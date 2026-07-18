'use strict';

/**
 * HearMeOutHelper supervisor.
 *
 * Compiles the native helper when the binary is missing (native/build.cmd via
 * cmd.exe on Windows, native/build-mac.sh via /bin/bash on darwin), spawns it,
 * speaks the JSON-lines protocol from docs/CONTRACTS.md over stdio, and
 * auto-restarts it with exponential backoff on crash. Exposes a singleton
 * EventEmitter.
 *
 * Events:
 *   'ready'       — helper installed its hook and is accepting commands
 *   'key'         {vk, down, held} — a watched VK went down/up
 *   'captured'    {vk, name, mods} — rebind capture result
 *   'foreground'  {exe, title}    — mirror of a foreground() reply
 *   'log'         msg             — helper-internal warning (never keystrokes)
 *   'crash'       {code, signal}  — helper process exited unexpectedly
 *   'unavailable' {restarts}      — gave up after MAX_RAPID_RESTARTS; hotkey dead
 *
 * Methods:
 *   start()            -> Promise<void>   compile-if-missing, spawn, resolve on ready
 *   stop()                                 quit + terminate; suppress restart
 *   watch(vks)                             replace the FULL watched VK set
 *   capture() / captureCancel()            one-shot next-key capture (rebind UI)
 *   grabSelection(timeoutMs) -> Promise<{ok, text, err}>  copy the current selection
 *   foreground()           -> Promise<{exe, title}>
 *   ping()                 -> Promise<boolean>
 */

const { EventEmitter } = require('events');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const { BIN_HELPER, HELPER_BUILD } = require('./config');
const log = require('./log');

const IS_MAC = process.platform === 'darwin';

const READY_TIMEOUT_MS = 15000;
const PING_TIMEOUT_MS = 2000;
const GRAB_TIMEOUT_PAD_MS = 2000;
const FOREGROUND_TIMEOUT_MS = 2000;

const BACKOFF_BASE_MS = 250;
const BACKOFF_MAX_MS = 8000;
const STABLE_MS = 10000;      // helper up this long => reset the backoff counter
const MAX_RAPID_RESTARTS = 3; // then give up and emit 'unavailable'

