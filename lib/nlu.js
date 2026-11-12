'use strict';
// Offline intent engine: English / Hindi (Devanagari) / Hinglish.
// Turns one utterance into an ordered, explainable list of proposed steps.
// Nothing here has side effects — it only PROPOSES. Execution lives in engine.js.

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const pad = (n) => String(n).padStart(2, '0');

const norm = (t) => String(t || '').toLowerCase().replace(/[“”"`]/g, '').replace(/\s+/g, ' ').trim();

// ---------- time understanding ----------
// `off` is Date#getTimezoneOffset() of the user (minutes, UTC - local).
function fmtLocal(ts, off, now) {
  const l = new Date(ts - off * 60000);
  const n = new Date(now - off * 60000);
  const dayDiff = Math.round((Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()) - Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())) / 86400000);
  let h = l.getUTCHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const t = `${h}:${pad(l.getUTCMinutes())} ${ap}`;
  if (dayDiff === 0) return `Today ${t}`;
  if (dayDiff === 1) return `Tomorrow ${t}`;
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][l.getUTCMonth()];
  return `${DAYS[l.getUTCDay()].slice(0, 3).replace(/^./, (c) => c.toUpperCase())}, ${l.getUTCDate()} ${mon} ${t}`;
}

function parseWhen(text, now, off) {
  const t = norm(text);
  const L = new Date(now - off * 60000); // "local wall clock stored as UTC"
  const base = { y: L.getUTCFullYear(), mo: L.getUTCMonth(), d: L.getUTCDate() };
  const toTs = (y, mo, d, h, mi) => Date.UTC(y, mo, d, h, mi) + off * 60000;

  // relative: "in 30 minutes", "2 ghante baad"
  let m = t.match(/(?:\bin\b|\bafter\b)\s+(\d+)\s*(minutes?|mins?|hours?|hrs?|ghante|ghanta|मिनट|घंटे|घंटा)/)
    || t.match(/(\d+)\s*(minutes?|mins?|hours?|hrs?|ghante|ghanta|मिनट|घंटे|घंटा)\s*(?:me|mein|baad|में|बाद)/);
  if (m) {
    const n = +m[1];
    const mult = /^(min|मिनट)/.test(m[2]) ? 60000 : 3600000;
    const ts = now + n * mult;
    return { ts, label: fmtLocal(ts, off, now), explicit: true, why: `relative time "${m[0]}"` };
  }

  // day
  let dayShift = null;
  if (/\b(tomorrow|tmrw|tommorow|kal|kl)\b|कल/.test(t)) dayShift = 1;
  if (/\b(day after tomorrow|parso|parson)\b|परसों/.test(t)) dayShift = 2;
  if (/\b(today|aaj|aj|tonight|tonite)\b|आज/.test(t)) dayShift = 0;
  for (let i = 0; i < 7; i++) {
    if (new RegExp(`\\b${DAYS[i]}\\b|\\b${DAYS[i].slice(0, 3)}\\b(?!\\w)`).test(t)) {
      dayShift = ((i - L.getUTCDay() + 7) % 7) || 7;
    }
  }

  // clock time
  let h = null; let mi = 0; let mer = null; let src = '';
  m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?!\w)/);
  if (m) { h = +m[1]; mi = +(m[2] || 0); mer = m[3][0] === 'a' ? 'am' : 'pm'; src = m[0]; }
  if (h === null) {
    m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(?:baje|bje|bajey|bajke|o'?clock)\b/) || t.match(/(\d{1,2})(?::(\d{2}))?\s*बजे/);
    if (m) { h = +m[1]; mi = +(m[2] || 0); src = m[0]; }
  }
  if (h === null) {
    m = t.match(/\b(?:at|by|@)\s+(\d{1,2})(?::(\d{2}))?\b/) || t.match(/\b(\d{1,2}):(\d{2})\b/);
    if (m) { h = +m[1]; mi = +(m[2] || 0); src = m[0]; }
  }
  const period =
    /\b(subah|subha|morning|savere)\b|सुबह/.test(t) ? 'am'
      : /\b(shaam|sham|evening|raat|night|tonight|tonite|dopahar|afternoon)\b|शाम|रात|दोपहर/.test(t) ? 'pm' : null;
  if (/\b(noon)\b|दोपहर 12/.test(t) && h === null) { h = 12; mer = 'pm'; }

  if (h === null && dayShift === null) {
    if (period === 'am' || period === 'pm') { h = period === 'am' ? 8 : 18; mer = period; src = period; } else return null;
  }
  if (h === null) { h = period === 'pm' ? 18 : 9; mer = period || 'am'; src = 'default'; }
  if (h > 23 || mi > 59) return null;

  if (h <= 12) {
    if (mer === 'pm' || (!mer && period === 'pm')) { if (h < 12) h += 12; }
    else if (mer === 'am' || (!mer && period === 'am')) { if (h === 12) h = 0; }
    else {
      // ambiguous 12h clock → choose the nearest future occurrence
      const cands = [h % 12, (h % 12) + 12];
      const day = dayShift ?? 0;
      const pick = cands.map((c) => toTs(base.y, base.mo, base.d + day, c, mi)).filter((ts) => ts > now);
      if (dayShift === null && pick.length) { return finish(pick[0]); }
      if (dayShift !== null) {
        // tomorrow 7 → 7 AM, tomorrow 4 → 4 PM
        h = h >= 7 && h <= 11 ? h : (h < 7 ? h + 12 : h);
      } else h += 12;
    }
  }
  const day = dayShift ?? 0;
  let ts = toTs(base.y, base.mo, base.d + day, h, mi);
  if (dayShift === null && ts <= now) ts += 86400000;
  return finish(ts);

  function finish(ts) {
    return { ts, label: fmtLocal(ts, off, now), explicit: true, why: `time "${src || 'inferred'}"` };
  }
}

