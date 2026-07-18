// HearMeOutHelper — native helper for Hear Me Out (local read-aloud) on macOS.
//
// Twin of HearMeOutHelper.cs: a persistent child process spoken to by the
// Electron main process over stdin/stdout using the same JSON-lines protocol
// (see docs/CONTRACTS.md). The app never knows which platform is answering.
//
// Responsibilities:
//   * Keyboard event tap (CGEvent.tapCreate, listen-only) reporting ONLY
//     watched VKs (the read hotkey + Esc while speaking) plus the one-shot
//     "capture next key" mode for rebinding. Everything crosses the wire in
//     WINDOWS virtual-key codes — this file owns the keycode translation, so
//     settings, hotkey-match and the renderers stay platform-blind.
//   * Selection grab: ask the Accessibility API for the focused element's
//     selected text first (zero clipboard disturbance); only when the app
//     exposes nothing, fall back to the Cmd+C dance — remember the pasteboard,
//     post Cmd+C, poll changeCount for the copy landing, restore. The
//     selection text goes to the parent process and nowhere else.
//   * Foreground app info (executable name + window title) on request.
//   * TCC status ('perms' events): Input Monitoring feeds the event tap,
//     Accessibility feeds the grab. The welcome screen watches these to walk
//     the user through granting both.
//
// Rules this file keeps forever (same four as the Windows twin):
//   1. Only watched VKs are ever reported. No buffering, no logging, no
//      other keys.
//   2. Injected input is ignored — any event carrying a poster's pid (our own
//      Cmd+C included) cannot feed back into the tap.
//   3. The pasteboard is restored after a grab whenever it held text.
//      Non-text pasteboard content is not restorable; warn once per run.
//   4. Tap callback failures never escape — the callback stays total, and a
//      tap disabled by the OS (timeout/user input) re-enables itself.
//
// Threads:
//   * main    — installs the event tap and runs its CFRunLoop.
//   * stdin   — reads command lines, dispatches; prompts and grabs are
//               pushed onto queues so a slow dialog never blocks commands.
//   * grab    — serial queue owning all pasteboard access + event posting.
//   * perms   — polls TCC status every 2 s, emits on change, and re-tries
//               the tap when Input Monitoring turns up granted.

import AppKit
import ApplicationServices
import Foundation
import IOKit.hid

// ---- Emit (thread-safe, one JSON object per line) -------------------------

let outLock = NSLock()

func emit(_ json: String) {
    outLock.lock()
    defer { outLock.unlock() }
    let bytes = Array((json + "\n").utf8)
    var off = 0
    while off < bytes.count {
        let n = bytes.withUnsafeBufferPointer { buf -> Int in
            write(1, buf.baseAddress! + off, bytes.count - off)
        }
        if n <= 0 { break } // pipe gone: the parent is dead; nothing to do
        off += n
    }
}

func jstr(_ s: String) -> String {
    var out = "\""
    for ch in s.unicodeScalars {
        switch ch {
        case "\"": out += "\\\""
        case "\\": out += "\\\\"
        case "\u{08}": out += "\\b"
        case "\u{0C}": out += "\\f"
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        case "\t": out += "\\t"
        default:
            if ch.value < 0x20 {
                out += String(format: "\\u%04x", ch.value)
            } else {
                out.unicodeScalars.append(ch)
            }
        }
    }
    return out + "\""
}

func emitSimple(_ evt: String) { emit("{\"evt\":\"\(evt)\"}") }

func emitLog(_ msg: String) { emit("{\"evt\":\"log\",\"msg\":\(jstr(msg))}") }

func emitKey(_ vk: Int, _ down: Bool, _ held: [Int]) {
    emit("{\"evt\":\"key\",\"vk\":\(vk),\"down\":\(down ? "true" : "false"),\"held\":[\(held.map(String.init).joined(separator: ","))]}")
}

func emitCaptured(_ vk: Int, _ mods: [Int]) {
    emit("{\"evt\":\"captured\",\"vk\":\(vk),\"name\":\(jstr(vkName(vk))),\"mods\":[\(mods.map(String.init).joined(separator: ","))]}")
}

