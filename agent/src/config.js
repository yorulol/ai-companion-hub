import "dotenv/config";
import os from "node:os";

const bool = (v, fallback = false) =>
  v === undefined || v === "" ? fallback : ["1", "true", "yes", "on"].includes(String(v).toLowerCase());

const integer = (v, fallback, min, max) => {
  const parsed = Number.parseInt(v ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

const homeDir = os.homedir();

const ownerIds = [
  ...(process.env.OWNER_DISCORD_ID || "").split(","),
  ...(process.env.OWNER_DISCORD_IDS || "").split(","),
].map((s) => s.trim()).filter(Boolean);

export const isOwnerId = (id) => !!id && ownerIds.includes(String(id));

export const config = {
  ownerId: ownerIds[0] || "",
  ownerIds,

  port: Number(process.env.PORT || 8787),
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim()),

  panels: {
    enabled: bool(process.env.PANELS_ENABLED, true),
    chatPort: Number(process.env.CHAT_PANEL_PORT || 8788),
    ownerPort: Number(process.env.OWNER_PANEL_PORT || 8789),
    siteUrl: (process.env.SITE_URL || "http://localhost:8080").replace(/\/$/, ""),
  },

  providers: {
    preferred: (process.env.PREFERRED_PROVIDER || "openrouter").toLowerCase(),
    openrouter: {
      enabled: bool(process.env.OPENROUTER_ENABLED, true),
      key: process.env.OPENROUTER_API_KEY || "",
      siteUrl: process.env.OPENROUTER_SITE_URL || "http://localhost:8787",
      appName: process.env.OPENROUTER_APP_NAME || "YORU Agent",
      base: "https://openrouter.ai/api/v1",
      maxAttempts: integer(process.env.OPENROUTER_MAX_ATTEMPTS, 3, 1, 12),
    },
    ollama: {
      enabled: bool(process.env.OLLAMA_ENABLED, true),
      url: (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, ""),
      // Default swapped to the 1B chat model: ~1.3 GB, fully on a 6 GB GPU,
      // and 3-5x faster tok/s than the 3B on a 1660 Ti. Old defaults auto-migrate.
      model: ["llama3.1", "llama3.1:8b-instruct-q4_K_M", "llama3.2:3b-instruct-q4_K_M"].includes(process.env.OLLAMA_MODEL || "")
        ? "llama3.2:1b-instruct-q4_K_M"
        : process.env.OLLAMA_MODEL || "llama3.2:1b-instruct-q4_K_M",
      codeModel: process.env.OLLAMA_CODE_MODEL || "qwen2.5-coder",
      numCtx: integer(process.env.OLLAMA_NUM_CTX, 1024, 512, 32768),
      numPredict: integer(process.env.OLLAMA_NUM_PREDICT, 256, 32, 8192),
      historyMessages: integer(process.env.OLLAMA_HISTORY_MESSAGES, 6, 2, 24),
      numBatch: integer(process.env.OLLAMA_NUM_BATCH, 512, 64, 4096),
      numGpu: integer(process.env.OLLAMA_NUM_GPU, 999, 0, 999),
      numThread: integer(process.env.OLLAMA_NUM_THREAD, 0, 0, 64),
    },
    openai: {
      enabled: bool(process.env.OPENAI_ENABLED, false),
      key: process.env.OPENAI_API_KEY || "",
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      base: "https://api.openai.com/v1",
    },
    anthropic: {
      enabled: bool(process.env.ANTHROPIC_ENABLED, false),
      key: process.env.ANTHROPIC_API_KEY || "",
      model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
      base: "https://api.anthropic.com/v1",
    },
    groq: {
      enabled: bool(process.env.GROQ_ENABLED, false),
      key: process.env.GROQ_API_KEY || "",
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      base: "https://api.groq.com/openai/v1",
    },
    openclaw: {
      enabled: bool(process.env.OPENCLAW_ENABLED, false),
      key: process.env.OPENCLAW_API_KEY || "",
      model: process.env.OPENCLAW_MODEL || "openclaw-default",
      base: (process.env.OPENCLAW_BASE_URL || "http://127.0.0.1:8080/v1").replace(/\/$/, ""),
    },
  },

  discord: {
    botToken: process.env.DISCORD_BOT_TOKEN || "",
    userToken: process.env.DISCORD_USER_TOKEN || "",
    defaultPrefix: process.env.DEFAULT_PREFIX || "!",
    botAutostart: bool(process.env.BOT_AUTOSTART, true),
    selfbotAutostart: bool(process.env.SELFBOT_AUTOSTART, false),
  },

  emailForward: {
    enabled: bool(process.env.EMAIL_FORWARD_ENABLED, false),
    key: process.env.EMAIL_FORWARD_API_KEY || "",
    base: (process.env.EMAIL_FORWARD_API_URL || "https://mail.thc.org/api").replace(/\/$/, ""),
  },

  computer: {
    enabled: bool(process.env.COMPUTER_CONTROL_ENABLED, true),
    root: process.env.COMPUTER_CONTROL_ROOT || homeDir,
    unrestricted: bool(process.env.COMPUTER_CONTROL_UNRESTRICTED, false),
    lockdownEnabled: bool(process.env.LOCKDOWN_ENABLED, true),
    lockdownTarget: process.env.LOCKDOWN_TARGET || "",
    clamscanPath: process.env.CLAMSCAN_PATH || "",
    winDefenderPath: process.env.WINDEFENDER_PATH || "",
  },

  os: {
    platform: process.platform, // 'linux' | 'win32' | 'darwin'
    home: homeDir,
    isWindows: process.platform === "win32",
    isLinux: process.platform === "linux",
    release: os.release(),
    hostname: os.hostname(),
  },
};

async function writeEnv(updates) {
  try {
    const { promises: fs } = await import("node:fs");
    const path = (await import("node:path")).default;
    const envPath = path.resolve(process.cwd(), ".env");
    let text = await fs.readFile(envPath, "utf8").catch(() => "");
    for (const [key, value] of Object.entries(updates)) {
      const lineRe = new RegExp(`^${key}=.*$`, "m");
      const line = `${key}=${value}`;
      if (lineRe.test(text)) text = text.replace(lineRe, line);
      else text += (text === "" || text.endsWith("\n") ? "" : "\n") + line + "\n";
    }
    await fs.writeFile(envPath, text, "utf8");
  } catch (err) {
    console.warn("[config] could not persist env changes:", err.message);
  }
}

/** Runtime toggle of a provider (also persists to .env when possible). */
export async function setProviderEnabled(name, enabled) {
  if (!config.providers[name]) throw new Error(`Unknown provider: ${name}`);
  config.providers[name].enabled = enabled;
  await writeEnv({ [`${name.toUpperCase()}_ENABLED`]: enabled });
}

const KEY_ENV = {
  openrouter: "OPENROUTER_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  groq: "GROQ_API_KEY",
  openclaw: "OPENCLAW_API_KEY",
};

/** Update a provider's API key (persisted to .env). */
export async function setProviderKey(name, key) {
  if (!config.providers[name]) throw new Error(`Unknown provider: ${name}`);
  if (!KEY_ENV[name]) throw new Error(`${name} does not use an API key`);
  config.providers[name].key = key || "";
  await writeEnv({ [KEY_ENV[name]]: key || "" });
}

/** Set the preferred provider (persisted to .env). */
export async function setPreferredProvider(name) {
  if (!config.providers[name]) throw new Error(`Unknown provider: ${name}`);
  config.providers.preferred = name;
  await writeEnv({ PREFERRED_PROVIDER: name });
}
