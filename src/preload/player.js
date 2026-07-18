'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function on(channel, cb) {
  ipcRenderer.on(channel, function (e, payload) { cb(payload); });
}

contextBridge.exposeInMainWorld('hmo', {
  onStart: function (cb) { on('session:start', cb); },
  onAudio: function (cb) { on('session:audio', cb); },
  onStop: function (cb) { on('session:stop', cb); },
  onCtl: function (cb) { on('session:ctl', cb); },
  onFlash: function (cb) { on('session:flash', cb); },
  onChunkError: function (cb) { on('session:chunk-error', cb); },
  onSettingsChanged: function (cb) { on('settings:changed', cb); },

  hello: function () { ipcRenderer.send('session:hello'); },
  need: function (idx) { ipcRenderer.send('session:need', idx); },
  report: function (msg) { ipcRenderer.send('session:report', msg); },
  stop: function () { return ipcRenderer.invoke('session:ctl', 'stop'); },
  setSpeed: function (pct) { return ipcRenderer.invoke('settings:set', { speedPct: pct }); },
  getSettings: function () { return ipcRenderer.invoke('settings:get'); },
  openReader: function () { return ipcRenderer.invoke('open:reader'); },
  openSettings: function () { return ipcRenderer.invoke('open:settings'); },
});
