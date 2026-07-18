# Security

## What this app can touch

- A low-level keyboard hook that reports ONLY the configured hotkey (and Esc
  while speaking) to the app. One-shot capture mode exists for rebinding and
  disarms itself. See `native/HearMeOutHelper.cs` — it is short on purpose.
- The clipboard, during a selection grab: save → copy → read → restore.
- The filesystem: settings JSON, logs (no content, ever), the model cache,
  and WAV files you explicitly export.
- The network: only the one-time voice-model download when the bundled copy
  is missing. Nothing else, ever.

## Reporting

Open a GitHub security advisory or an issue with `[security]` in the title.
No bounty program — this is free software — but reports get fixed fast and
credited.
