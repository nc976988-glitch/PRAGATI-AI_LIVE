'use strict';
// The assistant endpoint: one message in → streamed answer out (Server-Sent Events over POST).
// Routing order:  device action (call / SMS / WhatsApp / apps / search)  →  memory & contacts
//                 →  approvable plan (tasks / reminders / study blocks)  →  AI answer (or offline brain).

const llm = require('./llm');
const knowledge = require('./knowledge');
const actions = require('./actions');
const brain = require('./brain');
const engine = require('./engine');
const nlu = require('./nlu');
const L = require('../public/js/lang-core.js');

const ACT_KINDS = new Set(['create_task', 'create_reminder', 'study_plan', 'daily_plan', 'clear_done', 'create_note']);
const QUESTION = /\?\s*$|^(what|why|how|who|when|where|which|should|can|could|would|is|are|do|does|did|explain|tell|kya|kaise|kyun|kyon|kab|kaun)\b|what should|kya karu|kya karun|advice/i;
const ACTION_TAG = /<<ACTION\s*(\{[\s\S]*?\})\s*>>/;
const INDIC_LATIN = new Set(['en', 'hi', 'hinglish']);
// Which language should Pragati answer in?  explicit switch ("reply in Tamil") > fixed setting > voice hint > detection > conversation's last language
function pickLang({ text, user, cv, hint }) {
  const sw = L.switchRequest(text);
  if (sw) { cv.lang = sw.code; cv.langLock = true; return { lang: sw, switched: true }; }
  if (/\b(auto(?:matic)?(?:ally)?\s*(?:detect|language)|any language|same language as me|apni bhasha)\b/i.test(text)) cv.langLock = false;
  const set = user.settings?.language;
  if (set && set !== 'auto' && L.byCode(set)) return { lang: L.byCode(set), fixed: true };
  if (cv.langLock && L.byCode(cv.lang)) return { lang: L.byCode(cv.lang) };
  const d = L.detect(text);
  const pick = (hint && L.byCode(hint)) || (d.confidence >= 0.5 ? L.byCode(d.code) : null) || L.byCode(cv.lang) || L.byCode(d.code) || L.byCode('en');
  cv.lang = pick.code;
  return { lang: pick };
}
const hindiish = (t) => /[ऀ-ॿ]/.test(t) || /\b(kya|hai|kaise|mujhe|aap|tum|batao|karo|kar do|bhejo|bolo|nahi|haan|mera|meri|ko)\b/i.test(t);

