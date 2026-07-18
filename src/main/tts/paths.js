'use strict';

/**
 * Where the Kokoro model lives.
 *
 * Resolution order:
 *   1. Packaged app: <resources>/models      (bundled by electron-builder,
 *      read-only — fine, it is a complete cache so nothing downloads)
 *   2. Dev checkout / node tests: build-resources/models  (the engine smoke
 *      test warms this folder once; `npm run dist` then ships exactly it)
 *   3. Fallback: the Electron userData dir (first run downloads here if the
 *      bundled cache is somehow missing — keeps the app usable)
 *
 * The folder is a @huggingface/transformers cache dir; kokoro-js resolves the
 * model id inside it. After it is warm the app passes the airplane-mode test.
 */

const path = require('path');
const fs = require('fs');

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const MODEL_DTYPE = 'q8';

function repoRoot() {
  return path.resolve(__dirname, '..', '..', '..');
}

function devModelDir() {
  return path.join(repoRoot(), 'build-resources', 'models');
}

function packagedModelDir() {
  // process.resourcesPath exists only under Electron; guard for plain node.
  if (process.resourcesPath && !process.resourcesPath.includes('node_modules')) {
    return path.join(process.resourcesPath, 'models');
  }
  return null;
}

/** True if a cache dir already holds the model files (any file under the model id). */
function hasModel(dir) {
  if (!dir) return false;
  try {
    const probe = path.join(dir, MODEL_ID.replace('/', path.sep));
    const entries = fs.readdirSync(probe);
    return entries.length > 0;
  } catch (e) {
    return false;
  }
}

/**
 * @param {string|null} userDataDir Electron app.getPath('userData'), or null in tests
 * @returns {{cacheDir: string, warm: boolean}}
 */
function resolveModelCache(userDataDir) {
  const packaged = packagedModelDir();
  if (hasModel(packaged)) return { cacheDir: packaged, warm: true };

  const dev = devModelDir();
  if (hasModel(dev)) return { cacheDir: dev, warm: true };

  // Nothing warm: prefer userData (always writable) for the download,
  // except in plain-node dev/test where we warm the bundle folder itself.
  if (userDataDir) return { cacheDir: path.join(userDataDir, 'models'), warm: false };
  return { cacheDir: dev, warm: false };
}

module.exports = { MODEL_ID, MODEL_DTYPE, resolveModelCache, hasModel, devModelDir };
