# YORU agent — self-hosted AI service

Runs on your PC or any VPS. Cross-platform: **Linux (Parrot / Debian / Ubuntu / Arch)**
and **Windows 10 / 11**. Everything you need lives in this `agent/` folder — no
frontend build, no Lovable, no extra terminals.

## Setup (standalone)

```bash
cd agent
cp .env.example .env       # fill in what you use
npm install
npm run yoru               # or: npx yoru
```

That's it. The agent boots the AI router, the Discord bot (optional), and
both web panels — all as one process, behind a colored terminal dashboard
with an animated robot mascot.

> `npm run yoru` is the canonical command. `npm start` still works as an
> alias. If you `npm link` (or install the folder globally) you can just
> type `yoru` from any shell.

## Addresses

| Address                 | What it is                                        |
| ----------------------- | ------------------------------------------------- |
| http://localhost:8788   | **Chat panel** — talk to your AI agent            |
| http://localhost:8789   | **Owner panel** — Discord bot + owner controls    |
| http://localhost:8787   | Agent API (the panels use it for you)             |

Each panel is its own port and only shows its own screen — the owner page is
blocked on the chat port. Change the ports with `CHAT_PANEL_PORT` /
`OWNER_PANEL_PORT` in `.env`, or turn the panels off with `PANELS_ENABLED=false`.

## Running on a VPS

Copy the `agent/` folder up (or `git clone` the repo and only use `agent/`),
then:

```bash
cd agent
cp .env.example .env
npm install
# keep it alive across reboots
npx pm2 start src/index.js --name yoru
npx pm2 save
```

Open ports **8788** and **8789** on the VPS firewall. Reach the panels at
`http://<your-vps-ip>:8788` and `http://<your-vps-ip>:8789`. Put them behind
a reverse proxy (Caddy, Nginx, Traefik) if you want HTTPS and a domain.

## Getting updates

`git pull`, then `npm install` inside `agent/` if dependencies changed, and
restart the process.

## What's inside

| Piece            | What it does                                                   |
| ---------------- | -------------------------------------------------------------- |
| **AI router**    | OpenRouter (every free model, rotates on failure) → Groq → OpenAI → Anthropic → Ollama. Every provider toggled by `_ENABLED` in `.env`. |
| **Discord bot**  | 250+ built-in commands, per-server prefix + admin/mod role gating. |
| **Selfbot**      | Alt-account ping responder. AGAINST DISCORD ToS — use an alt.  |
| **Computer tools** | System info, file create/read/move/delete, malware scan, encrypt-lockdown with decryption key. |
| **Lookups**      | Drop PDF / CSV / TXT / JSON in `agent/lookups/`; ask YORU to search across all of them. |
| **Web panels**   | Two glassy purple panels served straight from `agent/panel/`.  |

## Providers

Enable any combination in `.env`. YORU tries them in this order and only
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
- To let YORU reach anywhere on disk, set `COMPUTER_CONTROL_UNRESTRICTED=true`.
- Destructive tools (`write_file`, `move_file`, `remove_file`, `lockdown_engage`,
  `lockdown_release`, `shell`) require an **owner** request — both DM/panel commands
  and Discord messages verify the requester's ID matches `OWNER_DISCORD_ID`.