func emitSelection(_ ok: Bool, _ text: String?, _ err: String?) {
    var s = "{\"evt\":\"selection\",\"ok\":\(ok ? "true" : "false")"
    if let t = text { s += ",\"text\":\(jstr(t))" }
    if let e = err { s += ",\"err\":\(jstr(e))" }
    emit(s + "}")
}

func emitForeground(_ exe: String, _ title: String) {
    emit("{\"evt\":\"foreground\",\"exe\":\(jstr(exe)),\"title\":\(jstr(title))}")
}

func emitPerms(_ input: String, _ ax: String) {
    emit("{\"evt\":\"perms\",\"input\":\(jstr(input)),\"ax\":\(jstr(ax))}")
}

// ---- Keycode translation (macOS virtual keycodes <-> Windows VKs) ---------
//
// The protocol speaks Windows VKs end to end. macOS keycodes are positional
// (kVK_ANSI_*); this table pins each position to the VK the Windows helper
// would have reported for the same key.

let keycodeToVK: [Int: Int] = [
    // letters
    0: 0x41, 11: 0x42, 8: 0x43, 2: 0x44, 14: 0x45, 3: 0x46, 5: 0x47, 4: 0x48,
    34: 0x49, 38: 0x4A, 40: 0x4B, 37: 0x4C, 46: 0x4D, 45: 0x4E, 31: 0x4F,
    35: 0x50, 12: 0x51, 15: 0x52, 1: 0x53, 17: 0x54, 32: 0x55, 9: 0x56,
    13: 0x57, 7: 0x58, 16: 0x59, 6: 0x5A,
    // digit row
    29: 0x30, 18: 0x31, 19: 0x32, 20: 0x33, 21: 0x34, 23: 0x35, 22: 0x36,
    26: 0x37, 28: 0x38, 25: 0x39,
    // punctuation
    41: 0xBA, 24: 0xBB, 43: 0xBC, 27: 0xBD, 47: 0xBE, 44: 0xBF, 50: 0xC0,
    33: 0xDB, 42: 0xDC, 30: 0xDD, 39: 0xDE,
    // whitespace / editing / navigation
    49: 0x20, 48: 0x09, 36: 0x0D, 76: 0x0D, 51: 0x08, 53: 0x1B, 117: 0x2E,
    114: 0x2D, 115: 0x24, 119: 0x23, 116: 0x21, 121: 0x22, 123: 0x25,
    124: 0x27, 125: 0x28, 126: 0x26, 57: 0x14,
    // function row
    122: 0x70, 120: 0x71, 99: 0x72, 118: 0x73, 96: 0x74, 97: 0x75, 98: 0x76,
    100: 0x77, 101: 0x78, 109: 0x79, 103: 0x7A, 111: 0x7B, 105: 0x7C,
    107: 0x7D, 113: 0x7E, 106: 0x7F, 64: 0x80, 79: 0x81, 80: 0x82, 90: 0x83,
    // numpad
    82: 0x60, 83: 0x61, 84: 0x62, 85: 0x63, 86: 0x64, 87: 0x65, 88: 0x66,
    89: 0x67, 91: 0x68, 92: 0x69, 67: 0x6A, 69: 0x6B, 78: 0x6D, 65: 0x6E,
    75: 0x6F, 71: 0x0C,
    // modifiers (Cmd wears the Win VKs, Option wears the Alt VKs)
    55: 0x5B, 54: 0x5C, 56: 0xA0, 60: 0xA1, 59: 0xA2, 62: 0xA3, 58: 0xA4,
    61: 0xA5,
]

// VK -> physical keycodes (a generic modifier VK covers both sides).
let vkToKeycodes: [Int: [Int]] = {
    var rev: [Int: [Int]] = [:]
    for (kc, vk) in keycodeToVK { rev[vk, default: []].append(kc) }
    rev[0x10] = [56, 60]
    rev[0x11] = [59, 62]
    rev[0x12] = [58, 61]
    return rev
}()

