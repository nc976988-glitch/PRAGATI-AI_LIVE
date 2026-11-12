// Hands-free voice mode — like Gemini Live / ChatGPT voice, with live text captions.
//  • Talk in any language; Pragati works out the language itself and answers in it (spoken + on-screen text).
//  • Fully hands-free texting & calling: "WhatsApp Papa" → "What should I say?" → you speak → it opens, pre-filled.
//    Unknown number? It asks for the number by voice. Every call/message shows a countdown you can stop by
//    saying "cancel" / "ruko" (or go now with "send" / "haan").
//  • Type while in voice mode — answers are still spoken and captioned.
//  • Optional "Hey Pragati" wake word.
import './lang-core.js';
import { S, emit } from './state.js';
import { $, esc, toast, sfx } from './util.js';
import { api } from './api.js';
import { Orb } from './orb.js';
import { hear, listenForWords, WakeWord, browserEars, canRecord } from './ears.js';
import { speak, stopSpeaking, sentences } from './speech.js';
import { mountAction, aicon } from './actions.js';

const PL = globalThis.PragatiLang;
const GLOBE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>';

// short UI phrases Pragati says itself (English, Hinglish, Hindi; other languages fall back to English + captions)
const PH = {
  en: { listen: 'Listening…', think: 'Thinking…', und: 'Understanding…', speak: 'Speaking…', paused: 'Paused — tap the orb to talk', what: (n) => `What should I say to ${n}?`, num: (n) => `What is ${n}'s phone number?`, badnum: 'Sorry, I did not catch a full number. Please say it again, digit by digit.', cancelled: 'Okay, cancelled.', hi: 'I\'m listening. Speak in any language.', nothing: 'I didn\'t hear anything.', say: 'Say “cancel” to stop · “send” to go now' },
  hinglish: { listen: 'Sun raha hoon…', think: 'Soch raha hoon…', und: 'Samajh raha hoon…', speak: 'Bol raha hoon…', paused: 'Ruka hua — baat karne ke liye orb dabao', what: (n) => `${n} ko kya bolna hai?`, num: (n) => `${n} ka number kya hai?`, badnum: 'Number poora samajh nahi aaya. Ek ek digit karke dobara bolo.', cancelled: 'Theek hai, cancel kar diya.', hi: 'Bolo, main sun raha hoon. Kisi bhi bhasha mein.', nothing: 'Kuch sunai nahi diya.', say: '“cancel” / “ruko” bolo rokne ke liye · “bhejo” / “haan” abhi ke liye' },
  hi: { listen: 'सुन रहा हूँ…', think: 'सोच रहा हूँ…', und: 'समझ रहा हूँ…', speak: 'बोल रहा हूँ…', paused: 'रुका हुआ — बात करने के लिए ऑर्ब दबाएँ', what: (n) => `${n} को क्या बोलना है?`, num: (n) => `${n} का नंबर क्या है?`, badnum: 'नंबर पूरा समझ नहीं आया। एक-एक अंक करके दोबारा बोलिए।', cancelled: 'ठीक है, रद्द कर दिया।', hi: 'बोलिए, मैं सुन रहा हूँ। किसी भी भाषा में।', nothing: 'कुछ सुनाई नहीं दिया।', say: '“रुको” बोलें रोकने के लिए · “हाँ” अभी के लिए' },
};
const ph = (code) => PH[code] || PH.en;
const CANCEL = /\b(cancel|stop|no|nahi|nahin|mat|ruko|ruk jao|rehne do|wait|don'?t|annuler|cancela|cancelar|stopp|abbrechen|annulla|отмена|стоп)\b|रुको|मत|नहीं|रहने दो|ரத்து|వద్దు|ਰੁਕੋ/i;
const GO = /\b(yes|yeah|yep|send|send it|go|call now|haan|ha|han|bhejo|bhej do|kar do|lagao|theek hai|ok|okay|sí|si|oui|ja|da|evet)\b|हाँ|हां|भेजो|ठीक है|ஆம்|అవును/i;
const EXIT = /^(exit|close|stop listening|end( voice)?( mode)?|goodbye|bye|bye bye|that'?s all|band karo|bas|bas karo|alvida|tata|अलविदा|बंद करो|बस)\.?$/i;

let el = null; let orb = null; let st = null; let wake = null;
const pref = (k, d) => { const v = localStorage.getItem(`pragati.${k}`); return v === null ? d : v === '1'; };
const setPref = (k, v) => localStorage.setItem(`pragati.${k}`, v ? '1' : '0');

export function userLanguage() { return S.user?.settings?.language || 'auto'; }
export function currentLang() {
  const fixed = userLanguage(); if (fixed !== 'auto') return PL.byCode(fixed) || PL.byCode('en');
  return PL.byCode(S.lastLang) || PL.byCode((navigator.language || '').startsWith('en') ? 'en' : navigator.language) || PL.byCode('en');
}
export const aiEars = () => !!S.engine?.ears && canRecord && pref('aiEars', true);

// ───────────── language picker (shared with the chat composer) ─────────────
export function openLangPicker(anchor, onPick) {
  document.querySelectorAll('.lpick').forEach((x) => x.remove());
  const cur = userLanguage();
  const pop = document.createElement('div'); pop.className = 'lpick glass'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Language');
  const row = (code, name, native, sub) => `<button type="button" data-l="${code}" class="${cur === code ? 'on' : ''}"><b>${esc(native)}</b><small>${esc(name)}${sub ? ` · ${esc(sub)}` : ''}</small></button>`;
  const list = (q) => [row('auto', 'Pragati detects your language', 'Auto-detect', 'recommended')]
    .concat(PL.LANGS.filter((l) => !q || `${l.name} ${l.native} ${l.code}`.toLowerCase().includes(q)).map((l) => row(l.code, l.name, l.native))).join('');
  pop.innerHTML = `<div class="lp-h"><b>Language</b><small>${PL.LANGS.length} languages · Auto answers in whatever language you use</small></div><input type="search" placeholder="Search languages…" aria-label="Search languages"><div class="lp-list">${list('')}</div>`;
  document.body.appendChild(pop);
  const r = anchor ? anchor.getBoundingClientRect() : { left: innerWidth / 2 - 160, top: innerHeight * 0.18, bottom: innerHeight * 0.18 }; const w = Math.min(320, innerWidth - 16);
  pop.style.width = `${w}px`; pop.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left))}px`;
  if (r.top > innerHeight / 2) pop.style.bottom = `${innerHeight - r.top + 8}px`; else pop.style.top = `${r.bottom + 8}px`;
  const inp = pop.querySelector('input'); inp.oninput = () => { pop.querySelector('.lp-list').innerHTML = list(inp.value.toLowerCase().trim()); };
  setTimeout(() => inp.focus(), 30);
  pop.onclick = async (e) => {
    const b = e.target.closest('[data-l]'); if (!b) return; e.stopPropagation();
    const code = b.dataset.l; pop.remove();
    try { const r2 = await api('PATCH', '/api/me', { settings: { language: code } }); S.user = r2.user; } catch (err) { toast('Could not change language', err.message, 'm'); return; }
    if (code !== 'auto') S.lastLang = code;
    const l = PL.byCode(code);
    toast('Language', code === 'auto' ? 'Auto-detect — I\'ll answer in whatever language you speak or type.' : `${l.native} — I'll listen and answer in ${l.name}.`, 'c');
    emit('lang'); onPick?.(code);
  };
  const off = (e) => { if (!pop.contains(e.target) && (!anchor || (e.target !== anchor && !anchor.contains(e.target)))) { pop.remove(); removeEventListener('pointerdown', off, true); } };
  setTimeout(() => addEventListener('pointerdown', off, true), 0);
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') pop.remove(); });
}
export function langLabel() {
  const c = userLanguage(); if (c !== 'auto') return PL.byCode(c)?.native || c;
  const l = S.lastLang && PL.byCode(S.lastLang); return l && l.code !== 'en' ? `Auto · ${l.native}` : 'Auto';
}

