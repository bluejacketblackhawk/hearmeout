'use strict';

const assert = require('assert');
const { encodeWav, concatFloat32 } = require('../src/main/tts/wav');

// A 1-second 440 Hz sine at 24 kHz.
const sr = 24000;
const f = new Float32Array(sr);
for (let i = 0; i < sr; i++) f[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.5;

const wav = encodeWav(f, sr);

assert.strictEqual(wav.length, 44 + sr * 2);
assert.strictEqual(wav.toString('ascii', 0, 4), 'RIFF');
assert.strictEqual(wav.toString('ascii', 8, 12), 'WAVE');
assert.strictEqual(wav.readUInt16LE(22), 1);        // mono
assert.strictEqual(wav.readUInt32LE(24), sr);       // sample rate
assert.strictEqual(wav.readUInt16LE(34), 16);       // bit depth
assert.strictEqual(wav.readUInt32LE(40), sr * 2);   // data bytes

// Samples survive the trip (spot check + clipping).
const clipped = encodeWav(new Float32Array([2.0, -2.0, 0]), sr);
assert.strictEqual(clipped.readInt16LE(44), 32767);
assert.strictEqual(clipped.readInt16LE(46), -32767);
assert.strictEqual(clipped.readInt16LE(48), 0);

// concat
const j = concatFloat32([new Float32Array([1, 2]), new Float32Array([3])]);
assert.deepStrictEqual(Array.from(j), [1, 2, 3]);

console.log('[wav-test] ok');
