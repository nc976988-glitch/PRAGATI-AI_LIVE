// Device actions — calls, SMS, WhatsApp, apps, Google / YouTube / Maps.
// A web app cannot silently dial or send: Pragati opens the phone's dialer / messaging app
// with everything pre-filled, and the user taps the final "call" or "send". That is by design.
import { api } from './api.js';
import { esc, toast, sfx } from './util.js';

export const isAndroid = /Android/i.test(navigator.userAgent);
export const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
export const isMobile = isAndroid || isIOS || matchMedia('(pointer:coarse)').matches;
const enc = encodeURIComponent;
const digits = (p) => String(p || '').replace(/[^\d]/g, '');

// name → [web url, android package, display name]
const APPS = {
  whatsapp: ['https://web.whatsapp.com/', 'com.whatsapp', 'WhatsApp'],
  youtube: ['https://www.youtube.com/', 'com.google.android.youtube', 'YouTube'],
  'youtube music': ['https://music.youtube.com/', 'com.google.android.apps.youtube.music', 'YouTube Music'],
  instagram: ['https://www.instagram.com/', 'com.instagram.android', 'Instagram'],
  facebook: ['https://www.facebook.com/', 'com.facebook.katana', 'Facebook'],
  messenger: ['https://www.messenger.com/', 'com.facebook.orca', 'Messenger'],
  x: ['https://x.com/', 'com.twitter.android', 'X'], twitter: ['https://x.com/', 'com.twitter.android', 'X'],
  snapchat: ['https://www.snapchat.com/', 'com.snapchat.android', 'Snapchat'],
  telegram: ['https://web.telegram.org/', 'org.telegram.messenger', 'Telegram'],
  linkedin: ['https://www.linkedin.com/', 'com.linkedin.android', 'LinkedIn'],
  spotify: ['https://open.spotify.com/', 'com.spotify.music', 'Spotify'],
  jiosaavn: ['https://www.jiosaavn.com/', 'com.jio.media.jiobeats', 'JioSaavn'],
  gaana: ['https://gaana.com/', 'com.gaana', 'Gaana'],
  netflix: ['https://www.netflix.com/', 'com.netflix.mediaclient', 'Netflix'],
  hotstar: ['https://www.hotstar.com/', 'in.startv.hotstar', 'JioHotstar'], jiohotstar: ['https://www.hotstar.com/', 'in.startv.hotstar', 'JioHotstar'],
  'prime video': ['https://www.primevideo.com/', 'com.amazon.avod.thirdpartyclient', 'Prime Video'],
  amazon: ['https://www.amazon.in/', 'in.amazon.mShop.android.shopping', 'Amazon'],
  flipkart: ['https://www.flipkart.com/', 'com.flipkart.android', 'Flipkart'],
  meesho: ['https://www.meesho.com/', 'com.meesho.supply', 'Meesho'],
  myntra: ['https://www.myntra.com/', 'com.myntra.android', 'Myntra'],
  zomato: ['https://www.zomato.com/', 'com.application.zomato', 'Zomato'],
  swiggy: ['https://www.swiggy.com/', 'in.swiggy.android', 'Swiggy'],
  blinkit: ['https://blinkit.com/', 'com.grofers.customerapp', 'Blinkit'],
  zepto: ['https://www.zeptonow.com/', 'com.zeptoconsumerapp', 'Zepto'],
  paytm: ['https://paytm.com/', 'net.one97.paytm', 'Paytm'],
  phonepe: ['https://www.phonepe.com/', 'com.phonepe.app', 'PhonePe'],
  gpay: ['https://pay.google.com/', 'com.google.android.apps.nbu.paisa.user', 'Google Pay'], 'google pay': ['https://pay.google.com/', 'com.google.android.apps.nbu.paisa.user', 'Google Pay'],
  maps: ['https://www.google.com/maps', 'com.google.android.apps.maps', 'Google Maps'], 'google maps': ['https://www.google.com/maps', 'com.google.android.apps.maps', 'Google Maps'],
  gmail: ['https://mail.google.com/', 'com.google.android.gm', 'Gmail'],
  drive: ['https://drive.google.com/', 'com.google.android.apps.docs', 'Google Drive'],
  photos: ['https://photos.google.com/', 'com.google.android.apps.photos', 'Google Photos'],
  calendar: ['https://calendar.google.com/', 'com.google.android.calendar', 'Google Calendar'],
  meet: ['https://meet.google.com/', 'com.google.android.apps.tachyon', 'Google Meet'],
  classroom: ['https://classroom.google.com/', 'com.google.android.apps.classroom', 'Google Classroom'],
  chatgpt: ['https://chatgpt.com/', 'com.openai.chatgpt', 'ChatGPT'],
  gemini: ['https://gemini.google.com/', 'com.google.android.apps.bard', 'Gemini'],
  perplexity: ['https://www.perplexity.ai/', 'ai.perplexity.app.android', 'Perplexity'],
  uber: ['https://m.uber.com/', 'com.ubercab', 'Uber'], ola: ['https://book.olacabs.com/', 'com.olacabs.customer', 'Ola'], rapido: ['https://www.rapido.bike/', 'com.rapido.passenger', 'Rapido'],
  irctc: ['https://www.irctc.co.in/', 'cris.org.in.prs.ima', 'IRCTC'],
  'physics wallah': ['https://www.pw.live/', 'xyz.penpencil.physicswala', 'Physics Wallah'], pw: ['https://www.pw.live/', 'xyz.penpencil.physicswala', 'Physics Wallah'],
  byjus: ['https://byjus.com/', 'com.byjus.thelearningapp', "BYJU'S"], unacademy: ['https://unacademy.com/', 'com.unacademyapp', 'Unacademy'],
  duolingo: ['https://www.duolingo.com/', 'com.duolingo', 'Duolingo'],
  discord: ['https://discord.com/app', 'com.discord', 'Discord'], reddit: ['https://www.reddit.com/', 'com.reddit.frontpage', 'Reddit'],
  pinterest: ['https://www.pinterest.com/', 'com.pinterest', 'Pinterest'], truecaller: ['https://www.truecaller.com/', 'com.truecaller', 'Truecaller'],
  github: ['https://github.com/', 'com.github.android', 'GitHub'],
  camera: [null, null, 'Camera'], settings: [null, null, 'Settings'], calculator: [null, null, 'Calculator'],
};

