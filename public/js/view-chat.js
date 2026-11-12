// Pragati Chat — the main, ChatGPT / Gemini-style assistant surface.
// Streams answers over SSE, renders markdown + LaTeX + code, runs device actions,
// shows approvable plans inline, and supports hands-free voice conversation.
import { api, auth } from './api.js';
import { S, emit, on } from './state.js';
import { $, $$, esc, md, toast, sfx } from './util.js';
import { Orb } from './orb.js';
import { planHTML } from './plan.js';
import { mountAction, aicon } from './actions.js';
import { speak, stopSpeaking } from './speech.js';
import { hear, browserEars } from './ears.js';
import { openVoice, openLangPicker, langLabel, currentLang, aiEars, userLanguage } from './handsfree.js';

// ───────────── rich markdown (CDN libs, with offline fallback) ─────────────
const CDN = 'https://cdn.jsdelivr.net/npm/';
let libs = null;
function loadScript(src) { return new Promise((res) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = res; document.head.appendChild(s); }); }
function loadCss(href) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); }
export function loadLibs() {
  if (libs) return libs;
  loadCss(`${CDN}katex@0.16.11/dist/katex.min.css`); loadCss(`${CDN}highlight.js@11.10.0/styles/github-dark.min.css`);
  libs = Promise.all([
    loadScript(`${CDN}marked@14.1.3/marked.min.js`), loadScript(`${CDN}dompurify@3.1.7/dist/purify.min.js`),
    loadScript(`${CDN}katex@0.16.11/dist/katex.min.js`), loadScript(`${CDN}@highlightjs/cdn-assets@11.10.0/highlight.min.js`),
  ]).then(() => { window.marked?.setOptions?.({ gfm: true, breaks: true }); });
  return libs;
}

