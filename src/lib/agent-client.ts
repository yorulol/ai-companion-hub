/**
 * Talks to the locally-running agent service (the `agent/` folder in this repo).
 * Default: http://localhost:8787 — override from the panels and it is remembered
 * in this browser.
 */

const BASE_KEY = "agent.baseUrl";
const OWNER_KEY = "agent.ownerId";

export const DEFAULT_BASE = "http://localhost:8787";

export function getBaseUrl(): string {
  if (typeof window === "undefined") return DEFAULT_BASE;
  return window.localStorage.getItem(BASE_KEY) || DEFAULT_BASE;
}

export function setBaseUrl(url: string) {
  window.localStorage.setItem(BASE_KEY, url.replace(/\/$/, ""));
}

export function getOwnerId(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(OWNER_KEY) || "";
}

export function setOwnerId(id: string) {
  window.localStorage.setItem(OWNER_KEY, id);
}

export function clearOwnerId() {
  window.localStorage.removeItem(OWNER_KEY);
}

async function request<T>(path: string, init?: RequestInit & { owner?: boolean }): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init?.owner) headers["x-owner-id"] = getOwnerId();

  const res = await fetch(`${getBaseUrl()}${path}`, { ...init, headers: { ...headers, ...(init?.headers as object) } });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body as T;
}

export type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

export type HealthInfo = {
  ok: boolean;
  openrouter: boolean;
  ollama: boolean;
  bot: { running: boolean; tag: string | null; guilds: number };
  selfbot: { running: boolean; tag: string | null };
  freeModels: number;
};

export const api = {
  health: () => request<HealthInfo>("/api/health"),

  chat: (messages: ChatMessage[], mode: "general" | "coding") =>
    request<{ reply: string; provider: string; model: string }>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ messages, mode }),
    }),

  models: () => request<{ free: string[]; coding: string[]; ollama: string[] }>("/api/models"),

  settings: () => request<Record<string, unknown>>("/api/owner/settings", { owner: true }),

  saveSettings: (patch: Record<string, unknown>) =>
    request<Record<string, unknown>>("/api/owner/settings", {
      method: "POST",
      owner: true,
      body: JSON.stringify(patch),
    }),

  verifyOwner: (id: string) =>
    fetch(`${getBaseUrl()}/api/owner/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-owner-id": id },
    }).then((r) => r.ok),

  guilds: () => request<{ guilds: GuildConfig[] }>("/api/owner/guilds", { owner: true }),

  saveGuild: (id: string, patch: Partial<GuildConfig>) =>
    request<GuildConfig>(`/api/owner/guilds/${id}`, {
      method: "POST",
      owner: true,
      body: JSON.stringify(patch),
    }),

  commands: () => request<{ commands: CommandInfo[]; total: number }>("/api/commands"),

  control: (action: "bot:start" | "bot:stop" | "self:start" | "self:stop") =>
    request<{ ok: true }>("/api/owner/control", {
      method: "POST",
      owner: true,
      body: JSON.stringify({ action }),
    }),
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
