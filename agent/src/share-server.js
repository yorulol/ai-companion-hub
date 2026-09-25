/**
 * Team-share server. A second HTTP surface that lets teammates on your LAN
 * use ONLY the terminal chat and the lookup tab.
 *
 *  - Serves /share.html + assets from agent/panel/
 *  - Proxies exactly two endpoints to the main agent service:
 *      POST /api/chat      → conversation
 *      POST /api/lookup    → identity lookup (protected-row redaction stays on)
 *  - Naive per-IP rate limit (60 requests/minute).
 *  - Everything else returns 404 — no owner/files/workspace/settings paths.
 */
import http from "node:http";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { log } from "./boot-ui.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PANEL_DIR = path.join(__dirname, "..", "panel");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const ALLOWED_PROXY = new Set(["/api/chat", "/api/lookup"]);
const rateBuckets = new Map();
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

function rateLimited(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || [];
  const fresh = bucket.filter((t) => now - t < RATE_WINDOW_MS);
  fresh.push(now);
  rateBuckets.set(ip, fresh);
  return fresh.length > RATE_LIMIT;
}

function json(res, code, body) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function notFound(res) {
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
}

async function serveFile(res, filePath) {
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME[path.extname(filePath)] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(data);
    return true;
  } catch { return false; }
}

async function proxy(req, res, pathname) {
  const target = `http://127.0.0.1:${config.port}${pathname}`;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") || "application/json",
    });
    res.end(text);
  } catch (err) {
    json(res, 502, { error: `Upstream unavailable: ${err.message}` });
  }
}

export function localIPs() {
  const out = [];
  for (const [, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal) out.push(a.address);
    }
  }
  return out;
}

export async function startShareServer() {
  const share = config.share || {};

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://x");
      const pathname = url.pathname;
      const ip = req.socket.remoteAddress || "?";

      if (rateLimited(ip)) return json(res, 429, { error: "Rate limit — slow down." });

      // Static entry: /, /share, /share.html
      if (["/", "/share", "/share.html"].includes(pathname)) {
        return void (await serveFile(res, path.join(PANEL_DIR, "share.html")) || notFound(res));
      }

      // Whitelisted static assets used by share.html
      if (pathname.startsWith("/assets/")) {
        const rel = pathname.replace(/^\/+/, "");
        const allowed = new Set(["assets/share.css", "assets/share.js", "assets/common.js"]);
        if (!allowed.has(rel)) return notFound(res);
        const full = path.join(PANEL_DIR, rel);
        if (existsSync(full) && (await serveFile(res, full))) return;
        return notFound(res);
      }

      // API proxy — chat + lookup only
      if (ALLOWED_PROXY.has(pathname)) {
        if (req.method !== "POST") { res.writeHead(405); return res.end(); }
        // Force lookup endpoint through the owner path so the whitelist redaction runs.
        const forwardPath = pathname === "/api/lookup" ? "/api/owner/lookup" : pathname;
        return await proxy(req, res, forwardPath);
      }

      return notFound(res);
    } catch (err) {
      json(res, 500, { error: err.message });
    }
  });

  return new Promise((resolve) => {
    server.listen(share.port, share.bind, () => {
      const ips = localIPs();
      const lan = ips[0] || "127.0.0.1";
      const url = `http://${lan}:${share.port}/`;
      log.ok("share", `team link: ${url}`);
      if (ips.length > 1) log.dim("share", `also on: ${ips.slice(1).map((ip) => `http://${ip}:${share.port}/`).join(", ")}`);
      log.dim("share", `chat + lookup only · open port ${share.port}/tcp on the LAN firewall if teammates can't connect`);
      resolve(server);
    });
    server.on("error", (err) => {
      log.warn("share", `could not bind :${share.port} — ${err.message}`);
      resolve(null);
    });
  });
}
