# Contributing

Glad you're here. Ground rules, short version:

- **The promise is the product.** Nothing that phones home, no telemetry, no
  "optional" cloud features, no update nags. PRs that add a network call will
  be closed with affection.
- **Zero runtime dependencies beyond the voice stack.** The app is vanilla
  Electron + `kokoro-js`. No frameworks, no bundlers. If a feature needs a
  library, it probably needs a rethink.
- **The helper stays boring and readable.** `native/HearMeOutHelper.cs` is
  compiled by the csc that ships in Windows (C# 5 — no string interpolation,
  no `?.`, no pattern matching). It watches only configured keys, and that is
  auditable in one sitting. Keep it that way.
- **Tests gate merges.** `npm test` (fast, no model) must pass; if you touch
  the engine/session, run `npm run test:engine` and `npm run smoke` too.
- Match the style around you. Comments explain *why*, not *what*.

## Getting set up

```
npm install
npm run setup   # compile helper + fetch the voice model once
npm start
```

## Good first issues

- Word-level highlight timing (estimate within a sentence by character weight)
- EPUB/PDF text extraction for the reader
- MP3/M4B export
- The macOS helper twin (docs/MAC-PORT.md)