func vkName(_ vk: Int) -> String {
    switch vk {
    case 0x08: return "Delete"
    case 0x09: return "Tab"
    case 0x0C: return "Clear"
    case 0x0D: return "Return"
    case 0x14: return "Caps Lock"
    case 0x1B: return "Esc"
    case 0x20: return "Space"
    case 0x21: return "Page Up"
    case 0x22: return "Page Down"
    case 0x23: return "End"
    case 0x24: return "Home"
    case 0x25: return "Left"
    case 0x26: return "Up"
    case 0x27: return "Right"
    case 0x28: return "Down"
    case 0x2D: return "Insert"
    case 0x2E: return "Fwd Delete"
    case 0x5B: return "Left Cmd"
    case 0x5C: return "Right Cmd"
    case 0x90: return "Num Lock"
    case 0xA0: return "Left Shift"
    case 0xA1: return "Right Shift"
    case 0xA2: return "Left Ctrl"
    case 0xA3: return "Right Ctrl"
    case 0xA4: return "Left Option"
    case 0xA5: return "Right Option"
    case 0x10: return "Shift"
    case 0x11: return "Ctrl"
    case 0x12: return "Option"
    case 0x6A: return "Numpad *"
    case 0x6B: return "Numpad +"
    case 0x6D: return "Numpad -"
    case 0x6E: return "Numpad ."
    case 0x6F: return "Numpad /"
    case 0xBA: return ";"
    case 0xBB: return "="
    case 0xBC: return ","
    case 0xBD: return "-"
    case 0xBE: return "."
    case 0xBF: return "/"
    case 0xC0: return "`"
    case 0xDB: return "["
    case 0xDC: return "\\"
    case 0xDD: return "]"
    case 0xDE: return "'"
    default: break
    }
    if vk >= 0x41 && vk <= 0x5A { return String(UnicodeScalar(vk)!) }        // A-Z
    if vk >= 0x30 && vk <= 0x39 { return String(UnicodeScalar(vk)!) }        // 0-9
    if vk >= 0x60 && vk <= 0x69 { return "Numpad \(vk - 0x60)" }             // Numpad 0-9
    if vk >= 0x70 && vk <= 0x87 { return "F\(vk - 0x6F)" }                   // F1-F24
    return "VK \(vk)"
}

func isModifier(_ vk: Int) -> Bool {
    return vk == 0x10 || vk == 0x11 || vk == 0x12
        || (vk >= 0xA0 && vk <= 0xA5)
        || vk == 0x5B || vk == 0x5C
}

// ---- Shared state ---------------------------------------------------------

let stateLock = NSLock()
var watchedVKs = Set<Int>()      // guarded by stateLock
var captureArmed = false          // guarded by stateLock
var captureMods = Set<Int>()      // guarded by stateLock
var captureGen = 0                // guarded by stateLock
let captureTimeoutSec = 15.0

var eventTap: CFMachPort?         // main runloop thread only
var mainRunLoop: CFRunLoop!

var warnedNonText = false         // grab queue only
var warnedNoAXPost = false        // grab queue only

let grabQueue = DispatchQueue(label: "hearmeout.grab")
let permsQueue = DispatchQueue(label: "hearmeout.perms")

// ---- Permissions (TCC) ----------------------------------------------------

func inputStatus() -> String {
    switch IOHIDCheckAccess(kIOHIDRequestTypeListenEvent) {
    case kIOHIDAccessTypeGranted: return "granted"
    case kIOHIDAccessTypeDenied: return "denied"
    default: return "unknown"
    }
}

func axStatus() -> String {
    return AXIsProcessTrusted() ? "granted" : "denied"
}

var lastEmittedPerms = ""         // perms queue + stdin thread; benign race

func emitCurrentPerms(force: Bool) {
    let i = inputStatus()
    let a = axStatus()
    let key = i + "/" + a
    if force || key != lastEmittedPerms {
        lastEmittedPerms = key
        emitPerms(i, a)
    }
}

/// Trigger the system permission dialogs for whatever the caller asked for.
/// Runs off the stdin thread — IOHIDRequestAccess may sit behind a dialog.
func promptPerms(_ which: String) {
    if (which == "input" || which == "all") && inputStatus() != "granted" {
        _ = IOHIDRequestAccess(kIOHIDRequestTypeListenEvent)
    }
    if (which == "ax" || which == "all") && axStatus() != "granted" {
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(opts)
    }
    emitCurrentPerms(force: true)
}

