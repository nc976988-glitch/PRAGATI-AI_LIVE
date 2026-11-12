'use strict';
// AI engine adapter — streaming, multi-turn, multimodal, with live web grounding.
// Priority: Gemini (GEMINI_API_KEY, free tier + Google Search grounding) → Claude (ANTHROPIC_API_KEY)
//           → any OpenAI-compatible API (OPENAI_API_KEY [+ OPENAI_BASE_URL], e.g. OpenAI, Groq, OpenRouter).
// With no key the app still runs: lib/knowledge.js answers from Wikipedia / DuckDuckGo / maths.

const env = (k) => (process.env[k] || '').trim();
const G_MODELS = () => [env('GEMINI_MODEL') || 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'].filter((v, i, a) => a.indexOf(v) === i);
const A_MODEL = () => env('ANTHROPIC_MODEL') || 'claude-sonnet-5-5';
const O_MODEL = () => env('OPENAI_MODEL') || 'gpt-4o-mini';
const O_BASE = () => (env('OPENAI_BASE_URL') || 'https://api.openai.com/v1').replace(/\/$/, '');
let gWorking = null; // the Gemini model that answered last (skips dead fallbacks)

function info() {
  if (env('GEMINI_API_KEY')) { const m = gWorking || G_MODELS()[0]; return { enabled: true, provider: 'gemini', model: m, web: true, vision: true, ears: true, label: `Gemini · ${m} · live Google Search` }; }
  if (env('ANTHROPIC_API_KEY')) return { enabled: true, provider: 'anthropic', model: A_MODEL(), web: false, vision: true, label: `Claude · ${A_MODEL()}` };
  if (env('OPENAI_API_KEY')) { const groq = /groq/.test(O_BASE()); return { enabled: true, provider: 'openai-compatible', model: O_MODEL(), web: false, vision: !groq, ears: groq || /api\.openai\.com/.test(O_BASE()), label: `${groq ? 'Groq' : 'LLM'} · ${O_MODEL()}` }; }
  return { enabled: false, provider: 'local', model: 'pragati-offline', web: true, vision: false, label: 'Offline brain · Wikipedia + maths' };
}

// Read an SSE body and call onData(jsonString) for every `data:` line.
async function readSSE(res, onData) {
  const dec = new TextDecoder(); let buf = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
      if (line.startsWith('data:')) { const d = line.slice(5).trim(); if (d && d !== '[DONE]') onData(d); }
    }
  }
  if (buf.startsWith('data:')) { const d = buf.slice(5).trim(); if (d && d !== '[DONE]') onData(d); }
}

async function httpErr(r, who) {
  let msg = ''; try { const j = await r.json(); msg = j.error?.message || j.message || JSON.stringify(j).slice(0, 200); } catch (_) { /* no body */ }
  const e = new Error(`${who} ${r.status}${msg ? `: ${msg}` : ''}`); e.status = r.status; return e;
}

// messages: [{ role: 'user'|'assistant', text, images?: [{ mime, data(base64) }] }]
// returns { text, sources: [{ title, url }], model }
async function stream({ system, messages, onDelta = () => {}, maxTokens = 2048, search = true, timeoutMs = 90000, signal }) {
  const i = info();
  if (!i.enabled) throw new Error('no-llm');
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  if (signal) signal.addEventListener('abort', () => ctl.abort());
  let text = ''; const sources = [];
  const push = (d) => { if (d) { text += d; onDelta(d); } };
  try {
    if (i.provider === 'gemini') {
      const contents = [];
      for (const m of messages) { // Gemini wants alternating user/model turns
        const role = m.role === 'assistant' ? 'model' : 'user'; const parts = [...(m.images || []).map((im) => ({ inline_data: { mime_type: im.mime, data: im.data } })), { text: m.text || ' ' }];
        const last = contents[contents.length - 1]; if (last && last.role === role) last.parts.push(...parts); else contents.push({ role, parts });
      }
      if (contents[0]?.role === 'model') contents.shift();
      const body = { system_instruction: { parts: [{ text: system }] }, contents, generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 } };
      if (search) body.tools = [{ google_search: {} }];
      let lastErr;
      const models = gWorking ? [gWorking, ...G_MODELS().filter((m) => m !== gWorking)] : G_MODELS();
      for (const model of models) {
        const r = await fetch(`${(env('GEMINI_BASE_URL') || 'https://generativelanguage.googleapis.com').replace(/\/$/, '')}/v1beta/models/${model}:streamGenerateContent?alt=sse`, { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': env('GEMINI_API_KEY') }, body: JSON.stringify(body) });
        if (!r.ok) { lastErr = await httpErr(r, `gemini(${model})`); if ([400, 404].includes(r.status) && /model|not found|not supported/i.test(lastErr.message)) continue; if (r.status === 429 && search) { body.tools = undefined; continue; } throw lastErr; }
        gWorking = model;
        await readSSE(r, (d) => {
          let j; try { j = JSON.parse(d); } catch (_) { return; }
          const c = j.candidates?.[0];
          for (const p of c?.content?.parts || []) if (p.text && !p.thought) push(p.text);
          for (const g of c?.groundingMetadata?.groundingChunks || []) if (g.web?.uri && !sources.some((s) => s.url === g.web.uri)) sources.push({ title: g.web.title || g.web.uri, url: g.web.uri });
        });
        return { text, sources, model };
      }
      throw lastErr || new Error('gemini: no model available');
    }
    if (i.provider === 'anthropic') {
      const msgs = messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: [...(m.images || []).map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.data } })), { type: 'text', text: m.text || ' ' }] }));
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: A_MODEL(), max_tokens: maxTokens, system, messages: msgs, stream: true }) });
      if (!r.ok) throw await httpErr(r, 'anthropic');
      await readSSE(r, (d) => { try { const j = JSON.parse(d); if (j.type === 'content_block_delta' && j.delta?.text) push(j.delta.text); } catch (_) { /* skip */ } });
      return { text, sources, model: A_MODEL() };
    }
    const msgs = [{ role: 'system', content: system }, ...messages.map((m) => (m.images?.length && i.vision
      ? { role: 'user', content: [{ type: 'text', text: m.text || ' ' }, ...m.images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mime};base64,${im.data}` } }))] }
      : { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.text || ' ' }))];
    const r = await fetch(`${O_BASE()}/chat/completions`, { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${env('OPENAI_API_KEY')}` }, body: JSON.stringify({ model: O_MODEL(), max_tokens: maxTokens, messages: msgs, stream: true }) });
    if (!r.ok) throw await httpErr(r, 'llm');
    await readSSE(r, (d) => { try { push(JSON.parse(d).choices?.[0]?.delta?.content || ''); } catch (_) { /* skip */ } });
    return { text, sources, model: O_MODEL() };
  } finally { clearTimeout(t); }
}

