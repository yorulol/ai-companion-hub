/** Mail Forwarding client for mail.thc.org / reads.phrack.org API.
 *  Implements the full public + API-key wire contract from the docs.
 *  Config: EMAIL_FORWARD_ENABLED, EMAIL_FORWARD_API_KEY, EMAIL_FORWARD_API_URL
 */
import { config } from "./config.js";
import { logActivity } from "./activity.js";

/* ── helpers ─────────────────────────────────────────────────────── */

function ef() {
  const c = config.emailForward;
  if (!c.enabled) throw new Error("Mail forwarding disabled. Set EMAIL_FORWARD_ENABLED=true in .env");
  return c;
}

async function hit(method, path, { query, body, useKey } = {}) {
  const c = ef();
  let url = `${c.base}${path}`;
  if (query) {
    const qs = new URLSearchParams(query).toString();
    if (qs) url += `?${qs}`;
  }
  const headers = { accept: "application/json" };
  if (body) headers["content-type"] = "application/json";
  if (useKey) {
    if (!c.key) throw new Error("EMAIL_FORWARD_API_KEY not set in .env");
    headers["x-api-key"] = c.key;
  }
  const started = Date.now();
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  logActivity("mail-fwd", `${method} ${path} → ${res.status} (${Date.now() - started}ms)`, { path, status: res.status });
  if (!res.ok) throw new Error(data?.error || data?.message || `API ${res.status}`);
  return data;
}

/* ── Public routes (no API key needed) ───────────────────────────── */

/** GET /api/domains — list all public mail domains */
export const listDomains = () => hit("GET", "/domains");

/** GET /api/stats — { domains, aliases, forwarded } */
export const getStats = () => hit("GET", "/stats");

/** GET /api/forward/subscribe — start alias creation (sends confirmation email) */
export const aliasSubscribe = (name, domain, to) =>
  hit("GET", "/forward/subscribe", { query: { name, domain, to } });

/** GET /api/forward/unsubscribe — start alias removal */
export const aliasUnsubscribe = (alias) =>
  hit("GET", "/forward/unsubscribe", { query: { alias } });

/** POST /api/forward/confirm — confirm alias create/remove with 6-digit token */
export const aliasConfirm = (token) =>
  hit("POST", "/forward/confirm", { body: { token } });

/** GET /api/handle/subscribe — start handle creation */
export const handleSubscribe = (handle, to) =>
  hit("GET", "/handle/subscribe", { query: { handle, to } });

/** GET /api/handle/unsubscribe — start handle removal */
export const handleUnsubscribe = (handle) =>
  hit("GET", "/handle/unsubscribe", { query: { handle } });

/** POST /api/handle/confirm — confirm handle create/remove */
export const handleConfirm = (token) =>
  hit("POST", "/handle/confirm", { body: { token } });

/** GET /api/handle/domain/disable — disable one domain for a handle */
export const handleDomainDisable = (handle, domain) =>
  hit("GET", "/handle/domain/disable", { query: { handle, domain } });

/** GET /api/handle/domain/enable — enable one domain for a handle */
export const handleDomainEnable = (handle, domain) =>
  hit("GET", "/handle/domain/enable", { query: { handle, domain } });

/** GET /api/checkdns/:target — DNS status for a domain */
export const checkDns = (target) => hit("GET", `/checkdns/${encodeURIComponent(target)}`);

/** POST /api/credentials/create — request an API key */
export const credentialsCreate = (email, days = 30, automatic_renew = false) =>
  hit("POST", "/credentials/create", { body: { email, days, automatic_renew } });

/** POST /api/credentials/confirm — confirm (GET previews, POST issues the key) */
export const credentialsConfirmPreview = (token) =>
  hit("GET", "/credentials/confirm", { query: { token } });
export const credentialsConfirm = (token) =>
  hit("POST", "/credentials/confirm", { body: { token } });

/** POST /api/credentials/renew — extend an active key */
export const credentialsRenew = (api_key, days = 30) =>
  hit("POST", "/credentials/renew", { body: { api_key, days } });

/** POST /api/credentials/automatic-renew — toggle auto-renew */
export const credentialsAutoRenew = (api_key, automatic_renew) =>
  hit("POST", "/credentials/automatic-renew", { body: { api_key, automatic_renew } });

