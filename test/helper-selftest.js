'use strict';

// Helper selftest: spawn the real native helper, verify ready + ping +
// watch + a selection grab against our own clipboard. The grab path is tested
// honestly: we put a known string on the clipboard, ask for a grab with no
// selection anywhere (expect no-selection AND the clipboard restored).
// Run with: npm run test:helper   (needs an interactive desktop session)

const helper = require('../src/main/helper');

const IS_MAC = process.platform === 'darwin';

function fail(msg) {
  console.error('[helper-selftest] FAIL: ' + msg);
  process.exit(1);
}

function setClipboard(cp, text) {
  if (IS_MAC) cp.execSync('pbcopy', { input: text });
  else cp.execSync('powershell -NoProfile -Command "Set-Clipboard -Value \'' + text + '\'"');
}

function getClipboard(cp) {
  if (IS_MAC) return cp.execSync('pbpaste').toString().trim();
  return cp.execSync('powershell -NoProfile -Command "Get-Clipboard"').toString().trim();
}

async function main() {
  await helper.start();
  console.log('[helper-selftest] ready');

  const pong = await helper.ping();
  if (!pong) fail('no pong');
  console.log('[helper-selftest] ping ok');

  helper.watch([0x77]); // F8 — just proving the command round-trips
  await helper.ping();  // watch has no reply; a following ping proves liveness
  console.log('[helper-selftest] watch ok');

  // Selection grab with nothing selected: expect ok:false / no-selection,
  // and expect our sentinel clipboard text to survive the round trip.
  const sentinel = 'hearmeout-selftest-' + Date.now();
  const cp = require('child_process');
  setClipboard(cp, sentinel);

  const res = await helper.grabSelection(500);
  if (res.ok) {
    // Something WAS selected somewhere (possible on a busy desktop) — accept,
    // but say so. The restore check below still applies.
    console.log('[helper-selftest] grab returned text (desktop had a live selection); len=' + (res.text || '').length);
  } else if (res.err !== 'no-selection') {
    fail('grab failed unexpectedly: ' + res.err);
  } else {
    console.log('[helper-selftest] grab: no-selection (expected)');
  }

  const back = getClipboard(cp);
  if (back !== sentinel) fail('clipboard not restored: got "' + back + '"');
  console.log('[helper-selftest] clipboard restored intact');

  helper.stop();
  console.log('[helper-selftest] ok');
  process.exit(0);
}

main().catch(function (e) { fail(e && e.stack || e); });
