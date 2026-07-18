'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function on(channel, cb) {
  ipcRenderer.on(channel, function (e, payload) { cb(payload); });
}

contextBridge.exposeInMainWorld('hmo', {
  onSettingsChanged: function (cb) { on('settings:changed', cb); },

  getSettings: function () { return ipcRenderer.invoke('settings:get'); },
  setSettings: function (patch) { return ipcRenderer.invoke('settings:set', patch); },
  voices: function () { return ipcRenderer.invoke('voices:list'); },
  sample: function (voiceId) { return ipcRenderer.invoke('tts:sample', voiceId); },
  modelInfo: function () { return ipcRenderer.invoke('model:info'); },
  captureHotkey: function () { return ipcRenderer.invoke('hotkey:capture'); },
  cancelCapture: function () { return ipcRenderer.invoke('hotkey:capture-cancel'); },
  version: function () { return ipcRenderer.invoke('app:version'); },
});