// ───────────── the overlay ─────────────
function build() {
  el = document.createElement('div'); el.className = 'vm'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Hands-free voice mode');
  el.innerHTML = `<div class="vm-glow"></div>
    <div class="vm-top">
      <button type="button" class="vm-chip" id="vmlang" title="Language">${GLOBE}<span></span></button>
      <span class="vm-ears" id="vmears"></span>
      <button type="button" class="vm-x" id="vmx" aria-label="Close voice mode">×</button>
    </div>
    <div class="vm-mid">
      <button type="button" class="vm-orb" id="vmorb" aria-label="Tap to talk or interrupt"><canvas></canvas></button>
      <div class="vm-phase" id="vmphase" aria-live="polite"></div>
    </div>
    <div class="vm-caps" id="vmcaps" aria-live="polite">
      <div class="vm-you" id="vmyou"></div>
      <div class="vm-ai" id="vmai"></div>
    </div>
    <div class="vm-act" id="vmact"></div>
    <form class="vm-type" id="vmtype" hidden><input id="vmin" autocomplete="off" placeholder="Type here — Pragati still answers out loud" aria-label="Type a message"><button type="submit" class="sendbtn" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></form>
    <div class="vm-bar">
      <button type="button" class="vm-b" id="vmmute" title="Pause / resume listening"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><span>Pause</span></button>
      <button type="button" class="vm-b" id="vmkbd" title="Type instead"><svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg><span>Type</span></button>
      <button type="button" class="vm-b" id="vmcc" title="Captions on / off"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 10.5a2 2 0 1 0 0 3M17 10.5a2 2 0 1 0 0 3"/></svg><span>Captions</span></button>
      <button type="button" class="vm-b" id="vmwake" title="Say “Hey Pragati” to start voice mode any time"><svg viewBox="0 0 24 24"><path d="M12 3v3M5.6 5.6l2.1 2.1M3 12h3M18 12h3M16.3 7.7l2.1-2.1"/><circle cx="12" cy="14" r="5"/></svg><span>Hey Pragati</span></button>
      <button type="button" class="vm-b end" id="vmend" title="End voice mode"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg><span>End</span></button>
    </div>`;
  document.body.appendChild(el);
  orb = new Orb(el.querySelector('canvas'));
  $('#vmx', el).onclick = close; $('#vmend', el).onclick = close;
  $('#vmlang', el).onclick = (e) => openLangPicker(e.currentTarget, () => { paintTop(); if (st.phase === 'listening') { st.hearing?.cancel(); setTimeout(listen, 150); } });
  $('#vmorb', el).onclick = () => {
    if (st.phase === 'speaking') { stopSpeaking(); st.onSpoken?.(); return; }
    if (st.phase === 'listening') { st.hearing?.cancel(); setPhase('paused'); return; }
    if (st.phase === 'paused' || st.phase === 'idle') { st.misses = 0; listen(); }
  };
  $('#vmmute', el).onclick = () => { if (st.phase === 'paused') { st.misses = 0; listen(); } else { st.hearing?.cancel(); stopSpeaking(); setPhase('paused'); } };
  $('#vmkbd', el).onclick = () => { const f = $('#vmtype', el); f.hidden = !f.hidden; if (!f.hidden) { st.hearing?.cancel(); setPhase('paused'); $('#vmin', el).focus(); } };
  $('#vmtype', el).onsubmit = (e) => { e.preventDefault(); const v = $('#vmin', el).value.trim(); if (!v) return; $('#vmin', el).value = ''; stopSpeaking(); st.hearing?.cancel(); handle(v, null, true); };
  $('#vmcc', el).onclick = () => { const on = !pref('captions', true); setPref('captions', on); el.classList.toggle('nocap', !on); $('#vmcc', el).classList.toggle('on', on); };
  $('#vmwake', el).onclick = () => setWake(!pref('wake', false));
  el.classList.toggle('nocap', !pref('captions', true)); $('#vmcc', el).classList.toggle('on', pref('captions', true));
  $('#vmwake', el).classList.toggle('on', pref('wake', false));
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}
function paintTop() {
  if (!el) return;
  $('#vmlang span', el).textContent = langLabel();
  $('#vmears', el).innerHTML = aiEars() ? '<i class="ok"></i>AI ears · understands any language' : browserEars ? `<i></i>Browser ears · ${esc(currentLang().native)}` : '<i class="bad"></i>Voice input not supported here — type below';
}
function setPhase(p, extra) {
  st.phase = p; const P = ph(currentLang().code);
  const txt = { listening: P.listen, understanding: P.und, thinking: P.think, speaking: P.speak, paused: P.paused, idle: P.paused }[p] || '';
  $('#vmphase', el).textContent = extra || txt; el.dataset.phase = p;
  orb?.setMode(p === 'listening' ? 'listening' : p === 'thinking' || p === 'understanding' ? 'thinking' : p === 'speaking' ? 'speaking' : 'idle');
  clearInterval(st.pulse); if (p === 'speaking') { let k = 0; st.pulse = setInterval(() => orb?.setLevel(0.25 + 0.35 * Math.abs(Math.sin((k += 0.45)))), 90); } else if (p !== 'listening') orb?.setLevel(0);
}
const you = (t, live) => { const y = $('#vmyou', el); y.classList.toggle('live', !!live); y.innerHTML = t ? `<span class="who">You</span>${esc(t)}` : ''; };
function aiCaption(text, idx = -1, parts = null) {
  const a = $('#vmai', el); if (!text && !parts) { a.innerHTML = ''; return; }
  if (parts) { a.innerHTML = `<span class="who">Pragati</span>${parts.map((s, i) => `<span class="${i === idx ? 'cap-now' : i < idx ? 'cap-past' : 'cap-next'}">${esc(s)} </span>`).join('')}`; a.querySelector('.cap-now')?.scrollIntoView({ block: 'nearest' }); return; }
  a.innerHTML = `<span class="who">Pragati</span>${esc(sentences(text).join(' ').slice(-420))}`; a.scrollTop = a.scrollHeight;
}

