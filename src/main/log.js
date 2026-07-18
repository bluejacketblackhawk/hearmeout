'use strict';

/**
 * Tiny logger: console always; a rotating file once attach() is given the
 * userData dir (main.js calls it after app is ready). Never logs spoken or
 * selected text — paths, timings and error strings only.
 */

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 512 * 1024;

let _file = null;

function attach(userDataDir) {
  try {
    const dir = path.join(userDataDir, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    _file = path.join(dir, 'hearmeout.log');
    try {
      const st = fs.statSync(_file);
      if (st.size > MAX_BYTES) {
        fs.renameSync(_file, _file + '.1');
      }
    } catch (e) { /* first run */ }
  } catch (e) {
    _file = null;
  }
}

function line(level, msg, err) {
  const ts = new Date().toISOString();
  let s = ts + ' [' + level + '] ' + msg;
  if (err && err.stack) s += '\n' + err.stack;
  else if (err) s += ' ' + String(err);
  return s;
}

function write(s) {
  if (!_file) return;
  try { fs.appendFileSync(_file, s + '\n'); } catch (e) { /* disk woes are not our woes */ }
}

module.exports = {
  attach: attach,
  info: function (msg) { const s = line('info', msg); console.log(s); write(s); },
  warn: function (msg) { const s = line('warn', msg); console.warn(s); write(s); },
  error: function (msg, err) { const s = line('error', msg, err); console.error(s); write(s); },
};
