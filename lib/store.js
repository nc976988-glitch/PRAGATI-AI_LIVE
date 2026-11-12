'use strict';
// Tiny durable JSON store: in-memory collections, atomic debounced writes.
// Zero dependencies so the prototype runs anywhere with `node server.js`.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const COLLECTIONS = ['users', 'tasks', 'notes', 'reminders', 'plans', 'audit', 'docs', 'workflows', 'chats', 'contacts', 'memories', 'convos'];

class Store {
  constructor(file) {
    this.file = file;
    this.db = Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
    this._timer = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const c of COLLECTIONS) if (Array.isArray(raw[c])) this.db[c] = raw[c];
    } catch (_) { /* first run */ }
  }
  id(prefix) { return `${prefix}_${crypto.randomBytes(5).toString('hex')}`; }
  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 120);
  }
  flush() {
    clearTimeout(this._timer);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.db));
    fs.renameSync(tmp, this.file);
  }
  list(col, uid) { return this.db[col].filter((x) => x.uid === uid); }
  get(col, id, uid) { return this.db[col].find((x) => x.id === id && (uid === undefined || x.uid === uid)); }
  insert(col, obj) { this.db[col].push(obj); this.save(); return obj; }
  update(col, id, uid, patch) {
    const o = this.get(col, id, uid);
    if (!o) return null;
    Object.assign(o, patch);
    this.save();
    return o;
  }
  remove(col, id, uid) {
    const i = this.db[col].findIndex((x) => x.id === id && x.uid === uid);
    if (i < 0) return null;
    const [o] = this.db[col].splice(i, 1);
    this.save();
    return o;
  }
  removeAllForUser(uid) {
    for (const c of COLLECTIONS) {
      if (c === 'users') continue;
      this.db[c] = this.db[c].filter((x) => x.uid !== uid);
    }
    this.save();
  }
}
module.exports = { Store };