// say something (short UI line or a full answer) with captions, then resolve
function say(text, lang) {
  return new Promise((resolve) => {
    if (!text) { resolve(); return; }
    setPhase('speaking');
    let finished = false; const end = () => { if (finished) return; finished = true; st.onSpoken = null; resolve(); };
    st.onSpoken = end;
    const parts = sentences(text);
    const r = speak(text, { lang, onSentence: (i) => aiCaption(null, i, parts), onEnd: (ok) => { if (!ok) aiCaption(null, parts.length - 1, parts); setTimeout(end, ok ? 120 : Math.min(6000, 900 + text.length * 25)); } });
    aiCaption(null, 0, parts);
    if (!r.voice && r.count) {
      const l = PL.byCode(lang) || PL.LANGS.find((x) => x.locale === r.locale);
      if (l && !st.warned[l.code]) { st.warned[l.code] = 1; toast(`No ${l.name} voice on this device`, `Showing captions instead. Add a ${l.name} voice in your phone's text-to-speech settings to hear it.`, 'a', 7000); }
    }
  });
}

async function listen() {
  if (!st || !el) return;
  stopSpeaking(); st.hearing?.cancel();
  const lang = currentLang(); paintTop(); setPhase('listening'); you('', true);
  const h = st.hearing = hear({
    locale: lang.locale, ai: aiEars(),
    onInterim: (t, preview) => you(t, preview), onLevel: (v) => orb?.setLevel(v),
    onPhase: (p) => { if (p === 'understanding') setPhase('understanding'); if (p === 'denied') { setPhase('paused', 'Microphone is blocked — allow it in the browser, or tap Type.'); } if (p === 'unsupported') setPhase('paused', 'Voice input is not supported in this browser — tap Type.'); },
  });
  const res = await h.promise; if (st?.hearing !== h) return; st.hearing = null;
  if (!el || st.phase === 'paused') return;
  if (!res || !res.text) {
    st.misses += 1; you('');
    if (st.misses >= 2) { setPhase('paused'); sfx('err'); return; }
    return listen();
  }
  st.misses = 0; handle(res.text, res.lang);
}

