/**
 * Lightweight verification system. A Discord user runs `!verify` in a server,
 * receives a one-time link served by the agent's HTTP service. Opening the
 * link + clicking the button completes verification, assigns a configurable
 * role, and appends the result to lookups/verify.txt.
 */
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { LOOKUPS_DIR } from "./lookups.js";
import { config } from "./config.js";

const PENDING = new Map(); // token -> { userId, guildId, roleId, createdAt, ip }
const TTL_MS = 15 * 60 * 1000;

function baseUrl(req) {
  const host = req?.headers?.host?.split(":")[0] || "localhost";
  return `http://${host}:${config.port}`;
}

export function newToken({ userId, guildId, roleId }) {
  const token = crypto.randomBytes(24).toString("hex");
  PENDING.set(token, { userId, guildId, roleId, createdAt: Date.now() });
  return token;
}

export function verifyUrl(req, token) {
  return `${baseUrl(req)}/verify/${token}`;
}

function prune() {
  const now = Date.now();
  for (const [k, v] of PENDING) if (now - v.createdAt > TTL_MS) PENDING.delete(k);
}

async function appendLog(entry) {
  await fs.mkdir(LOOKUPS_DIR, { recursive: true });
  const file = path.join(LOOKUPS_DIR, "verify.txt");
  const line = `[${new Date().toISOString()}] userId=${entry.userId} guild=${entry.guildId} role=${entry.roleId || "-"} ip=${entry.ip || "-"} ua="${(entry.ua || "").replace(/"/g, "'").slice(0, 240)}"\n`;
  await fs.appendFile(file, line, "utf8");
}

const PAGE = (token, done, err) => `<!doctype html>
<html><head><meta charset="utf-8"><title>YORU · Verify</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;min-height:100vh;background:#05030b;color:#ece7ff;font:15px/1.5 system-ui,sans-serif;display:grid;place-items:center}
  .card{max-width:420px;padding:32px;border:1px solid rgba(168,118,255,.28);border-radius:18px;
        background:linear-gradient(160deg,rgba(126,61,255,.10),rgba(126,61,255,.04));
        box-shadow:0 30px 90px rgba(60,12,130,.45), inset 0 1px 0 rgba(255,255,255,.05);text-align:center}
  h1{margin:0 0 10px;letter-spacing:5px;background:linear-gradient(90deg,#fff,#c9a7ff 60%,#6d3bff);
     -webkit-background-clip:text;background-clip:text;color:transparent}
  button{margin-top:18px;padding:12px 22px;border-radius:12px;border:1px solid rgba(200,160,255,.5);
         background:linear-gradient(120deg,#7c3aed,#a855f7);color:#fff;font:inherit;cursor:pointer}
  .muted{color:#9c92c4;font-size:13px}
  .ok{color:#4ade80}.err{color:#ff6b8b}
</style></head><body><div class="card">
<h1>YORU</h1>
${done ? `<p class="ok">Verified. You can close this tab.</p>`
       : err ? `<p class="err">${err}</p><p class="muted">Ask the moderators for a new verification link.</p>`
             : `<p>Click below to confirm you're human and complete verification in the Discord server.</p>
                <form method="POST" action="/verify/${token}"><button type="submit">I'm human — verify me</button></form>
                <p class="muted">This link expires in 15 minutes.</p>`}
</div></body></html>`;

export function attachRoutes(getBotClient) {
  return {
    async GET(req, token) {
      prune();
      const rec = PENDING.get(token);
      if (!rec) return { html: PAGE(token, false, "This link is invalid or has expired.") };
      return { html: PAGE(token, false, null) };
    },
    async POST(req, token) {
      prune();
      const rec = PENDING.get(token);
      if (!rec) return { html: PAGE(token, false, "This link is invalid or has expired."), status: 400 };
      const ip = req.socket?.remoteAddress || "";
      const ua = req.headers?.["user-agent"] || "";
      try {
        const client = getBotClient();
        if (!client) throw new Error("The Discord bot is offline.");
        if (!rec.guildId || !rec.roleId) throw new Error("Verification is not configured for this server.");
        const guild = client.guilds.cache.get(rec.guildId);
        if (!guild) throw new Error("The Discord server is unavailable.");
        const member = await guild.members.fetch(rec.userId).catch(() => null);
        if (!member) throw new Error("Your Discord membership could not be confirmed.");
        await member.roles.add(rec.roleId);
      } catch (error) {
        return { html: PAGE(token, false, error.message || "Verification could not be completed."), status: 503 };
      }
      await appendLog({ ...rec, ip, ua });
      PENDING.delete(token);
      return { html: PAGE(token, true, null) };
    },
  };
}
