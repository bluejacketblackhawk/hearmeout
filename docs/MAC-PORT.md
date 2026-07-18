# macOS Port

Shipped: `native/HearMeOutHelper.swift` + `native/build-mac.sh` (universal
binary), mac paths in `config.js`/`setup.js`, the welcome permissions flow
(`perms` over the protocol, see CONTRACTS.md), `assets/HearMeOut.icns`, and
the dmg+zip lanes for arm64 + x64. The notes below are kept as the port's
design record.

The core (engine, session, chunker, windows, renderers, settings) is already
portable — no Win32 outside `native/` and `src/main/config.js`. The port is
one Swift helper plus packaging.

## HearMeOutHelper.swift (the twin)

Same JSON-lines stdio protocol (docs/CONTRACTS.md). Implementation map:

| Windows | macOS |
|---|---|
| `WH_KEYBOARD_LL` hook | `CGEvent.tapCreate` (`.listenOnly`) or `NSEvent.addGlobalMonitorForEvents` — needs Input Monitoring TCC |
| `SendInput` Ctrl+C | `CGEvent(keyboardEventSource:)` Cmd+C post — needs Accessibility TCC |
| `Clipboard` (STA) | `NSPasteboard.general` with `changeCount` polling (no clear needed — changeCount detects the copy landing) |
| `GetForegroundWindow` | `NSWorkspace.shared.frontmostApplication` |

Better-than-Windows option: try the Accessibility API first
(`AXUIElementCopyAttributeValue(kAXSelectedTextAttribute)`) and fall back to
the Cmd+C clipboard dance only when the app exposes nothing. Zero clipboard
disturbance in the happy path.

Permissions UX: mirror saysomething's welcome flow — `perms` events over the
protocol, welcome screen shows Input Monitoring + Accessibility grant status
with deep links to System Settings panes.

## Packaging

- `native/build-mac.sh`: `swiftc -O HearMeOutHelper.swift -o ../bin/helper/HearMeOutHelper`
- electron-builder mac config already present in package.json (dmg + zip,
  arm64 + x64 — BOTH ship; "the iMacs/x64s" are first-class). Generate
  `assets/HearMeOut.icns` from `HearMeOut.png` (`iconutil`); hardened runtime
  on.
- Signing: `npm run dist` auto-discovers the Developer ID Application
  identity (team 7Y39A984XL) and signs everything, helper included.
  Notarization + stapling live in `scripts/notarize-mac.js` (afterSign),
  gated on `APPLE_API_KEY` (path to the App Store Connect .p8),
  `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` — without them the hook steps aside
  and the unsigned-era `xattr -dr com.apple.quarantine` instructions still
  apply to what comes out.
- Packaging excludes are ALREADY platform-scoped on main: `build.win.files`
  strips linux/darwin/arm64 onnxruntime binaries, `build.mac.files` strips
  linux/win32. Do not re-add platform excludes to the base `build.files`.
  Optional slimming: an afterPack hook may prune the non-target darwin arch
  (`onnxruntime-node/bin/napi-v3/darwin/<other-arch>`) from each mac build.

## Order of work

1. Swift helper speaking the protocol + selftest port (test/helper-selftest.js
   already runs anywhere node does).
2. `config.js` mac paths + `build-mac.sh`.
3. Welcome perms flow.
4. icns + dmg lane + smoke on both arches. The x64 build must be smoked on
   real Intel hardware when an iMac is available, otherwise under Rosetta 2
   on Apple Silicon — either counts; skipping x64 verification does not.
