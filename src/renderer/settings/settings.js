'use strict';

(function () {
  const hotkeyLabel = document.getElementById('hotkey-label');
  const btnRebind = document.getElementById('rebind');
  const voiceSel = document.getElementById('voice');
  const btnPreview = document.getElementById('preview');
  const speed = document.getElementById('speed');
  const speedLabel = document.getElementById('speed-label');
  const login = document.getElementById('login');
  const modelLine = document.getElementById('model-line');
  const versionEl = document.getElementById('version');
  const audio = document.getElementById('audio');

  const MOD_NAMES = { 16: 'Shift', 17: 'Ctrl', 18: 'Alt', 91: 'Win', 92: 'Win', 160: 'Shift', 161: 'Shift', 162: 'Ctrl', 163: 'Ctrl', 164: 'Alt', 165: 'Alt' };

  let capturing = false;
  let previewUrl = null;

  function hotkeyText(hk) {
    if (!hk) return '?';
    const parts = [];
    const mods = hk.mods || [];
    for (let i = 0; i < mods.length; i++) parts.push(MOD_NAMES[mods[i]] || ('VK' + mods[i]));
    parts.push(hk.name || ('VK' + hk.vk));
    return parts.join(' + ');
  }

  function speedText(pct) {
    return (pct / 100).toFixed(2).replace(/0$/, '').replace(/\.$/, '') + '×';
  }

  function labelForVoice(v) {
    const lang = v.lang === 'en-us' ? 'American' : v.lang === 'en-gb' ? 'British' : (v.lang || '');
    const g = v.gender ? v.gender.toLowerCase() : '';
    const grade = v.grade ? ' · ' + v.grade : '';
    return v.name + ' — ' + [lang, g].filter(Boolean).join(' ') + grade;
  }

  async function loadVoices(selectedId) {
    const voices = await window.hmo.voices();
    voiceSel.innerHTML = '';
    if (!voices.length) {
      const opt = document.createElement('option');
      opt.textContent = 'Voices load in a moment…';
      voiceSel.appendChild(opt);
      setTimeout(function () { loadVoices(selectedId); }, 1500);
      return;
    }
    voices.sort(function (a, b) { return (a.lang + a.name).localeCompare(b.lang + b.name); });
    for (let i = 0; i < voices.length; i++) {
      const opt = document.createElement('option');
      opt.value = voices[i].id;
      opt.textContent = labelForVoice(voices[i]);
      voiceSel.appendChild(opt);
    }
    if (selectedId) voiceSel.value = selectedId;
  }

  // ---- hotkey rebind ---------------------------------------------------

  btnRebind.addEventListener('click', async function () {
    if (capturing) {
      capturing = false;
      await window.hmo.cancelCapture();
      btnRebind.textContent = 'Change…';
      hotkeyLabel.classList.remove('listening');
      const s = await window.hmo.getSettings();
      hotkeyLabel.textContent = hotkeyText(s.hotkey);
      return;
    }
    capturing = true;
    btnRebind.textContent = 'Cancel';
    hotkeyLabel.textContent = 'press keys…';
    hotkeyLabel.classList.add('listening');
    const cap = await window.hmo.captureHotkey();
    capturing = false;
    btnRebind.textContent = 'Change…';
    hotkeyLabel.classList.remove('listening');
    if (cap && cap.vk) {
      const hk = { vk: cap.vk, name: cap.name || ('VK' + cap.vk), mods: cap.mods || [] };
      await window.hmo.setSettings({ hotkey: hk });
      hotkeyLabel.textContent = hotkeyText(hk);
    } else {
      const s = await window.hmo.getSettings();
      hotkeyLabel.textContent = hotkeyText(s.hotkey);
    }
  });

  // ---- voice + preview -------------------------------------------------

  voiceSel.addEventListener('change', function () {
    window.hmo.setSettings({ voice: voiceSel.value });
  });

  btnPreview.addEventListener('click', async function () {
    btnPreview.disabled = true;
    try {
      const wav = await window.hmo.sample(voiceSel.value);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
      audio.src = previewUrl;
      await audio.play();
    } catch (e) { /* engine still warming */ }
    btnPreview.disabled = false;
  });

  // ---- speed / login ---------------------------------------------------

  speed.addEventListener('input', function () {
    speedLabel.textContent = speedText(parseInt(speed.value, 10));
  });
  speed.addEventListener('change', function () {
    window.hmo.setSettings({ speedPct: parseInt(speed.value, 10) });
  });

  login.addEventListener('change', function () {
    window.hmo.setSettings({ launchAtLogin: login.checked });
  });

  // ---- boot ------------------------------------------------------------

  window.hmo.getSettings().then(function (s) {
    hotkeyLabel.textContent = hotkeyText(s.hotkey);
    speed.value = s.speedPct || 100;
    speedLabel.textContent = speedText(s.speedPct || 100);
    login.checked = !!s.launchAtLogin;
    loadVoices(s.voice);
  });

  window.hmo.modelInfo().then(function (m) {
    if (m.ready && m.cache) {
      modelLine.textContent = 'Kokoro-82M (Apache-2.0), loaded from ' + m.cache.cacheDir;
    } else {
      modelLine.textContent = 'Kokoro-82M — still warming up…';
      setTimeout(function () {
        window.hmo.modelInfo().then(function (m2) {
          if (m2.ready && m2.cache) modelLine.textContent = 'Kokoro-82M (Apache-2.0), loaded from ' + m2.cache.cacheDir;
        });
      }, 4000);
    }
  });

  window.hmo.version().then(function (v) {
    versionEl.textContent = 'Hear Me Out v' + v;
  });

  window.hmo.onSettingsChanged(function (s) {
    if (!capturing) hotkeyLabel.textContent = hotkeyText(s.hotkey);
    if (voiceSel.value !== s.voice) voiceSel.value = s.voice;
    speed.value = s.speedPct || 100;
    speedLabel.textContent = speedText(s.speedPct || 100);
    login.checked = !!s.launchAtLogin;
  });
})();
