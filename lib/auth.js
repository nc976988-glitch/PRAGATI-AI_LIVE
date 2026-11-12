'use strict';
// Trust layer: scrypt password hashing, HMAC-signed expiring tokens, tamper-evident audit chain.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function loadSecret(dir) {
  if (process.env.PRAGATI_SECRET) return process.env.PRAGATI_SECRET;
  const f = path.join(dir, '.secret');
  try { return fs.readFileSync(f, 'utf8'); } catch (_) {
    const s = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(f, s, { mode: 0o600 });
    return s;
  }
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [, s, h] = stored.split('$');
    const test = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64);
    return crypto.timingSafeEqual(test, Buffer.from(h, 'hex'));
  } catch (_) { return false; }
}

const b64 = (b) => Buffer.from(b).toString('base64url');
function makeAuth(secret) {
  const sign = (data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return {
    issue(uid, ttlSec = 60 * 60 * 24 * 7) {
      const body = b64(JSON.stringify({ uid, exp: Math.floor(Date.now() / 1000) + ttlSec }));
      return `${body}.${sign(body)}`;
    },
    verify(token) {
      if (!token || typeof token !== 'string') return null;
      const [body, sig] = token.split('.');
      if (!body || !sig) return null;
      const good = sign(body);
      if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
      try {
        const p = JSON.parse(Buffer.from(body, 'base64url').toString());
        return p.exp > Date.now() / 1000 ? p : null;
      } catch (_) { return null; }
    },
  };
}

// ---- Hash-chained audit ledger (tamper-evident) ----
const entryHash = (prev, e) =>
  crypto.createHash('sha256').update(`${prev}|${e.ts}|${e.type}|${e.summary}|${JSON.stringify(e.meta || {})}`).digest('hex');

function audit(store, uid, type, summary, meta = {}) {
  const mine = store.db.audit.filter((a) => a.uid === uid);
  const prev = mine.length ? mine[mine.length - 1].hash : 'GENESIS';
  const e = { id: store.id('aud'), uid, ts: Date.now(), type, summary, meta, prev };
  e.hash = entryHash(prev, e);
  store.insert('audit', e);
  return e;
}
function verifyChain(store, uid) {
  let prev = 'GENESIS';
  const mine = store.db.audit.filter((a) => a.uid === uid);
  for (let i = 0; i < mine.length; i++) {
    const e = mine[i];
    if (e.prev !== prev || entryHash(prev, e) !== e.hash) return { ok: false, brokenAt: i, total: mine.length };
    prev = e.hash;
  }
  return { ok: true, total: mine.length, head: prev };
}

// ---- tiny in-memory rate limiter ----
function rateLimiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(key, arr);
    return arr.length <= max;
  };
}

module.exports = { loadSecret, hashPassword, verifyPassword, makeAuth, audit, verifyChain, rateLimiter };
