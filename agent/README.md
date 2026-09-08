# NOVA agent — self-hosted AI service

Runs on your PC. Cross-platform: **Linux (Parrot / Debian / Ubuntu / Arch / etc.)**
and **Windows 10 / 11**.

## Setup

```bash
# terminal 1 — the web interface
npm install
npm run dev            # serves the UI on http://localhost:8080

# terminal 2 — the agent
cd agent
cp .env.example .env   # fill in what you use
npm install
npm start
```

## Addresses

| Address                 | What it is                                   |
| ----------------------- | -------------------------------------------- |
| http://localhost:8788   | **Chat panel** — talk to your AI agent        |
| http://localhost:8789   | **Owner panel** — Discord bot + owner controls |
| http://localhost:8787   | Agent API (the panels use it for you)         |

Each panel is its own port and only shows its own screen — the owner page is
blocked on the chat port. Change the ports with `CHAT_PANEL_PORT` /
`OWNER_PANEL_PORT` in `.env`, or turn the panels off with `PANELS_ENABLED=false`.

Getting updates later: `git pull`, then `npm install` in the root and in
`agent/` if dependencies changed, and restart both terminals.

## What's inside

| Piece            | What it does                                                   |
| ---------------- | -------------------------------------------------------------- |
| **AI router**    | OpenRouter (every free model, rotates on failure) → Groq → OpenAI → Anthropic → Ollama. Every provider toggled by `_ENABLED` in `.env`. |
| **Discord bot**  | ~70 built-in commands, per-server prefix + admin/mod role gating. |
| **Selfbot**      | Alt-account ping responder. AGAINST DISCORD ToS — use an alt.  |
| **Computer tools** | System info, file create/read/move/delete, malware scan, encrypt-lockdown with decryption key. |
| **Lookups**      | Drop PDF / CSV / TXT / JSON in `agent/lookups/`; ask NOVA to search across all of them. |
| **HTTP service** | Local API the web panels use (`http://localhost:8787`).        |

## Providers

Enable any combination in `.env`. NOVA tries them in this order and only
skips a provider if that provider's `_ENABLED` flag is `false` or its key
is missing:

1. `PREFERRED_PROVIDER` (default `openrouter`)
2. `openrouter` — rotates through every free model live (rescans every 10 minutes)
3. `groq`
4. `openai`
5. `anthropic`
6. `ollama` (local, always the last-resort backup)

## Computer control safety

- Master switch: `COMPUTER_CONTROL_ENABLED`.
- File writes are sandboxed to `COMPUTER_CONTROL_ROOT` (your home folder by default).
- To let NOVA reach anywhere on disk, set `COMPUTER_CONTROL_UNRESTRICTED=true`.
- Destructive tools (`write_file`, `move_file`, `remove_file`, `lockdown_engage`,
  `lockdown_release`, `shell`) require an **owner** request — both DM/panel commands
  and Discord messages verify the requester's ID matches `OWNER_DISCORD_ID`.

## Ports

Change `PORT=` in `.env`. The web panels remember the address you enter
on the Chat page.
