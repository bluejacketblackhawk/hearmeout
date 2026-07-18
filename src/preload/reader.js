'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function on(channel, cb) {
  ipcRenderer.on(channel, function (e, payload) { cb(payload); });
}

contextBridge.exposeInMainWorld('hmo', {
  onSessionStart: function (cb) { on('session:start', cb); },
  onPos: function (cb) { on('session:pos', cb); },
  onSessionStop: function (cb) { on('session:stop', cb); },
  onExportProgress: function (cb) { on('export:progress', cb); },
  onSettingsChanged: function (cb) { on('settings:changed', cb); },

  read: function (text) { return ipcRenderer.invoke('session:start-text', { text: text, origin: 'reader' }); },
  stop: function () { return ipcRenderer.invoke('session:ctl', 'stop'); },
  exportWav: function (text) { return ipcRenderer.invoke('export:wav', { text: text }); },
  getSettings: function () { return ipcRenderer.invoke('settings:get'); },
  setSettings: function (patch) { return ipcRenderer.invoke('settings:set', patch); },
  voices: function () { return ipcRenderer.invoke('voices:list'); },
  openSettings: function () { return ipcRenderer.invoke('open:settings'); },
});
