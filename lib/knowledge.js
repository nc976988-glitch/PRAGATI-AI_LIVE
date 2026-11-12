'use strict';
// World knowledge without an API key: a safe calculator, Wikipedia (English + Hindi) and DuckDuckGo
// instant answers. Also used to give non-Gemini models fresh context from the web.

const UA = 'PragatiAI/1.0 (hackathon prototype; https://github.com/) node-fetch';
const withTimeout = async (url, ms = 5000, opts = {}) => {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { ...opts, signal: ctl.signal, headers: { 'user-agent': UA, accept: 'application/json', ...(opts.headers || {}) } }); if (!r.ok) return null; return await r.json(); } catch (_) { return null; } finally { clearTimeout(t); }
};

// ───────────────────────── safe calculator (recursive descent, no eval) ─────────────────────────
const FN = { sqrt: Math.sqrt, cbrt: Math.cbrt, sin: (x) => Math.sin(x), cos: (x) => Math.cos(x), tan: (x) => Math.tan(x), asin: Math.asin, acos: Math.acos, atan: Math.atan, log: Math.log10, ln: Math.log, exp: Math.exp, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil };
const CONST = { pi: Math.PI, e: Math.E };
function calc(src, degMode = false) {
  const s = String(src).toLowerCase().replace(/×/g, '*').replace(/÷/g, '/').replace(/\bx\b/g, '*').replace(/\s+/g, '').replace(/π/g, 'pi');
  let i = 0;
  const peek = () => s[i]; const eat = (c) => (s[i] === c ? (i++, true) : false);
  function num() {
    const m = s.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/); if (m) { i += m[0].length; return parseFloat(m[0]); }
    const w = s.slice(i).match(/^[a-z]+/);
    if (w) {
      const name = w[0]; i += name.length;
      if (CONST[name] !== undefined) return CONST[name];
      if (FN[name]) { let deg = false; if (!eat('(')) throw new Error('('); const v = expr(); if (!eat(')')) throw new Error(')'); if (['sin', 'cos', 'tan'].includes(name) && degMode) deg = true; return FN[name](deg ? (v * Math.PI) / 180 : v); }
      throw new Error(`unknown ${name}`);
    }
    if (eat('(')) { const v = expr(); if (!eat(')')) throw new Error(')'); return v; }
    throw new Error('number expected');
  }
  function postfix() { let v = num(); for (;;) { if (eat('!')) { if (v < 0 || v > 170 || v % 1) throw new Error('!'); let f = 1; for (let k = 2; k <= v; k++) f *= k; v = f; } else if (peek() === '%' && !/[\d(a-z.]/.test(s[i + 1] || '')) { i++; v /= 100; } else break; } return v; }
  function unary() { if (eat('-')) return -unary(); if (eat('+')) return unary(); return postfix(); }
  function power() { const b = unary(); if (eat('^') || (s[i] === '*' && s[i + 1] === '*' && (i += 2))) return b ** power(); return b; }
  function term() { let v = power(); for (;;) { if (eat('*')) v *= power(); else if (eat('/')) v /= power(); else if (peek() === '%' ) { i++; v %= power(); } else break; } return v; }
  function expr() { let v = term(); for (;;) { if (eat('+')) v += term(); else if (eat('-')) v -= term(); else break; } return v; }
  const v = expr(); if (i !== s.length) throw new Error('trailing'); if (!Number.isFinite(v)) throw new Error('nan'); return v;
}
const fmtNum = (v) => (Math.abs(v) >= 1e15 || (Math.abs(v) < 1e-6 && v !== 0) ? v.toExponential(6) : String(+v.toFixed(10)));

