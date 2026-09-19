/**
 * YORU deep-scan extras. Non-destructive probes that layer on top of
 * vuln-scan.js core: GraphQL introspection, JWT weakness detection, host-
 * header injection + cache poisoning, prototype pollution, HTTP smuggling
 * fingerprints, DOM-XSS sinks, subdomain enum (crt.sh), WebSocket sniff,
 * expanded well-known + secret + path catalogues, form-body param probing.
 *
 * All exports return arrays of normalized findings (same shape as core).
 */

import { URL } from "node:url";
import { randomBytes, createHash } from "node:crypto";

const UA = "YORU-DeepScan/2.1 (+bug-bounty)";
const TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 800_000;
const hash = (s) => createHash("sha1").update(s).digest("hex").slice(0, 10);
const marker = () => "yr" + randomBytes(4).toString("hex");

function mk(f) {
  return {
    id: hash(`${f.type}|${f.url || ""}|${f.param || ""}|${f.path || ""}`),
    severity: "info", confidence: "medium", references: [], remediation: "",
    ...f,
  };
}

async function tfetch(url, init = {}) {
  return fetch(url, {
    redirect: "follow", ...init,
    headers: { "user-agent": UA, accept: "*/*", ...(init.headers || {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}
async function ftext(url, init) {
  const t0 = Date.now();
  try {
    const r = await tfetch(url, init);
    const buf = await r.arrayBuffer();
    return { ok: true, status: r.status, url: r.url,
      headers: Object.fromEntries(r.headers.entries()),
      body: Buffer.from(buf).slice(0, MAX_BODY_BYTES).toString("utf8"),
      timeMs: Date.now() - t0 };
  } catch (e) { return { ok: false, error: e.message, timeMs: Date.now() - t0 }; }
}

// ────────── extended path catalogues ──────────
export const EXTRA_PATHS = [
  "/.env.dev", "/.env.staging", "/.env.example", "/.env.sample",
  "/.git/index", "/.git/refs/heads/main", "/.git/refs/heads/master",
  "/.git/objects/info/packs", "/.gitlab-ci.yml", "/.circleci/config.yml",
  "/.travis.yml", "/.github/workflows/deploy.yml",
  "/.idea/workspace.xml", "/.vscode/settings.json",
  "/CHANGELOG.md", "/README.md", "/LICENSE",
  "/Dockerfile", "/docker-compose.yml", "/docker-compose.yaml",
  "/kustomization.yaml", "/values.yaml", "/helm/values.yaml",
  "/terraform.tfstate", "/terraform.tfstate.backup",
  "/config/database.yml", "/config/secrets.yml", "/config/master.key",
  "/config/credentials/production.key", "/config/credentials.yml.enc",
  "/appsettings.json", "/appsettings.Production.json", "/web.config",
  "/WEB-INF/web.xml", "/WEB-INF/classes/application.properties",
  "/application.properties", "/application.yml", "/application-prod.yml",
  "/bootstrap.yml", "/META-INF/MANIFEST.MF",
  "/actuator/beans", "/actuator/threaddump", "/actuator/loggers",
  "/actuator/metrics", "/actuator/httptrace", "/actuator/configprops",
  "/actuator/scheduledtasks", "/actuator/gateway/routes",
  "/spring-security-oauth2-authorization-server", "/env", "/mappings",
  "/metrics/prometheus", "/-/metrics", "/api/metrics",
  "/health", "/healthz", "/readyz", "/livez", "/status",
  "/.well-known/openid-configuration", "/.well-known/oauth-authorization-server",
  "/.well-known/apple-app-site-association", "/.well-known/assetlinks.json",
  "/.well-known/change-password", "/.well-known/host-meta", "/.well-known/nodeinfo",
  "/graphql", "/graphiql", "/playground", "/altair", "/voyager",
  "/api/graphql", "/v1/graphql", "/query", "/gql",
  "/swagger", "/swagger/v1/swagger.json", "/api-docs", "/api/docs",
  "/api/swagger.json", "/redoc", "/docs.json", "/openapi.yml",
  "/rest/v1", "/api/private", "/api/internal", "/internal/api",
  "/CVS/Root", "/CVS/Entries", "/_wpeprivate/config.json",
  "/adminer.php", "/pma/", "/phpmyadmin/", "/phpMyAdmin/", "/sqlbuddy/",
  "/.htaccess", "/.htpasswd",
  "/crossdomain.xml", "/clientaccesspolicy.xml",
  "/console/", "/h2-console/", "/druid/index.html",
  "/nacos/", "/eureka/", "/hystrix/", "/turbine/",
  "/geoserver/web/", "/rabbitmq/", "/activemq/",
];

export const EXTRA_SECRETS = [
  { name: "Twilio SID", r: /AC[a-f0-9]{32}/g, sev: "high" },
  { name: "Twilio token", r: /SK[a-f0-9]{32}/g, sev: "high" },
  { name: "SendGrid key", r: /SG\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}/g, sev: "critical" },
  { name: "Mailgun key", r: /key-[a-f0-9]{32}/g, sev: "high" },
  { name: "DigitalOcean token", r: /dop_v1_[a-f0-9]{64}/g, sev: "critical" },
  { name: "Heroku key", r: /[hH]eroku.{0,20}["'][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}["']/g, sev: "high" },
  { name: "Firebase URL", r: /https?:\/\/[a-z0-9-]+\.firebaseio\.com/gi, sev: "medium" },
  { name: "npm token", r: /npm_[A-Za-z0-9]{36}/g, sev: "critical" },
  { name: "PyPI token", r: /pypi-AgEIcHlwaS5vcmc[A-Za-z0-9_\-]{50,}/g, sev: "critical" },
  { name: "Cloudflare token", r: /CF-[A-Za-z0-9_\-]{40,}/g, sev: "high" },
  { name: "Discord bot token", r: /[MN][A-Za-z0-9]{23}\.[\w-]{6}\.[\w-]{27,}/g, sev: "critical" },
  { name: "Discord webhook", r: /https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_\-]+/g, sev: "high" },
  { name: "Telegram bot", r: /\d{9,10}:AA[A-Za-z0-9_\-]{33}/g, sev: "high" },
  { name: "Facebook access token", r: /EAA[A-Za-z0-9]{80,}/g, sev: "high" },
  { name: "Square access token", r: /sq0atp-[A-Za-z0-9_\-]{22}/g, sev: "high" },
  { name: "Square OAuth secret", r: /sq0csp-[A-Za-z0-9_\-]{43}/g, sev: "critical" },
  { name: "Algolia key", r: /"?algolia[A-Za-z]{0,20}[Kk]ey"?\s*[:=]\s*["'][a-f0-9]{32}["']/g, sev: "medium" },
];

// ────────── GraphQL introspection ──────────
export async function probeGraphQL(origin, onNote) {
  const findings = [];
  const paths = ["/graphql", "/api/graphql", "/v1/graphql", "/query", "/gql"];
  const introspection = { query: "query IntrospectionQuery{__schema{queryType{name} mutationType{name} types{name kind}}}" };
  for (const p of paths) {
    const url = new URL(p, origin).toString();
    const r = await ftext(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(introspection),
    });
    if (!r.ok) continue;
    if (r.status === 200 && /__schema/.test(r.body) && /"types"/.test(r.body)) {
      findings.push(mk({
        type: "graphql-introspection", severity: "medium", confidence: "high",
        title: `GraphQL introspection exposed at ${p}`,
        description: "Schema introspection returned the full type graph — enumeration surface for attackers.",
        url, path: p, evidence: r.body.slice(0, 260),
        remediation: "Disable introspection in production (Apollo `introspection: false`, graphql-yoga `disableIntrospection`).",
        references: ["https://cheatsheetseries.owasp.org/cheatsheets/GraphQL_Cheat_Sheet.html"],
      }));
      onNote?.(`graphql introspection at ${p}`);
    }
    // GraphiQL / Playground UIs
    const g = await ftext(url);
    if (g.ok && /GraphiQL|GraphQL Playground|Altair/i.test(g.body)) {
      findings.push(mk({
        type: "graphql-ui", severity: "low", confidence: "high",
        title: `GraphQL IDE UI at ${p}`,
        description: "Interactive query UI reachable without auth.",
        url, path: p,
        remediation: "Serve GraphQL IDE only in non-production or behind auth.",
      }));
    }
  }
  return findings;
}

// ────────── JWT weakness (cookies + JS bundles) ──────────
export function scanJwts(url, text) {
  const findings = [];
  const jwtRe = /eyJ[A-Za-z0-9_\-]{6,}\.eyJ[A-Za-z0-9_\-]{6,}\.[A-Za-z0-9_\-]*/g;
  const seen = new Set();
  for (const m of text.matchAll(jwtRe)) {
    const tok = m[0]; if (seen.has(tok)) continue; seen.add(tok);
    try {
      const [h] = tok.split(".");
      const header = JSON.parse(Buffer.from(h.padEnd(h.length + (4 - h.length % 4) % 4, "="), "base64").toString("utf8"));
      const alg = String(header.alg || "").toLowerCase();
      if (alg === "none") findings.push(mk({
        type: "jwt-alg-none", severity: "critical", confidence: "high", url,
        title: "JWT with alg=none observed",
        description: "Server accepts / issues JWTs with alg=none — signature check can be trivially bypassed.",
        evidence: tok.slice(0, 60) + "...",
        remediation: "Reject alg=none. Pin allowed algs (e.g. RS256/EdDSA) explicitly.",
      }));
      else if (alg === "hs256" || alg === "hs384" || alg === "hs512") findings.push(mk({
        type: "jwt-hs-secret", severity: "medium", confidence: "low", url,
        title: `Symmetric JWT (${alg}) exposed to client`,
        description: "HMAC-signed JWT visible to the browser — if the shared secret leaks, tokens can be forged.",
        evidence: tok.slice(0, 60) + "...",
        remediation: "Prefer asymmetric algs (RS256/EdDSA). Rotate secret if leaked.",
      }));
    } catch {}
  }
  return findings;
}

// ────────── Host-header injection + cache poisoning ──────────
export async function probeHostHeader(baseUrl) {
  const findings = [];
  const evil = `evil-${randomBytes(3).toString("hex")}.example.com`;
  const attempts = [
    { h: { host: evil }, name: "Host override" },
    { h: { "x-forwarded-host": evil }, name: "X-Forwarded-Host reflection" },
    { h: { "x-host": evil }, name: "X-Host reflection" },
    { h: { "x-forwarded-server": evil }, name: "X-Forwarded-Server reflection" },
    { h: { forwarded: `host=${evil}` }, name: "Forwarded host reflection" },
  ];
  for (const a of attempts) {
    const r = await ftext(baseUrl, { headers: a.h }).catch(() => null);
    if (!r?.ok) continue;
    const bodyHit = r.body && r.body.includes(evil);
    const locHit = /(?:^|\s)location:\s*[^\n]*evil-/i.test(Object.entries(r.headers).map(([k,v])=>`${k}:${v}`).join("\n"));
    if (bodyHit || locHit) findings.push(mk({
      type: "host-header-injection", severity: "high", confidence: bodyHit ? "high" : "medium",
      url: baseUrl,
      title: `${a.name} reflected`,
      description: `Injected host \`${evil}\` via ${Object.keys(a.h)[0]} — appears in ${bodyHit ? "response body" : "response headers"}. Password-reset link poisoning / cache poisoning possible.`,
      evidence: bodyHit ? r.body.match(new RegExp(".{0,80}" + evil + ".{0,80}"))?.[0] : "reflected in headers",
      remediation: "Bind absolute URLs to a fixed canonical host. Ignore untrusted host headers.",
    }));
  }
  return findings;
}

// ────────── Cache-poisoning header probe ──────────
export async function probeCachePoisoning(url) {
  const findings = [];
  const poison = `yrcp${randomBytes(3).toString("hex")}`;
  const headers = { "x-forwarded-scheme": "nothttps", "x-original-url": `/${poison}`, "x-rewrite-url": `/${poison}` };
  const r = await ftext(url, { headers }).catch(() => null);
  if (r?.ok && r.body.includes(poison)) findings.push(mk({
    type: "cache-poisoning", severity: "high", confidence: "medium", url,
    title: "Unkeyed header reflected in body",
    description: `Values from X-Original-URL / X-Rewrite-URL reach the response — feeding a shared cache with this input can poison other users.`,
    evidence: `marker=${poison}`,
    remediation: "Do not consume rewrite headers unless from a trusted proxy; strip them at the edge.",
  }));
  return findings;
}

// ────────── HTTP smuggling fingerprint (indicators only, non-destructive) ──────────
export function smugglingIndicators(url, headers) {
  const findings = [];
  const hopByHop = ["transfer-encoding", "connection", "keep-alive", "proxy-authenticate", "trailer", "upgrade"];
  const suspicious = hopByHop.filter((h) => headers[h]);
  if (headers["transfer-encoding"] && headers["content-length"]) findings.push(mk({
    type: "smuggling-hint", severity: "medium", confidence: "low", url,
    title: "Both Transfer-Encoding and Content-Length present",
    description: "Coexisting TE and CL headers are a canonical HTTP request smuggling precondition when a front proxy differs from the origin. Manual verification required.",
    evidence: `TE=${headers["transfer-encoding"]} · CL=${headers["content-length"]}`,
    remediation: "Ensure the front proxy strips one of the two and origin normalises framing.",
    references: ["https://portswigger.net/web-security/request-smuggling"],
  }));
  if (suspicious.length > 2) findings.push(mk({
    type: "hop-headers", severity: "info", confidence: "low", url,
    title: "Unusual hop-by-hop headers leaked",
    description: `Headers ${suspicious.join(", ")} were forwarded — possible proxy misconfig.`,
  }));
  return findings;
}

// ────────── Prototype-pollution query test ──────────
export async function probeProtoPollution(url) {
  const findings = [];
  try {
    const u = new URL(url);
    u.searchParams.set("__proto__[yrpp]", "1");
    u.searchParams.set("constructor[prototype][yrpp2]", "1");
    const r = await ftext(u.toString());
    if (r.ok && /"yrpp":\s*"?1"?|yrpp2/.test(r.body)) findings.push(mk({
      type: "proto-pollution", severity: "high", confidence: "medium", url: u.toString(),
      title: "Query prototype-pollution reflection",
      description: "Server-side deep merge appears to accept `__proto__` / `constructor.prototype` keys from query string.",
      remediation: "Reject `__proto__`, `constructor`, `prototype` keys. Use safe merge (lodash `mergeWith` + sanitizer, `Object.create(null)`).",
    }));
  } catch {}
  return findings;
}

// ────────── DOM XSS sinks in JS ──────────
const DOM_SINKS = [
  { name: "document.write from location", rx: /document\.write\s*\([^)]*(?:location|document\.URL|document\.referrer)/ },
  { name: "innerHTML from location", rx: /\.innerHTML\s*=\s*[^;]*(?:location|document\.URL|referrer|window\.name)/ },
  { name: "eval on user input", rx: /\beval\s*\([^)]*(?:location|document\.URL|referrer|window\.name|postMessage)/ },
  { name: "setTimeout string arg from input", rx: /setTimeout\s*\(\s*['"`][^)]*(?:location|referrer)/ },
  { name: "unrestricted postMessage listener", rx: /addEventListener\s*\(\s*['"]message['"][\s\S]{0,200}?(?!origin)/ },
  { name: "insecure document.domain assign", rx: /document\.domain\s*=/ },
];
export function scanDomSinks(url, body) {
  const findings = [];
  for (const s of DOM_SINKS) {
    if (s.rx.test(body)) findings.push(mk({
      type: "dom-xss-sink", severity: "medium", confidence: "low", url,
      title: `DOM-XSS sink pattern: ${s.name}`,
      description: "Static pattern match — verify manually if the sink is fed by attacker-controlled input.",
      evidence: (body.match(s.rx) || [""])[0].slice(0, 180),
      remediation: "Sanitize before assigning to sinks. Prefer textContent, safe templating, and origin-checked postMessage.",
      references: ["https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html"],
    }));
  }
  return findings;
}

// ────────── crt.sh subdomain enum (public CT log) ──────────
export async function subdomainEnum(host, onNote) {
  const findings = [];
  try {
    const r = await tfetch(`https://crt.sh/?q=%25.${encodeURIComponent(host)}&output=json`);
    if (!r.ok) return findings;
    const arr = await r.json().catch(() => []);
    const set = new Set();
    for (const row of arr) String(row.name_value || "").split(/\n+/).forEach((n) => {
      const s = n.trim().toLowerCase();
      if (s && s.endsWith(host) && s !== host && !s.includes("*")) set.add(s);
    });
    const subs = [...set].slice(0, 50);
    if (subs.length) {
      onNote?.(`ct-log subdomains: ${subs.length}`);
      findings.push(mk({
        type: "subdomain-enum", severity: "info", confidence: "high",
        url: `https://crt.sh/?q=%25.${host}`,
        title: `${subs.length} subdomains discovered via CT logs`,
        description: "Certificate transparency reveals candidate subdomains — expand scan scope here.",
        evidence: subs.slice(0, 20).join(", "),
        remediation: "Not itself a vulnerability. Audit each subdomain for takeover / stale endpoints.",
      }));
    }
  } catch {}
  return findings;
}

// ────────── WebSocket endpoint sniff ──────────
export function detectWebsocket(url, headers, body) {
  const findings = [];
  const wsUrl = (body.match(/wss?:\/\/[^\s"'<>]+/) || [])[0];
  if (wsUrl) findings.push(mk({
    type: "websocket-endpoint", severity: "info", confidence: "medium", url,
    title: "WebSocket endpoint referenced",
    description: `Page references ${wsUrl} — test for origin-validation bypass, missing auth on messages, DoS.`,
    remediation: "Enforce origin check on the WS handshake; authenticate every message; rate-limit.",
  }));
  return findings;
}

// ────────── Form-body param probing (POST) ──────────
const XSS_BODY = (m) => [`<svg/onload=alert(1)>${m}`, `"><script>${m}</script>`];
const SQLI_BODY = [`'`, `' OR '1'='1`, `';SELECT pg_sleep(0)--`];
const SQL_ERR = /(?:sql syntax|mysql|postgres|sqlite|ORA-\d{5}|SQLSTATE\[|ODBC.*SQL Server)/i;

export async function probeFormBodies(forms, onNote) {
  const findings = [];
  for (const f of forms.filter((x) => x.method === "post")) {
    if (!f.inputs.length) continue;
    for (const inp of f.inputs.slice(0, 6)) {
      if (/^(?:submit|button|image|reset|hidden)$/i.test(inp.type)) continue;
      const mk1 = marker();
      // XSS
      for (const p of XSS_BODY(mk1)) {
        const body = new URLSearchParams();
        for (const i of f.inputs) body.set(i.name, i.name === inp.name ? p : "yr");
        const r = await ftext(f.action, {
          method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });
        if (r.ok && r.body.includes(p)) {
          findings.push(mk({
            type: "xss-reflected", severity: "high", confidence: "high",
            url: f.action, param: inp.name, payload: p,
            title: `Reflected XSS via POST body param ${inp.name}`,
            description: "Form field reflected verbatim without encoding.",
            remediation: "Encode output; add strict CSP; validate POST inputs.",
          }));
          onNote?.(`xss on POST ${inp.name}`);
          break;
        }
      }
      // SQLi error
      for (const p of SQLI_BODY) {
        const body = new URLSearchParams();
        for (const i of f.inputs) body.set(i.name, i.name === inp.name ? p : "1");
        const r = await ftext(f.action, {
          method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });
        if (r.ok && SQL_ERR.test(r.body)) {
          findings.push(mk({
            type: "sqli-error", severity: "high", confidence: "high",
            url: f.action, param: inp.name, payload: p,
            title: `SQL error reflected via POST param ${inp.name}`,
            description: "Database error surfaced when the POST field contained SQL metacharacters.",
            evidence: (r.body.match(SQL_ERR) || [""])[0].slice(0, 200),
            remediation: "Parameterize queries; validate inputs.",
          }));
          onNote?.(`sqli on POST ${inp.name}`);
          break;
        }
      }
    }
  }
  return findings;
}

// ────────── HTTP method fuzz (WebDAV, DEBUG) ──────────
export async function probeExtraMethods(url) {
  const findings = [];
  for (const method of ["PROPFIND", "DEBUG", "TRACK"]) {
    try {
      const r = await tfetch(url, { method });
      if (r.status === 200 || r.status === 207) findings.push(mk({
        type: "http-method-open", severity: method === "PROPFIND" ? "medium" : "low",
        url, title: `${method} accepted (HTTP ${r.status})`,
        description: `Server accepts ${method}. PROPFIND indicates WebDAV; DEBUG/TRACK enable header disclosure.`,
        remediation: "Disable unused HTTP verbs at the web server.",
      }));
    } catch {}
  }
  return findings;
}
