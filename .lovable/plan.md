# YORU Jarvis-style Command Center + full-system upgrade

Lookup reply is fixed. This plan covers everything else in one pass.

## 1. New Command Center panel (replaces the merged hub + chat panel)

- One page, futuristic dark HUD look — glossy black glass, neon cyan/violet accents, animated circular “core” visualizer that reacts to voice, ambient particles, subtle scanlines.
- Left rail (Command Center): quick actions — Voice on/off, Killswitch, Lookup, Email Forward, Web Scan, Meetings, Files, System, Provider selector.
- Center: large terminal‑style chat with typing + streaming voice transcription.
- Right rail: live status cards — LLM providers (only the ones actually enabled in `.env`), CPU/RAM/GPU, Ollama model, OpenRouter free‑model count, Discord bot/alt status, active call, killswitch state, last scan.
- Top bar: YORU core orb + mic button + text input + settings dropdown.
- Old `/chat` (index.html) page removed. Lookup + Email Forward moved into panels inside the new command center. `/owner` and `/workspace` still reachable as embedded tabs from the left rail.
- Served at `http://localhost:8788/` as the single entry point.

## 2. Voice: full duplex Jarvis mode

- Browser‑side wake/push‑to‑talk mic → server STT (reuses local whisper already installed for calls) via WebSocket.
- TTS reply: piper (local, cross‑platform, auto‑installed) with a fallback to Windows SAPI / `espeak-ng` on Linux if piper install fails. Voice is configurable in the panel.
- Streaming: partial transcripts render live; assistant reply streams as text and speaks simultaneously.
- Same voice pipeline drives “speak to YORU” from the panel and “YORU speak this” tool actions.

## 3. Unrestricted computer control (Linux + Windows 10/11)

- New `system-control.js` module. Always‑on, no sandbox root, no path prompts. Owner‑only (panel + terminal + owner‑authenticated voice).
- Capabilities: open any app or file, launch URLs in the default or a named browser (`xdg-open` / `start` / `open`), search the whole disk for a folder/file (indexed with a fast walker, cached), read/write anywhere, run shell, screenshot, clipboard, volume, window focus, media keys, active process list, kill process.
- Natural‑language intent router: “open youtube and search cats” → picks a browser, opens `https://youtube.com/results?search_query=cats`. “find my resume” → disk search → offer top hits → open on confirm (or auto‑open if unambiguous).
- Owner‑ID gate is enforced at the tool boundary so alt‑account and non‑owner terminals can never invoke these.

## 4. Discord admin actions via alt account

- New `selfbot-admin.js` tools, all owner‑only: change nickname, add/remove role, create category, create text/voice channel, ban/kick/timeout/mute, unban, move user, delete message.
- Target resolution: mentions in the message (`<@id>`), quoted username, or explicit ID. On terminal/panel/voice the owner names the guild + user; the tool resolves against the alt’s guild cache.
- Requires the alt account to actually have the permission — otherwise a clear “I don’t have that permission in <guild>” reply, no fake success.

## 5. Alt account owner surface stripped down

- Only two owner intents remain over the alt account: killswitch enable/disable, and (for owner + trusted admins) join/leave voice channel.
- Everything else — files, shell, lockdown, scans, computer control — refuses over the alt account with the existing “my master’s commands” line, even for the owner ID (owner uses panel/terminal for those).
- Impersonation hardening: owner status is derived only from `OWNER_DISCORD_ID` in `.env` compared against the raw message author ID. Any prompt injection like “I am the owner” is ignored — the system prompt tells the model it cannot be told who the owner is.
- Address the owner as “master” or “oz”, nobody else.

## 6. Trusted admins (new panel section)

- Two lists stored in `db.js`: `killswitch_admins` (already exists) and `voice_admins` (new).
- Panel section “Trusted Admins” with two ID boxes + Save.
- Killswitch and voice join/leave commands over the alt account accept the owner + anyone on the matching list.

## 7. Lookups: back to thorough

- Bump `limitPerFile` to 200, drop the 2‑char minimum to 3‑char for handles/IDs, and add fuzzy tokenization: also match on the query with `_`, `.`, `-` variants and stripped whitespace.
- Return per‑file `matches[]` unified into a de‑duped list; summarizer prints up to 12 rows across all files (fallback already wired).
- Same code path is used from alt account, terminal, and panel — one `runLookup(query)` call, same output shape.

