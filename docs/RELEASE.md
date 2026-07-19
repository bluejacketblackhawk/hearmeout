# Cutting a release

Two lanes, one release. The Mac builds and uploads its four artifacts to a
draft; the PC adds the Windows two and publishes. Nothing goes live until the
last step, and every artifact gets verified from its shipping bytes first —
never from the build tree alone.

## Mac lane (arm64 + x64)

1. `npm ci && npm run setup`, then the trio: `npm test`,
   `npm run test:helper`, `npm run smoke`.
2. Signed + notarized dist — needs the Developer ID identity in the keychain
   and the App Store Connect key in the env (names in docs/MAC-PORT.md):

   ```
   APPLE_API_KEY=<path to the .p8> APPLE_API_KEY_ID=<key id> \
   APPLE_API_ISSUER=<issuer uuid> npm run dist
   ```

3. Verify what will actually ship: unzip each zip and mount each dmg, then
   `xcrun stapler validate` + `spctl -a -t exec` on the app inside — `spctl`
   must say Notarized Developer ID or it does not ship. Smoke the packaged
   app on arm64 natively and x64 under Rosetta 2 (`--smoke`).
4. `cd dist && shasum -a 256 HearMeOut-0.1.0-*.dmg HearMeOut-0.1.0-*.zip > SHA256SUMS.txt`
   (adjust version; blockmaps stay home).
5. Draft the release with the four artifacts + SHA256SUMS.txt:

   ```
   gh release create v<version> --draft --title "Hear Me Out <version>" \
     --notes-file <notes> dist/HearMeOut-<version>-*.dmg \
     dist/HearMeOut-<version>-*.zip dist/SHA256SUMS.txt
   ```

## PC lane (Windows x64) — closing the gap

1. Pull main. `npm ci && npm run setup`, then the same trio: `npm test`,
   `npm run test:helper`, `npm run smoke`.
2. `npm run dist` → `dist/HearMeOut-Setup-<version>.exe` (installer) and
   `dist/HearMeOut-<version>-win.zip` (portable).
3. The release gate is the product gesture, not just the smoke: install the
   exe on a real machine, select text in a browser, press F8, hear it, press
   Esc. Then check the clipboard survived.
4. Upload both and extend the checksums:

   ```
   gh release upload v<version> dist/HearMeOut-Setup-<version>.exe dist/HearMeOut-<version>-win.zip
   gh release download v<version> --pattern SHA256SUMS.txt
   sha256sum dist/HearMeOut-Setup-<version>.exe dist/HearMeOut-<version>-win.zip >> SHA256SUMS.txt
   gh release upload v<version> SHA256SUMS.txt --clobber
   ```

   (`certutil -hashfile <file> SHA256` if sha256sum isn't around; keep the
   `<hash>  <filename>` line shape.)
5. Publish — the only step that makes anything public, in this order:
   - if this release takes the repo public:
     `gh repo edit --visibility public --accept-visibility-change-consequences`
   - `gh release edit v<version> --draft=false`

## Rules

- No betas, no pre-release flags, no release-candidate theater. Every release
  is the real thing and we maintain as we go; if it is not ready to be the
  real thing, it does not get a tag.
- The draft is the handoff between lanes.
- Windows artifacts are unsigned (README says so, and why). Mac artifacts
  must be Notarized Developer ID.
- Version bumps land in package.json before the mac lane starts; the tag is
  born when the draft publishes.