// ---------- intent lexicon ----------
const RX = {
  reminder: /\b(remind\w*|reminder|alarm|alert me|yaad\s*dila\w*|yad\s*dila\w*|yaad\s*rakh\w*|notify me)\b|याद\s*दिला|रिमाइंडर|अलार्म/,
  email: /\b(e-?mail|mail|letter|application|message to)\b|ईमेल|मेल|पत्र/,
  send: /\b(send|bhej\w*|forward)\b|भेज/,
  study: /\b(study|studies|studying|padhai|padhna|padhun|padh\w*|revis\w+|exam|exams|prepare for|time ?table|syllabus|learn)\b|पढ़ाई|पढ़ना|पढ़|रिविजन|परीक्षा/,
  plan: /\b(plan|schedule|organi[sz]e|timetable|arrange)\b|योजना|प्लान/,
  notes: /\b(notes?|likh\w*|write[- ]?up|jot|draft)\b|नोट्स|नोट|लिख/,
  daily: /\b(get ready for|ready for tomorrow|plan my (day|tomorrow)|plan tomorrow|prepare for tomorrow|kal ke liye|kal ki taiyari|taiyari|taiyar|daily plan|aaj ka plan|day plan)\b|कल की तैयारी|तैयार|तैयारी|आज का प्लान/,
  explain: /\b(explain|samjh\w*|samjha\w*|what is|what are|kya hai|kya hota|define|meaning of|summari[sz]e|summary of|teach me)\b|समझा|क्या है|मतलब/,
  del: /\b(delete|clear|remove|hata\w*|mita\w*|saaf)\b|हटा|मिटा|डिलीट/,
  task: /\b(task|tasks|todo|to-do|to do|kaam|karna hai|karna he|add .{0,30} (to )?(my )?list|finish|complete|submit|buy|pay|book|finish)\b|काम|करना है/,
  unsupported: /\b(call|phone|dial|whatsapp|insta\w*|facebook|twitter|linkedin|tweet|publish|post (on|to)|laptop|computer|pc|shut ?down|spotify|play (some )?music|open (app|chrome)|uber|order)\b/,
  greet: /^(hi|hello|hey|namaste|namaskar|hii+|yo|sup|good (morning|evening|afternoon|night))\b|^नमस्ते/,
};

const UNSUPPORTED_MAP = [
  [/\b(call|phone|dial)\b/, 'Smart calls', 'Placing or routing calls needs telephony APIs, carrier consent and call-recording rules.'],
  [/\b(whatsapp|insta\w*|facebook|twitter|tweet|linkedin|publish|post (on|to))\b/, 'Social workflows', 'Publishing needs each platform\'s official API, scopes and review.'],
  [/\b(laptop|computer|pc|shut ?down|open (app|chrome))\b/, 'Connected laptop', 'Controlling a device needs secure pairing and an approved-command list.'],
  [/\b(spotify|play (some )?music|uber|order)\b/, 'Connected services', 'Third-party actions need OAuth connections you have not granted.'],
];