function intentFor(web, pkg) {
  if (!web) return null;
  const u = new URL(web);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=${pkg};S.browser_fallback_url=${enc(web)};end`;
}

/** Resolve an action object (from the server) to something the browser can open. */
export function resolve(a) {
  const q = a.query || '';
  switch (a.type) {
    case 'call': return a.to?.phone ? { url: `tel:${a.to.phone}`, external: true, verb: `Call ${a.to.name}`, icon: 'call' } : null;
    case 'sms': return a.to?.phone ? { url: `sms:${a.to.phone}${isIOS ? '&' : '?'}body=${enc(a.text || '')}`, external: true, verb: `Open SMS to ${a.to.name}`, icon: 'sms' } : null;
    case 'whatsapp': {
      const n = digits(a.to?.phone);
      return { url: n ? `https://wa.me/${n}${a.text ? `?text=${enc(a.text)}` : ''}` : `https://wa.me/?text=${enc(a.text || '')}`, verb: n ? `Open WhatsApp · ${a.to.name}` : 'Open WhatsApp & pick the chat', icon: 'whatsapp' };
    }
    case 'youtube': return { url: `https://www.youtube.com/results?search_query=${enc(q)}`, verb: `Open YouTube · ${q}`, icon: 'youtube' };
    case 'google': return { url: `https://www.google.com/search?q=${enc(q)}`, verb: `Search Google · ${q}`, icon: 'google' };
    case 'maps': return /near me|nearby|paas/i.test(q) || !/\bto\b|tak|route|directions/i.test(q)
      ? { url: `https://www.google.com/maps/search/?api=1&query=${enc(q.replace(/\b(directions?|route) to\b/i, '').trim())}`, verb: `Open Maps · ${q}`, icon: 'maps' }
      : { url: `https://www.google.com/maps/dir/?api=1&destination=${enc(q.replace(/^.*\b(to|tak)\b\s*/i, ''))}`, verb: `Directions · ${q}`, icon: 'maps' };
    case 'open': {
      const name = String(a.app || '').toLowerCase().replace(/\b(app|application)\b/g, '').trim();
      const hit = APPS[name] || Object.entries(APPS).find(([k]) => name.includes(k) || k.includes(name))?.[1];
      if (hit) {
        const [web, pkg, label] = hit;
        if (!web) return { url: null, verb: `Open ${label}`, icon: 'app', note: `Browsers aren't allowed to open the phone's ${label}. Open it from your home screen.` };
        return { url: isAndroid && pkg ? intentFor(web, pkg) : web, external: isAndroid && !!pkg, verb: `Open ${label}`, icon: 'app' };
      }
      if (/^[\w-]+(\.[\w-]+)+$/.test(name)) return { url: `https://${name}`, verb: `Open ${name}`, icon: 'app' };
      return { url: `https://www.google.com/search?q=${enc(a.app)}`, verb: `Find ${a.app}`, icon: 'google' };
    }
    default: return null;
  }
}

