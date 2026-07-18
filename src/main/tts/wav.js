'use strict';

/**
 * Float32 PCM -> 16-bit mono WAV. No dependencies, no surprises.
 * Used for export and for handing audio to the renderer as a playable blob.
 */

/**
 * @param {Float32Array} samples mono audio in [-1, 1]
 * @param {number} sampleRate e.g. 24000
 * @returns {Buffer} a complete RIFF/WAVE file
 */
function encodeWav(samples, sampleRate) {
  const n = samples.length;
  const dataBytes = n * 2;
  const buf = Buffer.alloc(44 + dataBytes);

  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);            // PCM chunk size
  buf.writeUInt16LE(1, 20);             // PCM format
  buf.writeUInt16LE(1, 22);             // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32);             // block align
  buf.writeUInt16LE(16, 34);            // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);

  let off = 44;
  for (let i = 0; i < n; i++) {
    let s = samples[i];
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    buf.writeInt16LE((s * 32767) | 0, off);
    off += 2;
  }
  return buf;
}

/**
 * Concatenate several Float32Arrays (used by "export whole document").
 * @param {Float32Array[]} chunks
 * @returns {Float32Array}
 */
function concatFloat32(chunks) {
  let total = 0;
  for (let i = 0; i < chunks.length; i++) total += chunks[i].length;
  const out = new Float32Array(total);
  let off = 0;
  for (let i = 0; i < chunks.length; i++) {
    out.set(chunks[i], off);
    off += chunks[i].length;
  }
  return out;
}

module.exports = { encodeWav, concatFloat32 };
