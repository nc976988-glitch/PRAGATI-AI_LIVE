// Pragati AI — app shell: auth, routing, voice, live events, command palette.
import { api, auth, setUnauth, connectEvents } from './api.js';
import { S, emit, on } from './state.js';
import { $, $$, esc, icon, toast, sfx, setSound, speak, wireGlass, typeInto } from './util.js';
import { startBackdrop } from './bg.js';
import { Voice, voiceSupported } from './voice.js';
import { wirePlans, patchPlan } from './plan.js';
import { mountConsole } from './view-console.js';
import { mountChat, stopSpeaking } from './view-chat.js';
import { mountPeople } from './view-people.js';
import { mountMap, mountPersonal, mountWork } from './views-a.js';
import { mountStudy, mountLife } from './views-b.js';
import { mountAgent, mountTrust, mountRoad } from './views-c.js';
import { lockEnabled, verifyLock } from './lock.js';
import { playIntro } from './intro.js';
import './lang-core.js';
import { initWake, openVoice, setWake, currentLang, openLangPicker, voiceOpen } from './handsfree.js';

const VIEWS = {
  chat: { mount: mountChat, label: 'Chat', crumb: 'Pragati' },
  people: { mount: mountPeople, label: 'Family & memory', crumb: 'Family & memory' },
  console: { mount: mountConsole, label: 'Command console', crumb: 'Command console' },
  map: { mount: mountMap, label: 'Intelligence map', crumb: 'Intelligence map' },
  personal: { mount: mountPersonal, label: 'Personal AI', crumb: 'Personal AI' },
  work: { mount: mountWork, label: 'Work AI', crumb: 'Work AI' },
  study: { mount: mountStudy, label: 'Study AI', crumb: 'Study AI' },
  life: { mount: mountLife, label: 'Life manager', crumb: 'Life manager' },
  agent: { mount: mountAgent, label: 'Smart agent', crumb: 'Smart agent' },
  trust: { mount: mountTrust, label: 'Trust center', crumb: 'Trust center' },
  road: { mount: mountRoad, label: 'Roadmap', crumb: 'Roadmap' },
};
const RAIL = ['study', 'life', 'work', 'personal', 'people', 'agent', 'console', 'map', 'trust', 'road'];

const stage = $('#stage');
let unmount = null;
let stopEvents = null;
let entered = false;

// ───────────────────────── app object shared with views ─────────────────────────
export const app = {
  lang: 'en-IN', orb: null, interim: null, final: null, keys: null, submitIntent: null,
  go, refresh, mic, setLang, say,
};

function say(text, lang) { if (S.user?.settings?.speak && text) speak(text, lang || app.lang); }

async function setLang(l) {
  app.lang = l;
  try { const r = await api('PATCH', '/api/me', { settings: { lang: l } }); S.user = r.user; } catch (_) { /* non-fatal */ }
}

let refreshing = null;
async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try { S.dash = await api('GET', '/api/dashboard'); S.engine = S.dash.engine; setEngineChip(); emit('dash'); }
    catch (_) { /* offline */ }
    finally { refreshing = null; }
  })();
  return refreshing;
}
on('data', refresh);

function setEngineChip() {
  const c = $('#engchip'); if (!c || !S.engine) return;
  c.querySelector('span').textContent = S.engine.label || 'Local engine';
  c.classList.toggle('ai', !!S.engine.enabled);
}

// ───────────────────────── voice ─────────────────────────
const voice = new Voice({
  onInterim: (t) => app.interim?.(t),
  onFinal: (t) => app.final?.(t),
  onLevel: (v) => app.orb?.setLevel(v),
  onState: (s) => {
    const live = s === 'listening';
    S.voice.listening = live; emit('voice', live);
    $('#miclive').hidden = !live;
    if (live) app.orb?.setMode('listening'); else if (app.orb?.mode === 'listening') app.orb.setMode('idle');
  },
  onError: (m) => toast('Voice', m, 'm', 6000),
});
function mic() {
  if (S.view === 'chat' && app.chatMic) { app.chatMic(); return; }
  if (!voiceSupported) { toast('Voice needs Chrome or Edge', 'You can type your request instead.', 'a'); return; }
  if (voice.active) voice.stop(); else { sfx('start'); voice.start(currentLang().locale || app.lang); }
}

