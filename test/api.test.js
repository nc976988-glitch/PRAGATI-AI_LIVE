'use strict';
// End-to-end API test. Spawns the server on a temp dir and walks the whole Pragati Loop.
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const PORT = 3900 + Math.floor(Math.random() * 90);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pragati-'));
const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tok = '';
async function api(method, url, body) {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-tz-offset': '-330', ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
}
(async () => {
  const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT, DATA_DIR: dir, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', GEMINI_API_KEY: '' }, stdio: 'inherit' });
  try {
    for (let i = 0; i < 30; i++) { try { await fetch(base + '/api/health'); break; } catch (_) { await sleep(150); } }
    let r = await api('GET', '/api/health'); assert.equal(r.ok, true); console.log('✓ health');
    r = await api('GET', '/api/tasks'); assert.equal(r.status, 401); console.log('✓ auth required');
    r = await api('POST', '/api/auth/register', { name: 'Test User', email: 't@x.io', password: 'short' }); assert.equal(r.status, 400);
    r = await api('POST', '/api/auth/register', { name: 'Test User', email: 't@x.io', password: 'longenough1' }); assert.equal(r.status, 200); tok = r.token; console.log('✓ register');
    r = await api('POST', '/api/auth/login', { email: 't@x.io', password: 'wrong' }); assert.equal(r.status, 401);
    r = await api('POST', '/api/auth/login', { email: 't@x.io', password: 'longenough1' }); assert.equal(r.status, 200); console.log('✓ login');

    r = await api('POST', '/api/orchestrate', { text: 'Plan my study for physics and maths, finish my notes, remind me at 7.' });
    assert.equal(r.plan.steps.length, 3); assert.deepEqual(r.plan.steps.map((s) => s.kind), ['study_plan', 'create_note', 'create_reminder']);
    const pid = r.plan.id; console.log('✓ orchestrate → 3 steps, nothing executed yet');
    let tasks = await api('GET', '/api/tasks'); assert.equal(tasks.items.length, 0); console.log('✓ no side effects before approval');

    r = await api('POST', `/api/plans/${pid}/approve`, { steps: 'all' }); assert.equal(r.status, 200);
    for (let i = 0; i < 30; i++) { await sleep(300); r = await api('GET', `/api/plans/${pid}`); if (r.plan.status === 'done') break; }
    assert.equal(r.plan.status, 'done'); assert(r.plan.steps.every((s) => s.status === 'done'));
    tasks = await api('GET', '/api/tasks'); assert.equal(tasks.items.length, 3);
    const notes = await api('GET', '/api/notes'); assert.equal(notes.items.length, 1);
    const rems = await api('GET', '/api/reminders'); assert.equal(rems.items.length, 1); console.log('✓ approve → executed: 3 tasks, 1 note, 1 reminder');

    r = await api('POST', `/api/plans/${pid}/undo`, { step: 's1' }); assert.equal(r.plan.steps[0].status, 'undone');
    tasks = await api('GET', '/api/tasks'); assert.equal(tasks.items.length, 0); console.log('✓ undo');

    // consequential steps need explicit confirmation; unsupported are honest
    await api('POST', '/api/tasks', { title: 'old', status: 'done' });
    r = await api('POST', '/api/orchestrate', { text: 'clear completed tasks and call mom at 8pm' });
    assert.deepEqual(r.plan.steps.map((s) => s.kind), ['clear_done', 'blocked']);
    r = await api('POST', `/api/plans/${r.plan.id}/approve`, { steps: 'all' }); assert.equal(r.status, 400, 'consequential not auto-approved'); console.log('✓ consequential step refuses bulk approve');

    // study
    const d = await api('POST', '/api/docs', { title: 'OS', text: 'A deadlock occurs when a set of processes are each waiting for a resource held by another process in the set. Deadlock requires four conditions together: mutual exclusion, hold and wait, no preemption, and circular wait.' });
    assert.equal(d.status, 201);
    const ex = await api('POST', '/api/study/explain', { topic: 'deadlock' }); assert.equal(ex.grounded, true);
    const fc = await api('POST', '/api/study/flashcards', { docId: d.item.id }); assert(fc.cards.length >= 1); console.log('✓ study: grounded explain + flashcards');


    // assistant: streamed chat, device actions, contacts, memory, conversations (offline brain)
    const chat = async (text, convoId, extra) => {
      const res = await fetch(base + '/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tz-offset': '-330', authorization: `Bearer ${tok}` }, body: JSON.stringify({ text, convoId, ...(extra || {}) }) });
      const raw = await res.text(); const ev = {}; for (const m of raw.matchAll(/event: (\w+)\ndata: (.*)\n/g)) ev[m[1]] = JSON.parse(m[2]); return ev;
    };
    let ev = await chat('call mummy'); assert.equal(ev.action.type, 'call'); assert.equal(ev.action.needsContact, true); const cvId = ev.done.convoId; assert(cvId);
    ev = await chat('save mummy number as 9876543210', cvId); assert.equal(ev.action.type, 'contact_saved');
    ev = await chat('mummy ko call karo', cvId); assert.equal(ev.action.to.phone, '+919876543210'); console.log('✓ assistant: call → add contact → call by relation');
    ev = await chat('papa ko whatsapp pe bolo ki main late aaunga', cvId); assert.equal(ev.action.type, 'whatsapp'); assert.equal(ev.action.text, 'main late aaunga');
    ev = await chat('play kesariya on youtube', cvId); assert.equal(ev.action.type, 'youtube');
    ev = await chat('open instagram', cvId); assert.equal(ev.action.type, 'open'); console.log('✓ assistant: WhatsApp, YouTube, open app');
    ev = await chat('Solve 2x + 7 = 19', cvId); assert(/x = 6/.test(ev.done.text));
    ev = await chat('what is 15% of 240', cvId); assert(/36/.test(ev.done.text)); console.log('✓ assistant: offline maths + equation solver');
    ev = await chat('remember that my exam is on 5 December', cvId); assert.equal(ev.action.type, 'memory');
    r = await api('GET', '/api/memories'); assert.equal(r.items.length, 1);
    r = await api('GET', `/api/convos/${cvId}`); assert(r.messages.length >= 16); r = await api('GET', '/api/convos'); assert.equal(r.items.length, 1);
    r = await api('DELETE', `/api/convos/${cvId}`); assert.equal(r.ok, true); console.log('✓ assistant: memory + conversation history');

    // languages: detection, switching, voice hint, settings validation, AI ears
    const PL = require('../public/js/lang-core.js'); assert(PL.LANGS.length >= 130);
    for (const [t, c] of [['How are you doing today?', 'en'], ['¿Cómo estás? Quiero aprender física', 'es'], ['Bonjour, comment ça va aujourd\'hui ?', 'fr'], ['आज मौसम कैसा है?', 'hi'], ['வணக்கம், எப்படி இருக்கிறீர்கள்?', 'ta'], ['今日はいい天気ですね', 'ja'], ['مرحبا كيف حالك', 'ar'], ['Привет, как дела?', 'ru'], ['bhai aaj kya plan hai', 'hinglish']]) assert.equal(PL.detect(t).code, c, t);
    assert.equal(PL.switchRequest('reply in tamil')?.code, 'ta');
    ev = await chat('Hola, ¿cómo estás?'); assert.equal(ev.meta.lang.code, 'es'); const lc = ev.done.convoId;
    ev = await chat('please reply in german from now on', lc); assert.equal(ev.meta.lang.code, 'de'); assert.equal(ev.meta.switched, true);
    ev = await chat('ok thanks', lc); assert.equal(ev.meta.lang.code, 'de');
    ev = await chat('வணக்கம்', null, { lang: 'ta' }); assert.equal(ev.meta.lang.code, 'ta');
    r = await api('PATCH', '/api/me', { settings: { language: 'klingon' } }); assert.equal(r.user.settings.language, 'auto');
    r = await api('PATCH', '/api/me', { settings: { language: 'fr' } }); assert.equal(r.user.settings.language, 'fr');
    ev = await chat('hello there'); assert.equal(ev.meta.lang.code, 'fr');
    r = await api('PATCH', '/api/me', { settings: { language: 'auto' } }); assert.equal(r.user.settings.language, 'auto');
    r = await api('POST', '/api/ai/transcribe', { mime: 'audio/wav', audio: 'A'.repeat(4000) }); assert.equal(r.status, 501); r = await api('POST', '/api/ai/transcribe', { audio: 'x' }); assert.equal(r.status, 400);
    console.log(`✓ languages: ${PL.LANGS.length} languages, auto-detect, switching, voice hint, fixed setting, AI ears off without key`);

    const v = await api('GET', '/api/audit/verify'); assert.equal(v.ok, true); assert(v.total > 5);
    console.log(`✓ audit chain valid (${v.total} entries)`);
    const wd = await api('POST', '/api/work/draft', { type: 'email', fields: { to: 'Prof. Sen', topic: 'Extension request' } }); assert(wd.body.includes('Prof. Sen'));
    const dm = await api('POST', '/api/auth/demo', {}); assert.equal(dm.status, 200); tok = dm.token;
    const dash = await api('GET', '/api/dashboard'); assert(dash.counts.docs === 2); console.log('✓ work draft + demo workspace');
    console.log('\nALL PASSED');
  } catch (e) { console.error('\n✗ FAILED', e); process.exitCode = 1; }
  finally { srv.kill(); }
})();
