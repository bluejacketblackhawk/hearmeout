'use strict';

/* The reader: paste or drop text, listen with follow-along highlighting,
 * export the whole thing as audio. While a session started here is live, the
 * textarea swaps for a span-per-sentence view driven by session:pos events. */

(function () {
  const input = document.getElementById('input');
  const follow = document.getElementById('follow');
  const voiceSel = document.getElementById('voice');
  const speedSel = document.getElementById('speed');
  const btnRead = document.getElementById('read');
  const btnExport = document.getElementById('export');
  const btnSettings = document.getElementById('settings');
  const statsEl = document.getElementById('stats');
  const statusEl = document.getElementById('status');
  const dropHint = document.getElementById('drop-hint');

  let listening = false;   // a session started from THIS window is live
  let exporting = false;
  let spans = [];

  // ---- stats -----------------------------------------------------------

  function updateStats() {
    const t = input.value;
    const words = (t.match(/\S+/g) || []).length;
    if (!words) { statsEl.textContent = ''; return; }
    // ~170 wpm is Kokoro's natural clip at 1×.
    const mins = Math.max(1, Math.round(words / 170));
    statsEl.textContent = words.toLocaleString() + ' words · about ' + mins + ' min of listening';
  }
  input.addEventListener('input', updateStats);

  function setStatus(s) { statusEl.textContent = s || ''; }

  // ---- voices ----------------------------------------------------------

  function labelForVoice(v) {
    const lang = v.lang === 'en-us' ? 'American' : v.lang === 'en-gb' ? 'British' : (v.lang || '');
    const g = v.gender ? v.gender.toLowerCase() : '';
    return v.name + ' — ' + [lang, g].filter(Boolean).join(' ');
  }

  async function loadVoices(selectedId) {
    const voices = await window.hmo.voices();
    voiceSel.innerHTML = '';
    // Model may still be warming: voices() is empty until then.
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

  voiceSel.addEventListener('change', function () {
    window.hmo.setSettings({ voice: voiceSel.value });
  });
  speedSel.addEventListener('change', function () {
    window.hmo.setSettings({ speedPct: parseInt(speedSel.value, 10) || 100 });
  });

  // ---- listen / follow-along ------------------------------------------

  function buildFollow(text, offsets) {
    follow.innerHTML = '';
    spans = [];
    let cursor = 0;
    for (let i = 0; i < offsets.length; i++) {
      const o = offsets[i];
      if (o.start > cursor) {
        follow.appendChild(document.createTextNode(text.slice(cursor, o.start)));
      }
      const sp = document.createElement('span');
      sp.className = 'sent';
      sp.textContent = text.slice(o.start, o.end);
      follow.appendChild(sp);
      spans.push(sp);
      cursor = o.end;
    }
    if (cursor < text.length) {
      follow.appendChild(document.createTextNode(text.slice(cursor)));
    }
  }

  function enterListening(offsets) {
    listening = true;
    buildFollow(input.value, offsets);
    input.hidden = true;
    follow.hidden = false;
    btnRead.textContent = 'Stop';
    setStatus('Listening — the floating player has the controls.');
  }

  function exitListening() {
    listening = false;
    input.hidden = false;
    follow.hidden = true;
    spans = [];
    btnRead.textContent = 'Listen';
    setStatus('');
  }

  btnRead.addEventListener('click', async function () {
    if (listening) {
      await window.hmo.stop();
      exitListening();
      return;
    }
    const text = input.value;
    if (!text.trim()) { setStatus('Nothing to read yet — paste some text first.'); return; }
    const r = await window.hmo.read(text);
    if (!r.ok) setStatus(r.err === 'empty' ? 'Nothing readable in that text.' : 'Could not start: ' + r.err);
  });

  window.hmo.onSessionStart(function (payload) {
    // Only mirror sessions that came from this window's text.
    if (payload.origin === 'reader') enterListening(payload.offsets || []);
    else if (listening) exitListening();
  });

  window.hmo.onPos(function (p) {
    if (!listening) return;
    for (let i = 0; i < spans.length; i++) spans[i].classList.remove('active');
    const sp = spans[p.idx];
    if (sp) {
      sp.classList.add('active');
      sp.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });

  window.hmo.onSessionStop(function () {
    if (listening) exitListening();
  });

  // ---- export ----------------------------------------------------------

  btnExport.addEventListener('click', async function () {
    if (exporting) return;
    const text = input.value;
    if (!text.trim()) { setStatus('Nothing to export yet.'); return; }
    exporting = true;
    btnExport.disabled = true;
    setStatus('Rendering audio…');
    try {
      const r = await window.hmo.exportWav(text);
      if (r.ok) {
        const mins = Math.floor(r.seconds / 60);
        const secs = r.seconds % 60;
        setStatus('Saved ' + (mins ? mins + 'm ' : '') + secs + 's of audio.');
      } else if (r.err !== 'canceled') {
        setStatus('Export failed: ' + r.err);
      } else {
        setStatus('');
      }
    } catch (e) {
      setStatus('Export failed.');
    }
    exporting = false;
    btnExport.disabled = false;
  });

  window.hmo.onExportProgress(function (p) {
    if (exporting) setStatus('Rendering audio… sentence ' + p.done + ' of ' + p.total);
  });

  // ---- drop a file -----------------------------------------------------

  document.addEventListener('dragover', function (e) {
    e.preventDefault();
    dropHint.hidden = false;
  });
  document.addEventListener('dragleave', function (e) {
    if (e.relatedTarget === null) dropHint.hidden = true;
  });
  document.addEventListener('drop', async function (e) {
    e.preventDefault();
    dropHint.hidden = true;
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    if (!/\.(txt|md|markdown|text)$/i.test(f.name)) {
      setStatus('Only .txt and .md files for now.');
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setStatus('That file is over 5 MB — paste the part you want instead.');
      return;
    }
    input.value = await f.text();
    updateStats();
    setStatus('Loaded ' + f.name + ' — press Listen.');
  });

  // ---- misc ------------------------------------------------------------

  btnSettings.addEventListener('click', function () { window.hmo.openSettings(); });

  window.hmo.onSettingsChanged(function (s) {
    if (s.voice && voiceSel.value !== s.voice) voiceSel.value = s.voice;
    const sp = String(s.speedPct || 100);
    if (speedSel.value !== sp) speedSel.value = sp;
  });

  // Boot.
  window.hmo.getSettings().then(function (s) {
    speedSel.value = String(s.speedPct || 100);
    loadVoices(s.voice);
  });
  updateStats();
})();