const digitsOf = (t) => {
  const W = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, che: 6, saat: 7, aath: 8, nau: 9, shunya: 0 };
  let s = String(t).toLowerCase().replace(/double\s+(\d)/g, '$1$1').replace(/triple\s+(\d)/g, '$1$1$1');
  s = s.replace(/[a-z]+/g, (w) => (w in W ? String(W[w]) : ' ')); const d = s.replace(/[^\d+]/g, '');
  return d.replace(/(?!^)\+/g, '');
};

async function handle(text, langHint, typed = false) {
  if (!st) return;
  you(text); aiCaption('');
  if (langHint?.code && userLanguage() === 'auto') S.lastLang = langHint.code;
  const P = ph(currentLang().code);
  if (EXIT.test(text.trim())) { await say(currentLang().code === 'hinglish' || currentLang().code === 'hi' ? 'Theek hai, phir milte hain!' : 'Okay, talk soon.', currentLang().code); close(); return; }

  // hands-free texting: we asked "what should I say?"
  if (st.pending?.kind === 'compose') {
    const p = st.pending; st.pending = null;
    if (CANCEL.test(text) && text.split(/\s+/).length <= 3) { await say(P.cancelled, currentLang().code); return listen(); }
    return runAction(p.host, { ...p.a, text }, p.lang);
  }
  // we asked for a phone number
  if (st.pending?.kind === 'number') {
    const p = st.pending; const d = digitsOf(text);
    if (CANCEL.test(text) && d.length < 6) { st.pending = null; await say(P.cancelled, currentLang().code); return listen(); }
    if (d.replace('+', '').length < 10) { await say(P.badnum, currentLang().code); return listen(); }
    st.pending = null;
    try {
      const r = await api('POST', '/api/contacts', { name: p.a.to?.name || 'Contact', phone: d, relation: p.a.to?.relation || '' });
      const ct = r.item || r.contact || r; toast('Contact saved', `${ct.name || p.a.to?.name} · ${ct.phone || d}`, 'g'); sfx('done'); emit('data');
      const a2 = { ...p.a, needsContact: false, to: { name: ct.name || p.a.to?.name, phone: ct.phone || d, known: true } };
      if ((a2.type === 'sms' || a2.type === 'whatsapp') && !a2.text) return askCompose(p.host, a2, p.lang);
      return runAction(p.host, a2, p.lang);
    } catch (err) { await say(err.message, 'en'); return listen(); }
  }

  if (!S.ask) { toast('Voice mode', 'Open a chat first.', 'm'); return; }
  setPhase('thinking'); $('#vmact', el).innerHTML = '';
  let action = null; let lang = currentLang().code;
  const r = await S.ask(text, {
    voice: !typed, lang: langHint?.code || null,
    onMeta: (m) => { if (m.lang?.code) { lang = m.lang.code; if (userLanguage() === 'auto') S.lastLang = m.lang.code; paintTop(); } },
    onDelta: (acc) => aiCaption(acc),
    onAction: (a) => { action = a; },
  });
  if (!st || !el) return;
  const reply = r?.text || '';
  const host = $('#vmact', el);
  if (action && ['call', 'sms', 'whatsapp'].includes(action.type)) {
    if (action.needsContact) { st.pending = { kind: 'number', a: action, host, lang }; host.innerHTML = `<div class="act-card mini">${aicon('contact')}<span>${esc(P.num(action.to?.name || ''))}</span></div>`; await say(reply.split('\n')[0] || P.num(action.to?.name || ''), lang); if (st?.pending?.kind === 'number') return listen(); return; }
    if (((action.type === 'whatsapp') || (action.type === 'sms' && action.to?.phone)) && !action.text) return askCompose(host, action, lang);
    await say(stripQuote(reply), lang);
    return runAction(host, action, lang, true);
  }
  if (action) { mountAction(host, action, { auto: true }); }
  await say(reply, lang);
  if (st && el && st.phase !== 'paused') listen();
}
const stripQuote = (t) => String(t || '').split('\n').filter((l) => !l.startsWith('>')).join(' ').trim();

