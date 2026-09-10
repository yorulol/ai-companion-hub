/** Email Forward client for reads.phrack.org.
 *  Supports the documented operations: analyze, headers, urls, attachments,
 *  threat (score), and a generic passthrough. All operations require
 *  EMAIL_FORWARD_ENABLED=true and EMAIL_FORWARD_API_KEY set.
 */
import { config } from "./config.js";
import { logActivity } from "./activity.js";

const OPS = {
  analyze:     { path: "/analyze",           body: (e) => ({ email: e }) },
  headers:     { path: "/headers",           body: (e) => ({ email: e }) },
  urls:        { path: "/urls",              body: (e) => ({ email: e }) },
  attachments: { path: "/attachments",       body: (e) => ({ email: e }) },
  threat:      { path: "/threat",            body: (e) => ({ email: e }) },
  parse:       { path: "/parse",             body: (e) => ({ email: e }) },
};

export const supportedOps = () => Object.keys(OPS);

export async function runEmailForward(op, email, extra = {}) {
  const ef = config.emailForward;
  if (!ef.enabled || !ef.key) {
    throw new Error("Email Forward is disabled. Set EMAIL_FORWARD_ENABLED=true and EMAIL_FORWARD_API_KEY in .env.");
  }
  if (!email || typeof email !== "string") throw new Error("Paste the raw email content first.");
  const spec = OPS[op] || OPS.analyze;
  const url = `${ef.base}${spec.path}`;
  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json",
      Authorization: `Bearer ${ef.key}`,
      "x-api-key": ef.key,
    },
    body: JSON.stringify({ ...spec.body(email), ...extra }),
    signal: AbortSignal.timeout(90_000),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  logActivity("email-forward", `${op} → ${res.status} (${Date.now() - started}ms)`, { op, status: res.status });
  if (!res.ok) throw new Error(body?.error || body?.message || `Email Forward API ${res.status}`);
  return { op, result: body };
}