/// Every 2 s: emit perms on change; when Input Monitoring turns up granted
/// and the tap is not installed, try again from the tap's own runloop.
func startPermsWatch() {
    let t = Thread {
        while true {
            Thread.sleep(forTimeInterval: 2.0)
            emitCurrentPerms(force: false)
            if inputStatus() == "granted" && eventTap == nil {
                CFRunLoopPerformBlock(mainRunLoop, CFRunLoopMode.commonModes.rawValue) {
                    installTap(announce: true)
                }
                CFRunLoopWakeUp(mainRunLoop)
            }
        }
    }
    t.name = "perms"
    t.start()
}

// ---- Keyboard event tap ---------------------------------------------------

func snapshotHeld(_ watched: Set<Int>) -> [Int] {
    // Real-time physical state of the watched keys, like GetAsyncKeyState on
    // the other side. A generic modifier VK counts if either side is down.
    var held: [Int] = []
    for vk in watched.sorted() {
        guard let kcs = vkToKeycodes[vk] else { continue }
        for kc in kcs where CGEventSource.keyState(.combinedSessionState, key: CGKeyCode(kc)) {
            held.append(vk)
            break
        }
    }
    return held
}

// Accumulate a modifier chord during capture; resolve when a non-modifier key
// goes DOWN (mods + that key) or a lone modifier is RELEASED. Runs on the tap
// thread; all shared state touched under stateLock.
func handleCaptureKey(_ vk: Int, _ down: Bool) {
    var emitVK = 0
    var mods: [Int] = []
    var doEmit = false
    stateLock.lock()
    if captureArmed {
        if down {
            if isModifier(vk) {
                captureMods.insert(vk) // wait for the trigger
            } else {
                mods = Array(captureMods)
                emitVK = vk
                doEmit = true
                captureArmed = false
                captureMods.removeAll()
            }
        } else if isModifier(vk) && captureMods.contains(vk) {
            // Modifier pressed + released with no trigger => bind the modifier
            // itself (e.g. bare Right Cmd); still-held modifiers are its mods.
            captureMods.remove(vk)
            mods = Array(captureMods)
            emitVK = vk
            doEmit = true
            captureArmed = false
            captureMods.removeAll()
        }
    }
    stateLock.unlock()
    if doEmit { emitCaptured(emitVK, mods) }
}

func handleKeyEvent(_ type: CGEventType, _ event: CGEvent) {
    // Rule 2: anything with a poster's pid is synthetic — never report it.
    if event.getIntegerValueField(.eventSourceUnixProcessID) != 0 { return }

    let kc = Int(event.getIntegerValueField(.keyboardEventKeycode))
    guard let vk = keycodeToVK[kc] else { return }

    let down: Bool
    if type == .flagsChanged {
        // Modifiers arrive as flag transitions; ask the source for the key's
        // present physical state to learn the direction.
        down = CGEventSource.keyState(.combinedSessionState, key: CGKeyCode(kc))
    } else {
        down = (type == .keyDown)
    }

    stateLock.lock()
    let armed = captureArmed
    let watched = watchedVKs
    stateLock.unlock()

    if armed {
        handleCaptureKey(vk, down)
    } else if watched.contains(vk) {
        emitKey(vk, down, snapshotHeld(watched))
    }
}

func tapCallback(_ proxy: CGEventTapProxy, _ type: CGEventType, _ event: CGEvent,
                 _ refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    // Rule 4: stay total. The OS disables a slow tap; re-enable and move on.
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = eventTap { CGEvent.tapEnable(tap: tap, enable: true) }
        return Unmanaged.passUnretained(event)
    }
    if type == .keyDown || type == .keyUp || type == .flagsChanged {
        handleKeyEvent(type, event)
    }
    return Unmanaged.passUnretained(event)
}

func installTap(announce: Bool) {
    if eventTap != nil { return }
    // Explicitly denied: attempting anyway would only re-notify the user.
    // The perms watcher retries the moment the grant shows up.
    if inputStatus() == "denied" {
        if announce { return }
        emitLog("keyboard hook unavailable — grant Input Monitoring to use the hotkey")
        return
    }
    let mask: CGEventMask =
        (1 << CGEventType.keyDown.rawValue) |
        (1 << CGEventType.keyUp.rawValue) |
        (1 << CGEventType.flagsChanged.rawValue)
    guard let tap = CGEvent.tapCreate(
        tap: .cgSessionEventTap,
        place: .headInsertEventTap,
        options: .listenOnly,
        eventsOfInterest: mask,
        callback: tapCallback,
        userInfo: nil
    ) else {
        emitLog("keyboard hook could not be installed")
        return
    }
    eventTap = tap
    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
    if announce { emitLog("keyboard hook installed") }
}

