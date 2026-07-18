'use strict';

/**
 * Window factory + registry. Four windows, all context-isolated, no node in
 * renderers. The player is a frameless always-on-top strip that shows without
 * stealing focus; everything else is a normal window.
 */

const path = require('path');
const { BrowserWindow, screen } = require('electron');

const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, '..', 'preload');

const _wins = { player: null, reader: null, settings: null, welcome: null };

// webContents.send fired before a renderer finishes loading is silently lost.
// Every outbound send goes through queueSend(): buffered until did-finish-load.
function queueSend(w, channel, payload) {
  if (!w || w.isDestroyed()) return;
  if (w._hmoLoaded) {
    w.webContents.send(channel, payload);
    return;
  }
  if (!w._hmoQueue) w._hmoQueue = [];
  w._hmoQueue.push([channel, payload]);
}

function armLoadFlush(w) {
  w._hmoLoaded = false;
  w._hmoQueue = [];
  w.webContents.on('did-finish-load', function () {
    w._hmoLoaded = true;
    const q = w._hmoQueue || [];
    w._hmoQueue = [];
    for (let i = 0; i < q.length; i++) {
      if (!w.isDestroyed()) w.webContents.send(q[i][0], q[i][1]);
    }
  });
}

function base(preloadFile, extra) {
  const opts = {
    show: false,
    webPreferences: {
      preload: path.join(PRELOAD, preloadFile),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  };
  const keys = Object.keys(extra || {});
  for (let i = 0; i < keys.length; i++) opts[keys[i]] = extra[keys[i]];
  return opts;
}

function player() {
  if (_wins.player && !_wins.player.isDestroyed()) return _wins.player;
  const w = new BrowserWindow(base('player.js', {
    width: 440,
    height: 104,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    hasShadow: false,
  }));
  w.setAlwaysOnTop(true, 'screen-saver');
  armLoadFlush(w);
  w.loadFile(path.join(RENDERER, 'player', 'index.html'));
  w.on('closed', function () { _wins.player = null; });
  _wins.player = w;
  return w;
}

/** Place the player bottom-center of the display the cursor is on, and show
 *  it WITHOUT stealing focus from whatever the user is reading. */
function showPlayer() {
  const w = player();
  const pt = screen.getCursorScreenPoint();
  const disp = screen.getDisplayNearestPoint(pt);
  const wa = disp.workArea;
  const b = w.getBounds();
  w.setPosition(Math.round(wa.x + (wa.width - b.width) / 2), Math.round(wa.y + wa.height - b.height - 24));
  if (!w.isVisible()) w.showInactive();
}

function hidePlayer() {
  if (_wins.player && !_wins.player.isDestroyed() && _wins.player.isVisible()) {
    _wins.player.hide();
  }
}

function reader() {
  if (_wins.reader && !_wins.reader.isDestroyed()) { _wins.reader.show(); _wins.reader.focus(); return _wins.reader; }
  const w = new BrowserWindow(base('reader.js', {
    width: 780,
    height: 660,
    minWidth: 520,
    minHeight: 420,
    title: 'Hear Me Out',
    backgroundColor: '#101214',
  }));
  w.setMenuBarVisibility(false);
  armLoadFlush(w);
  w.loadFile(path.join(RENDERER, 'reader', 'index.html'));
  w.once('ready-to-show', function () { w.show(); });
  w.on('closed', function () { _wins.reader = null; });
  _wins.reader = w;
  return w;
}

function settings() {
  if (_wins.settings && !_wins.settings.isDestroyed()) { _wins.settings.show(); _wins.settings.focus(); return _wins.settings; }
  const w = new BrowserWindow(base('settings.js', {
    width: 520,
    height: 620,
    resizable: false,
    maximizable: false,
    title: 'Hear Me Out — Settings',
    backgroundColor: '#101214',
  }));
  w.setMenuBarVisibility(false);
  armLoadFlush(w);
  w.loadFile(path.join(RENDERER, 'settings', 'index.html'));
  w.once('ready-to-show', function () { w.show(); });
  w.on('closed', function () { _wins.settings = null; });
  _wins.settings = w;
  return w;
}

function welcome() {
  if (_wins.welcome && !_wins.welcome.isDestroyed()) { _wins.welcome.show(); return _wins.welcome; }
  const w = new BrowserWindow(base('welcome.js', {
    width: 600,
    // The darwin extra fits the permissions card; Windows never shows it.
    height: process.platform === 'darwin' ? 680 : 560,
    resizable: false,
    maximizable: false,
    title: 'Welcome to Hear Me Out',
    backgroundColor: '#101214',
  }));
  w.setMenuBarVisibility(false);
  armLoadFlush(w);
  w.loadFile(path.join(RENDERER, 'welcome', 'index.html'));
  w.once('ready-to-show', function () { w.show(); });
  w.on('closed', function () { _wins.welcome = null; });
  _wins.welcome = w;
  return w;
}

/** Send to a window if it exists (player also gets created on demand). */
function sendToPlayer(channel, payload) {
  queueSend(player(), channel, payload);
}

function sendToReader(channel, payload) {
  queueSend(_wins.reader, channel, payload);
}

function sendToSettings(channel, payload) {
  queueSend(_wins.settings, channel, payload);
}

function sendToWelcome(channel, payload) {
  queueSend(_wins.welcome, channel, payload);
}

function all() { return _wins; }

module.exports = {
  player, showPlayer, hidePlayer,
  reader, settings, welcome,
  sendToPlayer, sendToReader, sendToSettings, sendToWelcome,
  all,
};
