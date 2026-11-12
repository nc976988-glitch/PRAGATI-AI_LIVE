'use strict';
// Tiny .env loader (no dependencies). Real environment variables win over the file.
const fs = require('fs'); const path = require('path');
function load(dir) {
  const file = path.join(dir, '.env'); let txt;
  try { txt = fs.readFileSync(file, 'utf8'); } catch (_) { return null; }
  for (const raw of txt.replace(/^﻿/, '').split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || raw.trim().startsWith('#')) continue;
    let v = m[2]; if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined || process.env[m[1]] === '') process.env[m[1]] = v.trim();
  }
  return file;
}
module.exports = { load };
