'use strict';

/**
 * The voice. One resident Kokoro-82M model (q8, CPU) behind a tiny queue.
 *
 * kokoro-js is ESM-only, so it is pulled in with a dynamic import. All
 * synthesis is serialized through a promise chain — one ONNX session, one
 * inference at a time, in arrival order — so a long paragraph cannot starve
 * the "read this now" hotkey path (callers that matter enqueue first).
 *
 * synth() returns { audio: Float32Array, sampleRate } and never touches disk;
 * WAV encoding is the caller's business (see wav.js).
 */

const fs = require('fs');
const { MODEL_ID, MODEL_DTYPE, resolveModelCache } = require('./paths');

class Engine {
  constructor() {
    this._tts = null;
    this._initing = null;
    this._chain = Promise.resolve();
    this._cache = null; // {cacheDir, warm}
    this._progress = null; // download progress callback
  }

  /** @param {(info:{file:string,progress:number})=>void} cb */
  onProgress(cb) {
    this._progress = cb;
  }

  /**
   * Load the model (idempotent). In Electron pass app.getPath('userData');
   * in plain node tests pass nothing.
   * @param {string} [userDataDir]
   */
  init(userDataDir) {
    if (this._tts) return Promise.resolve();
    if (this._initing) return this._initing;
    const self = this;
    this._initing = (async function () {
      const mod = await import('kokoro-js');
      const hub = await import('@huggingface/transformers');

      self._cache = resolveModelCache(userDataDir || null);
      fs.mkdirSync(self._cache.cacheDir, { recursive: true });
      hub.env.cacheDir = self._cache.cacheDir;
      hub.env.allowLocalModels = true;

      const opts = {
        dtype: MODEL_DTYPE,
        device: 'cpu',
        progress_callback: function (p) {
          if (self._progress && p && p.status === 'progress') {
            self._progress({ file: p.file || '', progress: p.progress || 0 });
          }
        },
      };

      try {
        self._tts = await mod.KokoroTTS.from_pretrained(MODEL_ID, opts);
      } catch (e) {
        // A read-only or corrupt bundled cache must not brick the app: retry
        // once against the writable userData cache (downloads if needed).
        if (userDataDir && self._cache.warm) {
          const path = require('path');
          hub.env.cacheDir = path.join(userDataDir, 'models');
          fs.mkdirSync(hub.env.cacheDir, { recursive: true });
          self._cache = { cacheDir: hub.env.cacheDir, warm: false };
          self._tts = await mod.KokoroTTS.from_pretrained(MODEL_ID, opts);
        } else {
          throw e;
        }
      }
      self._initing = null;
    })();
    return this._initing;
  }

  ready() {
    return !!this._tts;
  }

  /** Where the model actually loaded from (for the settings screen). */
  cacheInfo() {
    return this._cache;
  }

  /**
   * All voices as plain objects for the UI.
   * @returns {{id:string,name:string,lang:string,gender:string,grade:string}[]}
   */
  voices() {
    if (!this._tts) return [];
    const raw = this._tts.voices || {};
    const out = [];
    const ids = Object.keys(raw);
    for (let i = 0; i < ids.length; i++) {
      const v = raw[ids[i]] || {};
      out.push({
        id: ids[i],
        name: v.name || ids[i],
        lang: v.language || '',
        gender: v.gender || '',
        grade: v.overallGrade || '',
      });
    }
    return out;
  }

  /**
   * Synthesize one chunk of text. Serialized; resolves in call order.
   * @param {string} text
   * @param {{voice?: string}} [opts]
   * @returns {Promise<{audio: Float32Array, sampleRate: number}>}
   */
  synth(text, opts) {
    const self = this;
    const voice = (opts && opts.voice) || 'af_heart';
    const run = async function () {
      if (!self._tts) throw new Error('engine not initialized');
      const t = String(text == null ? '' : text).trim();
      if (!t) return { audio: new Float32Array(0), sampleRate: 24000 };
      const res = await self._tts.generate(t, { voice: voice });
      // kokoro-js returns a RawAudio { audio: Float32Array, sampling_rate }
      return { audio: res.audio, sampleRate: res.sampling_rate || 24000 };
    };
    const p = this._chain.then(run, run);
    // Keep the chain alive whatever happens to individual jobs.
    this._chain = p.then(function () {}, function () {});
    return p;
  }
}

module.exports = { engine: new Engine(), Engine: Engine };
