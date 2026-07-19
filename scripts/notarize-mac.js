'use strict';

/**
 * electron-builder afterSign, mac lanes only: get a notarization ticket
 * STAPLED to each app before the dmg/zip wrap it, so Gatekeeper says yes
 * offline too (the airplane-mode test applies to install day).
 *
 * electron-builder already notarizes when APPLE_API_KEY / APPLE_API_KEY_ID /
 * APPLE_API_ISSUER are exported — what it does not do is staple. So: try the
 * staple first (free when the ticket is already there); only if that fails,
 * submit ourselves with notarytool --wait and staple after. A failed
 * submission fails the build — `xcrun notarytool log <id>` has Apple's
 * reasons.
 *
 * No credentials in the environment: say so and step aside — signing alone
 * still yields a runnable app behind the one-time quarantine clear.
 * Zero dependencies on purpose: ditto, notarytool, stapler.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function staple(appPath, loud) {
  try {
    execFileSync('xcrun', ['stapler', 'staple', appPath], { stdio: loud ? 'inherit' : 'pipe' });
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = async function (context) {
  if (context.electronPlatformName !== 'darwin') return;

  const keyPath = process.env.APPLE_API_KEY;
  const keyId = process.env.APPLE_API_KEY_ID;
  const issuer = process.env.APPLE_API_ISSUER;
  if (!keyPath || !keyId || !issuer) {
    console.log('  • skipped notarization  reason=set APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER to enable');
    return;
  }

  const apps = fs.readdirSync(context.appOutDir).filter(function (n) { return n.endsWith('.app'); });
  for (let i = 0; i < apps.length; i++) {
    const appPath = path.join(context.appOutDir, apps[i]);

    if (staple(appPath, false)) {
      console.log('  • stapled         file=' + apps[i] + ' (ticket from the electron-builder submission)');
      continue;
    }

    const zipPath = appPath + '.notarize.zip';
    console.log('  • notarizing      file=' + apps[i] + ' (Apple usually answers in a few minutes)');
    execFileSync('ditto', ['-c', '-k', '--keepParent', appPath, zipPath]);
    try {
      execFileSync('xcrun', [
        'notarytool', 'submit', zipPath,
        '--key', keyPath, '--key-id', keyId, '--issuer', issuer,
        '--wait',
      ], { stdio: 'inherit' });
    } finally {
      fs.rmSync(zipPath, { force: true });
    }
    if (!staple(appPath, true)) throw new Error('stapler failed for ' + apps[i]);
    console.log('  • notarized + stapled  file=' + apps[i]);
  }
};
