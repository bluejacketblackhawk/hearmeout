'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function on(channel, cb) {
  ipcRenderer.on(channel, function (e, payload) { cb(payload); });
}

contextBridge.exposeInMainWorld('hmo', {
  onModelProgress: function (cb) { on('model:progress', cb); },
  onModelReady: function (cb) { on('model:ready', cb); },
  onPerms: function (cb) { on('perms:changed', cb); },

  modelInfo: function () { return ipcRenderer.invoke('model:info'); },
  perms: function () { return ipcRenderer.invoke('perms:get'); },
  permsGrant: function (which) { return ipcRenderer.invoke('perms:grant', which); },
  sample: function (voiceId) { return ipcRenderer.invoke('tts:sample', voiceId); },
  getSettings: function () { return ipcRenderer.invoke('settings:get'); },
  done: function () { return ipcRenderer.invoke('welcome:done'); },
  openReader: function () { return ipcRenderer.invoke('open:reader'); },
  readSelection: function () { return ipcRenderer.invoke('read:selection'); },
});