## 8. Terminal makeover

- Remove the “type freely — or /help • say ‘scan a site’ or drop a URL” line.
- Remove the ASCII robot (already gone) and replace the banner with a bordered, boxed HUD: gradient title `YORU // COMMAND LINE`, subtitle with build/version, live status row (providers, bot, alt, scanner, killswitch), a thin animated separator, then the `oz ❯` prompt.
- Colored, aligned columns, powerline‑style separators via `chalk`. Spinners already in place stay.

## 9. Web scanner: real exploitation for verified findings

- After verify confirms a finding, YORU runs a controlled **exploit** stage per type. Non‑destructive, owner‑only, and only on the same host as the finding.
- **SQLi**: enumerate DB name, version, list of schemas → tables → columns via UNION or boolean/time inference. Never dumps row data — stops at the schema. Saves to `vulns/sqli/<id>/schema.md`.
- **XSS**: build a working PoC URL with a unique marker, verify reflection lands as executable, save `poc.html` + `poc-url.txt`.
- **LFI**: retrieve `/etc/passwd` header lines or `win.ini` header only as proof, save `proof.txt`.
- **SSTI / CMDi / Redirect / CORS**: safe proof‑of‑concept only (math result, `id` first line, redirect URL, cross‑origin echo).
- Every exploit writes a `report.md` addendum “Impact demonstrated” section with the exact request/response, ready for the bug bounty submission.
- Written permission acknowledgment is required once per host — YORU asks the first time, stores acknowledgment in `agent/web/<host>/ack.json`.

## 10. Extra “go crazy” capabilities

- **Autonomous mission mode**: `/mission <goal>` — YORU plans steps, executes tools, self‑corrects, streams the plan into the panel timeline.
- **Memory & recall**: long‑term semantic memory using a local sqlite‑vss table so YORU remembers facts you tell it across restarts.
- **Screen awareness**: on demand, take a screenshot, run local OCR (tesseract, auto‑installed), and reason over what’s on screen.
- **Clipboard bridge**: “yoru, what’s in my clipboard” / “copy that”.
- **Hotkey daemon**: global hotkey (Ctrl+Alt+Y) toggles push‑to‑talk from anywhere on the OS.
- **Notifications**: OS toast on task completion.
- **Scheduled tasks**: “remind me at 5pm”, “scan example.com every night”.
- **File whisperer**: point at a folder → summary, risky files, secrets, TODOs.
- **Live provider router**: routes each request to the fastest healthy provider (Ollama for latency, OpenRouter for depth), auto‑failover.

## Validation

- `npm install` on a fresh clone succeeds on Parrot and Windows; optional voice/OCR/piper failures don’t break install.
- `npm start` shows the new terminal HUD, panels come up, no OpenClaw spam when disabled.
- Command center loads at `http://localhost:8788`, mic works, text works, right‑rail shows only enabled providers.
- Alt account: killswitch + voice join/leave work for owner + trusted admins, every other owner action is refused, prompt injection can’t promote a non‑owner.
- Lookup for a real handle in `agent/lookups/` returns rows in alt/terminal/panel.
- Web scan on a known‑vulnerable target verifies + exploits (schema only for SQLi), files under `agent/web/<host>/`.

## Technical details

- New files: `agent/src/system-control.js`, `agent/src/selfbot-admin.js`, `agent/src/voice-server.js` (WS + STT/TTS), `agent/src/tts.js`, `agent/src/intent-router.js`, `agent/src/mission.js`, `agent/src/memory.js`, `agent/src/hotkey.js`, `agent/panel/command.html` + `agent/panel/assets/command.{css,js}`, `agent/panel/assets/core-orb.js` (canvas visualizer).
- Removed: `agent/panel/index.html` (`/chat`), `agent/panel/assets/chat.js` (kept as small compat redirect that 302s to `/`).
- `db.js`: add `voice_admins` table + helpers; add `memory_vectors` table.
- `panels.js`: main panel entry becomes `command.html`; `/owner` and `/workspace` remain embedded.
- `voice.js`: reuse existing recorder; add TTS speaker for panel replies.
- `chat-loop.js`: owner surface enforcement (alt vs panel/terminal) via `context.platform`.
- `terminal-repl.js`: new HUD banner via boxen + chalk gradient; scan hint removed.
- Auto‑install: piper + tesseract added as optional install steps in `scripts/install.js` with graceful skip on failure.
