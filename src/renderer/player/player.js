'use strict';

/* The floating player. Receives per-sentence WAVs from main, plays them in
 * order through one <audio> element (preservesPitch makes the speed control a
 * time-stretch, not a chipmunk), reports position back, and stays draggable
 * and tiny. All state lives here; main owns the session, we own playback. */

(function () {
  const audio = document.getElementById('audio');
  const wave = document.getElementById('wave');
  const sourceEl = document.getElementById('source');
  const lineEl = document.getElementById('line');
  const fillEl = document.getElementById('progress-fill');
  const btnToggle = document.getElementById('toggle');
  const btnPrev = document.getElementById('prev');
  const btnNext = document.getElementById('next');
  const btnSpeed = document.getElementById('speed');
  const btnClose = document.getElementById('close');

  const SPEEDS = [75, 100, 125, 150, 175, 200, 250, 300];

  let chunks = [];
  let urls = new Map();      // idx -> object URL
  let idx = 0;
  let hasSession = false;
  let waitingFor = -1;       // chunk we want to play but do not have yet
  let speedPct = 100;
  let flashTimer = null;

  // ---- helpers ---------------------------------------------------------

  function friendlySource(from) {
    if (!from) return 'Hear Me Out';
    if (from.origin === 'reader') return 'Reading your text';
    if (from.origin === 'smoke') return 'Self test';
    let exe = (from.exe || '').replace(/\.exe$/i, '');
    if (!exe) return 'Reading your selection';
    exe = exe.charAt(0).toUpperCase() + exe.slice(1);
    return 'Reading from ' + exe;
  }

  function setSpeaking(on) {
    if (on) wave.classList.add('speaking');
    else wave.classList.remove('speaking');
    btnToggle.innerHTML = on ? '&#10074;&#10074;' : '&#9654;';
  }

  function setLine(text) {
    lineEl.textContent = text || ' ';
  }

  function setProgress() {
    const pct = chunks.length ? Math.round(((idx + 1) / chunks.length) * 100) : 0;
    fillEl.style.width = pct + '%';
  }

  function applySpeed() {
    audio.playbackRate = speedPct / 100;
    try { audio.preservesPitch = true; } catch (e) { /* older engines */ }
    btnSpeed.textContent = (speedPct / 100) + '×';
  }

  function clearUrls() {
    urls.forEach(function (u) { URL.revokeObjectURL(u); });
    urls = new Map();
  }

  // ---- playback core ---------------------------------------------------

  function playIdx(i) {
    if (i < 0) i = 0;
    if (i >= chunks.length) { end(); return; }
    idx = i;
    setLine(chunks[i]);
    setProgress();
    window.hmo.report({ evt: 'pos', idx: i });

    const u = urls.get(i);
    if (!u) {
      waitingFor = i;
      setSpeaking(false);
      setLine(chunks[i]);
      window.hmo.need(i);
      return;
    }
    waitingFor = -1;
    audio.src = u;
    applySpeed();
    audio.play().then(function () {
      setSpeaking(true);
    }).catch(function () {
      // Autoplay cannot be blocked for an app window, but never wedge: skip on.
      next();
    });
  }

  function next() {
    if (idx + 1 < chunks.length) playIdx(idx + 1);
    else end();
  }

  function prev() {
    playIdx(Math.max(0, idx - 1));
  }

  function end() {
    setSpeaking(false);
    hasSession = false;
    audio.pause();
    clearUrls();
    window.hmo.report({ evt: 'ended' });
  }

  function stopAll() {
    hasSession = false;
    audio.pause();
    clearUrls();
    setSpeaking(false);
    window.hmo.stop();
  }

  function togglePause() {
    if (!hasSession) return;
    if (audio.paused) {
      audio.play();
      setSpeaking(true);
      window.hmo.report({ evt: 'paused', paused: false });
    } else {
      audio.pause();
      setSpeaking(false);
      window.hmo.report({ evt: 'paused', paused: true });
    }
  }

  audio.addEventListener('ended', function () {
    if (hasSession) next();
  });

  // ---- events from main ------------------------------------------------

  window.hmo.onStart(function (payload) {
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
    chunks = payload.chunks || [];
    clearUrls();
    idx = 0;
    hasSession = true;
    waitingFor = 0;
    speedPct = payload.speedPct || 100;
    sourceEl.textContent = friendlySource(payload.from);
    setLine(chunks[0] || '');
    setProgress();
    applySpeed();
    setSpeaking(false); // dances once audio actually starts
  });

  window.hmo.onAudio(function (payload) {
    if (!hasSession) return;
    const blob = new Blob([payload.wav], { type: 'audio/wav' });
    const u = URL.createObjectURL(blob);
    urls.set(payload.idx, u);
    if (waitingFor === payload.idx) {
      playIdx(payload.idx);
    }
  });

  window.hmo.onStop(function () {
    hasSession = false;
    audio.pause();
    clearUrls();
    setSpeaking(false);
  });

  window.hmo.onCtl(function (msg) {
    const a = msg && msg.action;
    if (a === 'toggle' || a === 'pause' || a === 'resume') togglePause();
    else if (a === 'next') next();
    else if (a === 'prev') prev();
  });

  window.hmo.onFlash(function (msg) {
    sourceEl.textContent = 'Hear Me Out';
    setLine((msg && msg.msg) || '');
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      flashTimer = null;
      if (!hasSession) window.hmo.report({ evt: 'closed' });
    }, 2600);
  });

  window.hmo.onChunkError(function (payload) {
    // A sentence failed to synthesize: say so briefly, keep going.
    if (!hasSession) return;
    if (payload.idx === idx) next();
  });

  window.hmo.onSettingsChanged(function (s) {
    if (s && typeof s.speedPct === 'number' && s.speedPct !== speedPct) {
      speedPct = s.speedPct;
      applySpeed();
    }
  });

  // ---- controls --------------------------------------------------------

  btnToggle.addEventListener('click', togglePause);
  btnNext.addEventListener('click', function () { if (hasSession) next(); });
  btnPrev.addEventListener('click', function () { if (hasSession) prev(); });
  btnClose.addEventListener('click', stopAll);
  btnSpeed.addEventListener('click', function () {
    const at = SPEEDS.indexOf(speedPct);
    speedPct = SPEEDS[(at + 1) % SPEEDS.length];
    applySpeed();
    window.hmo.setSpeed(speedPct);
  });

  window.addEventListener('keydown', function (e) {
    if (e.key === ' ') { e.preventDefault(); togglePause(); }
    else if (e.key === 'Escape') stopAll();
    else if (e.key === 'ArrowRight') { if (hasSession) next(); }
    else if (e.key === 'ArrowLeft') { if (hasSession) prev(); }
  });

  // Boot: pick up the configured speed, then announce ourselves — if a session
  // is already live (window reloaded mid-read), main replays it.
  window.hmo.getSettings().then(function (s) {
    speedPct = s.speedPct || 100;
    applySpeed();
  });
  window.hmo.hello();
})();
