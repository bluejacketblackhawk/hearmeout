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

  // macOS permissions card. Stays hidden on Windows (perms() resolves null)
  // and on a mac that already granted both; once shown it sticks around so
  // the dots can turn green under the user's eyes.
  const permsCard = document.getElementById('perms');
  const permEls = {
    input: { dot: document.getElementById('perm-input-dot'), btn: document.getElementById('perm-input-btn') },
    ax: { dot: document.getElementById('perm-ax-dot'), btn: document.getElementById('perm-ax-btn') },
  };

  function renderPerms(p) {
    if (!p || !p.input) return;
    const allGranted = (p.input === 'granted' && p.ax === 'granted');
    if (permsCard.hidden && !allGranted) permsCard.hidden = false;
    const keys = ['input', 'ax'];
    for (let i = 0; i < keys.length; i++) {
      const ok = (p[keys[i]] === 'granted');
      permEls[keys[i]].dot.classList.toggle('ready', ok);
      permEls[keys[i]].btn.hidden = ok;
    }
  }

  function wireGrant(which) {
    permEls[which].btn.addEventListener('click', async function () {
      permEls[which].btn.disabled = true;
      try { renderPerms(await window.hmo.permsGrant(which)); } catch (e) { /* helper down */ }
      permEls[which].btn.disabled = false;
    });
  }
  wireGrant('input');
  wireGrant('ax');

  window.hmo.perms().then(renderPerms, function () { /* no perms channel here */ });
  window.hmo.onPerms(renderPerms);

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
