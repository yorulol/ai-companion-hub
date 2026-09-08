import "dotenv/config";

const bool = (v, fallback = false) =>
  v === undefined ? fallback : ["1", "true", "yes", "on"].includes(String(v).toLowerCase());

export const config = {
  ownerId: process.env.OWNER_DISCORD_ID || "",
  port: Number(process.env.PORT || 8787),
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim()),

  openrouter: {
    key: process.env.OPENROUTER_API_KEY || "",
    siteUrl: process.env.OPENROUTER_SITE_URL || "http://localhost:8787",
    appName: process.env.OPENROUTER_APP_NAME || "NOVA Agent",
    base: "https://openrouter.ai/api/v1",
  },

  ollama: {
    url: (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, ""),
    model: process.env.OLLAMA_MODEL || "llama3.1",
    codeModel: process.env.OLLAMA_CODE_MODEL || "qwen2.5-coder",
  },

  discord: {
    botToken: process.env.DISCORD_BOT_TOKEN || "",
    userToken: process.env.DISCORD_USER_TOKEN || "",
    defaultPrefix: process.env.DEFAULT_PREFIX || "!",
    botAutostart: bool(process.env.BOT_AUTOSTART, true),
    selfbotAutostart: bool(process.env.SELFBOT_AUTOSTART, false),
  },
};