function register({ route, store, A, send, fail, str, ctxOf, apiLimit }) {
  // ── conversations ──
  route('GET', '/api/convos', (c) => send(c.res, 200, { items: store.list('convos', c.user.id).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt).slice(0, 200) }));
  route('GET', '/api/convos/:id', (c) => {
    const cv = store.get('convos', c.params.id, c.user.id); if (!cv) return fail(c.res, 404, 'not found');
    const msgs = store.db.chats.filter((m) => m.uid === c.user.id && m.convoId === cv.id);
    const plans = {}; for (const m of msgs) if (m.planId) { const p = store.get('plans', m.planId, c.user.id); if (p) plans[p.id] = p; }
    send(c.res, 200, { convo: cv, messages: msgs, plans });
  });
  route('PATCH', '/api/convos/:id', (c) => {
    const o = {}; if (c.body.title !== undefined) o.title = str(c.body.title, 80) || 'Untitled'; if (typeof c.body.pinned === 'boolean') o.pinned = c.body.pinned;
    const cv = store.update('convos', c.params.id, c.user.id, o); return cv ? send(c.res, 200, { convo: cv }) : fail(c.res, 404, 'not found');
  });
  route('DELETE', '/api/convos/:id', (c) => {
    const cv = store.remove('convos', c.params.id, c.user.id); if (!cv) return fail(c.res, 404, 'not found');
    store.db.chats = store.db.chats.filter((m) => !(m.uid === c.user.id && m.convoId === cv.id)); store.save();
    A.audit(store, c.user.id, 'convo.deleted', `Deleted conversation: ${cv.title}`, {});
    send(c.res, 200, { ok: true });
  });

  // ── speech-to-text in any language (AI engine) ──
  route('POST', '/api/ai/transcribe', async (c) => {
    if (!apiLimit('t' + c.user.id)) return fail(c.res, 429, 'Too many voice requests in a minute.');
    const data = String(c.body.audio || '').replace(/^data:[^,]+,/, '');
    if (data.length < 2000 || data.length > 14e6) return fail(c.res, 400, 'No usable audio.');
    if (!llm.info().ears) return fail(c.res, 501, 'AI speech recognition needs a Gemini, OpenAI or Groq key.');
    const contacts = store.list('contacts', c.user.id).slice(0, 20).map((x) => x.name);
    try {
      const r = await llm.transcribe({ data, mime: /^audio\/[\w.+-]+$/.test(c.body.mime) ? c.body.mime : 'audio/wav', hint: ['Pragati', ...contacts].join(', ') });
      const l = r.lang ? L.byCode(r.lang) : (r.text ? L.byCode(L.detect(r.text).code) : null);
      send(c.res, 200, { text: r.text, lang: l ? { code: l.code, name: l.name, native: l.native, locale: l.locale } : null });
    } catch (e) {
      console.error('[transcribe]', e.message);
      fail(c.res, /429/.test(e.message) ? 429 : 502, /429/.test(e.message) ? 'Voice engine is rate-limited — try again in a minute.' : 'Could not understand the audio.');
    }
  }, { limit: 16e6 });

  // ── the assistant ──
  route('POST', '/api/ai/chat', async (c) => {
    if (!apiLimit('a' + c.user.id)) return fail(c.res, 429, 'Slow down a little — too many messages in a minute.');
    const text = str(c.body.text, 8000);
    const images = (Array.isArray(c.body.images) ? c.body.images : []).slice(0, 4)
      .map((im) => ({ mime: /^image\/(png|jpe?g|webp|gif|heic)$/.test(im?.mime) ? im.mime : 'image/jpeg', data: String(im?.data || '').replace(/^data:[^,]+,/, '') }))
      .filter((im) => im.data.length > 100 && im.data.length < 7e6);
    if (!text && !images.length) return fail(c.res, 400, 'Say or type something first.');
    const mode = ['jarvis', 'study', 'web'].includes(c.body.mode) ? c.body.mode : 'jarvis';
    const ctx = ctxOf(c.req); const user = c.user; const uid = user.id;
    const keep = user.settings?.storeTranscripts !== false;

    // conversation
    let cv = c.body.convoId ? store.get('convos', c.body.convoId, uid) : null;
    if (!cv) cv = store.insert('convos', { id: store.id('cv'), uid, title: (text || 'Image question').replace(/\s+/g, ' ').slice(0, 60), mode, createdAt: Date.now(), updatedAt: Date.now() });
    const history = store.db.chats.filter((m) => m.uid === uid && m.convoId === cv.id).slice(-16);

    // stream
    const res = c.res;
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const ev = (event, data) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    const aborter = new AbortController(); c.req.on('close', () => { if (!res.writableEnded) aborter.abort(); });
    const info = llm.info();
    const { lang, switched, fixed } = pickLang({ text: text || '', user, cv, hint: typeof c.body.lang === 'string' ? c.body.lang : null });
    store.save();
    ev('meta', { convoId: cv.id, title: cv.title, engine: info, lang: { code: lang.code, name: lang.name, native: lang.native, locale: lang.locale }, switched: !!switched });
    const foreign = !INDIC_LATIN.has(lang.code);
    // canned (non-LLM) replies → user's language when the AI engine is available
    const localise = async (t) => {
      if (!foreign || !info.enabled || !t) return t;
      try { const o = await llm.complete({ system: `Translate the text into ${lang.name} (${lang.native}). Keep markdown, emojis, names, phone numbers and anything inside a > quote line unchanged. Output only the translation.`, user: t, maxTokens: 400, timeoutMs: 12000 }); return o.trim() || t; } catch (_) { return t; }
    };

    let reply = ''; let sources = []; let action = null; let plan = null; let image = null;
    const say = (t) => { reply += t; ev('delta', { t }); };
    const typeOut = async (t) => { for (const part of String(t).match(/[\s\S]{1,14}/g) || []) { say(part); await new Promise((r) => setTimeout(r, 8)); } };
    const contacts = store.list('contacts', uid); const memories = store.list('memories', uid);
    const hi = hindiish(text) || lang.code === 'hi' || lang.code === 'hinglish';

    try {
      const act = images.length ? null : actions.detect(text, contacts);
      if (act) {
        const h = await handleAction(act, { store, uid, user, contacts, memories, hi, A, info, text });
        action = h.action; await typeOut(await localise(h.reply));
        if (action) ev('action', action);
      } else {
        // approvable plan?
        const u = images.length ? { steps: [] } : nlu.understand(text, ctx);
        if (u.steps.some((s) => ACT_KINDS.has(s.kind)) && !QUESTION.test(text)) {
          const r = await engine.createPlan(store, user, text, ctx);
          if (r.plan) {
            plan = r.plan; plan.convoId = cv.id; store.save();
            ev('plan', plan);
            await typeOut(foreign ? await localise(`I've lined up **${plan.steps.length} step${plan.steps.length > 1 ? 's' : ''}** for you. Take a look — I'll run them the moment you approve.`) : hi ? `Maine **${plan.steps.length} step${plan.steps.length > 1 ? 's' : ''}** taiyaar kiye hain. Dekh lo — approve karte hi kar dunga.` : `I've lined up **${plan.steps.length} step${plan.steps.length > 1 ? 's' : ''}** for you. Take a look — I'll run them the moment you approve.`);
          }
        }
        if (!plan) {
          if (info.enabled) {
            let webCtx = null;
            if (!info.web || info.provider !== 'gemini') { const w = await knowledge.webContext(text); if (w) { webCtx = w.text; sources = w.sources; } }
            const system = brain.systemPrompt({ user, memories, contacts, ctx, mode, webCtx, engine: info, lang, langNote: switched ? 'switched' : fixed ? 'fixed' : 'auto' });
            const msgs = history.map((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', text: m.text }));
            msgs.push({ role: 'user', text: text || 'Please look at this image and help me with it. If it is a question or problem, solve it step by step.', images });
            let hidden = false;
            const out = await llm.stream({ system, messages: msgs, maxTokens: mode === 'study' ? 4096 : 2048, search: info.provider === 'gemini', signal: aborter.signal,
              onDelta: (d) => { reply += d; if (!hidden && reply.includes('<<ACTION')) hidden = true; ev('delta', { t: d }); } });
            reply = out.text;
            for (const s of out.sources) if (!sources.some((x) => x.url === s.url)) sources.push(s);
            const tag = reply.match(ACTION_TAG);
            if (tag) {
              reply = reply.replace(ACTION_TAG, '').trim();
              try {
                const j = JSON.parse(tag[1]);
                const a2 = toAction(j, contacts);
                if (a2) { const h = await handleAction(a2, { store, uid, user, contacts, memories, hi, A, info, text }); action = h.action; if (action) ev('action', action); }
              } catch (_) { /* malformed tag */ }
              ev('replace', { text: reply });
            }
          } else {
            // offline brain
            const small = switched ? brain.langAck(lang) : brain.offlineSmallTalk(text, user, ctx, lang);
            if (small) await typeOut(small);
            else if (images.length) await typeOut('I can see you sent an image. Reading photos and solving them needs the AI engine — add a free **Gemini API key** in `.env` (see README) and I\'ll solve it step by step.');
            else {
              const k = await knowledge.answer(text, { hindi: /[ऀ-ॿ]/.test(text), wiki: lang.wiki });
              if (k) { sources = k.sources; image = k.image || null; if (image) ev('image', { url: image }); await typeOut(k.md + (k.kind === 'wiki' ? `\n\n*Answered offline from Wikipedia${foreign ? ` (${lang.native})` : ''}. Add a free Gemini key for full AI answers with live Google Search${foreign ? ` — in ${lang.name} or any language` : ''}.*` : '')); }
              else await typeOut(hi ? `Is sawaal ka pakka jawab mere offline brain mein nahi hai. Main Google pe dhoondh deta hoon — ya \`.env\` mein free Gemini key daal do, phir main kuch bhi samjha sakta hoon.` : `I couldn't find a solid answer to that offline. I've opened a Google search for you below — or add a free Gemini key in \`.env\` and I can answer anything in full.`);
              if (!k) { action = { type: 'google', query: text, label: `Search Google for “${text.slice(0, 60)}”` }; ev('action', action); }
            }
          }
        }
      }
    } catch (e) {
      if (aborter.signal.aborted) { res.end(); return; }
      console.error('[assistant]', e.message);
      const msg = /429/.test(e.message) ? 'The AI engine is rate-limited right now (free tier quota). Give it a minute and try again.' : /401|403|API key|permission/i.test(e.message) ? 'The AI key was rejected. Check the key in your `.env` file and restart the server.' : `I hit a problem reaching the AI engine (${e.message.slice(0, 120)}).`;
      // graceful fallback to the offline brain
      let fb = null; try { fb = await knowledge.answer(text, { wiki: lang.wiki }); } catch (_) { /* none */ }
      if (fb) { sources = fb.sources; await typeOut(`${reply ? '\n\n' : ''}${fb.md}\n\n*${msg} Showing an offline answer instead.*`); } else await typeOut(`${reply ? '\n\n' : ''}${msg}`);
    }

    reply = reply.replace(ACTION_TAG, '').trim();
    cv.updatedAt = Date.now(); store.save();
    let msgId = null;
    if (keep) {
      store.insert('chats', { id: store.id('msg'), uid, convoId: cv.id, role: 'user', text: text || '[image]', images: images.length, ts: Date.now() });
      const m = store.insert('chats', { id: store.id('msg'), uid, convoId: cv.id, role: 'ai', text: reply, sources, action, image, planId: plan ? plan.id : null, ts: Date.now() });
      msgId = m.id;
    }
    ev('done', { convoId: cv.id, messageId: msgId, sources, text: reply });
    res.end();
  }, { limit: 30e6 });
}

// LLM <<ACTION>> tag → our action shape
function toAction(j, contacts) {
  const type = String(j.type || '').toLowerCase();
  const q = String(j.query || j.text || j.app || '').slice(0, 200);
  if (['call', 'sms', 'whatsapp'].includes(type)) {
    const who = String(j.to || '').slice(0, 60); if (!who) return null;
    const num = actions.phoneOf(who); const ct = num ? null : actions.findContact(contacts, who);
    return { type, to: num ? { name: who, phone: num, known: true } : ct ? { name: ct.name, phone: ct.phone, known: true, id: ct.id } : { name: who, phone: null, known: false, relation: actions.relOf(who) }, text: String(j.text || '').slice(0, 1000), confirm: true };
  }
  if (type === 'youtube') return q ? { type, query: q, play: true } : null;
  if (type === 'google') return q ? { type, query: q } : null;
  if (type === 'maps') return q ? { type, query: q } : null;
  if (type === 'open') return j.app || q ? { type, app: String(j.app || q) } : null;
  return null;
}

const COMPOSE = /^(wish|wishing|ask|asking|tell|telling|inform|informing|say sorry|apologi[sz]e|invite|inviting|congratulat|remind|thank)/i;

async function handleAction(act, { store, uid, user, contacts, memories, hi, A, info, text }) {
  const first = user.settings?.callMe || user.name.split(' ')[0];
  if (act.type === 'remember') {
    store.insert('memories', { id: store.id('mem'), uid, text: act.fact.slice(0, 300), createdAt: Date.now() });
    A.audit(store, uid, 'memory.saved', `Remembered: ${act.fact.slice(0, 80)}`, {});
    return { reply: hi ? `Yaad rakh liya: *“${act.fact}”*. Zaroorat padne par main khud yaad dila dunga.` : `Got it — I'll remember that: *“${act.fact}”*.`, action: { type: 'memory', label: 'Saved to memory' } };
  }
  if (act.type === 'forget') {
    const w = act.fact.toLowerCase().split(/\s+/).filter((x) => x.length > 2);
    const gone = memories.filter((m) => w.filter((x) => m.text.toLowerCase().includes(x)).length >= Math.max(1, Math.ceil(w.length * 0.6)));
    for (const m of gone) store.remove('memories', m.id, uid);
    return { reply: gone.length ? `Done — I've forgotten ${gone.length} thing${gone.length > 1 ? 's' : ''} about that.` : 'I didn\'t have anything like that saved.', action: null };
  }
  if (act.type === 'save_contact') {
    if (!act.phone) return { reply: 'I need a valid phone number to save that contact.', action: null };
    const ex = contacts.find((x) => x.name.toLowerCase() === act.name.toLowerCase() || (act.relation && x.relation === act.relation));
    if (ex) { ex.phone = act.phone; store.save(); } else store.insert('contacts', { id: store.id('ct'), uid, name: act.name, phone: act.phone, relation: act.relation || '', aliases: [], createdAt: Date.now() });
    A.audit(store, uid, 'contacts.saved', `Saved contact: ${act.name}`, {});
    return { reply: hi ? `**${act.name}** ka number save ho gaya (${act.phone}). Ab bas bolo *"${act.name} ko call karo"*.` : `Saved **${act.name}** — ${act.phone}. Now you can just say *"call ${act.name}"*.`, action: { type: 'contact_saved', label: `${act.name} · ${act.phone}` } };
  }
  if (['call', 'sms', 'whatsapp'].includes(act.type)) {
    const who = act.to.name;
    const instr = act.compose || (act.text && COMPOSE.test(act.text) ? act.text : null); delete act.compose;
    if (instr && info.enabled) {
      try { const t = await llm.complete({ system: `Write the actual message the user wants to send, in the same language they used (Hinglish stays Hinglish). Warm, natural, 1-3 sentences, no quotes, no preamble. Sender: ${user.name}. Recipient: ${who}.`, user: `Instruction: ${instr}\nOriginal request: ${text}`, maxTokens: 200 }); if (t.trim()) act.text = t.trim().replace(/^["']|["']$/g, ''); } catch (_) { /* keep raw */ }
    }
    const verb = act.type === 'call' ? 'Call' : act.type === 'sms' ? 'SMS' : 'WhatsApp';
    if (!act.to.phone && act.type !== 'whatsapp') {
      return { reply: hi ? `Mere paas abhi **${who}** ka number nahi hai. Neeche number daal do, main save karke turant ${act.type === 'call' ? 'call laga dunga' : 'message bhej dunga'}.` : `I don't have **${who}**'s number yet, ${first}. Add it below and I'll ${act.type === 'call' ? 'place the call' : 'send it'} right away.`, action: { ...act, needsContact: true, label: `${verb} ${who}` } };
    }
    A.audit(store, uid, `device.${act.type}`, `${verb} prepared for ${who}${act.to.phone ? ` (${act.to.phone})` : ''}`, {});
    const r = act.type === 'call'
      ? (hi ? `**${who}** ko call laga raha hoon…` : `Calling **${who}**…`)
      : act.type === 'sms'
        ? (act.text ? (hi ? `**${who}** ke liye SMS taiyaar hai:` : `SMS to **${who}** is ready:`) : (hi ? `**${who}** ke liye SMS khol raha hoon.` : `Opening SMS to **${who}**.`))
        : (act.text ? (hi ? `**${who}** ke liye WhatsApp message taiyaar hai:` : `WhatsApp message to **${who}** is ready:`) : (hi ? `**${who}** ki WhatsApp chat khol raha hoon.` : `Opening WhatsApp chat with **${who}**.`));
    return { reply: r + (act.text ? `\n\n> ${act.text}` : ''), action: { ...act, label: `${verb} ${who}` } };
  }
  if (act.type === 'youtube') return { reply: hi ? `YouTube pe **${act.query}** ${act.play ? 'chala' : 'dhoondh'} raha hoon.` : `${act.play ? 'Playing' : 'Searching'} **${act.query}** on YouTube.`, action: { ...act, label: `YouTube · ${act.query}` } };
  if (act.type === 'google') return { reply: hi ? `Google pe **${act.query}** search kar raha hoon.` : `Searching Google for **${act.query}**.`, action: { ...act, label: `Google · ${act.query}` } };
  if (act.type === 'maps') return { reply: act.near ? `Finding **${act.query}** near you on Maps.` : `Getting directions to **${act.query}**.`, action: { ...act, label: `Maps · ${act.query}` } };
  if (act.type === 'open') return { reply: hi ? `**${act.app}** khol raha hoon.` : `Opening **${act.app}**.`, action: { ...act, label: `Open ${act.app}` } };
  return { reply: '', action: null };
}

module.exports = { register, toAction };
