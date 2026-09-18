/**
 * Web vulnerability scanner. Non-destructive checks that surface likely
 * bug-bounty leads: SQLi/XSS reflection probes, security headers, common
 * exposed paths, cookie flags, and CVE lookup against known software
 * fingerprints via the public NVD API. Results are handed to the AI for
 * interpretation.
 *
 * IMPORTANT: only intended for targets the operator has permission to test.
 */
import { URL } from "node:url";

const UA = "YORU-VulnScan/1.0 (+bug-bounty; contact: owner)";
const TIMEOUT_MS = 12_000;

function timedFetch(url, init = {}) {
  return fetch(url, {
    redirect: "follow",
    ...init,
    headers: { "user-agent": UA, ...(init.headers || {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

const SQLI_PAYLOADS = [`'`, `"`, `' OR '1'='1`, `1)) OR 1=1--`, `';WAITFOR DELAY '0:0:0'--`];
const SQLI_ERRORS = [
  /you have an error in your sql syntax/i,
  /warning:\s*mysql/i,
  /unclosed quotation mark after the character string/i,
  /quoted string not properly terminated/i,
  /pg_query\(\)|postgresql.*ERROR/i,
  /sqlite3?::(?:exception|error)/i,
  /ORA-\d{5}/i,
  /odbc.*sql server/i,
  /native client.*error/i,
];

const XSS_MARKER = "yoru_xss_" + Math.random().toString(36).slice(2, 10);
const XSS_PAYLOADS = [
  `<svg/onload=alert(1)>${XSS_MARKER}`,
  `"><script>${XSS_MARKER}</script>`,
  `'><img src=x onerror=${XSS_MARKER}>`,
];

const SECURITY_HEADERS = [
  "content-security-policy",
  "strict-transport-security",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "permissions-policy",
];

const COMMON_PATHS = [
  "/.env", "/.git/config", "/.git/HEAD", "/wp-config.php.bak",
  "/config.json", "/backup.zip", "/backup.sql", "/phpinfo.php",
  "/server-status", "/actuator", "/actuator/env", "/actuator/health",
  "/api", "/api/", "/api/v1", "/graphql", "/debug", "/console",
  "/robots.txt", "/sitemap.xml", "/.well-known/security.txt",
];

function normalize(target) {
  if (!/^https?:\/\//i.test(target)) target = "https://" + target;
  const u = new URL(target);
  return u;
}

async function fetchBaseline(u) {
  const res = await timedFetch(u.toString());
  const body = (await res.text()).slice(0, 500_000);
  const headers = Object.fromEntries(res.headers.entries());
  return { status: res.status, headers, body, finalUrl: res.url };
}

function fingerprintSoftware(headers, body) {
  const hits = [];
  const server = headers["server"] || "";
  const powered = headers["x-powered-by"] || "";
  const generator = /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i.exec(body)?.[1] || "";
  const wp = /wp-content|wp-includes|wp-json/i.test(body) || /wordpress/i.test(generator);
  const drupal = /drupal-settings-json|drupal\.js/i.test(body) || /drupal/i.test(generator);
  const joomla = /joomla/i.test(generator);
  const laravel = /laravel_session/i.test(headers["set-cookie"] || "");
  const django = /csrftoken/i.test(headers["set-cookie"] || "");
  if (server) hits.push({ type: "server", value: server });
  if (powered) hits.push({ type: "x-powered-by", value: powered });
  if (generator) hits.push({ type: "generator", value: generator });
  if (wp) hits.push({ type: "cms", value: "WordPress" });
  if (drupal) hits.push({ type: "cms", value: "Drupal" });
  if (joomla) hits.push({ type: "cms", value: "Joomla" });
  if (laravel) hits.push({ type: "framework", value: "Laravel" });
  if (django) hits.push({ type: "framework", value: "Django" });
  return hits;
}

function analyzeHeaders(headers) {
  const missing = SECURITY_HEADERS.filter((h) => !headers[h]);
  const cookies = String(headers["set-cookie"] || "").split(/,(?=[^ ])/).filter(Boolean);
  const cookieIssues = cookies.map((c) => {
    const name = c.split("=")[0];
    const issues = [];
    if (!/;\s*httponly/i.test(c)) issues.push("missing HttpOnly");
    if (!/;\s*secure/i.test(c)) issues.push("missing Secure");
    if (!/;\s*samesite/i.test(c)) issues.push("missing SameSite");
    return issues.length ? { cookie: name, issues } : null;
  }).filter(Boolean);
  return { missing, cookieIssues };
}

async function probeParams(u, onNote) {
  const findings = [];
  const params = [...u.searchParams.keys()];
  if (!params.length) return findings;
  for (const key of params) {
    for (const payload of SQLI_PAYLOADS) {
      const test = new URL(u.toString());
      test.searchParams.set(key, payload);
      try {
        const res = await timedFetch(test.toString());
        const body = (await res.text()).slice(0, 200_000);
        const hit = SQLI_ERRORS.find((r) => r.test(body));
        if (hit) {
          findings.push({
            type: "sqli",
            severity: "high",
            param: key,
            payload,
            url: test.toString(),
            evidence: (body.match(hit) || [""])[0].slice(0, 200),
          });
          onNote?.(`sqli suspicion on ?${key}`);
          break;
        }
      } catch {}
    }
    for (const payload of XSS_PAYLOADS) {
      const test = new URL(u.toString());
      test.searchParams.set(key, payload);
      try {
        const res = await timedFetch(test.toString());
        const body = (await res.text()).slice(0, 200_000);
        if (body.includes(payload)) {
          findings.push({
            type: "xss-reflected",
            severity: "high",
            param: key,
            payload,
            url: test.toString(),
            evidence: "payload reflected verbatim in response body",
          });
          onNote?.(`reflected XSS on ?${key}`);
          break;
        }
      } catch {}
    }
  }
  return findings;
}

async function probePaths(u, onNote) {
  const findings = [];
  for (const p of COMMON_PATHS) {
    try {
      const test = new URL(p, u.origin).toString();
      const res = await timedFetch(test, { method: "GET" });
      if (res.status === 200) {
        const body = (await res.text()).slice(0, 4000);
        const suspicious = /root:x:0:0|BEGIN RSA|APP_KEY=|DB_PASSWORD|access_key|secret/i.test(body)
          || p.startsWith("/.git") || p === "/.env" || p.startsWith("/actuator");
        findings.push({
          type: "exposed-path",
          severity: suspicious ? "high" : "info",
          path: p,
          status: res.status,
          url: test,
          evidence: suspicious ? body.slice(0, 300) : `HTTP 200 at ${p}`,
        });
        onNote?.(`${p} → 200`);
      }
    } catch {}
  }
  return findings;
}

async function cveLookup(fingerprints, onNote) {
  const out = [];
  const seen = new Set();
  for (const fp of fingerprints) {
    // Extract product/version tokens like "nginx/1.18.0" or "PHP/7.4.3"
    const m = /^([A-Za-z][\w.-]*)[\/ ]v?(\d+\.\d+(?:\.\d+)?)/.exec(fp.value);
    if (!m) continue;
    const [_, product, version] = m;
    const key = `${product}:${version}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const q = `${product} ${version}`;
    try {
      const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(q)}&resultsPerPage=5`;
      const res = await timedFetch(url);
      if (!res.ok) continue;
      const body = await res.json();
      const items = (body.vulnerabilities || []).slice(0, 5).map((v) => ({
        id: v.cve?.id,
        severity: v.cve?.metrics?.cvssMetricV31?.[0]?.cvssData?.baseSeverity
          || v.cve?.metrics?.cvssMetricV30?.[0]?.cvssData?.baseSeverity
          || v.cve?.metrics?.cvssMetricV2?.[0]?.baseSeverity
          || "unknown",
        score: v.cve?.metrics?.cvssMetricV31?.[0]?.cvssData?.baseScore
          || v.cve?.metrics?.cvssMetricV30?.[0]?.cvssData?.baseScore
          || v.cve?.metrics?.cvssMetricV2?.[0]?.cvssData?.baseScore,
        summary: v.cve?.descriptions?.find((d) => d.lang === "en")?.value?.slice(0, 240),
      }));
      if (items.length) {
        out.push({ product, version, cves: items });
        onNote?.(`${items.length} CVE hits for ${product} ${version}`);
      }
    } catch {}
  }
  return out;
}

/**
 * Run a full scan. `onNote` receives short progress strings for the terminal.
 * The returned object is compact and safe to feed straight into the AI.
 */
export async function scanTarget(target, { onNote } = {}) {
  const u = normalize(target);
  onNote?.(`baseline ${u.origin}${u.pathname}`);
  const baseline = await fetchBaseline(u);
  const fingerprints = fingerprintSoftware(baseline.headers, baseline.body);
  const headerAnalysis = analyzeHeaders(baseline.headers);
  onNote?.("probing query parameters");
  const paramFindings = await probeParams(u, onNote);
  onNote?.("probing common paths");
  const pathFindings = await probePaths(u, onNote);
  onNote?.("checking NVD for known CVEs");
  const cves = await cveLookup(fingerprints, onNote);
  return {
    target: u.toString(),
    status: baseline.status,
    finalUrl: baseline.finalUrl,
    fingerprints,
    missingSecurityHeaders: headerAnalysis.missing,
    cookieIssues: headerAnalysis.cookieIssues,
    findings: [...paramFindings, ...pathFindings],
    cves,
    scannedAt: new Date().toISOString(),
  };
}