// ---- Selection grab -------------------------------------------------------

/// Happy path: the focused element tells us its selection outright.
/// Returns nil when the app exposes nothing (then the Cmd+C dance decides).
func axSelectedText() -> String? {
    guard AXIsProcessTrusted() else { return nil }
    let sys = AXUIElementCreateSystemWide()
    var focusedRef: CFTypeRef?
    guard AXUIElementCopyAttributeValue(sys, kAXFocusedUIElementAttribute as CFString, &focusedRef) == .success,
          let focused = focusedRef, CFGetTypeID(focused) == AXUIElementGetTypeID() else { return nil }
    let el = focused as! AXUIElement
    var selRef: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, kAXSelectedTextAttribute as CFString, &selRef) == .success,
          let sel = selRef as? String, !sel.isEmpty else { return nil }
    return sel
}

func postCmdC() -> Bool {
    guard let src = CGEventSource(stateID: .hidSystemState) else { return false }
    let cmdDown = CGEvent(keyboardEventSource: src, virtualKey: 55, keyDown: true)
    let cDown = CGEvent(keyboardEventSource: src, virtualKey: 8, keyDown: true)
    let cUp = CGEvent(keyboardEventSource: src, virtualKey: 8, keyDown: false)
    let cmdUp = CGEvent(keyboardEventSource: src, virtualKey: 55, keyDown: false)
    guard let e1 = cmdDown, let e2 = cDown, let e3 = cUp, let e4 = cmdUp else { return false }
    e1.flags = .maskCommand
    e2.flags = .maskCommand
    e3.flags = .maskCommand
    e4.flags = []
    // A short beat between events: burst-posted chords can outrun slower
    // apps' key handling, and 20 ms total is invisible next to the poll.
    e1.post(tap: .cghidEventTap)
    usleep(5_000)
    e2.post(tap: .cghidEventTap)
    usleep(5_000)
    e3.post(tap: .cghidEventTap)
    usleep(5_000)
    e4.post(tap: .cghidEventTap)
    return true
}

func doGrab(_ timeoutMs: Int) {
    // 1) Accessibility first: zero pasteboard disturbance when the app talks.
    if let text = axSelectedText() {
        emitSelection(true, text, nil)
        return
    }

    // 2) Cmd+C dance. changeCount detects the copy landing, so no clear is
    //    needed — an untouched pasteboard stays untouched on a miss.
    if !AXIsProcessTrusted() && !warnedNoAXPost {
        warnedNoAXPost = true
        emitLog("selection grab without the Accessibility permission usually finds nothing")
    }

    let pb = NSPasteboard.general
    let before = pb.changeCount
    let savedText = pb.string(forType: .string)
    let hadNonText = (savedText == nil) && !(pb.types ?? []).isEmpty

    if !postCmdC() {
        emitSelection(false, nil, "event post failed")
        return
    }

    var text: String? = nil
    var waited = 0
    while waited < timeoutMs {
        usleep(30_000)
        waited += 30
        if pb.changeCount != before {
            // The copy landed. Apps write asynchronously; text may take
            // another beat to materialize.
            if let got = pb.string(forType: .string), !got.isEmpty {
                text = got
                break
            }
        }
    }

    // Rule 3: put back whatever text the user had, even when the grab came
    // up empty. Non-text content the copy replaced is gone — warn once.
    if pb.changeCount != before {
        if let saved = savedText {
            pb.clearContents()
            pb.setString(saved, forType: .string)
        } else {
            if hadNonText && !warnedNonText {
                warnedNonText = true
                emitLog("clipboard held non-text content; a selection grab replaces it")
            }
            pb.clearContents()
        }
    }

    if text == nil {
        emitSelection(false, nil, "no-selection")
    } else {
        emitSelection(true, text, nil)
    }
}

// ---- Foreground app -------------------------------------------------------

