'use strict';

/**
 * Path resolution for both worlds: a dev checkout (repo layout) and a packaged
 * app (electron-builder extraResources). Everything that needs a path asks
 * here; nothing else does path math.
 */

const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function isPackaged() {
  // app.isPackaged without requiring electron (files here also run under node tests).
  return __dirname.indexOf('app.asar') !== -1;
}

function resourcesRoot() {
  if (isPackaged()) return process.resourcesPath;
  return REPO_ROOT;
}

const BIN_HELPER = path.join(resourcesRoot(), 'bin', 'helper', 'HearMeOutHelper.exe');
const HELPER_BUILD = path.join(
  isPackaged() ? path.join(process.resourcesPath, 'native') : path.join(REPO_ROOT, 'native'),
  process.platform === 'darwin' ? 'build-mac.sh' : 'build.cmd'
);

module.exports = {
  REPO_ROOT: REPO_ROOT,
  BIN_HELPER: BIN_HELPER,
  HELPER_BUILD: HELPER_BUILD,
  isPackaged: isPackaged,
};
