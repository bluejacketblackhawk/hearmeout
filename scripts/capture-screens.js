'use strict';

/**
 * Capture README screenshots from the real windows (npx electron
 * scripts/capture-screens.js). The player is staged with a live-looking
 * session so the shot shows the app doing its job.
 * Output: assets/screenshots/*.png
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

// Windows come and go between captures — do not let Electron quit early.
app.on('window-all-closed', function () { /* still capturing */ });

// Just enough IPC for the renderers to boot outside the real app.
ipcMain.handle('settings:get', function () {
  return { voice: 'af_heart', speedPct: 100, hotkey: { vk: 0x77, name: 'F8', mods: [] }, launchAtLogin: false, firstRunDone: true };
});
ipcMain.handle('voices:list', function () { return []; });
ipcMain.handle('model:info', function () { return { ready: true, cache: { cacheDir: 'bundled', warm: true } }; });
ipcMain.handle('app:version', function () { return '0.1.0'; });
ipcMain.handle('perms:get', function () { return null; }); // shots stay platform-neutral

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'screenshots');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const PRELOAD = path.join(ROOT, 'src', 'preload');

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function shoot(w, file) {
  const img = await w.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, file), img.toPNG());
  console.log('[capture] ' + file);
  w.destroy();
}

async function capturePlayer() {
  const w = new BrowserWindow({
    width: 440, height: 104, show: false, frame: false, transparent: true,
    webPreferences: { preload: path.join(PRELOAD, 'player.js'), contextIsolation: true, sandbox: false },
  });
  await w.loadFile(path.join(RENDERER, 'player', 'index.html'));
  await w.webContents.executeJavaScript(`
    document.getElementById('source').textContent = 'Reading from Firefox';
    document.getElementById('line').textContent = 'The model runs faster than realtime on an ordinary CPU.';
    document.getElementById('progress-fill').style.width = '38%';
    document.getElementById('wave').classList.add('speaking');
    document.getElementById('toggle').innerHTML = '&#10074;&#10074;';
    true;
  `);
  await sleep(450); // mid-dance
  await shoot(w, 'player-speaking.png');
}

async function captureReader() {
  const w = new BrowserWindow({
    width: 780, height: 660, show: false, backgroundColor: '#101214',
    webPreferences: { preload: path.join(PRELOAD, 'reader.js'), contextIsolation: true, sandbox: false },
  });
  await w.loadFile(path.join(RENDERER, 'reader', 'index.html'));
  await w.webContents.executeJavaScript(`
    (function () {
      const input = document.getElementById('input');
      const follow = document.getElementById('follow');
      follow.innerHTML = '';
      const sents = [
        'There is a category of app that exists because, for about a decade, a voice that did not sound like a robot was genuinely hard. ',
        'That scarcity is over. ',
        'An eighty-two million parameter model now speaks like a person, faster than realtime, on the laptop you already own. ',
        'So the only honest price for reading aloud is zero.',
      ];
      for (let i = 0; i < sents.length; i++) {
        const sp = document.createElement('span');
        sp.className = 'sent' + (i === 2 ? ' active' : '');
        sp.textContent = sents[i];
        follow.appendChild(sp);
      }
      input.hidden = true;
      follow.hidden = false;
      document.getElementById('read').textContent = 'Stop';
      document.getElementById('stats').textContent = '61 words · about 1 min of listening';
      document.getElementById('status').textContent = 'Listening — the floating player has the controls.';
      const v = document.getElementById('voice');
      v.innerHTML = '<option>Heart — American female</option>';
      return true;
    })();
  `);
  await sleep(200);
  await shoot(w, 'reader-highlight.png');
}

async function captureSettings() {
  const w = new BrowserWindow({
    width: 520, height: 620, show: false, backgroundColor: '#101214',
    webPreferences: { preload: path.join(PRELOAD, 'settings.js'), contextIsolation: true, sandbox: false },
  });
  await w.loadFile(path.join(RENDERER, 'settings', 'index.html'));
  await w.webContents.executeJavaScript(`
    (function () {
      const v = document.getElementById('voice');
      v.innerHTML = '';
      const names = ['Heart — American female · A', 'Bella — American female · A-', 'George — British male · B', 'Fenrir — American male · B+'];
      for (let i = 0; i < names.length; i++) { const o = document.createElement('option'); o.textContent = names[i]; v.appendChild(o); }
      document.getElementById('model-line').textContent = 'Kokoro-82M (Apache-2.0), bundled with the app';
      document.getElementById('version').textContent = 'Hear Me Out v0.1.0';
      return true;
    })();
  `);
  await sleep(200);
  await shoot(w, 'settings.png');
}

async function captureWelcome() {
  const w = new BrowserWindow({
    width: 600, height: 560, show: false, backgroundColor: '#101214',
    webPreferences: { preload: path.join(PRELOAD, 'welcome.js'), contextIsolation: true, sandbox: false },
  });
  await w.loadFile(path.join(RENDERER, 'welcome', 'index.html'));
  await w.webContents.executeJavaScript(`
    (function () {
      document.getElementById('model-dot').classList.add('ready');
      document.getElementById('model-text').textContent = 'Voice ready. Everything runs on this machine from here on.';
      document.getElementById('try').disabled = false;
      return true;
    })();
  `);
  await sleep(200);
  await shoot(w, 'welcome.png');
}

app.whenReady().then(async function () {
  fs.mkdirSync(OUT, { recursive: true });
  await capturePlayer();
  await captureReader();
  await captureSettings();
  await captureWelcome();
  console.log('[capture] done');
  app.exit(0);
}).catch(function (e) {
  console.error('[capture] FAIL', e);
  app.exit(1);
});
