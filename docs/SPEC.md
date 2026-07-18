# Hear Me Out — Product Spec

## One-liner

Select text anywhere on your PC, press a key, hear it in a real human voice —
free, MIT, 100% local.

## The wedge

The paid read-aloud products (Speechify ~$139/yr, NaturalReader ~$119/yr,
ElevenLabs Reader) all rent you two things: a natural voice and a convenient
gesture. The voice is now free (Kokoro-82M, Apache-2.0, faster than realtime
on CPU). The gesture is a weekend of Win32. So the product is: **the gesture +
the voice, packaged so a non-technical person can install it in one click.**

Non-goals for v1: OCR of images, browser extensions, mobile, cloud voices,
PDF/EPUB parsing (paste still works), word-level highlight timing.

## The gesture

1. User selects text in ANY app.
2. User presses the hotkey (default `F8`, rebindable to any chord).
3. Within ~a second the floating player fades in near the bottom of the
   screen and begins speaking. It shows the sentence being spoken, the
   source app, progress, and controls (pause, prev/next sentence, speed,
   stop). It never steals focus.
4. Hotkey again, `Esc`, or the ✕ stops everything and the player hides.

Nothing selected → the player flashes "Select some text first" and hides.
Model still warming on the very first run → "Warming up the voice…" then it
speaks as soon as the engine is up.

## The reader

A normal window for longer material: paste text or drop a `.txt`/`.md` file,
Listen with per-sentence follow-along highlight, change voice/speed, export
the whole text to `.wav`. Stats line shows word count + estimated listening
time at ~170 wpm.

## Architecture

```
┌───────────────────────────── Electron main ─────────────────────────────┐
│ main.js  — boot, hotkey routing, smoke mode                             │
│ helper.js — supervisor for the native helper (spawn, backoff, protocol) │
│ session.js — chunking, synth-ahead window (2), WAV cache, state         │
│ tts/engine.js — kokoro-js resident model, serialized synth queue        │
│ tts/chunker.js — sentence splitter with offsets (highlighting)          │
│ ipc.js / windows.js / tray.js / stores/settings.js                      │
└─────────────┬───────────────────────────────┬───────────────────────────┘
              │ stdio JSON-lines              │ IPC (buffered until load)
     HearMeOutHelper.exe               player / reader / settings / welcome
     (C# 5, LL kbd hook,               (vanilla HTML/CSS/JS, one <audio>,
      selection grab)                   preservesPitch speed 0.5×–3×)
```

- Sentence streaming: the player starts speaking after chunk 0 synthesizes
  (~1 s); chunks synth 2 ahead of the playhead; played chunks older than 5
  are dropped (long docs stay lean).
- The engine serializes all synthesis through one promise chain: one ONNX
  session, deterministic order, no starvation.
- Speed is renderer playbackRate with preservesPitch — instant, no re-synth.

## Quality bar (the polish tests)

- Cold start (model bundled): tray + hotkey live in < 2 s; first speech from
  hotkey press in < 2.5 s for a normal sentence.
- The airplane-mode test: every feature works offline once the model is present.
- The clipboard test: grab restores whatever text clipboard you had, every time.
- A first-time user goes install → hearing their first sentence without
  reading anything (welcome screen teaches the one gesture).
- `npm run smoke` boots the real app and speaks end-to-end in CI fashion.

## Platforms

Windows 10/11 x64 first (this repo, shipped). macOS Apple Silicon + Intel
next: docs/MAC-PORT.md — the Swift helper twin is the only real work; the
core is dependency-portable (no Win32 outside the helper + config paths).

## Pricing displaced

Speechify Premium ~$139/yr · NaturalReader ~$119/yr · ElevenLabs Reader
(free tier, account + cloud). Hear Me Out: $0, forever, by construction.