async function askCompose(host, a, lang) {
  const P = ph(PL.byCode(lang)?.code || 'en');
  host.innerHTML = `<div class="act-card mini t-${a.type}"><span>${esc(P.what(a.to?.name || ''))}</span></div>`;
  st.pending = { kind: 'compose', a, host, lang }; // set before speaking so a typed reply mid-sentence still counts
  await say(P.what(a.to?.name || ''), lang);
  if (st?.pending?.kind === 'compose') return listen();
}

// show the action card with a longer, voice-stoppable countdown
async function runAction(host, a, lang, alreadySpoke = false) {
  const P = ph(PL.byCode(lang)?.code || 'en');
  if (!alreadySpoke && a.text) await say(`${a.type === 'whatsapp' ? 'WhatsApp' : 'SMS'} → ${a.to?.name}: ${a.text}`, lang);
  setPhase('idle', P.say);
  let stopWords = () => {};
  await new Promise((resolve) => {
    const ctl = mountAction(host, a, { auto: true, delay: 6, onEnd: (how) => { stopWords(); resolve(how); } });
    if (!ctl?.counting) { resolve('done'); return; }
    stopWords = listenForWords(PL.byCode(lang)?.locale || currentLang().locale, (w) => {
      if (CANCEL.test(w)) ctl.cancel(); else if (GO.test(w)) ctl.go();
    });
  }).then(async (how) => { if (how === 'cancel') await say(P.cancelled, lang); });
  if (st && el) listen();
}