const FILLER = /\b(please|pls|plz|zara|na|yaar|mujhe|mere liye|meri|mera|mere|my|me|for me|can you|could you|will you|i want to|i need to|i have to|i wanna|jarvis|pragati|hey|ok|okay)\b|कृपया|मुझे|मेरे लिए|मेरी|मेरा/g;

function stripFiller(s) { return s.replace(FILLER, ' ').replace(/\s+/g, ' ').trim(); }
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// split into clauses. Strong separators always split; "and/aur" only split when BOTH
// sides carry an intent (so "physics aur maths" stays together).
const hasIntent = (c) => ['reminder', 'email', 'study', 'notes', 'daily', 'explain', 'del', 'task', 'unsupported'].some((k) => RX[k].test(norm(c)));

function splitClauses(text) {
  const strong = text
    .split(/\s*(?:,|;|\.(?!\d)|\bphir\b|\bfir\b|\bthen\b|\band then\b|\bafter that\b|\buske baad\b|फिर|\balso\b)\s*/i)
    .map((p) => p.trim()).filter(Boolean);
  const out = [];
  for (const part of strong) {
    const pieces = part.split(/(\s+(?:and|aur|और)\s+)/i);
    let cur = pieces[0];
    for (let i = 1; i < pieces.length; i += 2) {
      const right = pieces.slice(i + 1).join('');
      if (hasIntent(cur) && hasIntent(right)) { out.push(cur.trim()); cur = pieces[i + 1] || ''; }
      else cur += pieces[i] + (pieces[i + 1] || '');
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

function mergeClauses(parts) {
  const out = [];
  for (const p of parts) {
    if (hasIntent(p) || RX.plan.test(norm(p)) || !out.length) out.push(p);
    else out[out.length - 1] += ` and ${p}`;
  }
  return out;
}

function extractSubjects(c) {
  let s = '';
  const h = c.match(/(?:kal|aaj|today|tomorrow)?\s*([a-z][a-z .&+]{2,50}?)\s+(?:padhna|padhni|padhai|padhunga|padhungi|padh)\b/);
  if (h) s = h[1].replace(/\b(mujhe|mereko|i need to|i have to|kal|aaj|tomorrow|today|ko|ka|ki|plan|my)\b/g, ' ').trim();
  if (!s) {
    const m = c.match(/\b(?:for|of|on|about|ke liye|par|pe)\s+([a-z][a-z .&/+-]{2,60})$/i)
      || c.match(/(?:study|revise|revision)\s+(?:of\s+|for\s+)?([a-z][a-z .&/+-]{2,60})$/i);
    s = m ? m[1] : '';
  }
  s = s.replace(/\b(tomorrow|today|tonight|kal|aaj|at|by|baje|in|after)\b.*$/i, '').trim();
  const list = s.split(/\s*(?:,|\band\b|\baur\b|&|\+)\s*/i).map((x) => x.trim())
    .filter((x) => x && x.length > 1 && !/^(my|the|exam|exams|study|studies|hai|he|karna|hona|mujhe|ko)$/i.test(x));
  return list.slice(0, 4).map((x) => (x.length <= 4 ? x.toUpperCase() : cap(x)));
}

function titleFrom(c, extraStrips = []) {
  let s = norm(c);
  for (const rx of extraStrips) s = s.replace(rx, ' ');
  s = s.replace(/\b(in|after)\s+\d+\s*[a-z]+\b/g, ' ').replace(/\d+\s*(minutes?|mins?|hours?|ghante|ghanta)\s*(me|mein|baad)\b/g, ' ')
    .replace(/\d{1,2}(:\d{2})?\s*बजे/g, ' ').replace(/\b(at|by|in)\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b/g, ' ')
    .replace(/\b\d{1,2}(:\d{2})?\s*(am|pm|baje|bje)\b/g, ' ')
    .replace(/\b(tomorrow|today|tonight|kal|aaj|parso|subah|shaam|raat|morning|evening|night)\b|कल|आज|शाम|सुबह|रात|बजे/g, ' ');
  s = stripFiller(s)
    .replace(/\b(dila dena|dila do|dila de|dilao|dena|de do|karo|kar do|kardo|lagao|laga do|laga dena|laga de|banao|bana do|bana dena|batao)\b|लगाओ|लगा दो|करो|कर दो|दिलाओ|बनाओ/g, ' ')
    .replace(/\s+/g, ' ').trim()
    .replace(/\b(to|ko|ki|ka|ke|hai|he|h|na)\b$/g, '').replace(/^(to|ko)\b/, '').trim();
  return cap(s);
}

function studyBlocks(subj, now) {
  const start = Math.ceil((now + 15 * 60000) / 300000) * 300000;
  return [
    { title: `Learn — ${subj}`, mins: 40, kind: 'learn' },
    { title: `Practice problems — ${subj}`, mins: 30, kind: 'practice' },
    { title: `Active recall & revise — ${subj}`, mins: 20, kind: 'recall' },
  ].map((b, i) => ({ ...b, start: start + i * 55 * 60000 }));
}

// ---------- clause → step(s) ----------
function stepsForClause(raw, ctx, state) {
  const c = norm(raw);
  const when = parseWhen(c, ctx.now, ctx.off);
  const out = [];
  const mk = (kind, title, detail, reason, risk, payload) => ({ kind, title, detail, reason, risk: risk || 'low', payload: payload || {} });

  // unsupported (honest status) — checked first so "call mom" doesn't become a task
  if (RX.unsupported.test(c) && !RX.reminder.test(c)) {
    const hit = UNSUPPORTED_MAP.find(([rx]) => rx.test(c)) || [null, 'Roadmap', 'Needs a separate feasibility check.'];
    out.push(mk('blocked', `Not available yet: ${cap(stripFiller(c)).slice(0, 60)}`, hit[2], `Matches roadmap track “${hit[1]}”. Shown honestly instead of pretending.`, 'consequential', { track: hit[1] }));
    return out;
  }

  if (RX.del.test(c) && /(done|completed|finished|tasks?|notes?|reminders?|purane|old)/.test(c)) {
    const which = /note/.test(c) ? 'notes' : /reminder/.test(c) ? 'reminders' : 'tasks';
    out.push(mk('clear_done', `Clear completed ${which}`, `Permanently removes ${which} already marked done. A snapshot is kept so you can undo.`, 'Destructive requests always need your explicit confirmation.', 'consequential', { which }));
    return out;
  }

  if (RX.reminder.test(c)) {
    let title = titleFrom(c, [/\b(remind\w*|reminder|alarm|alert me|notify me)\b/g, /याद\s*दिला\w*|रिमाइंडर|अलार्म/g, /\b(yaad|yad)\s*dila\w*/g, /\b(set|a|an|the)\b/g]);
    if (!title || title.length < 3) title = state.lastTopic ? `${state.lastTopic}` : 'Pragati reminder';
    let at = when;
    if (!at) {
      const ts = ctx.now + 3600000;
      at = { ts, label: fmtLocal(ts, ctx.off, ctx.now), explicit: false, why: 'no time given → default +1 hour' };
    }
    out.push(mk('create_reminder', `Reminder: ${title}`, at.label, `Heard “remind”. Time understood from ${at.why}.`, 'low', { title, at: at.ts, label: at.label }));
    state.lastReminder = out[0];
    return out;
  }

  if (RX.email.test(c) && !RX.reminder.test(c)) {
    const to = (c.match(/\b(?:to|ko)\s+([a-z][a-z .']{2,30}?)(?:\s+(?:about|regarding|for|ke baare mein|ki|ka)\b|$)/) || [])[1] || '';
    const about = (c.match(/\b(?:about|regarding|for|ke baare mein)\s+(.{3,60})$/) || [])[1] || '';
    const subject = cap(stripFiller(about.replace(/\b(and|aur)\s+(send|bhej)\w*.*$/, '')) || 'Quick update');
    const recipient = cap(to.replace(/^(my|the)\s+/, '').trim());
    out.push(mk('draft_message', `Draft message${recipient ? ` to ${recipient}` : ''}`, `Subject: ${subject}`, 'Drafts are saved for your review — nothing is sent from here.', 'low', { to: recipient, subject, kind: /letter|application/.test(c) ? 'letter' : 'email' }));
    if (RX.send.test(c)) {
      out.push(mk('blocked', 'Send the message', 'Sending needs a connected mail account and your explicit approval per message.', 'Honest limit: the MVP drafts, it does not send.', 'consequential', { track: 'Connected services' }));
    }
    return out;
  }

  if (RX.study.test(c) || (RX.plan.test(c) && /\b(study|studies|padhai|exam|revision)\b/.test(c)) || /पढ़ाई|रिविजन/.test(c)) {
    const subjects = extractSubjects(c);
    const subj = subjects.length ? subjects.join(' + ') : 'your syllabus';
    state.lastTopic = subjects.length ? `Study: ${subj}` : 'Study session';
    const blocks = studyBlocks(subj, ctx.now);
    out.push(mk('study_plan', `Study plan · ${subj}`, '3 focused blocks · 90 min with short breaks', 'Intent: study. Split into learn → practice → recall, the order that retains best.', 'low', { subjects, blocks }));
    return out;
  }

  if (RX.daily.test(c)) {
    out.push(mk('daily_plan', 'Tomorrow-ready briefing', 'Pulls your open tasks & reminders into one briefing + an evening prep reminder', 'Intent: get ready. Groups tasks, notes and reminders — no outside data used.', 'low', { dayShift: /today|aaj|आज/.test(c) ? 0 : 1 }));
    return out;
  }

  if (RX.explain.test(c)) {
    const topic = titleFrom(c, [/\b(explain|samjh\w*|samjha\w*|what is|what are|kya hai|kya hota hai|define|meaning of|summari[sz]e|summary of|teach me)\b/g, /समझा\w*|क्या है|मतलब/g, /\b(about|of|the|a|an)\b/g]) || 'this topic';
    state.lastTopic = `Study: ${topic}`;
    out.push(mk('explain', `Explain: ${topic}`, 'Grounded in your Study library when possible', 'Intent: understand. Uses your own documents first, then the AI engine if connected.', 'low', { topic }));
    return out;
  }

  if (RX.notes.test(c)) {
    let topic = titleFrom(c, [/\b(finish|complete|write|make|create|draft|likh\w*|jot|take|notes?|write[- ]?up|bana\w*)\b/g, /नोट्स|नोट|लिख\w*/g, /\b(down|up|the|a|an|on|about|of)\b/g]);
    if (!topic || topic.length < 3) topic = state.lastTopic ? state.lastTopic.replace(/^Study:\s*/, '') : 'Untitled';
    out.push(mk('create_note', `Notes · ${topic}`, 'Draft prepared with an outline you can edit', 'Intent: notes. A structured draft is created — you stay the author.', 'low', { topic }));
    return out;
  }

  if (RX.task.test(c) || RX.plan.test(c)) {
    let title = titleFrom(c, [/\b(add|create|make|new|task|tasks|todo|to-do|to do|list|karna hai|karna he|kaam|plan|schedule)\b/g, /काम|करना है/g, /\b(to|the|a|an)\b/g]);
    if (!title) title = cap(stripFiller(c)).slice(0, 60);
    if (!title) return out;
    out.push(mk('create_task', `Task: ${title}`, when ? `Due ${when.label}` : 'No due time', 'Intent: add to your list.', 'low', { title, due: when ? when.ts : null, priority: /urgent|important|asap|jaldi|जरूरी/.test(c) ? 'high' : 'normal' }));
    return out;
  }
  return out;
}

// ---------- public API ----------
function understand(text, ctx) {
  const raw = String(text || '').trim().slice(0, 600);
  const lang = /[ऀ-ॿ]/.test(raw) ? 'hi' : /\b(kal|aaj|mujhe|karna|karo|baje|shaam|subah|raat|padhai|yaad|dila|samjha|hai|kya|aur|phir|mera|meri|mere)\b/i.test(raw) ? 'hinglish' : 'en';
  const n = norm(raw);

  if (!n) return { lang, steps: [], chat: true };
  if (RX.greet.test(n) && n.split(' ').length <= 4) return { lang, steps: [], chat: true, greet: true };

  const clauses = mergeClauses(splitClauses(raw));
  const state = {};
  const steps = [];
  for (const c of clauses) steps.push(...stepsForClause(c, ctx, state));

  // second pass: a reminder that was created before its subject was known
  if (state.lastTopic) {
    for (const s of steps) {
      if (s.kind === 'create_reminder' && /^Reminder: Pragati reminder$/.test(s.title)) {
        s.title = `Reminder: ${state.lastTopic}`;
        s.payload.title = state.lastTopic;
      }
    }
  }
  // dedupe identical titles
  const seen = new Set();
  const uniq = steps.filter((s) => (seen.has(s.title) ? false : seen.add(s.title)));
  uniq.forEach((s, i) => { s.id = `s${i + 1}`; s.status = s.kind === 'blocked' ? 'blocked' : 'proposed'; });
  return { lang, steps: uniq, chat: uniq.length === 0 };
}

module.exports = { studyBlocks, understand, parseWhen, fmtLocal, norm };
