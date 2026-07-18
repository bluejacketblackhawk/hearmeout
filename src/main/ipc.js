'use strict';

/**
 * Every ipcMain handler in one place. Renderers only ever see the channels
 * registered here (plus the events windows.js pushes at them).
 */

const { ipcMain, dialog, shell, app } = require('electron');
const fs = require('fs');
const path = require('path');

const windows = require('./windows');
const session = require('./session');
const settings = require('./stores/settings');
const helper = require('./helper');
const log = require('./log');
const { engine } = require('./tts/engine');
const { chunk } = require('./tts/chunker');
const { encodeWav, concatFloat32 } = require('./tts/wav');

const MAX_TEXT = 500000; // ~a novel's worth of characters; beyond this is a mistake

let _capturePending = null;

function register(mainApi) {
  // ---- settings ------------------------------------------------------

  ipcMain.handle('settings:get', function () {
    return settings.load();
  });

  ipcMain.handle('settings:set', function (e, patch) {
    const next = settings.save(patch || {});
    if (patch && patch.hotkey) mainApi.rewatch();
    if (patch && typeof patch.launchAtLogin === 'boolean') {
      app.setLoginItemSettings({ openAtLogin: patch.launchAtLogin });
    }
    // Everyone with a settings UI hears about changes.
    windows.sendToPlayer('settings:changed', next);
    windows.sendToReader('settings:changed', next);
    windows.sendToSettings('settings:changed', next);
    return next;
  });

  // ---- voices / model ------------------------------------------------

  ipcMain.handle('voices:list', function () {
    return engine.voices();
  });

  ipcMain.handle('model:info', function () {
    return {
      ready: engine.ready(),
      cache: engine.cacheInfo(),
    };
  });

  ipcMain.handle('tts:sample', async function (e, voiceId) {
    await mainApi.engineReady();
    const res = await engine.synth(
      'Hey. This is what I sound like, reading to you, right here on your machine.',
      { voice: String(voiceId || 'af_heart') }
    );
    return encodeWav(res.audio, res.sampleRate);
  });

  // ---- session -------------------------------------------------------

  ipcMain.handle('session:start-text', async function (e, payload) {
    const text = String((payload && payload.text) || '').slice(0, MAX_TEXT);
    const origin = (payload && payload.origin) || 'reader';
    await mainApi.engineReady();
    const s = settings.load();
    const r = session.start(text, { origin: origin }, { voice: s.voice, speedPct: s.speedPct });
    if (r.ok) windows.showPlayer();
    return r;
  });

  ipcMain.handle('session:ctl', function (e, action) {
    if (action === 'stop') {
      session.stop();
      windows.hidePlayer();
      return session.state();
    }
    // pause/resume/prev/next/toggle are the player's business; forward.
    windows.sendToPlayer('session:ctl', { action: String(action || '') });
    return session.state();
  });

  ipcMain.on('session:need', function (e, idx) {
    session.need(idx | 0);
  });

  ipcMain.on('session:hello', function () {
    session.hello();
  });

  ipcMain.on('session:report', function (e, msg) {
    if (!msg) return;
    if (msg.evt === 'pos') session.reportPos(msg.idx | 0);
    else if (msg.evt === 'ended') { session.reportEnded(); windows.hidePlayer(); }
    else if (msg.evt === 'paused') session.reportPaused(!!msg.paused);
    else if (msg.evt === 'closed') { session.stop(); windows.hidePlayer(); }
  });

  // ---- export --------------------------------------------------------

  ipcMain.handle('export:wav', async function (e, payload) {
    const text = String((payload && payload.text) || '').slice(0, MAX_TEXT);
    const parts = chunk(text);
    if (!parts.length) return { ok: false, err: 'empty' };

    const res = await dialog.showSaveDialog({
      title: 'Export audio',
      defaultPath: path.join(app.getPath('music'), 'hear-me-out.wav'),
      filters: [{ name: 'WAV audio', extensions: ['wav'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, err: 'canceled' };

    await mainApi.engineReady();
    const s = settings.load();
    const buffers = [];
    for (let i = 0; i < parts.length; i++) {
      const r = await engine.synth(parts[i].text, { voice: s.voice });
      buffers.push(r.audio);
      windows.sendToReader('export:progress', { done: i + 1, total: parts.length });
    }
    const all = concatFloat32(buffers);
    fs.writeFileSync(res.filePath, encodeWav(all, 24000));
    shell.showItemInFolder(res.filePath);
    return { ok: true, path: res.filePath, seconds: Math.round(all.length / 24000) };
  });

  // ---- hotkey rebind -------------------------------------------------

  ipcMain.handle('hotkey:capture', function () {
    return new Promise(function (resolve) {
      if (_capturePending) { _capturePending(null); _capturePending = null; }
      let done = false;
      const timer = setTimeout(function () {
        if (done) return; done = true;
        _capturePending = null;
        helper.captureCancel();
        resolve(null);
      }, 12000);
      _capturePending = function (result) {
        if (done) return; done = true;
        clearTimeout(timer);
        resolve(result);
      };
      helper.once('captured', function (cap) {
        if (_capturePending) {
          const cb = _capturePending;
          _capturePending = null;
          cb(cap);
        }
      });
      helper.capture();
    });
  });

  ipcMain.handle('hotkey:capture-cancel', function () {
    helper.captureCancel();
    if (_capturePending) { _capturePending(null); _capturePending = null; }
    return true;
  });

  // ---- navigation / misc ---------------------------------------------

  ipcMain.handle('open:reader', function () { windows.reader(); return true; });
  ipcMain.handle('open:settings', function () { windows.settings(); return true; });

  ipcMain.handle('welcome:done', function () {
    settings.save({ firstRunDone: true });
    return true;
  });

  ipcMain.handle('app:version', function () {
    return app.getVersion();
  });

  ipcMain.handle('read:selection', function () {
    return mainApi.readSelection('menu');
  });
}

module.exports = { register };
