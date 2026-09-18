/**
 * Panel hosting. Everything is static HTML/CSS/JS bundled INSIDE the agent
 * folder, so this runs anywhere Node runs with no frontend build step.
 *
 *   - Main panel   (default 8788) -> agent/panel/hub.html
 *       ONE merged panel: chat, owner controls, services, and the workspace
 *       all in a single tabbed shell. The legacy standalone pages are still
 *       served at /chat (index.html) and /owner (owner.html) because the hub
 *       embeds them, and they work standalone too.
 *   - WorkSpace    (default 8790) -> agent/panel/workspace.html
 *       Multi-agent panel where YORU (Ollama) and ACE (OpenRouter/OpenClaw)
 *       collaborate. Also embedded inside the main panel.
 *
 * Every /api/* call is proxied to the same-origin agent service on PORT.
 */
import http from "node:http";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PANEL_DIR = path.join(__dirname, "..", "panel");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const hopHeaders = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailers", "transfer-encoding", "upgrade", "host", "content-length",
]);

async function forwardApi(req, res) {
  const target = new URL(req.url, `http://127.0.0.1:${config.port}`);
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!hopHeaders.has(k.toLowerCase())) headers[k] = v;
  }
  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    body = Buffer.concat(chunks);
  }
  const upstream = await fetch(target, { method: req.method, headers, body, redirect: "manual" });
  const outHeaders = {};
  upstream.headers.forEach((v, k) => { if (!hopHeaders.has(k.toLowerCase())) outHeaders[k] = v; });
  res.writeHead(upstream.status, outHeaders);
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

function safeJoin(root, rel) {
  const clean = decodeURIComponent(rel.split("?")[0]).replace(/^\/+/, "");
  const full = path.normalize(path.join(root, clean));
  if (!full.startsWith(root)) return null;
  return full;
}

async function serveStatic(res, filePath) {
  try {
    const data = await fs.readFile(filePath);
    const type = MIME[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

function notFound(res) {
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
}

// Friendly page routes -> bundled HTML files.
const PAGES = {
  "/chat": "index.html",
  "/index.html": "index.html",
  "/owner": "owner.html",
  "/owner.html": "owner.html",
  "/workspace": "workspace.html",
  "/workspace.html": "workspace.html",
  "/hub": "hub.html",
  "/hub.html": "hub.html",
};

function startPanel({ name, port, entryHtml }) {
  const server = http.createServer(async (req, res) => {
    try {
      const [urlPath] = req.url.split("?");

      // Agent API -> forward to same-machine agent service.
      if (urlPath.startsWith("/api/")) {
        if (urlPath === "/api/panel-info") {
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify({
            port: config.panels.chatPort,
            chatPort: config.panels.chatPort,
            ownerPort: config.panels.workspacePort, // legacy field name
            workspacePort: config.panels.workspacePort,
            name,
          }));
        }
        return await forwardApi(req, res);
      }

      // Entry page.
      if (urlPath === "/" || urlPath === "/index") {
        const file = path.join(PANEL_DIR, entryHtml);
        if (await serveStatic(res, file)) return;
        return notFound(res);
      }

      // Named pages.
      if (PAGES[urlPath]) {
        const file = path.join(PANEL_DIR, PAGES[urlPath]);
        if (await serveStatic(res, file)) return;
        return notFound(res);
      }

      // Static assets — /assets/*, favicon.ico, etc.
      const full = safeJoin(PANEL_DIR, urlPath);
      if (full && existsSync(full) && (await serveStatic(res, full))) return;

      // SPA-ish fallback: serve entry HTML for unknown routes.
      const fallback = path.join(PANEL_DIR, entryHtml);
      if (await serveStatic(res, fallback)) return;
      return notFound(res);
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(`Panel error: ${err.message}`);
    }
  });

  server.listen(port, () => log.ok("panel", `${name}: http://localhost:${port}`));
  return server;
}

export function startPanels() {
  if (!config.panels.enabled) return;
  startPanel({ name: "YORU panel", port: config.panels.chatPort, entryHtml: "hub.html" });
  startPanel({ name: "YORU WorkSpace", port: config.panels.workspacePort, entryHtml: "workspace.html" });
}
