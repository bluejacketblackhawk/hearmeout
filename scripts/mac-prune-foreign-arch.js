'use strict';

/**
 * electron-builder afterPack, mac lanes only (the MAC-PORT.md slimming).
 *
 * One npm install feeds both mac builds, so each packaged app starts life
 * hauling the OTHER arch's native payload too. Drop it: the app.asar.unpacked
 * copies of onnxruntime's foreign darwin binaries and sharp's foreign
 * @img packages. Everything left is exactly what that app can execute.
 */

const fs = require('fs');
const path = require('path');

const ARCH_NAME = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64' };

module.exports = async function (context) {
  if (context.electronPlatformName !== 'darwin') return;
  const arch = ARCH_NAME[context.arch];
  if (arch !== 'x64' && arch !== 'arm64') return;
  const other = (arch === 'x64') ? 'arm64' : 'x64';

  const apps = fs.readdirSync(context.appOutDir).filter(function (n) { return n.endsWith('.app'); });
  for (let i = 0; i < apps.length; i++) {
    const mods = path.join(context.appOutDir, apps[i], 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules');
    const doomed = [
      path.join(mods, 'onnxruntime-node', 'bin', 'napi-v3', 'darwin', other),
      path.join(mods, '@img', 'sharp-darwin-' + other),
      path.join(mods, '@img', 'sharp-libvips-darwin-' + other),
    ];
    for (let d = 0; d < doomed.length; d++) {
      if (fs.existsSync(doomed[d])) {
        fs.rmSync(doomed[d], { recursive: true, force: true });
        console.log('  • pruned foreign arch ' + path.relative(context.appOutDir, doomed[d]));
      }
    }
  }
};