function mathAnswer(text) {
  const t = String(text).trim().replace(/[?=]+$/, '').trim();
  let m = t.match(/^(?:what(?:'s| is)\s+)?(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)$/i);
  if (m) { const v = (+m[1] / 100) * +m[2]; return { expr: `${m[1]}% of ${m[2]}`, value: fmtNum(v) }; }
  const stripped = t.replace(/^(what(?:'s| is)|calculate|compute|solve|evaluate|kitna hota hai|kitna hai|batao)\s+/i, '').replace(/\s+(kitna hota hai|kitna hai|batao|kya hai)$/i, '').replace(/\s*(in degrees|degrees?)$/i, ' deg');
  if (!/[\d)]/.test(stripped) || !/^[\d\s.+\-*/^()!%×÷xπa-z,]+$/i.test(stripped)) return null;
  if (/[a-z]{2,}/i.test(stripped.replace(/sqrt|cbrt|sin|cos|tan|asin|acos|atan|log|ln|exp|abs|round|floor|ceil|pi|deg/gi, ''))) return null;
  if (!/[+\-*/^!%×÷x(]|sqrt|sin|cos|tan|log|ln|exp/i.test(stripped)) return null;
  const deg = /\s*deg$/.test(stripped); const ex = stripped.replace(/\s*deg$/, '');
  try { return { expr: ex + (deg ? ' (degrees)' : ''), value: fmtNum(calc(ex, deg)) }; } catch (_) { return null; }
}

// ───────────────────────── Wikipedia + DuckDuckGo ─────────────────────────
function topicOf(text) {
  return String(text).trim()
    .replace(/[?!.।]+$/g, '')
    .replace(/^(hey |ok |hi )?(pragati|jarvis)[, ]+/i, '')
    .replace(/^(please |pls |can you |could you )?(tell me (about|who|what)|tell me|who (is|was|are|were)|what (is|are|was|were)( a| an| the)?|where (is|are)|when (is|was|did)|explain|define|meaning of|information (about|on)|info on|search for|describe|give me (info|details) (about|on))\s+/i, '')
    .replace(/\s+(kya hai|kya hota hai|kaun hai|kaun tha|kaun the|ke baare mein batao|ke bare me batao|ke baare me|kahan hai|batao|samjhao)$/i, '')
    .replace(/^(the|a|an)\s+/i, '')
    .trim();
}

async function wiki(query, lang = 'en') {
  const q = topicOf(query); if (q.length < 2) return null;
  const s = await withTimeout(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=3&utf8=1&srsearch=${encodeURIComponent(q)}`);
  const hit = s?.query?.search?.[0]; if (!hit) return null;
  const p = await withTimeout(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`);
  if (!p || !p.extract || p.type === 'disambiguation') return null;
  return { title: p.title, extract: p.extract, url: p.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(hit.title)}`, image: p.thumbnail?.source || null, desc: p.description || '' };
}

async function ddg(query) {
  const j = await withTimeout(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`);
  if (!j) return null;
  const text = j.Answer || j.AbstractText || j.Definition || '';
  if (!text) return null;
  return { title: j.Heading || query, extract: String(text), url: j.AbstractURL || j.DefinitionURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}` };
}


// Offline equation solver: one variable, degree ≤ 2 (e.g. "2x + 7 = 19", "x² − 5x + 6 = 0").
function solveEq(text) {
  let t = String(text).replace(/[−–]/g, '-').replace(/[×]/g, '*').replace(/÷/g, '/').replace(/²/g, '^2').replace(/³/g, '^3');
  const mm = t.match(/([0-9a-z+\-*/^().\s]*)=([0-9a-z+\-*/^().\s]+)/i); if (!mm) return null;
  const lhs = mm[1].replace(/^.*\b[a-z]{2,}\b[:\s]*/i, ''); const rhs = mm[2].replace(/\b[a-z]{2,}\b.*$/i, '');
  if (!/[a-z]/i.test(lhs + rhs) || !lhs.trim() || !rhs.trim()) return null;
  const m = [null, lhs, rhs];
  const vars = [...new Set((m[1] + m[2]).match(/\b[a-z]\b|(?<=\d)[a-z]\b|[a-z](?=\^)/gi) || [])].filter((v) => !/^e$/i.test(v));
  if (vars.length !== 1) return null; const v = vars[0];
  const prep = (side) => side.trim().replace(new RegExp(`(\\d|\\))\\s*${v}`, 'g'), '$1*' + v).replace(/\)\s*\(/g, ')*(').replace(/(\d)\s*\(/g, '$1*(');
  const L = prep(m[1]), R = prep(m[2]); if (!L || !R) return null;
  const f = (x) => { const sub = (e) => { try { return calc(e.replace(new RegExp(`\\b${v}\\b|${v}`, 'g'), `(${x})`)); } catch (_) { return null; } }; const a = sub(L), b = sub(R); return a == null || b == null ? NaN : a - b; };
  const c = f(0), p1 = f(1), m1 = f(-1); if (![c, p1, m1].every(Number.isFinite)) return null;
  const a = (p1 + m1) / 2 - c, b = (p1 - m1) / 2; const chk = a * 4 + b * 2 + c; if (Math.abs(chk - f(2)) > 1e-6 || Math.abs(a * 9 - b * 3 + c - f(-3)) > 1e-6) return null;
  const n = (x) => fmtNum(+x.toFixed(10)); const eq = `${m[1].trim()} = ${m[2].trim()}`;
  const poly = (A, B, C) => [A ? `${A === 1 ? '' : A === -1 ? '-' : n(A)}${v}^2` : '', B ? `${B < 0 ? ' - ' : A ? ' + ' : ''}${Math.abs(B) === 1 ? '' : n(Math.abs(B))}${v}` : '', C ? `${C < 0 ? ' - ' : A || B ? ' + ' : ''}${n(Math.abs(C))}` : ''].join('') || '0';
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) < 1e-12) return { md: c === 0 ? `**${eq}** is true for every value of $${v}$.` : `**${eq}** has no solution.`, kind: 'math' };
    const x = -c / b;
    return { md: `### Solving $${eq.replace(/\*/g, '')}$\n\n1. Bring everything to one side: $${poly(0, b, c)} = 0$\n2. Move the constant: $${n(b)}${v} = ${n(-c)}$\n3. Divide by ${n(b)}: $${v} = \\dfrac{${n(-c)}}{${n(b)}}$\n\n**Answer: $${v} = ${n(x)}$**\n\n*Check:* substituting gives ${n(f(x) + 0)} = 0 ✓`, kind: 'math' };
  }
  const D = b * b - 4 * a * c;
  let out = `### Solving $${eq.replace(/\*/g, '')}$\n\nStandard form: $${poly(a, b, c)} = 0$, so $a = ${n(a)},\\ b = ${n(b)},\\ c = ${n(c)}$.\n\n1. Discriminant: $D = b^2 - 4ac = (${n(b)})^2 - 4(${n(a)})(${n(c)}) = ${n(D)}$\n`;
  if (D < 0) { const re = -b / (2 * a), im = Math.sqrt(-D) / (2 * a); return { md: out + `2. $D < 0$, so there are no real roots. Complex roots: $${v} = ${n(re)} \\pm ${n(Math.abs(im))}i$`, kind: 'math' }; }
  const r1 = (-b + Math.sqrt(D)) / (2 * a), r2 = (-b - Math.sqrt(D)) / (2 * a);
  out += `2. Quadratic formula: $${v} = \\dfrac{-b \\pm \\sqrt{D}}{2a} = \\dfrac{${n(-b)} \\pm ${n(Math.sqrt(D))}}{${n(2 * a)}}$\n\n`;
  out += D === 0 ? `**Answer: $${v} = ${n(r1)}$** (a repeated root)` : `**Answer: $${v} = ${n(r1)}$ or $${v} = ${n(r2)}$**`;
  if (Number.isInteger(+r1.toFixed(9)) && Number.isInteger(+r2.toFixed(9)) && a === 1) out += `\n\n*Factor form:* $(${v} ${r1 > 0 ? '-' : '+'} ${n(Math.abs(r1))})(${v} ${r2 > 0 ? '-' : '+'} ${n(Math.abs(r2))}) = 0$`;
  return { md: out, kind: 'math' };
}

const FACTUAL = /\b(who|what|when|where|which|how many|how much|how old|capital|population|president|prime minister|ceo|founder|invented|discovered|born|died|latest|news|current|today|price|score|winner|won|history of|meaning|define|tell me about|kya hai|kaun|kab|kahan|kitne)\b/i;
const looksFactual = (t) => FACTUAL.test(t) && String(t).split(/\s+/).length <= 30;

// Offline answer for when no AI key is configured. Returns { md, sources } or null.
async function answer(text, { hindi = false, wiki: wl = null } = {}) {
  const m = mathAnswer(text);
  if (m) return { md: `**${m.expr} = ${m.value}**`, sources: [], kind: 'math' };
  try { const q = solveEq(text); if (q) return { ...q, sources: [] }; } catch (_) { /* not an equation */ }
  const code = wl && /^[a-z-]{2,12}$/.test(wl) ? wl : hindi ? 'hi' : 'en';
  let [w, d] = await Promise.all([wiki(text, code), ddg(topicOf(text))]);
  if (!w && code !== 'en' && /[a-z]{3}/i.test(text)) w = await wiki(text, 'en');
  const rel = (x) => { if (!x) return null; const ws = String(topicOf(text) || text).toLowerCase().split(/[^a-z0-9\u0900-\u097f]+/).filter((y) => y.length >= 4); const hay = `${x.title} ${x.extract}`.toLowerCase(); return !ws.length || ws.some((y) => hay.includes(y.slice(0, 5))) ? x : null; };
  const best = rel(w) || rel(d);
  if (!best) return null;
  const extra = w && d && d.extract && !w.extract.includes(d.extract.slice(0, 40)) && d.extract.length < 500 ? `\n\n> ${d.extract}` : '';
  return { md: `### ${best.title}${w?.desc ? `\n*${w.desc}*` : ''}\n\n${best.extract}${extra}`, sources: [w, d].filter(Boolean).filter((x, i, a) => a.findIndex((y) => y.url === x.url || y.title === x.title) === i).map((x) => ({ title: x.title, url: x.url })), image: w?.image || null, kind: 'wiki' };
}

// Fresh context for models without built-in web search.
async function webContext(text) {
  if (!looksFactual(text)) return null;
  const [w, d] = await Promise.all([wiki(text), ddg(topicOf(text))]);
  const parts = [w, d].filter(Boolean);
  if (!parts.length) return null;
  return { text: parts.map((p) => `[${p.title}] ${p.extract}`).join('\n\n').slice(0, 3000), sources: parts.map((p) => ({ title: p.title, url: p.url })) };
}

module.exports = { solveEq, calc, mathAnswer, wiki, ddg, answer, webContext, topicOf, looksFactual };
