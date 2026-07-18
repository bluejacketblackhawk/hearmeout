# Contracts

## Helper protocol (stdio, JSON-lines)

One JSON object per line, UTF-8, `\n` terminated, both directions.

### Commands (app → helper)

| cmd | fields | effect |
|---|---|---|
| `ping` | — | reply `{"evt":"pong"}` |
| `watch` | `vks: number[]` | replace the FULL watched VK set (hotkey + mods + Esc-while-speaking) |
| `capture` | — | one-shot: next chord/key is reported as `captured`, nothing else leaks; auto-disarms after 15 s |
| `capture-cancel` | — | disarm a pending capture |
| `grab` | `timeoutMs?: 100..3000` | selection grab: save clipboard → clear → Ctrl+C → poll → emit `selection` → restore |
| `foreground` | — | reply `foreground` with the focused window's exe + title |
| `quit` | — | unhook and exit 0 |

### Events (helper → app)

| evt | fields | meaning |
|---|---|---|
| `ready` | — | hook installed (or declared dead via `log`), commands accepted |
| `pong` | — | ping reply |
| `key` | `vk, down, held[]` | a WATCHED key changed state; `held` is the physical snapshot of watched keys |
| `captured` | `vk, name, mods[]` | rebind result |
| `selection` | `ok, text?, err?` | grab result; `err: "no-selection"` when nothing was copied |
| `foreground` | `exe, title` | focused window info |
| `log` | `msg` | helper-internal warning; never contains keystrokes or clipboard content |

Rules the helper must keep forever:

1. Only watched VKs are ever reported. No buffering, no logging, no other keys.
2. Injected input (`LLKHF_INJECTED`) is ignored — our own Ctrl+C cannot feed back.
3. The clipboard is restored after a grab whenever it held text. Non-text
   clipboard content is not restorable; the helper warns once per run.
4. Hook exceptions never escape (they would drop the hook for the whole OS).

## IPC surface (renderer ↔ main)

Invoke: `settings:get`, `settings:set(patch)`, `voices:list`, `tts:sample(voiceId)`,
`model:info`, `session:start-text({text, origin})`, `session:ctl(action)`,
`export:wav({text})`, `hotkey:capture`, `hotkey:capture-cancel`, `open:reader`,
`open:settings`, `welcome:done`, `app:version`, `read:selection`.

Send: `session:need(idx)`, `session:hello`, `session:report({evt, …})`.

Events pushed to windows: `session:start`, `session:audio {idx, wav}`,
`session:stop`, `session:ctl`, `session:flash`, `session:chunk-error`,
`session:pos`, `export:progress`, `settings:changed`, `model:progress`,
`model:ready`.

## Session state machine

`idle → speaking ⇄ paused → idle`. Esc and the hotkey stop from any non-idle
state. The main process owns the session; the player window owns playback and
reports `pos` / `paused` / `ended` / `closed`.
