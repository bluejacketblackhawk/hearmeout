'use strict';

// Helper selftest: spawn the real HearMeOutHelper.exe, verify ready + ping +
// watch + a selection grab against our own clipboard. The grab path is tested
// honestly: we put a known string on the clipboard, ask for a grab with no
// selection anywhere (expect no-selection AND the clipboard restored).
// Run with: npm run test:helper   (needs an interactive desktop session)

const helper = require('../src/main/helper');

function fail(msg) {
  console.error('[helper-selftest] FAIL: ' + msg);
  process.exit(1);
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
  cp.execSync('powershell -NoProfile -Command "Set-Clipboard -Value \'' + sentinel + '\'"');

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

  const back = cp.execSync('powershell -NoProfile -Command "Get-Clipboard"').toString().trim();
  if (back !== sentinel) fail('clipboard not restored: got "' + back + '"');
  console.log('[helper-selftest] clipboard restored intact');

  helper.stop();
  console.log('[helper-selftest] ok');
  process.exit(0);
}

main().catch(function (e) { fail(e && e.stack || e); });