// ───────────────────────── routing ─────────────────────────
function go(route) {
  const [view, sub] = String(route || 'chat').split(':');
  const v = VIEWS[view] || VIEWS.chat; const id = VIEWS[view] ? view : 'chat';
  closeSide(); stopSpeaking();
  if (voice.active) voice.stop();
  try { unmount?.(); } catch (_) { /* view cleanup */ }
  unmount = null; app.keys = null; app.interim = null; app.final = null; app.submitIntent = null;
  stage.classList.remove('swap'); void stage.offsetWidth; stage.classList.add('swap');
  stage.innerHTML = '';
  S.view = id;
  try { unmount = v.mount(stage, app, sub); } catch (e) { console.error(e); stage.innerHTML = `<div class="view"><div class="glass pad"><b>This view hit an error.</b><p class="muted">${esc(e.message)}</p></div></div>`; }
  $('#crumb').textContent = v.crumb;
  $$('#rail button[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === id));
  const h = `#/${sub ? `${id}:${sub}` : id}`; if (location.hash !== h) history.replaceState(null, '', h);
  stage.scrollTop = 0;
  markConvo(id === 'chat' ? sub : null);
}
addEventListener('hashchange', () => { if (entered) go(location.hash.replace(/^#\/?/, '') || 'chat'); });

function buildRail() {
  $('#rail').innerHTML = RAIL.map((id) => `<button data-v="${id}">${icon(id)}<span>${VIEWS[id].label}</span></button>`).join('');
  $$('#rail button[data-v]').forEach((b) => (b.onclick = () => go(b.dataset.v)));
}

// ───────────────────────── sidebar: conversations ─────────────────────────
let convos = []; let activeConvo = null;
function openSide() { document.body.classList.add('side-open'); }
function closeSide() { document.body.classList.remove('side-open'); }
$('#burger').onclick = () => { if (matchMedia('(max-width: 900px)').matches) openSide(); else document.body.classList.toggle('side-collapsed'); };
$('#sidex').onclick = () => { if (matchMedia('(max-width: 900px)').matches) closeSide(); else document.body.classList.add('side-collapsed'); };
$('#scrim').onclick = closeSide;
$('#newchat').onclick = () => { history.replaceState(null, '', '#/chat'); go('chat'); };
$('#csearch').oninput = renderConvos;
function markConvo(id) { activeConvo = id || null; $$('#convos [data-c]').forEach((b) => b.classList.toggle('on', b.dataset.c === activeConvo)); }
async function loadConvos() { try { convos = (await api('GET', '/api/convos')).items; } catch (_) { convos = []; } renderConvos(); }
function bucket(ts) { const d = (Date.now() - ts) / 864e5; return d < 1 && new Date(ts).getDate() === new Date().getDate() ? 'Today' : d < 2 ? 'Yesterday' : d < 7 ? 'Previous 7 days' : 'Older'; }
function renderConvos() {
  const q = ($('#csearch').value || '').toLowerCase(); const list = convos.filter((c) => !q || c.title.toLowerCase().includes(q));
  if (!list.length) { $('#convos').innerHTML = `<p class="side-empty">${q ? 'No chats match.' : 'Your conversations will appear here.'}</p>`; return; }
  let last = ''; let html = '';
  for (const c of list) {
    const b = c.pinned ? 'Pinned' : bucket(c.updatedAt);
    if (b !== last) { html += `<div class="side-when">${b}</div>`; last = b; }
    html += `<div class="cv${c.id === activeConvo ? ' on' : ''}" data-c="${c.id}"><button class="cv-t" data-open="${c.id}" title="${esc(c.title)}">${esc(c.title)}</button><button class="cv-m" data-more="${c.id}" aria-label="Chat options">⋯</button></div>`;
  }
  $('#convos').innerHTML = html;
}
on('convos', loadConvos);
on('convo', (id) => markConvo(id));
$('#convos').onclick = async (e) => {
  const o = e.target.closest('[data-open]'); if (o) { go(`chat:${o.dataset.open}`); return; }
  const m = e.target.closest('[data-more]'); if (!m) return; e.stopPropagation();
  $$('.cvmenu').forEach((x) => x.remove());
  const c = convos.find((x) => x.id === m.dataset.more); if (!c) return;
  const pop = document.createElement('div'); pop.className = 'cvmenu glass';
  pop.innerHTML = `<button data-x="rename">Rename</button><button data-x="pin">${c.pinned ? 'Unpin' : 'Pin'}</button><button data-x="del" class="danger">Delete</button>`;
  m.parentElement.appendChild(pop);
  pop.onclick = async (ev) => {
    const x = ev.target.closest('[data-x]')?.dataset.x; pop.remove(); if (!x) return;
    try {
      if (x === 'rename') { const t = prompt('Rename chat', c.title); if (t) await api('PATCH', `/api/convos/${c.id}`, { title: t }); }
      if (x === 'pin') await api('PATCH', `/api/convos/${c.id}`, { pinned: !c.pinned });
      if (x === 'del' && confirm(`Delete “${c.title}”?`)) { await api('DELETE', `/api/convos/${c.id}`); if (activeConvo === c.id) go('chat'); }
    } catch (err) { toast('Could not do that', err.message, 'm'); }
    loadConvos();
  };
};
addEventListener('click', (e) => { if (!e.target.closest('.cvmenu')) $$('.cvmenu').forEach((x) => x.remove()); });

// ───────────────────────── session ─────────────────────────
function applyUser(u) {
  S.user = u; app.lang = u.settings.lang || 'en-IN'; setSound(u.settings.sound !== false);
  $('#avatar').textContent = (u.name || 'P').trim()[0].toUpperCase(); $('#uname').textContent = u.settings.callMe || u.name; $('#uplan').textContent = u.demo ? 'Demo workspace' : (u.email || 'Personal workspace');
  $('#m-speak').textContent = u.settings.speak !== false ? 'on' : 'off';
  $('#m-sound').textContent = u.settings.sound !== false ? 'on' : 'off';
}

async function enter(cinematic = true) {
  if (entered) return; entered = true;
  buildRail();
  await refresh();
  on('need-chat', () => { if (S.view !== 'chat') go('chat'); });
  setTimeout(initWake, 1500);
  if (cinematic) await playIntro(S.user.name.split(' ')[0]);
  $('#boot').classList.add('off'); $('#app').classList.add('on');
  stopEvents = connectEvents({
    plan: (p) => { patchPlan(p); },
    reminder: (r) => {
      sfx('ping'); toast('⏰ Reminder', r.title, 'a', 12000); say(`Reminder: ${r.title}`);
      if (S.user.settings.notifications && 'Notification' in window && Notification.permission === 'granted') { try { new Notification('Pragati reminder', { body: r.title }); } catch (_) { /* noop */ } }
      emit('data');
    },
  });
  go(location.hash.replace(/^#\/?/, '') || 'chat'); loadConvos();
  if (S.user.demo) { const b = $('#demobanner'); b.textContent = 'Demo workspace · sample data loaded'; b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 7000); }
  if (S.user.settings.notifications && 'Notification' in window && Notification.permission === 'default') { /* asked from Trust center, never nagged */ }
}

function leave() {
  entered = false; stopEvents?.(); try { unmount?.(); } catch (_) { /* noop */ } unmount = null; stage.innerHTML = '';
  auth.set(''); S.user = null; S.dash = null; S.plans.clear();
  $('#app').classList.remove('on'); $('#boot').classList.remove('off'); $('#menu').classList.remove('on');
  history.replaceState(null, '', location.pathname);
}
setUnauth(() => { toast('Session ended', 'Please sign in again.', 'a'); leave(); });

// ───────────────────────── auth UI ─────────────────────────
function wireAuth() {
  const tabs = $$('#authcard .tabs button'); const forms = $$('#authcard form');
  const show = (t) => { tabs.forEach((b) => b.classList.toggle('on', b.dataset.tab === t)); forms.forEach((f) => { f.hidden = f.dataset.form !== t; }); $('#autherr').textContent = ''; };
  tabs.forEach((b) => (b.onclick = () => show(b.dataset.tab))); show('demo');
  forms.forEach((f) => (f.onsubmit = async (e) => {
    e.preventDefault(); const kind = f.dataset.form; const btn = f.querySelector('button[type=submit]'); const old = btn.textContent; btn.disabled = true; btn.textContent = '…';
    try {
      const body = Object.fromEntries(new FormData(f).entries());
      const r = await api('POST', `/api/auth/${kind}`, body);
      auth.set(r.token); applyUser(r.user); sfx('start'); await enter(true);
    } catch (err) { $('#autherr').textContent = err.message; sfx('err'); }
    finally { btn.disabled = false; btn.textContent = old; }
  }));
  const lines = ['ASK ANYTHING  /  STUDY EVERYTHING  /  GET IT DONE', '"CALL MUMMY"  ·  "PAPA KO WHATSAPP KARO"  ·  "OPEN INSTAGRAM"', 'LIKE JARVIS — BUT FAMILY.'];
  let i = 0; const el = $('#bootline'); const cycle = async () => { if (entered) return; await typeInto(el, lines[i++ % lines.length], 34); setTimeout(cycle, 2200); }; cycle();
}

// ───────────────────────── header, menu, palette ─────────────────────────
function tickClock() { $('#clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
setInterval(tickClock, 15000); tickClock();

$('#userbtn').onclick = (e) => { e.stopPropagation(); $('#menu').classList.toggle('on'); };
addEventListener('click', (e) => { if (!e.target.closest('#menu')) $('#menu').classList.remove('on'); });
$('#menu').onclick = async (e) => {
  const b = e.target.closest('[data-m]'); if (!b) return; $('#menu').classList.remove('on');
  const m = b.dataset.m;
  if (m === 'trust') go('trust');
  else if (m === 'people') go('people');
  else if (m === 'speak') { const v = !(S.user.settings.speak !== false); try { const r = await api('PATCH', '/api/me', { settings: { speak: v } }); applyUser(r.user); toast('Speak answers', v ? 'on — voice questions get spoken replies' : 'off', 'c'); } catch (err) { toast('Could not change', err.message, 'm'); } }
  else if (m === 'sound') { const v = !(S.user.settings.sound !== false); try { const r = await api('PATCH', '/api/me', { settings: { sound: v } }); applyUser(r.user); toast('Sound', v ? 'on' : 'off', 'c'); } catch (err) { toast('Could not change', err.message, 'm'); } }
  else if (m === 'lock') { if (lockEnabled()) showLock(); else { toast('App lock is off', 'Turn it on in the Trust center.', 'a'); go('trust'); } }
  else if (m === 'out') leave();
};

function showLock() { $('#lock').classList.add('on'); $('#lockerr').textContent = ''; }
$('#unlock').onclick = async () => {
  try { await verifyLock(); $('#lock').classList.remove('on'); sfx('done'); } catch (_) { $('#lockerr').textContent = 'Could not verify — try again.'; sfx('err'); }
};

const COMMANDS = () => [
  { t: 'New chat', k: 'chat', run: () => go('chat') },
  ...RAIL.filter((x) => x !== '-').map((id) => ({ t: `Go to ${VIEWS[id].label}`, k: 'navigate', run: () => go(id) })),
  { t: 'Run autopilot demo', k: 'demo', run: autopilot },
  { t: 'Toggle sound', k: 'setting', run: () => $('#menu [data-m=sound]').click() },
  { t: 'Start listening', k: 'voice', run: () => { go('chat'); setTimeout(mic, 400); } },
  { t: 'Voice mode (hands-free)', k: 'voice', run: () => openVoice() },
  { t: 'Change language', k: 'language', run: () => openLangPicker(null) },
  { t: 'Hey Pragati wake word (on/off)', k: 'voice', run: () => { const on = !document.body.classList.contains('wake-on'); setWake(on); toast(on ? 'Wake word on' : 'Wake word off', on ? 'Say "Hey Pragati" any time this tab is open.' : '', 'v'); } },
  { t: 'Lock Pragati', k: 'security', run: () => $('#menu [data-m=lock]').click() },
  { t: 'Sign out', k: 'session', run: leave },
];
let psel = 0; let pitems = [];
function openPalette() { $('#palette').classList.add('on'); const i = $('#pin'); i.value = ''; renderPalette(); setTimeout(() => i.focus(), 30); }
function closePalette() { $('#palette').classList.remove('on'); }
function renderPalette() {
  const q = $('#pin').value.trim().toLowerCase();
  pitems = COMMANDS().filter((c) => !q || c.t.toLowerCase().includes(q));
  if (q) pitems.push({ t: `Ask Pragati: “${$('#pin').value.trim()}”`, k: 'intent', run: () => { go('chat'); setTimeout(() => app.submitIntent?.($('#pin').value.trim() || q), 350); } });
  psel = Math.min(psel, pitems.length - 1); if (psel < 0) psel = 0;
  $('#popts').innerHTML = pitems.map((c, i) => `<button class="${i === psel ? 'sel' : ''}" data-i="${i}">${esc(c.t)}<small>${c.k}</small></button>`).join('');
}
$('#pin').oninput = () => { psel = 0; renderPalette(); };
$('#pin').onkeydown = (e) => {
  if (e.key === 'ArrowDown') { psel = Math.min(pitems.length - 1, psel + 1); renderPalette(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { psel = Math.max(0, psel - 1); renderPalette(); e.preventDefault(); }
  else if (e.key === 'Enter') { const c = pitems[psel]; if (c) { const text = $('#pin').value.trim(); closePalette(); if (c.k === 'intent') { go('chat'); setTimeout(() => app.submitIntent?.(text), 350); } else c.run(); } }
};
$('#popts').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; const c = pitems[+b.dataset.i]; const text = $('#pin').value.trim(); closePalette(); if (c.k === 'intent') { go('chat'); setTimeout(() => app.submitIntent?.(text), 350); } else c.run(); };
$('#palette').onclick = (e) => { if (e.target.id === 'palette') closePalette(); };
$('#cmdk').onclick = openPalette;

addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (entered) openPalette(); return; }
  if (e.key === 'Escape') { closePalette(); $('#modal').classList.remove('on'); $('#menu').classList.remove('on'); return; }
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
  if (!typing && entered && e.key === '/') { const i = $('#ci') || $('#pi'); if (i) { e.preventDefault(); i.focus(); } }
  if (!typing && entered && !voiceOpen() && e.key.toLowerCase() === 'h' && e.shiftKey && !e.ctrlKey && !e.metaKey) { openVoice(); return; }
  if (!typing && entered && !voiceOpen() && e.key.toLowerCase() === 'v' && !e.ctrlKey && !e.metaKey && (S.view === 'console' || S.view === 'chat')) { mic(); }
  app.keys?.(e);
});

// ───────────────────────── polish: spotlight + tilt ─────────────────────────
(function polish() {
  const spot = $('.spot'); let raf = 0, px = 0, py = 0;
  addEventListener('pointermove', (e) => {
    px = e.clientX; py = e.clientY; if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; spot.style.setProperty('--px', px + 'px'); spot.style.setProperty('--py', py + 'px'); });
    const t = e.target.closest && e.target.closest('.stat, .mini > .glass, .wf');
    if (t) { const r = t.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; t.style.transform = `perspective(800px) rotateX(${(-y * 7).toFixed(2)}deg) rotateY(${(x * 9).toFixed(2)}deg) translateZ(0)`; t.classList.add('tilting'); }
  }, { passive: true });
  addEventListener('pointerout', (e) => { const t = e.target.closest && e.target.closest('.tilting'); if (t) { t.style.transform = ''; t.classList.remove('tilting'); } }, { passive: true });
})();

// ───────────────────────── autopilot demo (for judges) ─────────────────────────
let demoOn = false;
async function autopilot() {
  if (demoOn) { demoOn = false; return; } if (!entered) return; demoOn = true;
  const cap = $('#democap'); const wait = (ms) => new Promise((r, j) => setTimeout(() => (demoOn ? r() : j(new Error('abort'))), ms));
  const say = (t) => { cap.innerHTML = t; cap.classList.add('on'); };
  const stop = () => { demoOn = false; cap.classList.remove('on'); };
  const esc = (e) => { if (e.key === 'Escape') stop(); }; addEventListener('keydown', esc);
  try {
    const typeSend = async (text) => { const inp = $('#ci'); inp.focus(); inp.value = ''; for (const ch of text) { inp.value += ch; inp.dispatchEvent(new Event('input')); await wait(32); } await wait(350); app.submitIntent?.(inp.value); inp.value = ''; };
    const settle = async () => { for (let i = 0; i < 40; i++) { await wait(400); if (!$('#send.stop')) break; } };
    go('chat'); await wait(900);
    say('<b>01 · ASK ANYTHING</b> — like ChatGPT or Gemini, in English, Hindi or Hinglish'); await typeSend('Who was APJ Abdul Kalam?'); await settle(); await wait(2600);
    say('<b>02 · STUDY</b> — maths, science, every subject, with steps'); await typeSend('Solve 2x + 7 = 19'); await settle(); await wait(2400);
    say('<b>03 · FAMILY</b> — Pragati remembers people and what matters to you'); await typeSend('remember that my board exams start on 15 February'); await settle(); await wait(2200);
    say('<b>04 · ACT</b> — plans with your approval: tasks, notes, reminders'); await typeSend('Plan my study for 2 hours and remind me at 7 pm'); await settle(); await wait(2400);
    { const ok = $$('.plan [data-act=approve]').pop(); if (ok) { say('<b>05 · APPROVE</b> — you stay in control. One click.'); await wait(1200); ok.click(); } }
    await wait(3000);
    say('<b>06 · DEVICE</b> — “call Mummy”, “WhatsApp Papa…”, “open Instagram”, “play Kesariya on YouTube” open on your phone'); await wait(4200);
    go('people'); say('<b>Family & memory</b> — contacts you can call by voice, plus what Pragati remembers'); await wait(3400);
    go('trust'); say('<b>Trust center</b> — a hash-chained ledger of every action'); await wait(3000);
    go('chat'); say('<b>Pragati</b> — like JARVIS, but family.'); await wait(2600);
  } catch (_) { /* aborted */ }
  stop(); removeEventListener('keydown', esc);
}
$('#demobtn').onclick = autopilot;

// ───────────────────────── boot ─────────────────────────
(async function boot() {
  wireGlass(); wirePlans(go); startBackdrop($('#bg')); wireAuth();
  if (auth.token) {
    try {
      const r = await api('GET', '/api/me'); applyUser(r.user); S.engine = r.engine;
      if (lockEnabled()) showLock();
      await enter(false);
    } catch (_) { auth.set(''); }
  }
})();
