'use strict';
// Study AI — offline extractive engine (summaries, key terms, flashcards, grounded explanations).
// Works with zero API keys; the LLM adapter upgrades the same endpoints when a key exists.

const STOP = new Set(('a an the and or but if then else of to in on at by for with from as is are was were be been being it its this that these those '
  + 'which who whom whose what when where why how can could should would may might will shall do does did done has have had not no nor so than too very '
  + 'also into over under between about above below up down out off more most such only own same each other some any both few all than there their they them '
  + 'we you he she his her our your i me my mine hai hain ka ki ke ko se me mein par pe aur ya to bhi nahi kya yeh woh').split(' '));

const words = (t) => (t.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []).filter((w) => !STOP.has(w));

function sentences(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/\n{2,}/g, ' ¶ ')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+|\s¶\s/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30 && s.length < 400);
}

function freq(text) {
  const f = new Map();
  for (const w of words(text)) f.set(w, (f.get(w) || 0) + 1);
  return f;
}

function keyTerms(text, n = 8) {
  const f = freq(text);
  return [...f.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, n).map(([w]) => w);
}

function summarize(text, n = 5) {
  const ss = sentences(text);
  if (!ss.length) return { bullets: [], terms: [] };
  const f = freq(text);
  const max = Math.max(...f.values(), 1);
  const scored = ss.map((s, i) => {
    const ws = words(s);
    const score = ws.reduce((a, w) => a + (f.get(w) || 0) / max, 0) / Math.sqrt(ws.length + 3) + (i === 0 ? 0.4 : 0);
    return { s, i, score };
  });
  const top = scored.sort((a, b) => b.score - a.score).slice(0, n).sort((a, b) => a.i - b.i);
  return { bullets: top.map((t) => t.s), terms: keyTerms(text, 8) };
}

function flashcards(text, n = 8) {
  const ss = sentences(text);
  const f = freq(text);
  const cards = [];
  const used = new Set();
  // definition-style sentences first: "X is/are/means Y"
  for (const s of ss) {
    const m = s.match(/^([A-Z][A-Za-z0-9 \-()/]{2,40}?)\s+(?:is|are|means|refers to|is defined as|occurs when)\s+(.{20,})$/);
    if (m && !used.has(m[1].toLowerCase())) {
      used.add(m[1].toLowerCase());
      cards.push({ q: `What is ${m[1].replace(/^(The|A|An)\s+/, '')}?`, a: `${m[1]} ${s.slice(m[1].length).trim()}`, type: 'definition' });
    }
  }
  // cloze deletions
  const scored = ss.map((s) => ({ s, k: words(s).sort((a, b) => (f.get(b) || 0) - (f.get(a) || 0))[0] }))
    .filter((x) => x.k).sort((a, b) => (f.get(b.k) || 0) - (f.get(a.k) || 0));
  for (const { s, k } of scored) {
    if (cards.length >= n) break;
    if (cards.some((c) => c.a.includes(s.slice(0, 40)))) continue;
    const re = new RegExp(`\\b${k}\\b`, 'i');
    if (!re.test(s)) continue;
    cards.push({ q: s.replace(re, '_____'), a: k, type: 'cloze', full: s });
  }
  return cards.slice(0, n);
}

function revisionNotes(title, text) {
  const { bullets, terms } = summarize(text, 6);
  const cards = flashcards(text, 4);
  return [
    `# ${title}`, '', '## Key terms', terms.map((t) => `- **${t}**`).join('\n'), '',
    '## Summary', bullets.map((b) => `- ${b}`).join('\n'), '',
    '## Self-test', cards.map((c) => `- ${c.q}`).join('\n') || '- (add more text to generate questions)', '',
  ].join('\n');
}

// Find the passages of the user's own library that relate to a topic.
function searchDocs(docs, topic, k = 4) {
  const q = new Set(words(topic));
  if (!q.size) return [];
  const hits = [];
  for (const d of docs) {
    for (const s of sentences(d.text)) {
      const ws = new Set(words(s));
      let score = 0; for (const w of q) if (ws.has(w) || [...ws].some((x) => x.startsWith(w.slice(0, 5)) && w.length > 4)) score++;
      if (score) hits.push({ doc: d.title, docId: d.id, s, score: score / q.size });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, k);
}

function explainLocal(topic, docs) {
  const hits = searchDocs(docs, topic, 5);
  if (!hits.length) {
    return {
      grounded: false,
      body: `# ${topic}\n\nNo passage in your Study library mentions this yet.\n\n**Do this next**\n- Add notes or a PDF about **${topic}** in Study AI and ask again — Pragati will explain it from your own material.\n- Or connect an AI engine key (see README) for general explanations.\n\n**Study frame you can fill in**\n- What problem does ${topic} solve?\n- Definition in one sentence:\n- A small example:\n- Common mistake:\n`,
    };
  }
  const srcs = [...new Set(hits.map((h) => h.doc))];
  return {
    grounded: true,
    sources: srcs,
    body: `# ${topic}\n\n**From your library**\n${hits.map((h) => `- ${h.s}  _(${h.doc})_`).join('\n')}\n\n**Remember it**\n- Say the idea in your own words before checking the lines above.\n- Make one example of ${topic}; then one counter-example.\n`,
  };
}

module.exports = { summarize, flashcards, revisionNotes, searchDocs, explainLocal, keyTerms, sentences };
