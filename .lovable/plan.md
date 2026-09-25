# Verify build, extend panel, team-share mode, installer refresh

## Scope

1. **Verify the recent shipments actually run.** Exercise the model builder path
   in a sandboxed Node run (unit-style: import `model-builder.js`, detect a
   fixture source, confirm Modelfile output). Boot the agent's HTTP server
   headless, hit `/api/models/custom`, `/api/owner/fs/roots`, the lookup
   endpoint, and the new share endpoints. Fix anything that throws.

2. **Panel — go further toward the JARVIS reference.**
   - Animated core orb (SVG + CSS, cyan pulse rings, subtle rotation) in the
     dashboard center column.
   - Mission activity ticker (live tail of `/api/activity`).
   - System monitor row (CPU / RAM / GPU bars from `/api/system`).
   - Agent overview cards (YORU / ACE / custom models) with status pill.
   - Providers strip with online dot.
   - Fixed left rail + top bar; settings popover moved into top bar with
     `z-index: 1000` so it never sits behind panels.
   - Keep terminal-style chat.

3. **Team-share mode.**
   - New env block: `TEAM_SHARE_ENABLED`, `TEAM_SHARE_PORT` (default 8790),
     `TEAM_SHARE_TOKEN` (auto-generated on first install), `TEAM_SHARE_BIND`
     (default `0.0.0.0`).
   - New file `agent/src/share-server.js` — a second HTTP server that serves
     `agent/panel/share.html` (terminal chat + lookup only, no nav to other
     tabs) and proxies **only** `/api/chat` and `/api/lookup` to the main
     server. Every request requires `?token=` or `X-Share-Token` header.
     Rate-limited (30 req/min/IP). All other paths return 404.
   - After `npm start`, print the shareable URL:
     `✓ [share] team link: http://<lan-ip>:8790/?token=...`
     Detect LAN IP via `os.networkInterfaces()` (first non-internal IPv4).
   - `share.html` — minimal two-tab UI (Terminal, Lookup), same dark HUD
     theme, no owner/files/workspace/settings entry points.

4. **Installer refresh (`scripts/install.js`).**
   - Generate `TEAM_SHARE_TOKEN` if missing (32-byte hex).
   - Ensure `agent/models/` and `agent/calls/` exist (already partly done).
   - On Linux (Parrot/Debian/Ubuntu/Fedora/Arch) auto-install: `ffmpeg`,
     `sqlite3`, `build-essential`/`base-devel`, `libsecret` (for keytar-ish
     deps), `curl`. On Windows via winget/choco/scoop: `ffmpeg`, `sqlite`,
     `vcredist`.
   - Open the team-share port in the local firewall on request (print the
     one-liner for `ufw allow 8790/tcp` / `netsh advfirewall` rather than
     running it silently — don't touch firewall without consent).
   - Re-run the audio-optional retry loop; ensure `better-sqlite3` rebuilds
     against the current Node ABI (`npm rebuild better-sqlite3`).
   - Verify every direct dep in `package.json` resolves at end of install;
     print a summary table.

5. **Boot output.** Add the `[share]` line to the Surfaces box. Keep the
   banner-last ordering.

## Technical details

- Files touched: `agent/src/share-server.js` (new), `agent/panel/share.html`
  (new), `agent/panel/assets/share.js` (new), `agent/panel/assets/share.css`
  (new), `agent/src/index.js` (start share server, print LAN URL),
  `agent/src/config.js` (share block), `agent/.env` + `agent/.env.example`
  (share vars), `agent/scripts/install.js` (deps, token gen, rebuild),
  `agent/panel/command.html` + `command.css` + `command.js` (core orb,
  monitors, ticker, agent cards, settings z-index fix),
  `agent/src/server.js` (expose `/api/system`, `/api/activity` tail if
  missing; ensure lookup endpoint is stable for share proxy).
- Verification harness: `agent/scripts/verify-commands.js` extended to
  smoke-test share server on an ephemeral port and hit each proxied route
  with and without the token.

## Safety

- Share server is **explicitly opt-in** via `TEAM_SHARE_ENABLED=true`. Off by
  default. Token required. Only chat + lookup proxied. Lookup protected-row
  redaction stays enforced on the proxy path.
