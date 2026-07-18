'use strict';

(function () {
  const dot = document.getElementById('model-dot');
  const text = document.getElementById('model-text');
  const bar = document.getElementById('model-bar');
  const fill = document.getElementById('model-fill');
  const hotkeyEl = document.getElementById('hotkey');
  const btnTry = document.getElementById('try');
  const btnReader = document.getElementById('reader');
  const btnStart = document.getElementById('start');
  const audio = document.getElementById('audio');

  let sampleUrl = null;

  function ready() {
    dot.classList.add('ready');
    bar.hidden = true;
    text.textContent = 'Voice ready. Everything runs on this machine from here on.';
    btnTry.disabled = false;
  }

  window.hmo.modelInfo().then(function (m) {
    if (m.ready) ready();
  });
  window.hmo.onModelReady(function () { ready(); });
  window.hmo.onModelProgress(function (p) {
    if (dot.classList.contains('ready')) return;
    bar.hidden = false;
    text.textContent = 'Downloading the voice (one time, ~90 MB)…';
    if (p && typeof p.progress === 'number') {
      fill.style.width = Math.max(2, Math.min(100, Math.round(p.progress))) + '%';
    }
  });

  window.hmo.getSettings().then(function (s) {
    if (s.hotkey && s.hotkey.name) hotkeyEl.textContent = s.hotkey.name;
  });

  btnTry.addEventListener('click', async function () {
    btnTry.disabled = true;
    try {
      const wav = await window.hmo.sample('af_heart');
      if (sampleUrl) URL.revokeObjectURL(sampleUrl);
      sampleUrl = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
      audio.src = sampleUrl;
      await audio.play();
    } catch (e) { /* not ready yet */ }
    btnTry.disabled = false;
  });

  btnReader.addEventListener('click', function () {
    window.hmo.done();
    window.hmo.openReader();
    window.close();
  });

  btnStart.addEventListener('click', function () {
    window.hmo.done();
    window.close();
  });
})();
