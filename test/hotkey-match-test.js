'use strict';

const assert = require('assert');
const { matches, watchSet } = require('../src/main/hotkey-match');

const F8 = 0x77, CTRL = 0xA2, SHIFT = 0xA0, ESC = 0x1B;

// Bare key.
assert.ok(matches({ vk: F8, down: true, held: [F8] }, { vk: F8, mods: [] }));
assert.ok(!matches({ vk: F8, down: false, held: [] }, { vk: F8, mods: [] }));
assert.ok(!matches({ vk: 0x76, down: true, held: [] }, { vk: F8, mods: [] }));

// Modified key requires the mods physically held.
const hk = { vk: F8, mods: [CTRL] };
assert.ok(matches({ vk: F8, down: true, held: [F8, CTRL] }, hk));
assert.ok(!matches({ vk: F8, down: true, held: [F8] }, hk));

// Two mods.
const hk2 = { vk: F8, mods: [CTRL, SHIFT] };
assert.ok(matches({ vk: F8, down: true, held: [F8, CTRL, SHIFT] }, hk2));
assert.ok(!matches({ vk: F8, down: true, held: [F8, SHIFT] }, hk2));

// watchSet: trigger + mods + extras, deduped, no zeros.
assert.deepStrictEqual(watchSet({ vk: F8, mods: [CTRL] }, [ESC, F8]), [F8, CTRL, ESC]);
assert.deepStrictEqual(watchSet(null, [ESC]), [ESC]);

// Garbage in, false out.
assert.ok(!matches(null, { vk: F8, mods: [] }));
assert.ok(!matches({ vk: F8, down: true, held: null }, { vk: F8, mods: [CTRL] }));

console.log('[hotkey-match-test] ok');
