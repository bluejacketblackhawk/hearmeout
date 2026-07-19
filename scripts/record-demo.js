'use strict';

/**
 * Render the README demo deterministically from the product's own UI
 * (npx electron scripts/record-demo.js [outDir]).
 *
 * A hidden stage window (scripts/demo-stage.html) replays the storyboard in
 * docs/DEMO-SCRIPT.md; this script seeks it frame by frame and saves PNGs.
 * No screen capture, no desktop involvement, same pixels every run.
 * Assembly into demo.gif / demo.mp4 is ffmpeg's job (see the launch notes).
 *
 * The soundtrack for the mp4 is the real voice: pass --wav to also synthesize
 * the two demo sentences through the actual engine into demo-voice.wav.
 */

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const FPS = 12.5;
const DURATION = 16.4; // seconds
const OUT = process.argv[2] && !process.argv[2].startsWith('--')
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', 'demo-frames');
const WANT_WAV = process.argv.indexOf('--wav') !== -1;

const SENTENCES =
  'The voice they rent you now runs free on the machine you already own. ' +
  'Select anything, press one key, and listen — no cloud, no account, no subscription.';

async function synthWav() {
  const { engine } = require('../src/main/tts/engine');
  const { encodeWav } = require('../src/main/tts/wav');
  await engine.init();
  const res = await engine.synth(SENTENCES, { voice: 'af_heart' });
  const out = path.join(OUT, 'demo-voice.wav');
  fs.writeFileSync(out, encodeWav(res.audio, res.sampleRate));
  console.log('[record-demo] voice: ' + (res.audio.length / res.sampleRate).toFixed(1) + 's -> ' + out);
}

app.whenReady().then(async function () {
  fs.mkdirSync(OUT, { recursive: true });

  // The window must actually reach the compositor for capturePage to work,
  // so the stage is visible (frameless, non-interactive) while it renders.
  const w = new BrowserWindow({
    width: 1200,
    height: 750,
    show: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: { backgroundThrottling: false, sandbox: false },
  });
  w.setIgnoreMouseEvents(true);
  await w.loadFile(path.join(__dirname, 'demo-stage.html'));
  await new Promise(function (r) { setTimeout(r, 400); });

  const total = Math.round(DURATION * FPS);
  for (let i = 0; i < total; i++) {
    const t = i / FPS;
    await w.webContents.executeJavaScript('stage.seek(' + t.toFixed(3) + '); true;');
    // Let transitions/animations advance a real tick before the grab.
    await new Promise(function (r) { setTimeout(r, 34); });
    const img = await w.webContents.capturePage();
    const name = 'f' + String(i).padStart(4, '0') + '.png';
    fs.writeFileSync(path.join(OUT, name), img.toPNG());
    if (i % 25 === 0) console.log('[record-demo] frame ' + i + '/' + total);
  }
  console.log('[record-demo] ' + total + ' frames -> ' + OUT);

  if (WANT_WAV) await synthWav();

  app.exit(0);
}).catch(function (e) {
  console.error('[record-demo] FAIL', e);
  app.exit(1);
});