const cutAction = (t) => { const i = t.indexOf('<<'); return i >= 0 ? t.slice(0, i) : t; };
export function renderMd(src) {
  src = cutAction(String(src || ''));
  if (!window.marked || !window.DOMPurify) return md(src);
  const hold = []; const keep = (s) => `\u0000${hold.push(s) - 1}\u0000`;
  // protect code first, then maths
  src = src.replace(/```[\s\S]*?(```|$)/g, keep).replace(/`[^`\n]+`/g, keep);
  const maths = [];
  const m = (tex, display) => `@@MATH${maths.push([tex, display]) - 1}@@`;
  src = src.replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => m(t, true)).replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => m(t, true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => m(t, false)).replace(/(^|[^\\$\w])\$([^\s$](?:[^$\n]*?[^\s$])?)\$(?!\d)/g, (_, p, t) => p + m(t, false));
  src = src.replace(/\u0000(\d+)\u0000/g, (_, i) => hold[+i]);
  let html = window.DOMPurify.sanitize(window.marked.parse(src), { ADD_ATTR: ['target'] });
  html = html.replace(/@@MATH(\d+)@@/g, (_, i) => {
    const [tex, display] = maths[+i];
    try { return window.katex ? window.katex.renderToString(tex, { displayMode: display, throwOnError: false }) : esc(tex); } catch (_) { return esc(tex); }
  });
  return html;
}
function enhance(el) {
  el.querySelectorAll('a[href^="http"]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
  el.querySelectorAll('pre').forEach((pre) => {
    if (pre.dataset.x) return; pre.dataset.x = 1;
    const code = pre.querySelector('code'); if (code && window.hljs) { try { window.hljs.highlightElement(code); } catch (_) { /* noop */ } }
    const lang = (code?.className.match(/language-(\w+)/) || [])[1] || 'code';
    const bar = document.createElement('div'); bar.className = 'codebar'; bar.innerHTML = `<span>${esc(lang)}</span><button type="button">Copy</button>`;
    bar.querySelector('button').onclick = (e) => { navigator.clipboard?.writeText(code?.innerText || pre.innerText); e.target.textContent = 'Copied'; setTimeout(() => (e.target.textContent = 'Copy'), 1400); };
    pre.prepend(bar);
  });
  el.querySelectorAll('table').forEach((t) => { if (!t.parentElement.classList.contains('tablewrap')) { const w = document.createElement('div'); w.className = 'tablewrap'; t.replaceWith(w); w.appendChild(t); } });
}

// ───────────── speech out ─────────────
export { plain, stopSpeaking } from './speech.js';
export function speakOut(text, lang, onEnd) { return speak(text, { lang, onEnd }); }

// ───────────── image attach ─────────────
function downscale(file, max = 1280) {
  return new Promise((res, rej) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); const d = c.toDataURL('image/jpeg', 0.85); res({ mime: 'image/jpeg', data: d.split(',')[1], preview: d });
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not read that image')); };
    img.src = url;
  });
}

// ───────────── the view ─────────────
const MODES = [
  ['jarvis', 'Assistant', 'Personal advice, actions, anything'],
  ['study', 'Study', 'Step-by-step, every subject & exam'],
  ['web', 'Web', 'Fresh facts with sources'],
];
const greet = () => { const h = new Date().getHours(); return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const SUGGEST = [
  ['call', 'Call Mummy', 'Places a call through your phone'],
  ['whatsapp', 'Papa ko WhatsApp karo ki main 8 baje tak aaunga', 'Prefills the message'],
  ['youtube', 'Play lo-fi study music on YouTube', 'Opens YouTube'],
  ['study', 'Explain photosynthesis for Class 10 with a diagram in words', 'Study mode'],
  ['math', 'Solve: x² − 5x + 6 = 0 and show steps', 'Maths with steps'],
  ['life', 'I feel stressed about exams, what should I do?', 'Personal advice'],
  ['google', 'Latest news about ISRO', 'Live search'],
  ['plan', 'Plan my study for 2 hours and remind me at 7 pm', 'Approvable plan'],
];

export function mountChat(stage, app, convoId) {
  loadLibs();
  stage.classList.add('chatmode');
  let mode = localStorage.getItem('pragati.mode') || 'jarvis';
  let cid = convoId || null; let busy = false; let ctrl = null; let attach = []; let talk = false; let orb = null;
  const name = () => (S.user?.settings?.callMe || S.user?.name || '').split(' ')[0];

  stage.innerHTML = `<div class="chat">
    <div class="thread" id="thread"><div class="thread-in" id="tin"></div></div>
    <div class="dock">
      <div class="composer2" id="comp">
        <div class="att" id="att" hidden></div>
        <textarea id="ci" rows="1" placeholder="Ask Pragati anything — or say “call Mummy”…" aria-label="Message Pragati" maxlength="8000"></textarea>
        <div class="crow">
          <label class="cbtn" title="Add a photo (homework, diagram, bill…)"><input type="file" id="file" accept="image/*" multiple hidden><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></label>
          <div class="modes" role="radiogroup" aria-label="Mode">${MODES.map(([k, l, t]) => `<button type="button" role="radio" data-mode="${k}" title="${t}">${l}</button>`).join('')}</div>
          <button type="button" class="cbtn lbtn" id="lang" title="Language — Auto detects whatever language you use"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg><span id="langl"></span></button>
          <span class="sp"></span>
          <button type="button" class="cbtn vbtn" id="talk" title="Hands-free voice mode — talk in any language, with live captions"><svg viewBox="0 0 24 24"><path d="M3 14v-2a9 9 0 0 1 18 0v2"/><rect x="2" y="14" width="5" height="7" rx="2"/><rect x="17" y="14" width="5" height="7" rx="2"/></svg><span>Voice</span></button>
          <button type="button" class="cbtn" id="mic" title="Speak (V)"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button>
          <button type="button" class="sendbtn" id="send" title="Send (Enter)" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>
        </div>
      </div>
      <p class="fine">Pragati understands ${globalThis.PragatiLang?.LANGS.length || 137} languages and answers in yours. It can make mistakes — double-check important facts. Calls & messages open on your phone for you to confirm.</p>
    </div>
  </div>`;
  const tin = $('#tin', stage), thread = $('#thread', stage), ci = $('#ci', stage), sendB = $('#send', stage);

  const setMode = (m) => { mode = m; localStorage.setItem('pragati.mode', m); $$('[data-mode]', stage).forEach((b) => b.setAttribute('aria-checked', b.dataset.mode === m)); ci.placeholder = m === 'study' ? 'Ask any study question — any class, board or exam…' : m === 'web' ? 'Search the web with sources…' : 'Ask Pragati anything — or say “call Mummy”…'; };
  $$('[data-mode]', stage).forEach((b) => (b.onclick = () => { setMode(b.dataset.mode); ci.focus(); })); setMode(mode);

  const grow = () => { ci.style.height = 'auto'; ci.style.height = Math.min(220, ci.scrollHeight) + 'px'; ci.style.overflowY = ci.scrollHeight > 220 ? 'auto' : 'hidden'; };
  ci.oninput = grow;
  ci.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } };
  sendB.onclick = () => (busy ? stop() : submit());
  let hearing = null;
  const micBtn = $('#mic', stage);
  const quickMic = async () => {
    stopSpeaking();
    if (hearing) { hearing.cancel(); return; }
    if (!browserEars && !aiEars()) { toast('Voice needs Chrome or Edge', 'Or add a free Gemini key for AI ears that work in any browser — you can type meanwhile.', 'a'); return; }
    sfx('start'); micBtn.classList.add('on'); orb?.setMode('listening');
    const before = ci.value;
    hearing = hear({ locale: currentLang().locale, ai: aiEars(), onInterim: (t) => { ci.value = (before ? before + ' ' : '') + t; grow(); }, onLevel: (v) => orb?.setLevel(v),
      onPhase: (p) => { if (p === 'understanding') ci.placeholder = 'Understanding…'; if (p === 'denied') toast('Microphone blocked', 'Allow the mic in your browser, or type instead.', 'm', 6000); } });
    const res = await hearing.promise; hearing = null; micBtn.classList.remove('on'); orb?.setMode('idle'); setMode(mode);
    if (res?.text) { ci.value = (before ? before + ' ' : '') + res.text; grow(); submit({ text: ci.value, voice: true, lang: res.lang?.code || null }); }
    else ci.value = before;
  };
  micBtn.onclick = quickMic; app.chatMic = quickMic;
  $('#talk', stage).onclick = () => openVoice();
  const paintLang = () => { const l = $('#langl', stage); if (l) l.textContent = langLabel(); };
  $('#lang', stage).onclick = (e) => openLangPicker(e.currentTarget, paintLang); paintLang();
  const offLang = on('lang', paintLang);

  // attachments
  const renderAtt = () => { const a = $('#att', stage); a.hidden = !attach.length; a.innerHTML = attach.map((x, i) => `<figure><img src="${x.preview}" alt=""><button type="button" data-rm="${i}" aria-label="Remove">×</button></figure>`).join(''); };
  $('#att', stage).onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) { attach.splice(+b.dataset.rm, 1); renderAtt(); } };
  const addFiles = async (files) => { for (const f of [...files].filter((x) => x.type.startsWith('image/')).slice(0, 4 - attach.length)) { try { attach.push(await downscale(f)); } catch (err) { toast('Image', err.message, 'm'); } } renderAtt(); };
  $('#file', stage).onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
  ci.onpaste = (e) => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } };
  const comp = $('#comp', stage);
  comp.ondragover = (e) => { e.preventDefault(); comp.classList.add('drag'); }; comp.ondragleave = () => comp.classList.remove('drag');
  comp.ondrop = (e) => { e.preventDefault(); comp.classList.remove('drag'); addFiles(e.dataTransfer.files); };

  // voice hooks from the shell
  app.interim = (t) => { ci.value = t; grow(); };
  app.final = (t) => { ci.value = t; submit(); };
  app.submitIntent = (t) => { ci.value = t; submit(); };
  const offVoice = on('voice', (live) => { $('#mic', stage).classList.toggle('on', live); orb?.setMode(live ? 'listening' : 'idle'); });

  // ── empty state ──
  function empty() {
    tin.innerHTML = `<div class="hello">
      <div class="hello-orb"><canvas id="orb"></canvas></div>
      <h1><span class="grad">${greet()}${name() ? `, ${esc(name())}` : ''}.</span></h1>
      <p class="muted">I'm Pragati — your AI, like JARVIS but family. Ask me anything, or tell me to call, message, open apps, or plan your day.</p>
      <div class="sugg">${SUGGEST.map(([k, t, s]) => `<button type="button" class="sg" data-s="${esc(t)}"><span class="sg-k">${k === 'math' || k === 'study' ? '∑' : k === 'life' ? '♡' : k === 'plan' ? '✓' : aicon(k)}</span><b>${esc(t)}</b><small>${esc(s)}</small></button>`).join('')}</div>
    </div>`;
    orb?.destroy(); orb = new Orb($('#orb', tin)); app.orb = orb;
    $$('.sg', tin).forEach((b) => (b.onclick = () => { ci.value = b.dataset.s; submit(); }));
  }

  // ── messages ──
  const scroll = (force) => { const near = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 160; if (force || near) thread.scrollTop = thread.scrollHeight; };
  function userMsg(text, imgs = []) {
    const el = document.createElement('div'); el.className = 'msg user';
    el.innerHTML = `<div class="bubble">${imgs.map((x) => `<img class="uimg" src="${x.preview}" alt="attached image">`).join('')}${text ? `<div>${esc(text).replace(/\n/g, '<br>')}</div>` : ''}</div>`;
    tin.appendChild(el); return el;
  }
  function aiMsg() {
    const el = document.createElement('div'); el.className = 'msg ai';
    el.innerHTML = `<div class="ava"><i></i></div><div class="mc"><div class="md typing"><span class="dots"><i></i><i></i><i></i></span></div><div class="img"></div><div class="act"></div><div class="plans"></div><div class="srcs"></div><div class="tools" hidden>
      <button type="button" data-t="copy" title="Copy"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg></button>
      <button type="button" data-t="speak" title="Read aloud"><svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg></button>
      <button type="button" data-t="retry" title="Ask again"><svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4"/></svg></button>
    </div></div>`;
    tin.appendChild(el); return el;
  }
  function fill(el, m) {
    const body = $('.md', el); body.classList.remove('typing'); body.innerHTML = renderMd(m.text || ''); enhance(body);
    if (m.image) $('.img', el).innerHTML = `<img src="${esc(m.image)}" alt="" loading="lazy">`;
    if (m.sources?.length) $('.srcs', el).innerHTML = m.sources.slice(0, 8).map((s, i) => { let h = ''; try { h = new URL(s.url).hostname.replace(/^www\./, ''); } catch (_) { /* bad url */ } return `<a class="src" href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.title || h)}"><i>${i + 1}</i>${esc((s.title || h).slice(0, 42))}<small>${esc(h)}</small></a>`; }).join('');
    const tools = $('.tools', el); tools.hidden = false; el._text = m.text || '';
    tools.onclick = (e) => {
      const b = e.target.closest('[data-t]'); if (!b) return;
      if (b.dataset.t === 'copy') { navigator.clipboard?.writeText(el._text); toast('Copied', '', 'c', 1500); }
      if (b.dataset.t === 'speak') speak(el._text, { lang: el._lang || S.lastLang });
      if (b.dataset.t === 'retry') { const prev = el.previousElementSibling?.querySelector('.bubble div')?.textContent; if (prev) { ci.value = prev; submit(); } }
    };
  }

  async function open(id) {
    tin.innerHTML = '<div class="loadingc"><span class="dots"><i></i><i></i><i></i></span></div>';
    try {
      const r = await api('GET', `/api/convos/${id}`); tin.innerHTML = ''; cid = id; orb?.destroy(); orb = null;
      for (const p of Object.values(r.plans || {})) S.plans.set(p.id, p);
      for (const m of r.messages) {
        if (m.role === 'user') userMsg(m.text === '[image]' ? '' : m.text, []);
        else { const el = aiMsg(); fill(el, m); if (m.action) mountAction($('.act', el), m.action, { auto: false }); if (m.planId && r.plans[m.planId]) $('.plans', el).innerHTML = planHTML(r.plans[m.planId]); }
      }
      if (!r.messages.length) empty();
      scroll(true); emit('convo', id);
    } catch (err) { toast('Could not open chat', err.message, 'm'); cid = null; empty(); }
  }

  function stop() { ctrl?.abort(); stopSpeaking(); }
  async function submit(o = null) {
    const text = (o?.text ?? ci.value).trim(); if (busy || (!text && !attach.length)) return null;
    const hf = !!o?.onDelta; // driven by hands-free voice mode
    stopSpeaking();
    if (!tin.querySelector('.msg')) { tin.innerHTML = ''; orb?.destroy(); orb = null; app.orb = null; }
    const imgs = attach; attach = []; renderAtt(); ci.value = ''; grow();
    userMsg(text, imgs); const el = aiMsg(); scroll(true);
    busy = true; sendB.classList.add('stop'); sendB.innerHTML = '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>'; sfx('send');
    ctrl = new AbortController(); let acc = ''; let raf = 0; let final = null; let action = null; let image = null; let replyLang = null;
    const body = $('.md', el);
    const paint = () => { raf = 0; body.classList.remove('typing'); body.innerHTML = renderMd(acc) + '<span class="cur"></span>'; scroll(); };
    try {
      await loadLibs();
      const res = await fetch('/api/ai/chat', { method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.token}`, 'x-tz-offset': String(new Date().getTimezoneOffset()) }, body: JSON.stringify({ convoId: cid, text, mode, lang: o?.lang || null, images: imgs.map(({ mime, data }) => ({ mime, data })) }) });
      if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `Request failed (${res.status})`); }
      const rd = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = (chunk.match(/^event: (.*)$/m) || [])[1]; const data = (chunk.match(/^data: (.*)$/m) || [])[1]; if (!ev || !data) continue;
          let d; try { d = JSON.parse(data); } catch (_) { continue; }
          if (ev === 'meta') {
            if (!cid) { cid = d.convoId; history.replaceState(null, '', `#/chat:${cid}`); emit('convos'); }
            if (d.lang?.code) { replyLang = d.lang.code; if (userLanguage() === 'auto' || d.switched) S.lastLang = d.lang.code; paintLang(); if (d.switched) toast('Language', `${d.lang.native} — I'll keep talking in ${d.lang.name}.`, 'c'); }
            o?.onMeta?.(d);
          }
          else if (ev === 'delta') { acc += d.t; if (!raf) raf = requestAnimationFrame(paint); o?.onDelta?.(acc); }
          else if (ev === 'replace') { acc = d.text; if (!raf) raf = requestAnimationFrame(paint); o?.onDelta?.(acc); }
          else if (ev === 'image') { image = d.url; $('.img', el).innerHTML = `<img src="${esc(d.url)}" alt="" loading="lazy">`; }
          else if (ev === 'action') { action = d; if (hf) { o.onAction?.(d); mountAction($('.act', el), d, { auto: false }); } else mountAction($('.act', el), d, { auto: true, onSpeak: (t) => app.say(t) }); scroll(); }
          else if (ev === 'plan') { S.plans.set(d.id, d); $('.plans', el).innerHTML = planHTML(d); scroll(); }
          else if (ev === 'done') final = d;
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') { acc += `${acc ? '\n\n' : ''}**Couldn't finish that.** ${err.message}`; sfx('err'); }
      else acc += acc ? '' : '*Stopped.*';
    }
    cancelAnimationFrame(raf);
    const m = { text: final?.text ?? acc, sources: final?.sources || [], image };
    fill(el, m); scroll();
    busy = false; ctrl = null; sendB.classList.remove('stop'); sendB.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
    emit('convos'); if (action || $('.plans', el).innerHTML) emit('data');
    el._lang = replyLang;
    const speakIt = !hf && S.user?.settings?.speak !== false && (o?.voice || S.voice.lastWasVoice);
    S.voice.lastWasVoice = false;
    if (speakIt && m.text) speak(m.text, { lang: replyLang });
    if (!hf && !matchMedia('(pointer:coarse)').matches) ci.focus();
    return { text: m.text, lang: replyLang, action };
  }
  S.ask = (t, opts) => submit({ text: t, ...opts });
  const prevFinal = app.final; app.final = (t) => { S.voice.lastWasVoice = true; ci.value = t; submit(); };
  void prevFinal;

  if (cid) open(cid); else empty();
  setTimeout(() => ci.focus(), 80);
  app.keys = (e) => { if (e.key === 'Escape' && busy) stop(); };
  return () => { stage.classList.remove('chatmode'); orb?.destroy(); app.orb = null; offVoice(); offLang(); stop(); hearing?.cancel(); S.ask = null; app.chatMic = null; };
}
