// Pragati "ears" — one utterance in, text out, in ANY language.
//  • AI ears (Gemini / OpenAI / Groq key): records 16 kHz audio, detects when you stop talking (voice-activity
//    detection) and lets the AI transcribe it — the spoken language is detected automatically.
//  • Browser ears (no key, or as live captions): Web Speech API in the chosen / last-detected language.
// The mic is only open while the orb shows "Listening" — never in the background (except the opt-in wake word).
import { auth } from './api.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const browserEars = !!SR;
export const canRecord = !!(navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext));

function wav16k(chunks, rate) {
  let len = 0; for (const c of chunks) len += c.length;
  const all = new Float32Array(len); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
  const ratio = rate / 16000; const n = Math.floor(all.length / ratio); const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) { // box-filter downsample
    const a = Math.floor(i * ratio), b = Math.min(all.length, Math.floor((i + 1) * ratio)); let s = 0;
    for (let j = a; j < b; j++) s += all[j]; const v = Math.max(-1, Math.min(1, s / Math.max(1, b - a)));
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  const buf = new ArrayBuffer(44 + pcm.length * 2); const dv = new DataView(buf);
  const w = (p, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(p + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 16000, true); dv.setUint32(28, 32000, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return new Blob([buf], { type: 'audio/wav' });
}
const b64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });

/**
 * Listen for one utterance.
 * @returns Promise<{ text, lang, via } | null>   null = nothing heard / cancelled
 */
export function hear({ locale = 'en-IN', ai = false, onInterim, onLevel, onPhase, maxMs = 20000, silenceMs = 1200, noSpeechMs = 8000 } = {}) {
  let cancel; const p = new Promise((resolve) => {
    let done = false; let stream = null; let ac = null; let rec = null; let raf = 0; const chunks = []; let rate = 48000;
    let srFinal = ''; let srInterim = ''; let srEnded = !SR; let speechAt = 0; let lastVoice = 0; const t0 = performance.now();
    let floor = 0.02; let calib = []; let stopped = false;
    const useAI = ai && canRecord;
    const finish = async (why) => {
      if (done) return; done = true; cancelAnimationFrame(raf);
      try { rec?.stop(); } catch (_) { /* noop */ }
      stream?.getTracks().forEach((t) => t.stop()); try { ac?.close(); } catch (_) { /* noop */ }
      onLevel?.(0);
      if (why === 'cancel') return resolve(null);
      const heard = speechAt > 0;
      if (useAI && heard && chunks.length) {
        onPhase?.('understanding');
        try {
          const audio = await b64(wav16k(chunks, rate));
          const r = await fetch('/api/ai/transcribe', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ audio, mime: 'audio/wav' }) });
          const j = await r.json().catch(() => ({}));
          if (r.ok && j.text) return resolve({ text: j.text.trim(), lang: j.lang || null, via: 'ai' });
          if (r.ok && !j.text && !(srFinal || srInterim).trim()) return resolve(null);
        } catch (_) { /* fall back to browser text */ }
      }
      const t = (srFinal || srInterim).trim();
      resolve(t ? { text: t, lang: null, via: 'browser' } : null);
    };
    cancel = () => finish('cancel');

    // browser recogniser: the answer when there is no AI, live captions when there is
    if (SR) {
      try {
        rec = new SR(); rec.lang = locale; rec.interimResults = true; rec.continuous = useAI; rec.maxAlternatives = 1;
        rec.onresult = (e) => {
          let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) srFinal += r[0].transcript + ' '; else interim += r[0].transcript; }
          srInterim = interim; const live = (srFinal + interim).trim(); if (live) { if (!speechAt) speechAt = performance.now(); lastVoice = performance.now(); onInterim?.(live, useAI); }
        };
        rec.onerror = (e) => { if (e.error === 'not-allowed' && !useAI) { stopped = true; onPhase?.('denied'); finish('error'); } };
        rec.onend = () => { srEnded = true; if (!useAI && !done && !stopped) finish('sr-end'); };
        rec.start();
      } catch (_) { srEnded = true; }
    } else if (!useAI) { onPhase?.('unsupported'); return finish('error'); }

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch (_) { if (useAI || !SR) { onPhase?.('denied'); finish('error'); } return; }
      if (done) { stream.getTracks().forEach((t) => t.stop()); return; }
      ac = new (window.AudioContext || window.webkitAudioContext)(); rate = ac.sampleRate;
      const src = ac.createMediaStreamSource(stream); const an = ac.createAnalyser(); an.fftSize = 1024; src.connect(an);
      if (useAI) {
        const sp = ac.createScriptProcessor(4096, 1, 1); const mute = ac.createGain(); mute.gain.value = 0;
        sp.onaudioprocess = (e) => { if (!done) chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
        src.connect(sp); sp.connect(mute); mute.connect(ac.destination);
      }
      const buf = new Float32Array(an.fftSize);
      onPhase?.('listening');
      const tick = () => {
        if (done) return;
        an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; const rms = Math.sqrt(s / buf.length);
        const now = performance.now(); const el = now - t0;
        if (el < 350) { calib.push(rms); floor = Math.max(0.012, Math.min(0.06, (calib.reduce((a, b) => a + b, 0) / calib.length) * 2.2)); }
        const lvl = Math.min(1, rms * 6); onLevel?.(lvl);
        if (el > 350 && rms > floor) { if (!speechAt) speechAt = now; lastVoice = now; }
        if (speechAt && now - lastVoice > (useAI ? silenceMs : silenceMs + 1800) && now - speechAt > 300) return finish('silence');
        if (!speechAt && el > noSpeechMs) return finish('nothing');
        if (el > maxMs) return finish('max');
        raf = requestAnimationFrame(tick);
      };
      tick();
    })();
  });
  return { promise: p, cancel: () => cancel?.() };
}

