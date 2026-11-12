'use strict';
// Device actions — understands English / Hindi / Hinglish requests like
//   "call mummy", "papa ko whatsapp pe bolo ki main late aaunga", "text 9876543210 I'm outside",
//   "play arijit singh on youtube", "google pe IPL score search karo", "instagram kholo", "navigate to India Gate".
// It only DETECTS and STRUCTURES the action. The browser performs it (tel:, sms:, wa.me, app links),
// and calls / messages always show a confirm card first.

const norm = (t) => String(t || '').replace(/[“”"`]/g, '').replace(/\s+/g, ' ').trim();
const lower = (t) => norm(t).toLowerCase();

// relation → spoken aliases (English, Hinglish, Devanagari)
const RELATIONS = {
  mom: ['mom', 'mommy', 'mummy', 'mumma', 'mama', 'maa', 'ma', 'mother', 'ammi', 'amma', 'mataji', 'मम्मी', 'माँ', 'मां'],
  dad: ['dad', 'daddy', 'papa', 'pappa', 'father', 'pitaji', 'abbu', 'baba', 'पापा', 'पिताजी'],
  brother: ['bhai', 'bhaiya', 'bhaiyya', 'brother', 'bro', 'भाई', 'भैया'],
  sister: ['didi', 'sister', 'behen', 'behna', 'sis', 'दीदी', 'बहन'],
  grandma: ['dadi', 'nani', 'grandma', 'grandmother', 'दादी', 'नानी'],
  grandpa: ['dada', 'nana', 'grandpa', 'grandfather', 'दादा', 'नाना'],
  wife: ['wife', 'biwi', 'patni'], husband: ['husband', 'pati'],
  uncle: ['chacha', 'mama ji', 'uncle', 'tauji', 'chachu'], aunt: ['chachi', 'mami', 'aunty', 'aunt', 'bua', 'mausi'],
};
const relOf = (word) => { const w = lower(word).replace(/\b(my|meri|mere|mera|apni|apne)\b/g, '').replace(/\s*ji$/, '').trim(); for (const [k, v] of Object.entries(RELATIONS)) if (v.includes(w) || k === w) return k; return null; };

function phoneOf(s) {
  const m = String(s).match(/\+?\d[\d\s-]{6,16}\d/); if (!m) return null;
  let d = m[0].replace(/[\s-]/g, '');
  if (/^\d{10}$/.test(d)) d = `+91${d}`; else if (/^0\d{10}$/.test(d)) d = `+91${d.slice(1)}`; else if (/^91\d{10}$/.test(d)) d = `+${d}`;
  return d;
}

function findContact(contacts, who) { const r = matchContact(contacts, who); return r ? r[1] : null; }
function matchContact(contacts, who) {
  const w = lower(who).replace(/^(my|meri|mere|mera|to|ko)\s+/, '').replace(/\s+(ko|ku|se|ji)$/, '').trim();
  if (!w) return null;
  const rel = relOf(w);
  const score = (c) => {
    const n = lower(c.name); const al = (c.aliases || []).map(lower);
    if (n === w || al.includes(w)) return 3;
    if (rel && (c.relation === rel || al.some((a) => relOf(a) === rel) || relOf(n) === rel)) return 2.5;
    if (n.split(' ')[0] === w.split(' ')[0] && w.length > 2) return 2;
    if (n.includes(w) || (w.length > 3 && w.includes(n))) return 1;
    return 0;
  };
  const best = contacts.map((c) => [score(c), c]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0])[0];
  if (best) return best;
  return rel ? [2.4, null] : null;
}

const cleanWho = (s) => norm(s).replace(/^(to|on|my|meri|mere|mera)\s+/i, '').replace(/\s+(ko|ku|se|now|please|pls|abhi|jaldi|on whatsapp|whatsapp pe|whatsapp par|on sms)$/i, '').replace(/[.,!?]+$/, '').trim();
const cleanBody = (s) => norm(s).replace(/^(saying|that|ki|ke|:|-|ye|yeh|bolo|bol do)\s+/i, '').replace(/\s+(bhejo|bhej do|send karo|send kar do|likh do|bol do|bolo)$/i, '').replace(/^["']|["']$/g, '').trim();

const UNIT = '(?:call|phone|dial|ring|fone)';
const MSG = '(?:message|msg|text|sms|whatsapp|wa)';

function wishText(occ) {
  const o = occ.toLowerCase();
  if (/birth ?day|janamdin|janmdin/.test(o)) return 'Happy Birthday! 🎂 Wishing you lots of happiness, good health and success this year.';
  if (/anniversary/.test(o)) return 'Happy Anniversary! ❤️ Wishing you many more years of love and happiness together.';
  if (/diwali|deepawali/.test(o)) return 'Happy Diwali! 🪔 May this festival of lights bring joy, prosperity and happiness to you and your family.';
  if (/holi/.test(o)) return 'Happy Holi! 🎨 May your life be filled with colours of joy and happiness.';
  if (/eid/.test(o)) return 'Eid Mubarak! 🌙 Wishing you peace, happiness and blessings.';
  if (/new year|naya saal/.test(o)) return 'Happy New Year! 🎉 Wishing you a year full of happiness and success.';
  if (/raksha|rakhi/.test(o)) return 'Happy Raksha Bandhan! 🧡 Thank you for always being there for me.';
  if (/good ?morning/.test(o)) return 'Good morning! ☀️ Have a wonderful day.';
  if (/good ?night/.test(o)) return 'Good night! 🌙 Sleep well.';
  if (/luck|exam|interview/.test(o)) return `All the best${/exam/.test(o) ? ' for your exam' : /interview/.test(o) ? ' for your interview' : ''}! 👍 You've got this.`;
  const clean = occ.replace(/^happy\s+/i, '');
  return `Happy ${clean.charAt(0).toUpperCase() + clean.slice(1)}! 🎉 Wishing you all the best.`;
}

function detect(text, contacts = []) {
  const raw = norm(text).replace(/[.!?।]+$/, ''); const t = lower(text).replace(/^(hey |ok |hi )?(pragati|jarvis)[, ]+/, '').replace(/^(please|pls|kindly|zara|jara)\s+/, '').replace(/[.!?।]+$/, '');
  if (!t) return null;
  let m;
  const person = (who) => {
    const w = cleanWho(who); const num = phoneOf(w);
    if (num) return { name: w.replace(/\+?\d[\d\s-]{6,16}\d/, '').trim() || num, phone: num, known: true };
    const c = findContact(contacts, w);
    if (c) return { name: c.name, phone: c.phone, known: true, id: c.id };
    return { name: w.replace(/^./, (x) => x.toUpperCase()), phone: null, known: false, relation: relOf(w) };
  };

  // "mom I reached safely" → who: mom, body: I reached safely
  const split = (rest) => {
    const r = norm(rest); const num = r.match(/^(\+?\d[\d\s-]{6,16}\d)\s*(.*)$/);
    if (num) return { who: num[1], body: cleanBody(raw.slice(raw.length - num[2].length)) };
    const ws = r.split(' ');
    let pick = null;
    for (let k = 1; k <= Math.min(3, ws.length - 1); k++) { const sc = matchContact(contacts, ws.slice(0, k).join(' ')); if (sc && (!pick || sc[0] > pick[0])) pick = [sc[0], k]; }
    if (pick) { const body = ws.slice(pick[1]).join(' '); return { who: ws.slice(0, pick[1]).join(' '), body: cleanBody(raw.slice(raw.length - body.length)) }; }
    return { who: r, body: '' };
  };

  // ── memory + contacts management ──
  if ((m = t.match(/^(?:remember|yaad rakh(?:na|o)?|note that|keep in mind)(?: that| ki)?\s+(.{3,})$/))) return { type: 'remember', fact: raw.slice(raw.length - m[1].length).trim() };
  if ((m = t.match(/^(?:forget|bhool jao|bhul jao)(?: that| ki)?\s+(.{3,})$/))) return { type: 'forget', fact: m[1] };
  if ((m = t.match(/^(?:save|add|store)\s+(?:contact\s+|number\s+)?(?:of\s+)?(.+?)(?:'s)?\s+(?:number|no\.?|contact)?\s*(?:as|is|:|=)?\s*(\+?\d[\d\s-]{7,}\d)$/)) || (m = t.match(/^(.+?)\s+ka\s+(?:number|no\.?|nambar)\s+(\+?\d[\d\s-]{7,}\d)(?:\s+(?:hai|save karo|save kar do|add karo|save))?$/))) {
    const name = cleanWho(m[1]).replace(/\s+(number|contact)$/, '');
    return { type: 'save_contact', name: name.replace(/^./, (x) => x.toUpperCase()), phone: phoneOf(m[2]), relation: relOf(name) };
  }

  // ── WhatsApp (checked before SMS / call) ──
  // ── greetings: "Didi ko birthday wish karo (whatsapp pe)", "wish didi happy birthday on whatsapp" ──
  if (/\bwish/.test(t)) {
    const via = /\b(sms|text)\b/.test(t) && !/whatsapp/.test(t) ? 'sms' : 'whatsapp';
    const s2 = t.replace(/\s*(?:on|via|pe|par|pr)?\s*(?:whatsapp|sms|text)\s*(?:pe|par|pr|se)?\s*/g, ' ').replace(/\s+/g, ' ').trim();
    if ((m = s2.match(/^(.+?)\s+(?:ko|ku)\s+(?:(.+?)\s+)?(?:wish|wishes)\s*(?:karo|kar do|bhejo|bhej do|send karo)?(?:\s+(.+))?$/))
      || (m = s2.match(/^(?:send\s+)?(?:wish|wishes)\s+(?:to\s+)?(\S+(?:\s+(?:ji|di|bhaiya|bhai|uncle|aunty))?)\s*(?:(?:a\s+)?(.+?))?$/))) {
      const occ = [m[2], m[3]].filter(Boolean).join(' ').replace(/^(a|an|for|on|his|her|their)\s+/, '').trim() || 'a wonderful day';
      return { type: via, to: person(m[1]), text: wishText(occ), compose: `wish them ${occ}`, confirm: true };
    }
  }
  if (/whatsapp|\bwa\b|व्हाट्सएप/.test(t)) {
    if ((m = t.match(/^(?:open\s+)?whatsapp(?:\s+(?:kholo|open karo|khol do))?$/))) return { type: 'open', app: 'whatsapp', label: 'Open WhatsApp' };
    if ((m = t.match(/^(?:send\s+)?(?:a\s+)?(?:whatsapp|wa)(?:\s+(?:message|msg|text))?\s+(?:to\s+)?(.+?)(?:\s+(?:saying|that|ki|:)\s+|\s*[:,-]\s*)(.+)$/))
      || (m = t.match(/^(?:send\s+)?(?:a\s+)?(?:message|msg|text)\s+(?:to\s+)?(.+?)\s+on\s+whatsapp(?:\s+(?:saying|that|:)\s*|\s*[:,-]\s*|\s+)(.+)$/))
      || (m = t.match(/^(?:message|msg|text|tell)\s+(.+?)\s+(?:saying|that)\s+(.+?)\s+on\s+whatsapp$/))
      || (m = t.match(/^(.+?)\s+(?:ko|ku)\s+whatsapp\s+(?:pe|par|pr|me|mein)?\s*(?:message|msg|text)?\s*(?:karo|kar do|bhejo|bhej do|bolo|bol do|likho)?\s*(?:ki|ke|:)\s+(.+)$/))
      || (m = t.match(/^(.+?)\s+(?:ko|ku)\s+whatsapp\s+(?:pe|par|pr|me|mein)?\s*(?:bolo|bol do|likho|batao)\s+(?:ki\s+)?(.+)$/))) {
      return { type: 'whatsapp', to: person(m[1]), text: cleanBody(raw.slice(raw.toLowerCase().lastIndexOf(m[2].slice(0, 12)))), confirm: true };
    }
    if ((m = t.match(/^(?:send\s+)?(?:a\s+)?(?:whatsapp|wa)(?:\s+(?:message|msg|call))?\s+(?:to\s+)?(.+)$/)) || (m = t.match(/^(?:message|msg|text)\s+(.+?)\s+on\s+whatsapp$/)) || (m = t.match(/^(.+?)\s+(?:ko|ku)\s+whatsapp\s*(?:pe|par)?\s*(?:message|msg|call)?\s*(?:karo|kar do|bhejo|lagao)?$/))) {
      const sp = split(m[1]); return { type: 'whatsapp', to: person(sp.who), text: sp.body, confirm: true };
    }
  }

  // ── SMS / text ──
  if ((m = t.match(/^(?:send\s+)?(?:an?\s+)?(?:sms|text|message|msg)(?:\s+message)?\s+(?:to\s+)?(.+?)(?:\s+(?:saying|that|ki|:)\s+|\s*[:,-]\s*)(.+)$/))
    || (m = t.match(/^(.+?)\s+(?:ko|ku)\s+(?:sms|text|message|msg)\s+(?:karo|kar do|bhejo|bhej do|likho)?\s*(?:ki|ke|:)\s+(.+)$/))
    || (m = t.match(/^(.+?)\s+(?:ko|ku)\s+(?:bolo|bol do|batao|bata do)\s+(?:ki\s+)(.+)$/))) {
    if (!/^(me|myself|mujhe)$/.test(m[1])) {
      const kind = /\b(sms|text)\b/.test(t) ? 'sms' : 'whatsapp';
      return { type: kind, to: person(m[1]), text: cleanBody(raw.slice(raw.toLowerCase().lastIndexOf(m[2].slice(0, 12)))), confirm: true };
    }
  }
  if ((m = t.match(/^(?:send\s+)?(?:an?\s+)?(sms|text|message|msg)\s+(?:to\s+)?([^ ].{0,160})$/)) || (m = t.match(/^(.+?)\s+(?:ko|ku)\s+(sms|text|message|msg)\s*(?:karo|kar do|bhejo|bhej do)?$/))) {
    const [who, kind] = /^(sms|text|message|msg)$/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]];
    if (!/\b(about|regarding|for my|email)\b/.test(who)) { const sp = split(who); return { type: /sms|text/.test(kind) ? 'sms' : 'whatsapp', to: person(sp.who), text: sp.body, confirm: true }; }
  }

  // ── phone call ──
  if ((m = t.match(new RegExp(`^(?:make\\s+a\\s+)?${UNIT}(?:\\s+(?:call|karo))?\\s+(?:to\\s+)?(.+?)(?:\\s+(?:now|please|abhi))?$`)))
    || (m = t.match(new RegExp(`^(.+?)\\s+(?:ko|ku|se)\\s+(?:${UNIT}|baat)\\s*(?:karo|kar do|kardo|lagao|laga do|karna hai|karwao|karao|milao|mila do)?$`)))
    || (m = t.match(/^(.+?)\s+(?:ko|ku)\s+(?:कॉल|फोन)\s*(?:करो|लगाओ)?$/))) {
    const who = m[1];
    if (!/^(me|a taxi|an? uber|it|this|that)$/.test(who) && who.length < 50) return { type: 'call', to: person(who), confirm: true };
  }

  // ── YouTube ──
  if ((m = t.match(/^(?:play|search|find|show|open|watch)\s+(.+?)\s+(?:on|in)\s+(?:youtube|yt)$/)) || (m = t.match(/^(?:search\s+)?(?:youtube|yt)\s+(?:for\s+|search\s+|pe\s+|par\s+|me\s+)?(.+?)(?:\s+(?:chalao|lagao|search karo|dikhao|play karo|bajao))?$/)) || (m = t.match(/^(?:youtube|yt)\s+(?:pe|par|pr|me|mein)\s+(.+?)\s*(?:chalao|lagao|search karo|dikhao|play karo|bajao|kholo)?$/)) || (m = t.match(/^(.+?)\s+(?:youtube|yt)\s+(?:pe|par|pr|me|mein)\s*(?:chalao|lagao|search karo|dikhao|play karo|bajao)?$/))) {
    if (!/^(open|kholo)$/.test(m[1])) return { type: 'youtube', query: m[1].replace(/^(play|the|some)\s+/, ''), play: /play|chalao|lagao|bajao|watch/.test(t) };
  }
  if ((m = t.match(/^(?:play|bajao|chalao|lagao)\s+(?:the\s+|some\s+)?(.+?)(?:\s+(?:song|songs|gaana|gana|gaane|music|video))?$/)) && !/\b(game|chess|ludo)\b/.test(t)) return { type: 'youtube', query: m[1], play: true };
  if ((m = t.match(/^(.+?)\s+(?:ka|ke|ki)\s+(?:song|songs|gaana|gana|gaane|video)\s+(?:chalao|lagao|bajao|play karo)$/))) return { type: 'youtube', query: `${m[1]} songs`, play: true };

  // ── Google search ──
  if ((m = t.match(/^(?:google|search(?:\s+on)?\s+google(?:\s+for)?|search(?:\s+the)?\s+(?:web|internet)\s+for|search\s+for|look\s+up|search)\s+(.+)$/)) || (m = t.match(/^(.+?)\s+(?:google|internet)\s+(?:pe|par|pr|me|mein)\s*(?:search\s*)?(?:karo|kar do|dhundo|dekho)?$/)) || (m = t.match(/^google\s+(?:pe|par|pr|me|mein)\s+(.+?)\s*(?:search karo|dhundo|dekho)?$/)) || (m = t.match(/^(.+?)\s+(?:search karo|search kar do|dhundo)$/))) {
    if (!/^(youtube|yt)\b/.test(m[1])) return { type: 'google', query: m[1].replace(/\s+on google$/, '') };
  }

  // ── maps / navigation ──
  if ((m = t.match(/^(?:navigate|directions?|route|take me|show (?:me )?the way|how (?:do i|to) (?:get|go|reach))\s+(?:to\s+)?(.+)$/)) || (m = t.match(/^(.+?)\s+(?:ka|ki)\s+(?:rasta|raasta|route|direction)\s*(?:batao|dikhao)?$/)) || (m = t.match(/^(?:find|show)\s+(.+?)\s+(?:near me|nearby|on (?:the )?map)$/))) return { type: 'maps', query: m[1], near: /near me|nearby/.test(t) };
  if ((m = t.match(/^(.+?)\s+(?:near me|nearby|paas mein|aas paas)$/)) && m[1].split(' ').length <= 5) return { type: 'maps', query: m[1], near: true };

  // ── open an app or a website ──
  if ((m = t.match(/^(?:open|launch|start|run|go to|goto)\s+(?:the\s+|my\s+)?(.+?)(?:\s+(?:app|application|website|site))?$/)) || (m = t.match(/^(.+?)\s+(?:app\s+)?(?:kholo|khol do|open karo|open kar do|chalu karo|start karo)$/)) || (m = t.match(/^(.+?)\s+(?:खोलो|ओपन करो)$/))) {
    const what = m[1].trim();
    if (what.split(' ').length <= 4 && !/\b(door|window|mind|heart|eyes|account|file|pdf|document)\b/.test(what)) return { type: 'open', app: what };
  }
  return null;
}

module.exports = { detect, findContact, phoneOf, relOf, RELATIONS };