export function openVoice(first) {
  if (el) { if (first) handle(first, null); return; }
  if (!browserEars && !aiEars()) toast('Voice input', 'This browser can\'t listen. Use Chrome/Edge, or add a free Gemini key for AI ears — you can still type in voice mode.', 'a', 7000);
  wake?.pause();
  st = { phase: 'idle', misses: 0, warned: {}, pending: null };
  build(); paintTop(); document.body.classList.add('vm-open'); sfx('start');
  const go = () => { if (first) handle(first, null); else listen(); };
  if (!S.ask) { emit('need-chat'); let n = 0; const w = setInterval(() => { if (S.ask || ++n > 30) { clearInterval(w); go(); } }, 100); } else go();
}
export function close() {
  if (!el) return;
  st?.hearing?.cancel(); stopSpeaking(); clearInterval(st?.pulse);
  orb?.destroy(); orb = null; el.remove(); el = null; st = null; document.body.classList.remove('vm-open');
  if (pref('wake', false) && wake) setTimeout(() => { if (wake.boot) wake.resume(currentLang().locale); else wake.start(currentLang().locale); }, 400);
}
export const voiceOpen = () => !!el;

// ───────────── wake word ─────────────
export function setWake(on) {
  setPref('wake', on); $('#vmwake', el || document)?.classList.toggle('on', on);
  if (!wake) wake = new WakeWord((rest) => { openVoice(rest || null); });
  if (on) {
    if (!browserEars) { toast('Wake word', 'Needs Chrome or Edge (speech recognition).', 'a'); setPref('wake', false); return; }
    if (!el) wake.start(currentLang().locale);
    toast('“Hey Pragati” is on', 'While this tab is open, say “Hey Pragati” to start talking. The “wake word” chip shows when the mic is listening for it.', 'v', 6000);
  } else { wake.stop(); toast('Wake word off', '', 'c', 1500); }
  document.body.classList.toggle('wake-on', on);
}
export function initWake() {
  if (!pref('wake', false) || !browserEars) return;
  wake = wake || new WakeWord((rest) => { openVoice(rest || null); });
  wake.start(currentLang().locale); document.body.classList.add('wake-on');
  document.addEventListener('visibilitychange', () => { if (!wake?.on) return; if (document.hidden) wake.pause(); else if (!el) wake.resume(currentLang().locale); });
}
