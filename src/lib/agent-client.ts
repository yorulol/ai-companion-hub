/** Talks to the locally-running YORU agent service. */

const BASE_KEY = "agent.baseUrl";
const OWNER_KEY = "agent.ownerId";

export const DEFAULT_BASE = "http://localhost:8787";

export function getBaseUrl(): string {
  if (typeof window === "undefined") return DEFAULT_BASE;
  return window.localStorage.getItem(BASE_KEY) || DEFAULT_BASE;
}
export function setBaseUrl(url: string) { window.localStorage.setItem(BASE_KEY, url.replace(/\/$/, "")); }
export function getOwnerId(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(OWNER_KEY) || "";
}
export function setOwnerId(id: string) { window.localStorage.setItem(OWNER_KEY, id); }
export function clearOwnerId() { window.localStorage.removeItem(OWNER_KEY); }

async function request<T>(path: string, init?: RequestInit & { owner?: boolean }): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init?.owner || getOwnerId()) headers["x-owner-id"] = getOwnerId();
  const res = await fetch(`${getBaseUrl()}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers as object) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body as T;
}

export type ChatMessage = { role: "user" | "assistant" | "system"; content: string };
export type ToolTrace = { tool: string; args: Record<string, unknown>; result: unknown };

export type HealthInfo = {
  ok: boolean;
  preferred: string;
  openrouter: boolean;
  ollama: boolean;
  openai: boolean;
  anthropic: boolean;
  groq: boolean;
  openclaw: boolean;
  freeModels: number;
  bot: { running: boolean; tag: string | null; guilds: number };
  selfbot: { running: boolean; tag: string | null };
  os: { platform: string; release: string; hostname: string; isWindows: boolean; isLinux: boolean };
  computerEnabled: boolean;
};

export type GuildConfig = {
  id: string;
  name: string;
  prefix: string;
  adminRoles: string[];
  modRoles: string[];
  aiReplies: boolean;
  roles?: { id: string; name: string }[];
};

export type CommandInfo = {
  name: string;
  category: string;
  description: string;
  usage: string;
  permission: "everyone" | "mod" | "admin" | "owner";
};

export const api = {
  health: () => request<HealthInfo>("/api/health"),

  chat: (userText: string, mode: "general" | "coding", scope: string) =>
    request<{ reply: string; provider: string; model: string; tools?: ToolTrace[] }>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ userText, mode, scope }),
    }),

  models: () => request<{ free: string[]; coding: string[]; ollama: string[] }>("/api/models"),

  settings: () => request<Record<string, unknown>>("/api/owner/settings", { owner: true }),
  saveSettings: (patch: Record<string, unknown>) =>
    request<Record<string, unknown>>("/api/owner/settings", { method: "POST", owner: true, body: JSON.stringify(patch) }),

  verifyOwner: (id: string) =>
    fetch(`${getBaseUrl()}/api/owner/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-owner-id": id },
    }).then((r) => r.ok),

  guilds: () => request<{ guilds: GuildConfig[] }>("/api/owner/guilds", { owner: true }),
  saveGuild: (id: string, patch: Partial<GuildConfig>) =>
    request<GuildConfig>(`/api/owner/guilds/${id}`, { method: "POST", owner: true, body: JSON.stringify(patch) }),

  commands: () => request<{ commands: CommandInfo[]; total: number }>("/api/commands"),

  providers: () =>
    request<{
      preferred: string;
      providers: { name: string; enabled: boolean; hasKey: boolean; keyRequired: boolean; model: string | null }[];
    }>("/api/providers"),
  saveProviders: (patch: { preferred?: string; providers?: Record<string, { enabled?: boolean; key?: string }> }) =>
    request<{ ok: true }>("/api/providers", { method: "POST", body: JSON.stringify(patch) }),

  control: (action: "bot:start" | "bot:stop" | "self:start" | "self:stop") =>
    request<{ ok: true }>("/api/owner/control", { method: "POST", owner: true, body: JSON.stringify({ action }) }),

  // ---- Computer control ----
  system: () => request<Record<string, unknown>>("/api/owner/system", { owner: true }),
  fsList: (path: string) => request<{ items: { name: string; type: string }[] }>("/api/owner/fs/list", { method: "POST", owner: true, body: JSON.stringify({ path }) }),
  fsRead: (path: string) => request<{ content: string }>("/api/owner/fs/read", { method: "POST", owner: true, body: JSON.stringify({ path }) }),
  fsWrite: (path: string, content: string) => request<{ path: string; bytes: number }>("/api/owner/fs/write", { method: "POST", owner: true, body: JSON.stringify({ path, content }) }),
  fsMove: (from: string, to: string) => request("/api/owner/fs/move", { method: "POST", owner: true, body: JSON.stringify({ from, to }) }),
  fsRemove: (path: string) => request("/api/owner/fs/remove", { method: "POST", owner: true, body: JSON.stringify({ path }) }),
  scan: () => request<{ code: number; target: string; output: string }>("/api/owner/scan", { method: "POST", owner: true }),
  lockdownEngage: () => request<{ target: string; encryptedFiles: number; decryptionKey: string }>("/api/owner/lockdown/engage", { method: "POST", owner: true }),
  lockdownRelease: (key: string) => request<{ restoredFiles: number; target: string }>("/api/owner/lockdown/release", { method: "POST", owner: true, body: JSON.stringify({ key }) }),
  lockdownStatus: () => request<{ active: boolean; target?: string; files?: number }>("/api/owner/lockdown", { owner: true }),

  // ---- Lookups ----
  lookupFiles: () => request<{ files: string[] }>("/api/owner/lookups", { owner: true }),
  lookup: (query: string) =>
    request<{ query: string; files: number; matches: { file: string; hits?: unknown[]; error?: string }[] }>("/api/owner/lookup", {
      method: "POST", owner: true, body: JSON.stringify({ query }),
    }),
  // ---- Mail Forwarding (mail.thc.org) ----
  mailFwd: <T = unknown>(op: string, args: Record<string, unknown> = {}) =>
    request<{ op: string; result: T }>("/api/email-forward", {
      method: "POST",
      body: JSON.stringify({ op, ...args }),
    }),
  mailFwdOps: () =>
    request<{ ops: string[]; enabled: boolean; hasKey: boolean; base: string }>("/api/email-forward/ops"),
  // ---- Owner activity feed ----
  activity: (since: number = 0) =>
    request<{ events: { id: number; kind: string; message: string; meta: unknown; at: string }[] }>(
      `/api/owner/activity?since=${since}`, { owner: true },
    ),
};
