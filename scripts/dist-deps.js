'use strict';

/**
 * Make `npm run dist` honest on a Mac: the mac lane packages BOTH arches, but
 * npm only installs sharp's native package for the machine it runs on — an
 * arm64 checkout would ship an x64 app whose engine cannot load. Before
 * electron-builder runs, pull the other darwin arch of sharp (exact versions
 * from package-lock.json, --no-save so nothing churns). The foreign-arch
 * payload each app does NOT need is pruned again at pack time by
 * scripts/mac-prune-foreign-arch.js.
 *
 * No-op on Windows and when everything is already present.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.platform !== 'darwin') process.exit(0);

const ROOT = path.resolve(__dirname, '..');
const WANTED = [
  '@img/sharp-darwin-arm64', '@img/sharp-libvips-darwin-arm64',
  '@img/sharp-darwin-x64', '@img/sharp-libvips-darwin-x64',
];

const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));

const missing = [];
for (let i = 0; i < WANTED.length; i++) {
  const name = WANTED[i];
  if (fs.existsSync(path.join(ROOT, 'node_modules', name))) continue;
  const entry = lock.packages && lock.packages['node_modules/' + name];
  if (!entry || !entry.version) {
    console.error('[dist-deps] ' + name + ' is not in package-lock.json — cannot pin');
    process.exit(1);
  }
  missing.push(name + '@' + entry.version);
}

if (!missing.length) {
  console.log('[dist-deps] both darwin arches of sharp present');
  process.exit(0);
}

console.log('[dist-deps] installing ' + missing.join(', '));
execFileSync('npm', ['install', '--no-save', '--force', '--no-audit', '--no-fund'].concat(missing), {
  cwd: ROOT,
  stdio: 'inherit',
});
