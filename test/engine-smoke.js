'use strict';

// Engine smoke test: load Kokoro (q8), synthesize one sentence, and assert the
// audio is real — correct sample rate, sane duration, and enough RMS energy
// that it cannot be silence. Run with: npm run test:engine
//
// First run downloads the model into the local cache (see tts/paths.js);
// afterwards it is fully offline.

const path = require('path');
const fs = require('fs');

const SENTENCE = 'Hear me out: this sentence was spoken on this machine, by this machine, for free.';

async function main() {
  const t0 = Date.now();
  const { engine } = require('../src/main/tts/engine');

  await engine.init();
  const voices = engine.voices();
  if (!Array.isArray(voices) || voices.length < 10) {
    throw new Error('expected a real voice list, got ' + (voices && voices.length));
  }
  console.log('[smoke] model ready in ' + (Date.now() - t0) + 'ms, ' + voices.length + ' voices');

  const t1 = Date.now();
  const res = await engine.synth(SENTENCE, { voice: 'af_heart' });
  const ms = Date.now() - t1;

  if (!res || !res.audio || !res.audio.length) throw new Error('no audio returned');
  if (res.sampleRate !== 24000) throw new Error('unexpected sample rate ' + res.sampleRate);

  const seconds = res.audio.length / res.sampleRate;
  if (seconds < 2 || seconds > 20) throw new Error('implausible duration ' + seconds.toFixed(2) + 's');

  let sum = 0;
  for (let i = 0; i < res.audio.length; i++) sum += res.audio[i] * res.audio[i];
  const rms = Math.sqrt(sum / res.audio.length);
  if (rms < 0.01) throw new Error('audio is (near) silence, rms=' + rms.toFixed(5));

  const { encodeWav } = require('../src/main/tts/wav');
  const wav = encodeWav(res.audio, res.sampleRate);
  const out = path.join(__dirname, 'smoke-out.wav');
  fs.writeFileSync(out, wav);

  const rtf = ms / 1000 / seconds;
  console.log('[smoke] ok: ' + seconds.toFixed(2) + 's of audio in ' + ms + 'ms (RTF ' + rtf.toFixed(2) + '), rms ' + rms.toFixed(4));
  console.log('[smoke] wrote ' + out + ' (' + wav.length + ' bytes)');
  process.exit(0);
}

main().catch(function (e) {
  console.error('[smoke] FAIL: ' + (e && e.stack || e));
  process.exit(1);
});