func doForeground() {
    var exe = ""
    var title = ""
    if let app = NSWorkspace.shared.frontmostApplication {
        exe = app.executableURL?.lastPathComponent ?? app.localizedName ?? ""
        if AXIsProcessTrusted() {
            let el = AXUIElementCreateApplication(app.processIdentifier)
            var winRef: CFTypeRef?
            if AXUIElementCopyAttributeValue(el, kAXFocusedWindowAttribute as CFString, &winRef) == .success,
               let win = winRef, CFGetTypeID(win) == AXUIElementGetTypeID() {
                var titleRef: CFTypeRef?
                if AXUIElementCopyAttributeValue(win as! AXUIElement, kAXTitleAttribute as CFString, &titleRef) == .success,
                   let t = titleRef as? String {
                    title = t
                }
            }
        }
    }
    emitForeground(exe, title)
}

// ---- Command dispatch -----------------------------------------------------

func armCapture() {
    stateLock.lock()
    captureArmed = true
    captureMods.removeAll()
    captureGen += 1
    let gen = captureGen
    stateLock.unlock()
    // Auto-disarm: an abandoned rebind can never later transmit an unrelated
    // keystroke (privacy), same 15 s as the Windows twin.
    DispatchQueue.global().asyncAfter(deadline: .now() + captureTimeoutSec) {
        stateLock.lock()
        if captureArmed && captureGen == gen {
            captureArmed = false
            captureMods.removeAll()
        }
        stateLock.unlock()
    }
}

func disarmCapture() {
    stateLock.lock()
    captureArmed = false
    captureMods.removeAll()
    stateLock.unlock()
}

func handleCommand(_ line: String) {
    guard let data = line.data(using: .utf8),
          let parsed = try? JSONSerialization.jsonObject(with: data),
          let obj = parsed as? [String: Any],
          let cmd = obj["cmd"] as? String else { return }

    switch cmd {
    case "ping":
        emitSimple("pong")
    case "watch":
        var next = Set<Int>()
        if let arr = obj["vks"] as? [Any] {
            for v in arr {
                if let n = (v as? NSNumber)?.intValue, n >= 0, n <= 255 { next.insert(n) }
            }
        }
        stateLock.lock()
        watchedVKs = next
        stateLock.unlock()
    case "capture":
        armCapture()
    case "capture-cancel":
        disarmCapture()
    case "grab":
        var timeoutMs = 600
        if let t = (obj["timeoutMs"] as? NSNumber)?.intValue { timeoutMs = t }
        if timeoutMs < 100 { timeoutMs = 100 }
        if timeoutMs > 3000 { timeoutMs = 3000 }
        grabQueue.async { doGrab(timeoutMs) }
    case "foreground":
        doForeground()
    case "perms":
        // macOS addition (docs/CONTRACTS.md): re-check, optionally raise the
        // system dialogs for what is missing, always reply with a perms event.
        var which: String? = nil
        if let s = obj["prompt"] as? String, s == "input" || s == "ax" { which = s }
        else if (obj["prompt"] as? NSNumber)?.boolValue == true { which = "all" }
        if let w = which {
            permsQueue.async { promptPerms(w) }
        } else {
            emitCurrentPerms(force: true)
        }
    case "quit":
        exit(0)
    default:
        break // unknown commands are ignored on purpose
    }
}

// ---- Entry ----------------------------------------------------------------

signal(SIGPIPE, SIG_IGN) // a dead parent must fail our writes, not kill us

mainRunLoop = CFRunLoopGetCurrent()

// Command loop on its own thread; exits the process when stdin closes.
let stdinThread = Thread {
    while let line = readLine(strippingNewline: true) {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty { handleCommand(trimmed) }
    }
    exit(0) // parent closed the pipe
}
stdinThread.name = "stdin"
stdinThread.start()

// Hook first, then declare readiness regardless: grab/foreground/ping still
// work without the tap, and the parent must not hang waiting for 'ready'.
installTap(announce: false)
emitSimple("ready")
emitCurrentPerms(force: true)
startPermsWatch()

// Keep servicing the tap forever. With no tap installed the run loop has no
// sources and returns immediately; the nap keeps that case cool until the
// perms watcher hands us one.
while true {
    CFRunLoopRun()
    Thread.sleep(forTimeInterval: 0.25)
}