// Short listen for a yes / no / cancel while a countdown runs (browser recogniser only).
export function listenForWords(locale, onWord) {
  if (!SR) return () => {};
  let rec; let live = true;
  try {
    rec = new SR(); rec.lang = locale; rec.interimResults = true; rec.continuous = true;
    rec.onresult = (e) => { let t = ''; for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript + ' '; onWord(t.toLowerCase()); };
    rec.onend = () => { if (live) try { rec.start(); } catch (_) { /* noop */ } };
    rec.start();
  } catch (_) { /* no mic */ }
  return () => { live = false; try { rec?.abort(); } catch (_) { /* noop */ } };
}

// "Hey Pragati" wake word — opt-in, browser recogniser, shows a visible chip while active.
export class WakeWord {
  constructor(onWake) { this.onWake = onWake; this.on = false; this.rec = null; }
  start(locale) {
    if (!SR || this.on) return !!SR; this.on = true; this.locale = locale;
    const boot = () => {
      if (!this.on) return;
      try {
        const rec = this.rec = new SR(); rec.lang = this.locale; rec.continuous = true; rec.interimResults = true;
        rec.onresult = (e) => {
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const t = e.results[i][0].transcript; const m = t.match(/(?:hey|hi|ok|okay|hello|he)?\s*(pragati|pragathi|pragti|pragat[iy]|प्रगति|प्रगती|பிரகதி|ప్రగతి|প্রগতি|pra gati)\b[\s,.!]*(.*)$/i);
            if (m) { const rest = e.results[i].isFinal ? m[2].trim() : ''; if (e.results[i].isFinal || m[0].length > 4) { this.pause(); this.onWake(rest); return; } }
          }
        };
        rec.onerror = (e) => { if (e.error === 'not-allowed') this.stop(); };
        rec.onend = () => { if (this.on && !this.paused) setTimeout(boot, 300); };
        rec.start();
      } catch (_) { setTimeout(boot, 1500); }
    };
    this.paused = false; this.boot = boot; boot(); return true;
  }
  pause() { this.paused = true; try { this.rec?.abort(); } catch (_) { /* noop */ } }
  resume(locale) { if (!this.on) return; if (locale) this.locale = locale; this.paused = false; try { this.rec?.abort(); } catch (_) { /* noop */ } setTimeout(() => this.boot?.(), 250); }
  stop() { this.on = false; this.paused = false; try { this.rec?.abort(); } catch (_) { /* noop */ } }
}
