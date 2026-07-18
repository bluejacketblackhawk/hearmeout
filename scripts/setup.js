'use strict';

/**
 * One-command dev setup: compile the native helper, then warm the voice model
 * into build-resources/models (the same folder the installer bundles).
 *
 *   npm install
 *   npm run setup
 *   npm start
 *
 * Everything after setup works with networking disabled.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(ROOT, 'native', process.platform === 'darwin' ? 'build-mac.sh' : 'build.cmd');
const HELPER = path.join(ROOT, 'bin', 'helper', 'HearMeOutHelper.exe');

function compileHelper() {
  return new Promise(function (resolve, reject) {
    if (process.platform === 'darwin') {
      console.log('[setup] macOS helper build comes with the mac port (docs/MAC-PORT.md) — skipping');
      resolve();
      return;
    }
    if (fs.existsSync(HELPER)) {
      console.log('[setup] helper already built');
      resolve();
      return;
    }
    console.log('[setup] compiling native helper (csc)…');
    execFile(process.env.ComSpec || 'cmd.exe', ['/c', BUILD], { cwd: path.dirname(BUILD) },
      function (err, stdout, stderr) {
        if (err) {
          reject(new Error('helper compile failed: ' + ((stderr || stdout || err.message) + '').trim()));
          return;
        }
        console.log('[setup] helper built');
        resolve();
      });
  });
}

async function warmModel() {
  const { engine } = require('../src/main/tts/engine');
  const { resolveModelCache } = require('../src/main/tts/paths');
  const where = resolveModelCache(null);
  if (where.warm) {
    console.log('[setup] voice model already present at ' + where.cacheDir);
    return;
  }
  console.log('[setup] downloading the Kokoro voice model (one time, ~90 MB)…');
  let lastPct = -1;
  engine.onProgress(function (p) {
    const pct = Math.floor(p.progress || 0);
    if (pct !== lastPct && pct % 10 === 0) {
      lastPct = pct;
      console.log('[setup]   ' + p.file + ' ' + pct + '%');
    }
  });
  await engine.init();
  console.log('[setup] model ready (' + engine.voices().length + ' voices) at ' + engine.cacheInfo().cacheDir);
}

compileHelper()
  .then(warmModel)
  .then(function () {
    console.log('[setup] done — run: npm start');
    process.exit(0);
  })
  .catch(function (e) {
    console.error('[setup] FAIL: ' + (e && e.message || e));
    process.exit(1);
  });
