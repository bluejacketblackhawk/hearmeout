# macOS Port

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
  arm64 + x64). Generate `assets/HearMeOut.icns` from `HearMeOut.png`
  (`iconutil`); hardened runtime on; notarize when the Apple ID is set up —
  unsigned + `xattr -dr com.apple.quarantine` instructions otherwise, same
  as cleanroom's release notes.
- onnxruntime-node ships darwin binaries — remember to flip the
  platform-exclude filters in package.json `build.files` for the mac lane
  (exclude win/linux there instead).

## Order of work

1. Swift helper speaking the protocol + selftest port (test/helper-selftest.js
   already runs anywhere node does).
2. `config.js` mac paths + `build-mac.sh`.
3. Welcome perms flow.
4. icns + dmg lane + smoke on both arches.
