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

// Legacy preferred values (openrouter/openai/anthropic/groq) auto-migrate to hermes.
const RAW_PREFERRED = (process.env.PREFERRED_PROVIDER || "hermes").toLowerCase();
const PREFERRED = ["hermes", "ollama"].includes(RAW_PREFERRED) ? RAW_PREFERRED : "hermes";

export const config = {
  ownerId: ownerIds[0] || "",
  ownerIds,

  port: Number(process.env.PORT || 8787),
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim()),

  panels: {
    enabled: bool(process.env.PANELS_ENABLED, true),
    chatPort: Number(process.env.CHAT_PANEL_PORT || process.env.PANEL_PORT || 8788),
    workspacePort: Number(process.env.WORKSPACE_PANEL_PORT || process.env.OWNER_PANEL_PORT || 8790),
    get ownerPort() { return this.workspacePort; },
    siteUrl: (process.env.SITE_URL || "http://localhost:8080").replace(/\/$/, ""),
  },

  share: {
    port: Number(process.env.TEAM_SHARE_PORT || 8790),
    bind: process.env.TEAM_SHARE_BIND || "0.0.0.0",
  },

  providers: {
    preferred: PREFERRED,
    hermes: {
      enabled: bool(process.env.HERMES_ENABLED, true),
      // Blank = auto-pick based on detected hardware (see src/hermes.js).
      model: (process.env.HERMES_MODEL || "").trim(),
    },
    ollama: {
      enabled: bool(process.env.OLLAMA_ENABLED, true),
      url: (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, ""),
      model: ["llama3.1", "llama3.1:8b-instruct-q4_K_M", "llama3.2:3b-instruct-q4_K_M", "llama3.2:1b-instruct-q4_K_M"].includes(process.env.OLLAMA_MODEL || "")
        ? "qwen2.5:3b-instruct-q4_K_M"
        : process.env.OLLAMA_MODEL || "qwen2.5:3b-instruct-q4_K_M",
      reasoningModel: process.env.OLLAMA_REASONING_MODEL || "qwen2.5:7b-instruct-q4_K_M",
      codeModel: process.env.OLLAMA_CODE_MODEL || "qwen2.5-coder",
      numCtx: integer(process.env.OLLAMA_NUM_CTX, 1536, 512, 32768),
      numPredict: integer(process.env.OLLAMA_NUM_PREDICT, 140, 32, 8192),
      historyMessages: integer(process.env.OLLAMA_HISTORY_MESSAGES, 8, 2, 24),
      numBatch: integer(process.env.OLLAMA_NUM_BATCH, 512, 64, 4096),
      numGpu: integer(process.env.OLLAMA_NUM_GPU, 999, 0, 999),
      numThread: integer(process.env.OLLAMA_NUM_THREAD, 0, 0, 64),
      balancedGpuLayers: integer(process.env.OLLAMA_BALANCED_GPU_LAYERS, 24, 0, 999),
      latencyBudgetMs: integer(process.env.OLLAMA_LATENCY_BUDGET_MS, 7000, 1000, 120000),
      minPredict: integer(process.env.OLLAMA_MIN_PREDICT, 64, 16, 2048),
      uf: {
        enabled: bool(process.env.OLLAMA_UF_ENABLED, false),
        baseModel: process.env.OLLAMA_UF_BASE_MODEL || "qwen2.5:3b-instruct-q4_K_M",
        model: process.env.OLLAMA_UF_MODEL || "qwen-yoru",
        modelfile: process.env.OLLAMA_UF_MODELFILE || "agent/UF/Modelfile",
      },
      heretic: {
        enabled: bool(process.env.OLLAMA_HERETIC_ENABLED, false),
        model: process.env.OLLAMA_HERETIC_MODEL || "hf.co/richardyoung/Qwen2.5-3B-Instruct-heretic:Q4_K_M",
      },
    },
  },

  localmodel: {
    enabled: bool(process.env.LOCALMODEL_ENABLED, false),
    dir: process.env.LOCALMODEL_DIR || "agent/models",
    active: (process.env.LOCALMODEL_ACTIVE || "").trim(),
    runtime: (process.env.LOCALMODEL_RUNTIME || "auto").toLowerCase(),
    latencyBudgetMs: integer(process.env.LOCALMODEL_LATENCY_BUDGET_MS, 9000, 1000, 120000),
    minPredict: integer(process.env.LOCALMODEL_MIN_PREDICT, 64, 16, 2048),
  },

  discord: {
    botToken: process.env.DISCORD_BOT_TOKEN || "",
    userToken: process.env.DISCORD_USER_TOKEN || "",
    defaultPrefix: process.env.DEFAULT_PREFIX || "!",
    ownerPrefix: process.env.OWNER_PREFIX || process.env.DEFAULT_PREFIX || "!",
    botAutostart: bool(process.env.BOT_AUTOSTART, true),
    selfbotAutostart: bool(process.env.SELFBOT_AUTOSTART, false),
  },

  emailForward: {
    enabled: false,
    key: "",
    base: "",
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
    platform: process.platform,
    home: homeDir,
    isWindows: process.platform === "win32",
    isLinux: process.platform === "linux",
    release: os.release(),
    hostname: os.hostname(),
  },
};

// Hermes runs through Ollama — keep Ollama on whenever Hermes is enabled.
if (config.providers.hermes.enabled) {
  config.providers.ollama.enabled = true;
}
if (config.providers.ollama.uf.enabled) {
  config.providers.ollama.enabled = true;
}
if (config.providers.ollama.heretic.enabled) {
  config.providers.ollama.enabled = true;
  if (!config.providers.ollama.uf.enabled) {
    config.providers.ollama.model = config.providers.ollama.heretic.model;
  }
}

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

const ENV_FLAG = { hermes: "HERMES_ENABLED", ollama: "OLLAMA_ENABLED" };

export async function setProviderEnabled(name, enabled) {
  if (!config.providers[name]) throw new Error(`Unknown provider: ${name}`);
  if (name === "ollama" && !enabled && (config.providers.hermes.enabled || config.providers.ollama.uf.enabled)) {
    enabled = true; // Hermes / UF need Ollama running
  }
  config.providers[name].enabled = enabled;
  const flag = ENV_FLAG[name];
  if (flag) await writeEnv({ [flag]: enabled });
}

export async function setProviderKey() {
  throw new Error("No provider requires an API key — Yoru runs on local Hermes/Ollama only.");
}

export async function setPreferredProvider(name) {
  if (!config.providers[name]) throw new Error(`Unknown provider: ${name}`);
  config.providers.preferred = name;
  await writeEnv({ PREFERRED_PROVIDER: name });
}

export async function setHermesModel(model) {
  const value = String(model || "").trim();
  config.providers.hermes.model = value;
  await writeEnv({ HERMES_MODEL: value });
  return value;
}

export async function setOwnerPrefix(prefix) {
  const value = String(prefix || "").trim();
  if (!value || value.length > 8 || /\s/.test(value)) throw new Error("Owner prefix must be 1-8 non-space characters.");
  config.discord.ownerPrefix = value;
  await writeEnv({ OWNER_PREFIX: value });
  return value;
}

export async function setLocalModel({ enabled, active } = {}) {
  const updates = {};
  if (typeof enabled === "boolean") {
    config.localmodel.enabled = enabled;
    updates.LOCALMODEL_ENABLED = enabled;
  }
  if (typeof active === "string") {
    config.localmodel.active = active.trim();
    updates.LOCALMODEL_ACTIVE = active.trim();
  }
  if (Object.keys(updates).length) await writeEnv(updates);
  return { enabled: config.localmodel.enabled, active: config.localmodel.active };
}
