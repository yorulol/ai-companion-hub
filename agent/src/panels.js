/**
 * Two separate local panels, each on its own port:
 *   - Chat panel   (default 8788) -> the AI agent chat page
 *   - Owner panel  (default 8789) -> the Discord / owner control page
 *
 * Both are thin local front-doors: they serve the web UI (from the site build
 * or the dev server running on SITE_URL) and forward every /api/* call to the
 * agent service on PORT. That means each panel is a single, self-contained
 * address you can open in the browser — no CORS setup, no extra flags.
 */
import http from "node:http";
import { config } from "./config.js";

const hopHeaders = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailers", "transfer-encoding", "upgrade", "host", "content-length",
]);

async function forward(req, res, targetBase, rewrittenPath) {
  const url = new URL(rewrittenPath, targetBase);
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
  const upstream = await fetch(url, { method: req.method, headers, body, redirect: "manual" });
  const outHeaders = {};
  upstream.headers.forEach((v, k) => {
    if (!hopHeaders.has(k.toLowerCase())) outHeaders[k] = v;
  });
  res.writeHead(upstream.status, outHeaders);
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.end(buf);
}

function offlinePage(name, siteUrl) {
  return `<!doctype html><html><head><meta charset="utf-8">
<title>${name} — waiting for the web UI</title>
<style>
 body{margin:0;min-height:100vh;display:grid;place-items:center;background:#08060f;color:#e9e4ff;
 font:16px/1.6 ui-sans-serif,system-ui,sans-serif}
 .card{max-width:560px;padding:32px;border-radius:20px;background:rgba(120,60,255,.07);
 border:1px solid rgba(160,110,255,.25);box-shadow:0 0 60px rgba(130,70,255,.25);backdrop-filter:blur(14px)}
 h1{margin:0 0 12px;font-size:22px;color:#c9a7ff}
 code{background:rgba(160,110,255,.15);padding:2px 7px;border-radius:6px}
</style></head><body><div class="card">
<h1>${name}</h1>
<p>The web interface isn't running yet at <code>${siteUrl}</code>.</p>
<p>In the project folder run:</p>
<p><code>npm install</code> then <code>npm run dev</code></p>
<p>Then refresh this page.</p>
</div></body></html>`;
}

function startPanel({ name, port, basePath }) {
  const siteUrl = config.panels.siteUrl;
  const apiUrl = `http://127.0.0.1:${config.port}`;

  const server = http.createServer(async (req, res) => {
    const [path] = req.url.split("?");
    const query = req.url.slice(path.length);
    try {
      // Agent API always goes to the agent service.
      if (path.startsWith("/api/")) return await forward(req, res, apiUrl, req.url);

      // The owner panel only exposes the owner page; the chat panel hides it.
      let target = path;
      if (basePath === "/owner") {
        if (path === "/" || path === "") target = "/owner";
      } else if (path === "/owner" || path.startsWith("/owner/")) {
        res.writeHead(302, { location: `http://localhost:${config.panels.ownerPort}/` });
        return res.end();
      }
      return await forward(req, res, siteUrl, target + query);
    } catch {
      res.writeHead(503, { "content-type": "text/html; charset=utf-8" });
      res.end(offlinePage(name, siteUrl));
    }
  });

  server.listen(port, () => console.log(`[panel] ${name}: http://localhost:${port}`));
  return server;
}

export function startPanels() {
  if (!config.panels.enabled) return;
  startPanel({ name: "NOVA chat panel", port: config.panels.chatPort, basePath: "/" });
  startPanel({ name: "NOVA owner panel", port: config.panels.ownerPort, basePath: "/owner" });
}