class Helper extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.ready = false;
    this.watched = []; // last full watch set, re-sent after a restart

    this._buf = '';
    this._starting = null;
    this._stopping = false;
    this._restartCount = 0;
    this._restartTimer = null;
    this._stableTimer = null;

    // Per-command-type FIFO queues of pending {resolve, reject, timer}.
    this._pingQ = [];
    this._grabQ = [];
    this._fgQ = [];

    this._onReadyOnce = null;
  }

  // ---- lifecycle ------------------------------------------------------

  /** Compile if needed, spawn, resolve once the helper reports 'ready'. */
  start() {
    if (this._starting) return this._starting;
    if (this.proc && this.ready) return Promise.resolve();
    this._stopping = false;
    const self = this;
    this._starting = this._ensureCompiled()
      .then(function () { return self._spawn(); })
      .then(function () { self._starting = null; })
      .catch(function (e) { self._starting = null; throw e; });
    return this._starting;
  }

  /** Terminate the helper; do not auto-restart. */
  stop() {
    this._stopping = true;
    if (this._restartTimer) { clearTimeout(this._restartTimer); this._restartTimer = null; }
    if (this._stableTimer) { clearTimeout(this._stableTimer); this._stableTimer = null; }
    const p = this.proc;
    this._rejectAll(new Error('helper stopped'));
    if (p) {
      try { this._send({ cmd: 'quit' }); } catch (e) { /* ignore */ }
      try { if (p.stdin) p.stdin.end(); } catch (e) { /* ignore */ }
      setTimeout(function () { try { p.kill(); } catch (e) { /* ignore */ } }, 500);
    }
  }

  _ensureCompiled() {
    return new Promise(function (resolve, reject) {
      if (fs.existsSync(BIN_HELPER)) { resolve(); return; }
      // Compile-on-missing only helps a dev checkout; a packaged app always ships
      // the helper prebuilt, so a missing binary + missing build script is fatal.
      if (!fs.existsSync(HELPER_BUILD)) {
        reject(new Error('helper missing at ' + BIN_HELPER + ' and no build script at ' + HELPER_BUILD));
        return;
      }
      const runner = IS_MAC ? '/bin/bash' : (process.env.ComSpec || 'cmd.exe');
      const argv = IS_MAC ? [HELPER_BUILD] : ['/c', HELPER_BUILD];
      log.info('helper: ' + path.basename(BIN_HELPER) + ' missing — compiling via ' + path.basename(HELPER_BUILD));
      execFile(runner, argv, { windowsHide: true, cwd: path.dirname(HELPER_BUILD) },
        function (err, stdout, stderr) {
          if (err) {
            const detail = (stderr && String(stderr).trim()) || (stdout && String(stdout).trim()) || err.message;
            reject(new Error('helper compile failed: ' + detail));
            return;
          }
          if (!fs.existsSync(BIN_HELPER)) {
            reject(new Error('helper compile produced no binary at ' + BIN_HELPER));
            return;
          }
          log.info('helper: compiled ' + path.basename(BIN_HELPER));
          resolve();
        });
    });
  }

  _spawn() {
    const self = this;
    return new Promise(function (resolve, reject) {
      let child;
      try {
        child = spawn(BIN_HELPER, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      } catch (e) {
        reject(e);
        return;
      }

      self.proc = child;
      self.ready = false;
      self._buf = '';

      let settled = false;
      const readyTimer = setTimeout(function () {
        if (settled) return;
        settled = true;
        self._onReadyOnce = null;
        try { child.kill(); } catch (e) { /* ignore */ }
        reject(new Error('helper ready timeout'));
      }, READY_TIMEOUT_MS);

      self._onReadyOnce = function () {
        if (settled) return;
        settled = true;
        clearTimeout(readyTimer);
        resolve();
      };

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', function (chunk) { self._onStdout(chunk); });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', function (d) {
        const s = String(d).trim();
        if (s) log.warn('helper stderr: ' + s);
      });
      child.on('error', function (err) {
        log.error('helper: process error', err);
        if (!settled) {
          settled = true;
          clearTimeout(readyTimer);
          self._onReadyOnce = null;
          reject(err);
        }
      });
      child.on('exit', function (code, signal) { self._onExit(code, signal); });
    });
  }

  _onExit(code, signal) {
    if (this._stableTimer) { clearTimeout(this._stableTimer); this._stableTimer = null; }
    const wasStopping = this._stopping;
    this.proc = null;
    this.ready = false;
    this._onReadyOnce = null;
    this._rejectAll(new Error('helper exited'));

    if (wasStopping) {
      log.info('helper: stopped (code=' + code + ', signal=' + signal + ')');
      return;
    }
    log.warn('helper: exited unexpectedly (code=' + code + ', signal=' + signal + ')');
    this.emit('crash', { code: code, signal: signal });
    this._scheduleRestart();
  }

  _scheduleRestart() {
    const self = this;
    if (this._restartTimer || this._stopping) return;
    if (this._restartCount >= MAX_RAPID_RESTARTS) {
      log.error('helper: gave up after ' + this._restartCount + ' rapid restarts — hotkey unavailable');
      this.emit('unavailable', { restarts: this._restartCount });
      return;
    }
    this._restartCount += 1;
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, this._restartCount - 1));
    log.warn('helper: restart #' + this._restartCount + ' in ' + delay + 'ms');
    this._restartTimer = setTimeout(function () {
      self._restartTimer = null;
      if (self._stopping) return;
      self._spawn().then(function () {
        log.info('helper: restarted');
      }).catch(function (e) {
        log.error('helper: restart failed: ' + (e && e.message));
        if (!self._stopping) self._scheduleRestart();
      });
    }, delay);
  }

  // ---- stdout parsing -------------------------------------------------

  _onStdout(chunk) {
    this._buf += chunk;
    let idx;
    while ((idx = this._buf.indexOf('\n')) >= 0) {
      let line = this._buf.slice(0, idx);
      this._buf = this._buf.slice(idx + 1);
      if (line.length && line.charCodeAt(line.length - 1) === 13) {
        line = line.slice(0, -1); // strip trailing \r
      }
      if (line.length) this._onLine(line);
    }
  }

  _onLine(line) {
    let obj;
    try { obj = JSON.parse(line); } catch (e) { return; }
    if (!obj || typeof obj.evt !== 'string') return;

    switch (obj.evt) {
      case 'ready':
        this.ready = true;
        this._armStableTimer();
        // Re-assert the watched set after a (re)spawn.
        if (this.watched && this.watched.length) {
          this._send({ cmd: 'watch', vks: this.watched });
        }
        this.emit('ready');
        if (this._onReadyOnce) { const cb = this._onReadyOnce; this._onReadyOnce = null; cb(); }
        break;
      case 'pong':
        this._resolveNext(this._pingQ, true);
        break;
      case 'key':
        this.emit('key', {
          vk: obj.vk | 0,
          down: !!obj.down,
          held: Array.isArray(obj.held) ? obj.held.map(function (v) { return v | 0; }) : null,
        });
        break;
      case 'captured': {
        const mods = [];
        if (Array.isArray(obj.mods)) {
          for (let mi = 0; mi < obj.mods.length; mi++) {
            const mv = obj.mods[mi] | 0;
            if (mv > 0 && mods.indexOf(mv) === -1) mods.push(mv);
          }
        }
        this.emit('captured', {
          vk: obj.vk | 0,
          name: (typeof obj.name === 'string' ? obj.name : ''),
          mods: mods,
        });
        break;
      }
      case 'selection':
        this._resolveNext(this._grabQ, {
          ok: !!obj.ok,
          text: (typeof obj.text === 'string' ? obj.text : null),
          err: (obj.err == null ? null : String(obj.err)),
        });
        break;
      case 'foreground': {
        const info = { exe: (obj.exe || ''), title: (obj.title || '') };
        this._resolveNext(this._fgQ, info);
        this.emit('foreground', info);
        break;
      }
      case 'log':
        if (obj.msg != null) {
          log.warn('helper: ' + obj.msg);
          this.emit('log', String(obj.msg));
        }
        break;
      default:
        break;
    }
  }

  _armStableTimer() {
    const self = this;
    if (this._stableTimer) clearTimeout(this._stableTimer);
    this._stableTimer = setTimeout(function () {
      self._restartCount = 0;
      self._stableTimer = null;
    }, STABLE_MS);
  }

  // ---- commands -------------------------------------------------------

  /** Replace the FULL watched VK set. @param {number[]} vks */
  watch(vks) {
    this.watched = Array.isArray(vks) ? vks.slice() : [];
    this._send({ cmd: 'watch', vks: this.watched });
  }

  /** One-shot: report the next keydown (any VK) as a 'captured' event. */
  capture() {
    this._send({ cmd: 'capture' });
  }

  /** Disarm a pending one-shot capture (rebind abandoned/timed out). */
  captureCancel() {
    this._send({ cmd: 'capture-cancel' });
  }

  /**
   * Copy the current selection without disturbing the user's clipboard.
   * Resolves {ok, text, err}; err 'no-selection' when nothing was selected.
   * @param {number} [timeoutMs] how long the helper polls for the copy to land
   */
  grabSelection(timeoutMs) {
    const t = (timeoutMs == null) ? 600 : (timeoutMs | 0);
    return this._request(this._grabQ, { cmd: 'grab', timeoutMs: t }, t + GRAB_TIMEOUT_PAD_MS);
  }

  /** @returns {Promise<{exe:string,title:string}>} */
  foreground() {
    return this._request(this._fgQ, { cmd: 'foreground' }, FOREGROUND_TIMEOUT_MS);
  }

  /** @returns {Promise<boolean>} true if the helper answered 'pong' */
  ping() {
    return this._request(this._pingQ, { cmd: 'ping' }, PING_TIMEOUT_MS)
      .then(function () { return true; });
  }

  // ---- plumbing -------------------------------------------------------

  _send(obj) {
    const p = this.proc;
    if (!p || !p.stdin || !p.stdin.writable) return false;
    try {
      p.stdin.write(JSON.stringify(obj) + '\n');
      return true;
    } catch (e) {
      return false;
    }
  }

  _request(queue, obj, timeoutMs) {
    const self = this;
    return new Promise(function (resolve, reject) {
      const pending = { resolve: resolve, reject: reject, timer: null };
      pending.timer = setTimeout(function () {
        const idx = queue.indexOf(pending);
        if (idx >= 0) queue.splice(idx, 1);
        reject(new Error('helper timeout for ' + obj.cmd));
      }, timeoutMs);
      queue.push(pending);
      if (!self._send(obj)) {
        clearTimeout(pending.timer);
        const idx = queue.indexOf(pending);
        if (idx >= 0) queue.splice(idx, 1);
        reject(new Error('helper not running'));
      }
    });
  }

  _resolveNext(queue, value) {
    const pending = queue.shift();
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve(value);
    }
  }

  _rejectAll(err) {
    const queues = [this._pingQ, this._grabQ, this._fgQ];
    for (let q = 0; q < queues.length; q++) {
      const queue = queues[q];
      while (queue.length) {
        const pending = queue.shift();
        clearTimeout(pending.timer);
        try { pending.reject(err); } catch (e) { /* ignore */ }
      }
    }
  }
}

module.exports = new Helper();
