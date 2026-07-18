'use strict';

/**
 * The reading session: one text being spoken, chunk by chunk.
 *
 * Owns: chunking, synth-ahead (a small window of sentences synthesized before
 * they are needed), the per-chunk WAV cache, and session state. Does NOT own
 * playback — the player window plays the WAVs and reports position back; this
 * keeps audio on the renderer side where <audio> gives us pitch-preserving
 * speed for free.
 *
 * Wiring is injected via bind() so this file stays testable without Electron.
 */

const { chunk } = require('./tts/chunker');
const { encodeWav } = require('./tts/wav');
const { engine } = require('./tts/engine');
const log = require('./log');

const AHEAD = 2;           // synth this many chunks past the one playing
const CACHE_BEHIND = 5;    // keep this many played chunks for instant "prev"

class Session {
  constructor() {
    this._io = null;         // {sendToPlayer, sendToReader, onState}
    this._gen = 0;           // generation counter; kills stale synth callbacks
    this._state = 'idle';    // idle | speaking | paused
    this._chunks = [];
    this._voice = 'af_heart';
    this._pos = 0;
    this._cache = new Map(); // idx -> Buffer (wav)
    this._inflight = new Set();
    this._from = null;
  }

  bind(io) {
    this._io = io;
  }

  state() {
    return this._state;
  }

  /**
   * Begin speaking `text`. Replaces any current session.
   * @param {string} text
   * @param {{exe?:string,title?:string,origin:string}} from
   * @param {{voice:string, speedPct:number}} opts
   * @returns {{ok:boolean, err?:string, chunks?:number}}
   */
  start(text, from, opts) {
    const parts = chunk(text);
    if (!parts.length) return { ok: false, err: 'empty' };

    this._gen += 1;
    this._chunks = parts;
    this._voice = (opts && opts.voice) || 'af_heart';
    this._pos = 0;
    this._cache = new Map();
    this._inflight = new Set();
    this._from = from || { origin: 'unknown' };
    this._setState('speaking');

    this._startPayload = {
      chunks: parts.map(function (c) { return c.text; }),
      offsets: parts.map(function (c) { return { start: c.start, end: c.end }; }),
      from: this._from,
      voice: this._voice,
      speedPct: (opts && opts.speedPct) || 100,
    };
    this._io.sendToPlayer('session:start', this._startPayload);
    this._io.sendToReader('session:start', {
      count: parts.length,
      offsets: parts.map(function (c) { return { start: c.start, end: c.end }; }),
      origin: this._from.origin,
    });

    this._ensure(0);
    return { ok: true, chunks: parts.length };
  }

  /** Player asks for a chunk it does not have yet. */
  need(idx) {
    if (this._state === 'idle') return;
    this._ensure(idx | 0);
  }

  /**
   * A (re)loaded player window announces itself: replay the session start and
   * whatever audio is already cached so it can resume where things stand.
   */
  hello() {
    if (this._state === 'idle' || !this._startPayload) return;
    this._io.sendToPlayer('session:start', this._startPayload);
    const self = this;
    this._cache.forEach(function (wav, i) {
      self._io.sendToPlayer('session:audio', { idx: i, wav: wav });
    });
  }

  /** Player reports playback position (chunk began playing). */
  reportPos(idx) {
    if (this._state === 'idle') return;
    this._pos = idx | 0;
    this._io.sendToReader('session:pos', { idx: this._pos });
    this._ensure(this._pos);
    this._trim();
  }

  /** Player reports the whole text finished. */
  reportEnded() {
    if (this._state === 'idle') return;
    this._teardown('ended');
  }

  reportPaused(paused) {
    if (this._state === 'idle') return;
    this._setState(paused ? 'paused' : 'speaking');
  }

  /** Stop and drop everything (hotkey/Esc/UI stop all land here). */
  stop() {
    if (this._state === 'idle') return;
    this._teardown('stopped');
  }

  _teardown(why) {
    this._gen += 1; // orphan in-flight synths
    this._chunks = [];
    this._cache = new Map();
    this._inflight = new Set();
    this._setState('idle');
    this._io.sendToPlayer('session:stop', { why: why });
    this._io.sendToReader('session:stop', { why: why });
  }

  _setState(s) {
    if (this._state === s) return;
    this._state = s;
    if (this._io && this._io.onState) this._io.onState(s);
  }

  /** Make sure chunks [idx .. idx+AHEAD] are cached or in flight. */
  _ensure(idx) {
    const self = this;
    const gen = this._gen;
    const last = Math.min(this._chunks.length - 1, idx + AHEAD);
    for (let i = Math.max(0, idx); i <= last; i++) {
      if (this._cache.has(i) || this._inflight.has(i)) {
        if (this._cache.has(i)) this._send(i);
        continue;
      }
      this._inflight.add(i);
      (function (i) {
        engine.synth(self._chunks[i].text, { voice: self._voice })
          .then(function (res) {
            if (gen !== self._gen) return; // session changed; drop it
            self._inflight.delete(i);
            const wav = encodeWav(res.audio, res.sampleRate);
            self._cache.set(i, wav);
            self._send(i);
          })
          .catch(function (e) {
            if (gen !== self._gen) return;
            self._inflight.delete(i);
            log.error('synth failed for chunk ' + i, e);
            self._io.sendToPlayer('session:chunk-error', { idx: i, err: String(e && e.message || e) });
          });
      })(i);
    }
  }

  _send(i) {
    const wav = this._cache.get(i);
    if (!wav) return;
    this._io.sendToPlayer('session:audio', { idx: i, wav: wav });
  }

  /** Drop cached audio far behind the playhead (long documents stay lean). */
  _trim() {
    const floor = this._pos - CACHE_BEHIND;
    const keys = Array.from(this._cache.keys());
    for (let k = 0; k < keys.length; k++) {
      if (keys[k] < floor) this._cache.delete(keys[k]);
    }
  }
}

module.exports = new Session();