// Back-compat single-shot helper used by the planner / study / work modules.
async function complete({ system, user, maxTokens = 900, timeoutMs = 25000 }) {
  const r = await stream({ system, messages: [{ role: 'user', text: user }], maxTokens, timeoutMs, search: false });
  return r.text;
}

function extractJson(s) {
  const m = String(s).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (_) { return null; }
}

// ── speech-to-text in ANY language (auto-detected) ──
// audio: base64 WAV (16 kHz mono) from the browser. Returns { text, lang } where lang is an ISO 639-1 code (or 'hinglish').
const STT_PROMPT = `You are a speech recogniser for every language in the world.
Transcribe the speech in this audio EXACTLY as spoken — do not translate, answer or summarise it.
Detect the spoken language automatically. Write it in that language's normal native script (Tamil in Tamil script, Arabic in Arabic script, Russian in Cyrillic, Japanese in Japanese, etc.).
Exception: Hindi or Urdu speech (including Hindi mixed with English, "Hinglish") must be written in Roman/Latin letters as Indians type it on WhatsApp, e.g. "mummy ko call karo", "kal mera exam hai". In that case lang is "hinglish".
Keep names, numbers and phone numbers as digits. If there is no clear human speech, return an empty text.
Reply ONLY with JSON: {"text":"...","lang":"<ISO 639-1 code or hinglish>"}`;
const WHISPER_LANG = { english: 'en', hindi: 'hinglish', urdu: 'ur', tamil: 'ta', telugu: 'te', kannada: 'kn', malayalam: 'ml', marathi: 'mr', bengali: 'bn', gujarati: 'gu', punjabi: 'pa', nepali: 'ne', spanish: 'es', french: 'fr', german: 'de', portuguese: 'pt', italian: 'it', russian: 'ru', ukrainian: 'uk', arabic: 'ar', persian: 'fa', turkish: 'tr', chinese: 'zh', japanese: 'ja', korean: 'ko', indonesian: 'id', malay: 'ms', vietnamese: 'vi', thai: 'th', dutch: 'nl', polish: 'pl', swedish: 'sv', greek: 'el', hebrew: 'he', swahili: 'sw', tagalog: 'fil' };

async function transcribe({ data, mime = 'audio/wav', hint = '' }) {
  const i = info();
  if (!i.ears) throw new Error('no-ears');
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 30000);
  try {
    if (i.provider === 'gemini') {
      const body = { contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime, data } }, { text: STT_PROMPT + (hint ? `\nThe speaker often uses: ${hint}.` : '') }] }], generationConfig: { temperature: 0, maxOutputTokens: 1024, responseMimeType: 'application/json' } };
      let lastErr;
      const models = gWorking ? [gWorking, ...G_MODELS().filter((m) => m !== gWorking)] : G_MODELS();
      for (const model of models) {
        const r = await fetch(`${(env('GEMINI_BASE_URL') || 'https://generativelanguage.googleapis.com').replace(/\/$/, '')}/v1beta/models/${model}:generateContent`, { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': env('GEMINI_API_KEY') }, body: JSON.stringify(body) });
        if (!r.ok) { lastErr = await httpErr(r, `gemini(${model})`); if ([400, 404].includes(r.status) && /model|not found|not supported/i.test(lastErr.message)) continue; throw lastErr; }
        const j = await r.json();
        const out = (j.candidates?.[0]?.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('');
        const parsed = extractJson(out) || { text: out.trim() };
        return { text: String(parsed.text || '').trim(), lang: String(parsed.lang || '').toLowerCase().slice(0, 12) || null, via: `gemini:${model}` };
      }
      throw lastErr || new Error('gemini: no model available');
    }
    // OpenAI / Groq Whisper (auto language detection)
    const groq = /groq/.test(O_BASE());
    const fd = new FormData();
    fd.append('file', new Blob([Buffer.from(data, 'base64')], { type: mime }), 'speech.wav');
    fd.append('model', env('OPENAI_STT_MODEL') || (groq ? 'whisper-large-v3-turbo' : 'whisper-1'));
    fd.append('response_format', 'verbose_json');
    const r = await fetch(`${O_BASE()}/audio/transcriptions`, { method: 'POST', signal: ctl.signal, headers: { authorization: `Bearer ${env('OPENAI_API_KEY')}` }, body: fd });
    if (!r.ok) throw await httpErr(r, 'stt');
    const j = await r.json();
    const ln = String(j.language || '').toLowerCase();
    return { text: String(j.text || '').trim(), lang: WHISPER_LANG[ln] || (ln.length <= 3 ? ln : null), via: 'whisper' };
  } finally { clearTimeout(t); }
}

module.exports = { info, complete, stream, extractJson, transcribe };
