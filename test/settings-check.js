'use strict';

// Settings store: defaults, merge, persistence round-trip, unknown-key
// sanitization — against a temp dir, never the real userData.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const settings = require('../src/main/stores/settings');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmo-settings-'));
settings.attach(dir);

// Defaults come back on first load.
let s = settings.load();
assert.strictEqual(s.voice, 'af_heart');
assert.strictEqual(s.speedPct, 100);
assert.strictEqual(s.hotkey.vk, 0x77);
assert.strictEqual(s.firstRunDone, false);

// Patch + persist.
s = settings.save({ voice: 'bm_george', speedPct: 150, hotkey: { vk: 0x78, name: 'F9', mods: [0xA2] } });
assert.strictEqual(s.voice, 'bm_george');
assert.strictEqual(s.hotkey.name, 'F9');

// Fresh process simulation: nuke the cache by re-requiring.
delete require.cache[require.resolve('../src/main/stores/settings')];
const settings2 = require('../src/main/stores/settings');
settings2.attach(dir);
const s2 = settings2.load();
assert.strictEqual(s2.voice, 'bm_george');
assert.strictEqual(s2.speedPct, 150);
assert.deepStrictEqual(s2.hotkey.mods, [0xA2]);

// Unknown keys are dropped, known survive (sanitization by merge).
const s3 = settings2.save({ evil: 'nope', voice: 'af_bella' });
assert.strictEqual(s3.evil, undefined);
assert.strictEqual(s3.voice, 'af_bella');

// Corrupt file falls back to defaults instead of crashing.
fs.writeFileSync(path.join(dir, 'settings.json'), '{not json');
delete require.cache[require.resolve('../src/main/stores/settings')];
const settings3 = require('../src/main/stores/settings');
settings3.attach(dir);
assert.strictEqual(settings3.load().voice, 'af_heart');

fs.rmSync(dir, { recursive: true, force: true });
console.log('[settings-check] ok');
