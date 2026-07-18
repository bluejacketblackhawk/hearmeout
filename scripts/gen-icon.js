'use strict';

/**
 * Generate every icon from one canvas drawing. Runs under Electron
 * (npx electron scripts/gen-icon.js) so there are zero image dependencies:
 *   assets/HearMeOut.png  256px app icon
 *   assets/HearMeOut.ico  multi-size (256/128/64/48/32/16, PNG-compressed)
 *   assets/tray.png       32px tray glyph (transparent)
 *
 * The mark: a rounded amber square with three white sound arcs — ")))" —
 * the same mark the UI wears as text.
 */

const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');

const DRAW = `
(function () {
  function draw(size, forTray) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    const s = size / 256;

    if (!forTray) {
      const r = 56 * s;
      g.fillStyle = '#14161a';
      g.beginPath();
      g.moveTo(r, 0); g.arcTo(256*s, 0, 256*s, 256*s, r); g.arcTo(256*s, 256*s, 0, 256*s, r);
      g.arcTo(0, 256*s, 0, 0, r); g.arcTo(0, 0, 256*s, 0, r);
      g.fill();
    }

    const cx = 74 * s, cy = 128 * s;
    g.strokeStyle = forTray ? '#f2b134' : '#f2b134';
    g.lineCap = 'round';
    const arcs = [
      { rad: 34, w: 22, a: 0.62 },
      { rad: 78, w: 22, a: 0.55 },
      { rad: 122, w: 22, a: 0.48 },
    ];
    for (let i = 0; i < arcs.length; i++) {
      g.lineWidth = arcs[i].w * s;
      g.beginPath();
      g.arc(cx, cy, arcs[i].rad * s, -arcs[i].a * Math.PI, arcs[i].a * Math.PI);
      g.stroke();
    }
    return c.toDataURL('image/png');
  }
  return { icon: draw(256, false), tray: draw(64, true) };
})();
`;

// ICO container: header + one directory entry per size + raw PNG payloads.
// Windows Vista+ reads PNG-compressed entries directly.
function writeIco(pngBySize, outPath) {
  const sizes = Object.keys(pngBySize).map(Number).sort(function (a, b) { return b - a; });
  const count = sizes.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // reserved
  header.writeUInt16LE(1, 2);      // type: icon
  header.writeUInt16LE(count, 4);

  const entries = [];
  const blobs = [];
  let offset = 6 + count * 16;
  for (let i = 0; i < count; i++) {
    const size = sizes[i];
    const png = pngBySize[size];
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);  // width (0 = 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1);  // height
    e.writeUInt8(0, 2);                       // palette
    e.writeUInt8(0, 3);                       // reserved
    e.writeUInt16LE(1, 4);                    // planes
    e.writeUInt16LE(32, 6);                   // bpp
    e.writeUInt32LE(png.length, 8);           // bytes
    e.writeUInt32LE(offset, 12);              // offset
    entries.push(e);
    blobs.push(png);
    offset += png.length;
  }
  fs.writeFileSync(outPath, Buffer.concat([header].concat(entries).concat(blobs)));
}

app.whenReady().then(async function () {
  const w = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await w.loadURL('data:text/html,<html><body></body></html>');
  const res = await w.webContents.executeJavaScript(DRAW);

  fs.mkdirSync(ASSETS, { recursive: true });

  const icon256 = nativeImage.createFromDataURL(res.icon);
  fs.writeFileSync(path.join(ASSETS, 'HearMeOut.png'), icon256.toPNG());

  const pngBySize = {};
  const sizes = [256, 128, 64, 48, 32, 16];
  for (let i = 0; i < sizes.length; i++) {
    const s = sizes[i];
    pngBySize[s] = (s === 256 ? icon256 : icon256.resize({ width: s, height: s })).toPNG();
  }
  writeIco(pngBySize, path.join(ASSETS, 'HearMeOut.ico'));

  const tray = nativeImage.createFromDataURL(res.tray).resize({ width: 32, height: 32 });
  fs.writeFileSync(path.join(ASSETS, 'tray.png'), tray.toPNG());

  console.log('[gen-icon] wrote HearMeOut.png, HearMeOut.ico, tray.png');
  app.exit(0);
}).catch(function (e) {
  console.error('[gen-icon] FAIL', e);
  app.exit(1);
});
