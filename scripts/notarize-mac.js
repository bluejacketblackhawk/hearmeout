'use strict';

/**
 * electron-builder afterSign, mac lanes only: notarize + staple each app,
 * so the dmg/zip built right after carry a ticket that works offline (the
 * airplane-mode test applies to install day too).
 *
 * Credential-gated so `npm run dist` still works on a machine with no Apple
 * setup: export APPLE_API_KEY (path to the App Store Connect .p8),
 * APPLE_API_KEY_ID and APPLE_API_ISSUER, or this hook says what is missing
 * and steps aside — signing alone still yields a runnable app behind the
 * one-time quarantine clear.
 *
 * Zero dependencies on purpose: ditto zips the app, xcrun notarytool submits
 * and waits (a failed submission fails the build — run `xcrun notarytool log`
 * with the printed id to see Apple's reasons), xcrun stapler pins the ticket.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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
    execFileSync('xcrun', ['stapler', 'staple', appPath], { stdio: 'inherit' });
    console.log('  • notarized + stapled  file=' + apps[i]);
  }
};
