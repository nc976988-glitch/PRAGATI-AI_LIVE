// Pragati's voice — speaks answers in the language they are written in, sentence by sentence,
// and reports each sentence so the UI can show live captions.
import './lang-core.js';
const PL = globalThis.PragatiLang;

const cutAction = (t) => { const i = t.indexOf('<<'); return i >= 0 ? t.slice(0, i) : t; };
export function plain(t) {
  return cutAction(String(t || '')).replace(/```[\s\S]*?```/g, ' (code shown on screen) ').replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]/g, ' (formula on screen) ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_#>`|~]/g, '').replace(/\$([^$]+)\$/g, '$1')
    .replace(/\\(?:long)?rightarrow|\\to\b/g, '→').replace(/\\times/g, '×').replace(/\\cdot/g, '·').replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1/$2').replace(/\\[a-zA-Z]+/g, '').replace(/[{}]/g, '')
    .replace(/^\s*[-•]\s+/gm, '').replace(/\n{2,}/g, '. ').replace(/([^.!?:;,。！？।\s])[ \t]*\n/g, '$1. ').replace(/\s+/g, ' ').trim();
}
export const sentences = (t) => (plain(t).match(/[^.!?。！？।؟]+[.!?。！？।؟]*/g) || []).map((s) => s.trim()).filter(Boolean);

let voices = [];
const load = () => { try { voices = speechSynthesis.getVoices() || []; } catch (_) { voices = []; } };
if ('speechSynthesis' in window) { load(); speechSynthesis.addEventListener?.('voiceschanged', load); }

/** Best installed voice for a language code / locale, or null. */
export function voiceFor(locale) {
  if (!voices.length) load();
  const L = String(locale || 'en-IN'); const base = L.slice(0, 2).toLowerCase();
  const good = (v) => /Google|Natural|Neural|Premium|Enhanced|Siri/i.test(v.name);
  const exact = voices.filter((v) => v.lang.replace('_', '-').toLowerCase() === L.toLowerCase());
  const same = voices.filter((v) => v.lang.slice(0, 2).toLowerCase() === base);
  return exact.find(good) || exact[0] || same.find(good) || same[0] || null;
}

/** Which locale should this text be spoken in? (the text decides; `hint` is the conversation language) */
export function localeFor(text, hint) {
  const d = PL.detect(plain(text).slice(0, 600));
  if (d.confidence >= 0.55 && d.code !== 'en') return d.locale;
  if (hint) { const l = PL.byCode(hint) || PL.LANGS.find((x) => x.locale === hint); if (l) return l.locale; }
  return d.locale || 'en-IN';
}

let speakId = 0;
/**
 * speak(text, { lang, onSentence(i, s, all), onEnd(ok), rate })
 * returns { locale, voice: boolean, count }
 */
export function speak(text, { lang, onSentence, onEnd, rate = 1.03 } = {}) {
  const id = ++speakId;
  const parts = sentences(text).slice(0, 40);
  const locale = localeFor(text, lang);
  if (!('speechSynthesis' in window) || !parts.length) { setTimeout(() => onEnd?.(false), 0); return { locale, voice: false, count: 0 }; }
  speechSynthesis.cancel();
  const v = voiceFor(locale);
  // no installed voice for this language → don't read it with a wrong-language voice; captions only
  if (!v && !/^en/i.test(locale) && voices.length) { setTimeout(() => onEnd?.(false), 0); return { locale, voice: false, count: parts.length }; }
  parts.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(p); u.lang = locale; if (v) u.voice = v; u.rate = rate; u.pitch = 1;
    u.onstart = () => { if (id === speakId) onSentence?.(i, p, parts); };
    if (i === parts.length - 1) { u.onend = () => { if (id === speakId) onEnd?.(true); }; u.onerror = () => { if (id === speakId) onEnd?.(true); }; }
    speechSynthesis.speak(u);
  });
  // Chrome bug: long queues pause after ~15 s — keep it awake
  const keep = /Android/i.test(navigator.userAgent) ? 0 : setInterval(() => { if (id !== speakId || !speechSynthesis.speaking) { clearInterval(keep); return; } speechSynthesis.pause(); speechSynthesis.resume(); }, 12000);
  return { locale, voice: !!v, count: parts.length };
}
export const isSpeaking = () => { try { return speechSynthesis.speaking; } catch (_) { return false; } };
export function stopSpeaking() { speakId++; try { speechSynthesis.cancel(); } catch (_) { /* noop */ } }
