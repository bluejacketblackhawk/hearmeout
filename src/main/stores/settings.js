'use strict';

/**
 * Settings: one small JSON file in userData, atomic writes, defaults merged on
 * read so new versions never crash on old files. Nothing here is secret; the
 * file is human-editable on purpose.
 */

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  voice: 'af_heart',
  speedPct: 100,           // 50..300, applied as playbackRate in the player
  hotkey: { vk: 0x77, name: 'F8', mods: [] },
  launchAtLogin: false,
  firstRunDone: false,
};

let _file = null;
let _cache = null;

function attach(userDataDir) {
  _file = path.join(userDataDir, 'settings.json');
}

function load() {
  if (_cache) return _cache;
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(_file, 'utf8'));
  } catch (e) { /* first run or corrupt: defaults win */ }
  _cache = merge(DEFAULTS, raw);
  return _cache;
}

function merge(def, got) {
  const out = {};
  const keys = Object.keys(def);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const d = def[k];
    const g = got ? got[k] : undefined;
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      out[k] = merge(d, g && typeof g === 'object' ? g : {});
    } else {
      out[k] = (g === undefined ? d : g);
    }
  }
  return out;
}

function save(patch) {
  const cur = load();
  const next = merge(cur, patch || {});
  // merge() only keeps known keys — which is exactly the sanitization we want.
  _cache = next;
  if (!_file) return next;
  const tmp = _file + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, _file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) { /* ignore */ }
  }
  return next;
}

module.exports = { attach, load, save, DEFAULTS };
