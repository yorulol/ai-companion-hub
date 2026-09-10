/** Tiny HTTP service the web panels talk to. No framework — plain node:http. */
import http from "node:http";
import { config, isOwnerId } from "./config.js";
import { ask, providerStatus, refreshModels, knownModels, ollamaModels } from "./ai.js";
import { chat } from "./chat-loop.js";
import {
  getSettings, setSettings, allGuilds, getGuild, saveGuild,
  listLookupWhitelist, addLookupWhitelist, removeLookupWhitelist,
  listCustomCommands, setCustomCommand, deleteCustomCommand,
  getAutoresponder, setAutoresponder,
  getWelcome, setWelcome,
  listReactionRoles, setReactionRole, deleteReactionRole,
} from "./db.js";
import { startBot, stopBot, botStatus, botGuilds, listCommands } from "./bot.js";
import { startSelfbot, stopSelfbot, selfbotStatus, selfbotGuilds } from "./selfbot.js";
import * as pc from "./computer.js";
import { lookup, listLookupFiles } from "./lookups.js";
import { auditFolder } from "./code-audit.js";

const json = (res, code, body) => {
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": corsOrigin(),
    "access-control-allow-headers": "content-type, x-owner-id",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  });
  res.end(JSON.stringify(body));
};
const corsOrigin = () => (config.allowedOrigins.includes("*") ? "*" : config.allowedOrigins.join(","));
const requireOwner = (req) => {
  const id = req.headers["x-owner-id"];
  if (!config.ownerId) throw new Error("OWNER_DISCORD_ID not set in .env");
  if (!isOwnerId(id)) throw new Error("Not the owner.");
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

const ROUTES = {
  "GET /api/health": async () => {
    const p = await providerStatus();
    return {
      ok: true,
      ...p,
      bot: botStatus(),
      selfbot: selfbotStatus(),
      os: config.os,
      computerEnabled: config.computer.enabled,
    };
  },

  "POST /api/chat": async (req) => {
    const body = await readBody(req);
    const scope = body.scope || `panel:${req.socket.remoteAddress}`;
    const isOwner = isOwnerId(req.headers["x-owner-id"]);
    if (body.userText) {
      return await chat({ scope, userText: body.userText, mode: body.mode || "general", isOwner });
    }
    // legacy: pass messages through directly
    return await ask({ messages: body.messages || [], mode: body.mode || "general" });
  },

  "GET /api/models": async () => {
    await refreshModels();
    const known = knownModels();
    return { ...known, ollama: await ollamaModels() };
  },

  "POST /api/owner/verify": async (req) => {
    requireOwner(req);
    return { ok: true };
  },

  "GET /api/owner/settings": async (req) => {
    requireOwner(req);
    const s = getSettings();
    return {
      ...s,
      discord: {
        ...s.discord,
        hasBotToken: !!config.discord.botToken,
        hasUserToken: !!config.discord.userToken,
        botEnabled: botStatus().running,
        selfbotEnabled: selfbotStatus().running,
      },
      provider: {
        ...s.provider,
        preferred: config.providers.preferred,
        openrouterEnabled: config.providers.openrouter.enabled,
        ollamaEnabled: config.providers.ollama.enabled,
        openaiEnabled: config.providers.openai.enabled,
        anthropicEnabled: config.providers.anthropic.enabled,
        groqEnabled: config.providers.groq.enabled,
      },
      computer: {
        enabled: config.computer.enabled,
        root: config.computer.root,
        unrestricted: config.computer.unrestricted,
        lockdownTarget: config.computer.lockdownTarget,
      },
    };
  },

  "POST /api/owner/settings": async (req) => {
    requireOwner(req);
    return setSettings(await readBody(req));
  },

  "GET /api/owner/guilds": async (req) => {
    requireOwner(req);
    const live = botGuilds();
    const merged = allGuilds().map((g) => {
      const l = live.find((x) => x.id === g.id);
      return { ...g, roles: l?.roles || [] };
    });
    for (const l of live) if (!merged.find((m) => m.id === l.id)) merged.push({ ...getGuild(l.id, l.name), roles: l.roles });
    return { guilds: merged };
  },

  "POST /api/owner/guilds/:id": async (req, id) => {
    requireOwner(req);
    return saveGuild(id, await readBody(req));
  },

  "GET /api/commands": async () => {
    const commands = listCommands();
    return { commands, total: commands.length };
  },

  "POST /api/owner/control": async (req) => {
    requireOwner(req);
    const { action } = await readBody(req);
    if (action === "bot:start") await startBot();
    else if (action === "bot:stop") await stopBot();
    else if (action === "self:start") await startSelfbot();
    else if (action === "self:stop") await stopSelfbot();
    else throw new Error("Unknown action");
    return { ok: true };
  },

  // ---- Computer control (owner only) ----
  "GET /api/owner/system": async (req) => { requireOwner(req); return await pc.systemInfo(); },
  "POST /api/owner/fs/list": async (req) => { requireOwner(req); return { items: await pc.listDir((await readBody(req)).path) }; },
  "POST /api/owner/fs/read": async (req) => { requireOwner(req); return { content: await pc.readFile((await readBody(req)).path) }; },
  "POST /api/owner/fs/write": async (req) => { requireOwner(req); const b = await readBody(req); return await pc.writeFile(b.path, b.content); },
  "POST /api/owner/fs/move": async (req) => { requireOwner(req); const b = await readBody(req); return await pc.moveFile(b.from, b.to); },
  "POST /api/owner/fs/remove": async (req) => { requireOwner(req); return await pc.removeFile((await readBody(req)).path); },
  "POST /api/owner/scan": async (req) => { requireOwner(req); return await pc.scanForMalware(); },
  "POST /api/owner/lockdown/engage": async (req) => { requireOwner(req); return await pc.engageLockdown(); },
  "POST /api/owner/lockdown/release": async (req) => { requireOwner(req); return await pc.releaseLockdown((await readBody(req)).key); },
  "GET /api/owner/lockdown": async (req) => { requireOwner(req); return await pc.lockdownStatus(); },

  // ---- Lookups ----
  "GET /api/owner/lookups": async (req) => { requireOwner(req); return { files: await listLookupFiles() }; },
  "POST /api/owner/lookup": async (req) => { requireOwner(req); return await lookup((await readBody(req)).query); },
};

function match(method, url) {
  const key = `${method} ${url}`;
  if (ROUTES[key]) return { handler: ROUTES[key], params: [] };
  for (const route of Object.keys(ROUTES)) {
    const [rm, rp] = route.split(" ");
    if (rm !== method || !rp.includes(":")) continue;
    const re = new RegExp("^" + rp.replace(/:[^/]+/g, "([^/]+)") + "$");
    const m = url.match(re);
    if (m) return { handler: ROUTES[route], params: m.slice(1) };
  }
  return null;
}

export function startServer() {
  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") { json(res, 204, {}); return; }
    const url = req.url.split("?")[0];
    try {
      const found = match(req.method, url);
      if (!found) return json(res, 404, { error: "Not found" });
      const body = await found.handler(req, ...found.params);
      return json(res, 200, body);
    } catch (err) {
      const code = /not the owner|not set/i.test(err.message) ? 403 : 500;
      return json(res, code, { error: err.message });
    }
  });
  server.listen(config.port, () => console.log(`[server] http://localhost:${config.port}`));
  return server;
}