const ICO = {
  call: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  sms: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/>',
  whatsapp: '<path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z"/><path d="M9 9c0 3 3 6 6 6l1-1.5-2-1-1 .8a4 4 0 0 1-2.3-2.3l.8-1-1-2z"/>',
  youtube: '<rect x="3" y="6" width="18" height="12" rx="4"/><path d="m10 9 5 3-5 3z"/>',
  google: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  maps: '<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
  app: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
  memory: '<path d="M12 3a6 6 0 0 0-4 10.5V17h8v-3.5A6 6 0 0 0 12 3zM9 21h6"/>',
  contact: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
};
export const aicon = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICO[n] || ICO.app}</svg>`;

function launch(r) {
  if (!r?.url) return false;
  if (r.external || r.url.startsWith('intent:')) { const a = document.createElement('a'); a.href = r.url; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); return true; }
  const w = window.open(r.url, '_blank', 'noopener'); return w !== null || true;
}

/**
 * Render an action card into `host` and (optionally) auto-run it.
 * `onContactSaved(action)` lets the caller know a contact was added.
 */
export function mountAction(host, a, { auto = false, onSpeak, delay = 3, onEnd } = {}) {
  if (!a || !a.type) return;
  if (a.type === 'memory' || a.type === 'contact_saved') {
    host.innerHTML = `<div class="act-card mini">${aicon(a.type === 'memory' ? 'memory' : 'contact')}<span>${esc(a.label || '')}</span><a href="#/people" class="act-link">Manage</a></div>`;
    return;
  }
  if (a.needsContact) return contactForm(host, a, { onSpeak });
  const r = resolve(a); if (!r) return;
  const msg = a.text ? `<div class="act-msg">${esc(a.text)}</div>` : '';
  const sub = a.to?.phone ? `<small class="mono">${esc(a.to.phone)}</small>` : r.note ? `<small>${esc(r.note)}</small>` : '';
  host.innerHTML = `<div class="act-card t-${a.type}">
    <div class="act-ico">${aicon(r.icon)}</div>
    <div class="act-body"><b>${esc(r.verb)}</b>${sub}${msg}<div class="act-count" hidden></div></div>
    <div class="act-btns">${r.url ? `<button class="btn solid sm" data-go>${a.type === 'call' ? 'Call now' : 'Open'}</button>` : ''}<button class="btn ghost sm" data-cancel hidden>Cancel</button></div>
  </div>`;
  const go = host.querySelector('[data-go]'); const cancel = host.querySelector('[data-cancel]'); const count = host.querySelector('.act-count');
  if (go) go.onclick = () => { stopTimer(); sfx('send'); launch(r); end('go'); go.textContent = a.type === 'call' ? 'Call again' : 'Open again'; };
  let timer = null; const stopTimer = () => { clearInterval(timer); timer = null; count.hidden = true; cancel.hidden = true; };
  let ended = false; const end = (how) => { if (!ended) { ended = true; onEnd?.(how); } };
  cancel.onclick = () => { stopTimer(); toast('Cancelled', 'Nothing was opened.', 'a'); host.querySelector('.act-card')?.classList.add('cancelled'); end('cancel'); };
  const ctl = { counting: false, go: () => { if (timer) { stopTimer(); sfx('send'); launch(r); if (go) go.textContent = a.type === 'call' ? 'Call again' : 'Open again'; end('go'); } }, cancel: () => { if (timer) cancel.onclick(); } };
  if (!auto || !r.url) { end('none'); return ctl; }
  if (a.type === 'call' || a.type === 'sms' || (a.type === 'whatsapp' && a.text)) {
    // short, visible countdown so the user can always stop it
    let n = delay; count.hidden = false; cancel.hidden = false; count.textContent = `${a.type === 'call' ? 'Dialling' : 'Opening'} in ${n}…`; ctl.counting = true;
    timer = setInterval(() => { n -= 1; if (n <= 0) { stopTimer(); launch(r); end('go'); } else count.textContent = `${a.type === 'call' ? 'Dialling' : 'Opening'} in ${n}…`; }, 1000);
  } else {
    const ok = r.external ? launch(r) : window.open(r.url, '_blank', 'noopener');
    if (!ok && go) { go.classList.add('pulse'); count.hidden = false; count.textContent = 'Your browser blocked the pop-up — tap Open.'; }
    end('go');
  }
  return ctl;
}

function contactForm(host, a, { onSpeak } = {}) {
  const who = a.to?.name || '';
  const pick = 'contacts' in navigator && 'select' in navigator.contacts;
  host.innerHTML = `<form class="act-card t-${a.type} need">
    <div class="act-ico">${aicon('contact')}</div>
    <div class="act-body"><b>Add ${esc(who)}'s number</b><small>Saved only on your Pragati server. Next time, just say the name.</small>
      <div class="act-row"><input name="name" value="${esc(who)}" placeholder="Name" maxlength="40" required><input name="phone" type="tel" inputmode="tel" placeholder="98765 43210" required pattern="[+0-9 ()-]{7,20}"></div>
    </div>
    <div class="act-btns"><button class="btn solid sm" type="submit">Save & ${a.type === 'call' ? 'call' : 'continue'}</button>${pick ? '<button class="btn ghost sm" type="button" data-pick>From phone</button>' : ''}${a.type === 'whatsapp' ? '<button class="btn ghost sm" type="button" data-skip>Choose in WhatsApp</button>' : ''}</div>
  </form>`;
  const f = host.querySelector('form');
  f.querySelector('[data-pick]')?.addEventListener('click', async () => {
    try { const [c] = await navigator.contacts.select(['name', 'tel'], { multiple: false }); if (c) { if (c.tel?.[0]) f.phone.value = c.tel[0]; } } catch (_) { /* cancelled */ }
  });
  f.querySelector('[data-skip]')?.addEventListener('click', () => { const b = { ...a, needsContact: false, to: { ...a.to, phone: null } }; mountAction(host, b, { auto: false }); host.querySelector('[data-go]')?.click(); });
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('POST', '/api/contacts', { name: f.name.value.trim() || who, phone: f.phone.value.trim(), relation: a.to?.relation || '' });
      const ct = r.item || r.contact || r;
      toast('Contact saved', `${ct.name || who} · ${ct.phone || f.phone.value}`, 'g'); sfx('done');
      onSpeak?.(`Saved. ${a.type === 'call' ? 'Calling' : 'Opening'} ${ct.name || who}.`);
      mountAction(host, { ...a, needsContact: false, to: { name: ct.name || who, phone: ct.phone || f.phone.value, known: true } }, { auto: true });
    } catch (err) { toast('Could not save', err.message, 'm'); }
  };
  setTimeout(() => f.phone.focus(), 60);
}
