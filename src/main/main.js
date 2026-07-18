'use strict';

/**
 * Hear Me Out — main process.
 *
 * Boot order: single-instance lock -> app ready -> settings/log attach ->
 * tray -> IPC -> native helper (hotkey) -> engine warm-up in the background.
 * The hotkey path never waits for anything it does not need: if the model is
 * still loading when the first grab lands, the player shows "warming up" and
 * speaks the moment the engine is ready.
 *
 * --smoke: boot everything, speak one sentence end-to-end through the real
 * player window, then exit 0 (used by CI and by humans who trust nothing).
 */

const { app } = require('electron');

const log = require('./log');
const settings = require('./stores/settings');
const helper = require('./helper');
const session = require('./session');
const windows = require('./windows');
const tray = require('./tray');
const ipc = require('./ipc');
const hotkeys = require('./hotkey-match');
const { engine } = require('./tts/engine');

const SMOKE = process.argv.indexOf('--smoke') !== -1;
const VK_ESC = 0x1B;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', function () {
    windows.reader();
  });
  app.whenReady().then(boot).catch(function (e) {
    log.error('boot failed', e);
    app.exit(1);
  });
}

let _enginePromise = null;
let _speaking = false;

function engineReady() {
  if (!_enginePromise) {
    _enginePromise = engine.init(app.getPath('userData')).then(function () {
      log.info('engine: model ready (' + engine.voices().length + ' voices) from ' + engine.cacheInfo().cacheDir);
      windows.sendToWelcome('model:ready', engine.cacheInfo());
    });
    engine.onProgress(function (p) {
      windows.sendToWelcome('model:progress', p);
    });
  }
  return _enginePromise;
}

function currentHotkey() {
  return settings.load().hotkey;
}

function rewatch() {
  const hk = currentHotkey();
  helper.watch(hotkeys.watchSet(hk, _speaking ? [VK_ESC] : []));
}

/** The one gesture: grab whatever is selected and speak it. */
async function readSelection(origin) {
  try {
    if (session.state() !== 'idle') {
      session.stop();
      windows.hidePlayer();
      return { ok: true, toggledOff: true };
    }
    const grabbed = await helper.grabSelection(700);
    if (!grabbed.ok || !grabbed.text || !grabbed.text.trim()) {
      windows.showPlayer();
      windows.sendToPlayer('session:flash', { msg: 'Select some text first, then press the hotkey.' });
      return { ok: false, err: 'no-selection' };
    }
    let from = { origin: origin || 'hotkey' };
    try {
      const fg = await helper.foreground();
      from.exe = fg.exe;
      from.title = fg.title;
    } catch (e) { /* cosmetic only */ }

    windows.showPlayer();
    if (!engine.ready()) {
      windows.sendToPlayer('session:flash', { msg: 'Warming up the voice…' });
    }
    await engineReady();
    const s = settings.load();
    const r = session.start(grabbed.text, from, { voice: s.voice, speedPct: s.speedPct });
    if (!r.ok) {
      windows.sendToPlayer('session:flash', { msg: 'Nothing readable in that selection.' });
    }
    return r;
  } catch (e) {
    log.error('readSelection failed', e);
    return { ok: false, err: String(e && e.message || e) };
  }
}

async function boot() {
  const userData = app.getPath('userData');
  log.attach(userData);
  settings.attach(userData);
  log.info('boot: v' + app.getVersion() + (SMOKE ? ' (smoke)' : ''));

  // Session <-> windows wiring.
  session.bind({
    sendToPlayer: windows.sendToPlayer,
    sendToReader: windows.sendToReader,
    onState: function (s) {
      _speaking = (s !== 'idle');
      rewatch(); // Esc is only watched while speaking
    },
  });

  ipc.register({
    engineReady: engineReady,
    rewatch: rewatch,
    readSelection: readSelection,
  });

  tray.create({
    onReadSelection: function () { readSelection('tray'); },
    onOpenReader: function () { windows.reader(); },
    onOpenSettings: function () { windows.settings(); },
    onQuit: function () { shutdown(); },
    getLogin: function () { return settings.load().launchAtLogin; },
    setLogin: function (on) {
      settings.save({ launchAtLogin: on });
      app.setLoginItemSettings({ openAtLogin: on });
    },
  });

  // Closing every window must not quit a tray app.
  app.on('window-all-closed', function (e) { /* stay alive in the tray */ });

  // Native helper + hotkey.
  try {
    await helper.start();
    rewatch();
    helper.on('key', function (ev) {
      if (ev.down && ev.vk === VK_ESC) {
        if (session.state() !== 'idle') {
          session.stop();
          windows.hidePlayer();
        }
        return;
      }
      if (hotkeys.matches(ev, currentHotkey())) {
        readSelection('hotkey');
      }
    });
    helper.on('unavailable', function () {
      log.error('hotkey unavailable — helper kept crashing');
    });
    // macOS: the welcome screen watches TCC grants flip live.
    helper.on('perms', function (p) {
      windows.sendToWelcome('perms:changed', p);
    });
    log.info('helper: up, hotkey ' + (currentHotkey().name || 'F8'));
  } catch (e) {
    log.error('helper failed to start — hotkey disabled, reader still works', e);
  }

  // Pre-create the hidden player so first speech is instant.
  windows.player();

  // Warm the engine in the background; first hotkey press should not pay it.
  engineReady().catch(function (e) { log.error('engine init failed', e); });

  if (SMOKE) return smoke();

  if (!settings.load().firstRunDone) {
    windows.welcome();
  }
}

async function smoke() {
  const t0 = Date.now();
  try {
    await engineReady();
    const r = session.start(
      'Hear me out. This is the smoke test speaking, out loud, end to end. If you can hear this, the pipeline works.',
      { origin: 'smoke' },
      { voice: 'af_heart', speedPct: 100 }
    );
    if (!r.ok) throw new Error('session refused: ' + r.err);
    windows.showPlayer();

    await new Promise(function (resolve, reject) {
      const timer = setTimeout(function () { reject(new Error('smoke timeout')); }, 120000);
      const iv = setInterval(function () {
        if (session.state() === 'idle') {
          clearInterval(iv);
          clearTimeout(timer);
          resolve();
        }
      }, 250);
    });

    log.info('smoke: ok in ' + (Date.now() - t0) + 'ms');
    shutdown(0);
  } catch (e) {
    log.error('smoke: FAIL', e);
    shutdown(1);
  }
}

function shutdown(code) {
  try { helper.stop(); } catch (e) { /* ignore */ }
  try { tray.destroy(); } catch (e) { /* ignore */ }
  app.exit(code || 0);
}
