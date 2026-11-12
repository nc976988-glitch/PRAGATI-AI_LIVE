// Family & Memory — the people Pragati can call/message, and what it remembers about you.
import { api } from './api.js';
import { S } from './state.js';
import { $, $$, esc, toast, sfx } from './util.js';
import { mountAction, aicon } from './actions.js';

const REL = [['', 'Relation'], ['mom', 'Mom / Mummy'], ['dad', 'Dad / Papa'], ['brother', 'Brother / Bhai'], ['sister', 'Sister / Didi'], ['grandma', 'Grandma / Dadi / Nani'], ['grandpa', 'Grandpa / Dada / Nana'], ['wife', 'Wife'], ['husband', 'Husband'], ['friend', 'Friend'], ['teacher', 'Teacher'], ['boss', 'Boss'], ['other', 'Other']];

export function mountPeople(stage, app) {
  stage.innerHTML = `<div class="view people">
    <header class="vhead"><div><span class="kicker">Family & memory</span><h2 class="grad">The people and things Pragati knows</h2><p class="muted">Say <b>“call Mummy”</b> or <b>“Bhai ko WhatsApp karo…”</b> — Pragati looks the name up here. Everything stays on your own server.</p></div></header>
    <div class="pgrid">
      <section class="glass pad">
        <div class="sechead"><h3>Contacts</h3><span class="sp"></span>${'contacts' in navigator && 'select' in navigator.contacts ? '<button class="btn sm" id="imp">Import from phone</button>' : ''}</div>
        <form id="cf" class="cform">
          <input name="name" placeholder="Name (e.g. Mummy)" required maxlength="60">
          <input name="phone" type="tel" inputmode="tel" placeholder="Phone (98765 43210)" required maxlength="20">
          <select name="relation">${REL.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
          <button class="btn solid sm" type="submit">Add</button>
        </form>
        <div id="clist" class="clist"></div>
        <div id="cact"></div>
      </section>
      <section class="glass pad c-v">
        <div class="sechead"><h3>Memory</h3><span class="sp"></span><small class="dim">Pragati uses these to personalise advice</small></div>
        <form id="mf" class="cform one"><input name="text" placeholder="e.g. My board exams start on 15 Feb · I'm vegetarian · I want to crack JEE" required maxlength="300"><button class="btn solid sm" type="submit">Remember</button></form>
        <div id="mlist" class="mlist"></div>
        <div class="sechead" style="margin-top:22px"><h3>How Pragati addresses you</h3></div>
        <form id="nf" class="cform one"><input name="callMe" placeholder="${esc(S.user?.name || 'Your name')}" maxlength="30" value="${esc(S.user?.settings?.callMe || '')}"><button class="btn sm" type="submit">Save</button></form>
        <p class="dim small">Tip: you can also just tell Pragati “remember that…” or “forget that…”.</p>
      </section>
    </div>
  </div>`;

  async function load() {
    try {
      const [c, m] = await Promise.all([api('GET', '/api/contacts'), api('GET', '/api/memories')]);
      $('#clist', stage).innerHTML = c.items.length ? c.items.map((x) => `<div class="crow2" data-id="${x.id}">
          <div class="cav">${esc((x.name || '?')[0].toUpperCase())}</div>
          <div class="cinfo"><b>${esc(x.name)}</b><small class="mono">${esc(x.phone)}${x.relation ? ` · ${esc(x.relation)}` : ''}</small></div>
          <button class="ib" data-do="call" title="Call">${aicon('call')}</button><button class="ib" data-do="whatsapp" title="WhatsApp">${aicon('whatsapp')}</button><button class="ib" data-do="sms" title="SMS">${aicon('sms')}</button><button class="ib del" data-do="del" title="Delete">×</button>
        </div>`).join('') : '<p class="dim">No contacts yet. Add Mummy, Papa, Bhai… so you can call them by voice.</p>';
      $('#clist', stage)._items = c.items;
      $('#mlist', stage).innerHTML = m.items.length ? m.items.map((x) => `<div class="mrow" data-id="${x.id}"><span>${esc(x.text)}</span><button class="ib del" data-do="mdel" title="Forget">×</button></div>`).join('') : '<p class="dim">Nothing remembered yet.</p>';
    } catch (err) { toast('Could not load', err.message, 'm'); }
  }

  $('#cf', stage).onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    try { await api('POST', '/api/contacts', { name: f.name.value.trim(), phone: f.phone.value.trim(), relation: f.relation.value }); f.reset(); sfx('done'); toast('Contact saved', '', 'g'); load(); } catch (err) { toast('Could not save', err.message, 'm'); }
  };
  $('#mf', stage).onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    try { await api('POST', '/api/memories', { text: f.text.value.trim() }); f.reset(); sfx('done'); load(); } catch (err) { toast('Could not save', err.message, 'm'); }
  };
  $('#nf', stage).onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api('PATCH', '/api/me', { settings: { callMe: e.target.callMe.value.trim() } }); S.user = r.user; toast('Saved', `I'll call you ${r.user.settings.callMe || r.user.name}.`, 'g'); } catch (err) { toast('Could not save', err.message, 'm'); }
  };
  $('#imp', stage)?.addEventListener('click', async () => {
    try {
      const picked = await navigator.contacts.select(['name', 'tel'], { multiple: true }); let n = 0;
      for (const p of picked) { const name = p.name?.[0]; const tel = p.tel?.[0]; if (name && tel) { await api('POST', '/api/contacts', { name, phone: tel }); n++; } }
      toast('Imported', `${n} contact${n === 1 ? '' : 's'}`, 'g'); load();
    } catch (_) { /* cancelled */ }
  });
  stage.onclick = async (e) => {
    const b = e.target.closest('[data-do]'); if (!b) return;
    const row = b.closest('[data-id]'); const id = row.dataset.id;
    if (b.dataset.do === 'mdel') { await api('DELETE', `/api/memories/${id}`).catch(() => {}); return load(); }
    const ct = ($('#clist', stage)._items || []).find((x) => x.id === id); if (!ct) return;
    if (b.dataset.do === 'del') { if (confirm(`Delete ${ct.name}?`)) { await api('DELETE', `/api/contacts/${id}`).catch(() => {}); load(); } return; }
    mountAction($('#cact', stage), { type: b.dataset.do, to: { name: ct.name, phone: ct.phone, known: true }, text: '' }, { auto: false });
    $('#cact [data-go]', stage)?.click();
  };
  load();
  return () => { stage.onclick = null; };
}
void $$;
