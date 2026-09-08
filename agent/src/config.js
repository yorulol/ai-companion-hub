import "dotenv/config";
import os from "node:os";

const bool = (v, fallback = false) =>
  v === undefined || v === "" ? fallback : ["1", "true", "yes", "on"].includes(String(v).toLowerCase());

const homeDir = os.homedir();

export const config = {
  ownerId: process.env.OWNER_DISCORD_ID || "",
  port: Number(process.env.PORT || 8787),
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim()),

  providers: {
    preferred: (process.env.PREFERRED_PROVIDER || "openrouter").toLowerCase(),
    openrouter: {
      enabled: bool(process.env.OPENROUTER_ENABLED, true),
      key: process.env.OPENROUTER_API_KEY || "",
      siteUrl: process.env.OPENROUTER_SITE_URL || "http://localhost:8787",
      appName: process.env.OPENROUTER_APP_NAME || "NOVA Agent",
      base: "https://openrouter.ai/api/v1",
    },
    ollama: {
      enabled: bool(process.env.OLLAMA_ENABLED, true),
      url: (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, ""),
      model: process.env.OLLAMA_MODEL || "llama3.1",
      codeModel: process.env.OLLAMA_CODE_MODEL || "qwen2.5-coder",
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
  },

  discord: {
    botToken: process.env.DISCORD_BOT_TOKEN || "",
    userToken: process.env.DISCORD_USER_TOKEN || "",
    defaultPrefix: process.env.DEFAULT_PREFIX || "!",
    botAutostart: bool(process.env.BOT_AUTOSTART, true),
    selfbotAutostart: bool(process.env.SELFBOT_AUTOSTART, false),
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
