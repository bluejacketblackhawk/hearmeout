'use strict';

/**
 * Tray icon + menu. The tray is the app's home: closing windows never quits;
 * the tray (or its Quit item) does.
 */

const path = require('path');
const { Tray, Menu, nativeImage, app } = require('electron');

let _tray = null;

/**
 * @param {{onReadSelection:Function, onOpenReader:Function, onOpenSettings:Function, onQuit:Function, getLogin:Function, setLogin:Function}} h
 */
function create(h) {
  if (_tray) return _tray;
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'tray.png');
  let img = nativeImage.createFromPath(iconPath);
  if (img.isEmpty()) img = nativeImage.createEmpty();
  _tray = new Tray(img);
  _tray.setToolTip('Hear Me Out — select text, press your hotkey, listen');

  const menu = Menu.buildFromTemplate([
    { label: 'Read selection now', click: function () { h.onReadSelection(); } },
    { label: 'Open reader', click: function () { h.onOpenReader(); } },
    { type: 'separator' },
    { label: 'Settings', click: function () { h.onOpenSettings(); } },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: !!h.getLogin(),
      click: function (item) { h.setLogin(!!item.checked); },
    },
    { type: 'separator' },
    { label: 'Quit Hear Me Out', click: function () { h.onQuit(); } },
  ]);
  _tray.setContextMenu(menu);
  _tray.on('double-click', function () { h.onOpenReader(); });
  return _tray;
}

function destroy() {
  if (_tray) { _tray.destroy(); _tray = null; }
}

module.exports = { create, destroy };