/** POST /api/credentials/destroy — destroy one key */
export const credentialsDestroy = (api_key) =>
  hit("POST", "/credentials/destroy", { body: { api_key } });

/* ── API-key routes (require X-API-Key) ──────────────────────────── */

/** GET /api/alias/list */
export const aliasList = (limit = 50, offset = 0) =>
  hit("GET", "/alias/list", { query: { limit, offset }, useKey: true });

/** GET /api/alias/stats */
export const aliasStats = () => hit("GET", "/alias/stats", { useKey: true });

/** GET /api/activity */
export const aliasActivity = (limit = 50, offset = 0) =>
  hit("GET", "/activity", { query: { limit, offset }, useKey: true });

/** POST /api/alias/create */
export const aliasCreate = (alias_handle, alias_domain) =>
  hit("POST", "/alias/create", { body: { alias_handle, alias_domain }, useKey: true });

/** POST /api/alias/delete */
export const aliasDelete = (alias) =>
  hit("POST", "/alias/delete", { body: { alias }, useKey: true });

/** POST /api/handle/create */
export const handleCreate = (handle) =>
  hit("POST", "/handle/create", { body: { handle }, useKey: true });

/** POST /api/handle/delete */
export const handleDelete = (handle) =>
  hit("POST", "/handle/delete", { body: { handle }, useKey: true });

/** POST /api/handle/domain/disable (API key) */
export const handleDomainDisableKey = (handle, domain) =>
  hit("POST", "/handle/domain/disable", { body: { handle, domain }, useKey: true });

/** POST /api/handle/domain/enable (API key) */
export const handleDomainEnableKey = (handle, domain) =>
  hit("POST", "/handle/domain/enable", { body: { handle, domain }, useKey: true });

/* ── Router for the HTTP server ──────────────────────────────────── */

const OPS = {
  // Public
  domains:              (b) => listDomains(),
  stats:                (b) => getStats(),
  "alias-subscribe":    (b) => aliasSubscribe(b.name, b.domain, b.to),
  "alias-unsubscribe":  (b) => aliasUnsubscribe(b.alias),
  "alias-confirm":      (b) => aliasConfirm(b.token),
  "handle-subscribe":   (b) => handleSubscribe(b.handle, b.to),
  "handle-unsubscribe": (b) => handleUnsubscribe(b.handle),
  "handle-confirm":     (b) => handleConfirm(b.token),
  "handle-domain-disable": (b) => handleDomainDisable(b.handle, b.domain),
  "handle-domain-enable":  (b) => handleDomainEnable(b.handle, b.domain),
  "check-dns":          (b) => checkDns(b.target),
  "credentials-create": (b) => credentialsCreate(b.email, b.days, b.automatic_renew),
  "credentials-confirm-preview": (b) => credentialsConfirmPreview(b.token),
  "credentials-confirm": (b) => credentialsConfirm(b.token),
  "credentials-renew":  (b) => credentialsRenew(b.api_key, b.days),
  "credentials-auto-renew": (b) => credentialsAutoRenew(b.api_key, b.automatic_renew),
  "credentials-destroy": (b) => credentialsDestroy(b.api_key),
  // API-key
  "alias-list":         (b) => aliasList(b.limit, b.offset),
  "alias-stats":        () => aliasStats(),
  "alias-activity":     (b) => aliasActivity(b.limit, b.offset),
  "alias-create":       (b) => aliasCreate(b.alias_handle, b.alias_domain),
  "alias-delete":       (b) => aliasDelete(b.alias),
  "handle-create":      (b) => handleCreate(b.handle),
  "handle-delete":      (b) => handleDelete(b.handle),
  "handle-domain-disable-key": (b) => handleDomainDisableKey(b.handle, b.domain),
  "handle-domain-enable-key":  (b) => handleDomainEnableKey(b.handle, b.domain),
};

export const supportedOps = () => Object.keys(OPS);

export async function runEmailForward(op, body = {}) {
  const fn = OPS[op];
  if (!fn) throw new Error(`Unknown operation: ${op}. Supported: ${Object.keys(OPS).join(", ")}`);
  const result = await fn(body);
  return { op, result };
}
