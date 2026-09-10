import { api, particles, MASCOT, render, toast, esc } from "./common.js";

particles(document.getElementById("particles"));
document.getElementById("mascotBig").innerHTML = MASCOT;

const messages = document.getElementById("messages");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const mood = document.getElementById("mood");
const SCOPE = "panel:" + (localStorage.getItem("yoru.scope") || (() => {
  const s = Math.random().toString(36).slice(2);
  localStorage.setItem("yoru.scope", s);
  return s;
})());

const mode = "general";

function bubble(who, text, tools) {
  const el = document.createElement("div");
  el.className = `msg ${who}`;
  el.innerHTML = `<div class="who">${who === "user" ? "you" : "yoru"}</div><div>${render(text)}</div>`;
  if (tools?.length) {
    const t = document.createElement("div");
    t.className = "tools";
    t.textContent = "🛠 " + tools.map((x) => x.tool).join(" → ");
    el.appendChild(t);
  }
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
  return el;
}

function greet() {
  bubble("bot", "I'm **YORU**. I run on your machine, so I can talk, write code, search your lookups folder, and act on your files when you ask. What do you need?");
}
greet();

async function send() {
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  input.style.height = "auto";
  bubble("user", text);
  const pending = bubble("bot", "…thinking");
  document.body.classList.add("thinking");
  mood.textContent = "Thinking…";
  sendBtn.disabled = true;
  try {
    const r = await api("/api/chat", { method: "POST", body: { userText: text, mode, scope: SCOPE } });
    pending.innerHTML = `<div class="who">yoru</div><div>${render(r.reply)}</div>`;
    if (r.tools?.length) {
      const t = document.createElement("div");
      t.className = "tools";
      t.textContent = "🛠 " + r.tools.map((x) => x.tool).join(" → ");
      pending.appendChild(t);
    }
    document.getElementById("pillProvider").textContent = `${r.provider} · ${r.model}`;
  } catch (err) {
    pending.innerHTML = `<div class="who">yoru</div><div>⚠ ${err.message}</div>`;
  } finally {
    document.body.classList.remove("thinking");
    mood.textContent = "Listening.";
    sendBtn.disabled = false;
    messages.scrollTop = messages.scrollHeight;
  }
}

sendBtn.onclick = send;
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
});
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(160, input.scrollHeight) + "px";
});

document.getElementById("clearBtn").onclick = () => {
  messages.innerHTML = "";
  greet();
  toast("Chat cleared on screen.");
};

/* ---------- live status ---------- */
async function health() {
  const dot = document.getElementById("dotAgent");
  const label = document.getElementById("agentText");
  try {
    const h = await api("/api/health", { owner: false });
    dot.className = "dot on";
    label.textContent = "online";
    document.getElementById("pillProvider").textContent = `${h.preferred} · ${h.freeModels || 0} free models`;
    document.getElementById("dotBot").className = "dot " + (h.bot?.running ? "on" : "off");
    document.getElementById("dotSelf").className = "dot " + (h.selfbot?.running ? "on" : "off");
    document.getElementById("pillOs").textContent = `${h.os?.platform || "?"} · ${h.os?.hostname || ""}`;
  } catch {
    dot.className = "dot off";
    label.textContent = "agent offline";
  }
}
health();
setInterval(health, 15000);

/* Owner panel lives on its own port; guess it from the current one. */
(async () => {
  const link = document.getElementById("ownerLink");
  try {
    const info = await fetch("/api/panel-info").then((r) => r.json());
    link.href = `${location.protocol}//${location.hostname}:${info.ownerPort}/`;
  } catch {
    link.classList.add("hidden");
  }
})();

/* ---------- provider popover ---------- */
const pill = document.getElementById("pillProvider");
const pop = document.getElementById("providerPop");
const PROVIDERS = [
  ["openrouterEnabled", "OpenRouter", "free models, auto-rotated"],
  ["ollamaEnabled", "Ollama", "local backup"],
  ["openaiEnabled", "OpenAI"],
  ["anthropicEnabled", "Anthropic"],
  ["groqEnabled", "Groq"],
  ["openclawEnabled", "OpenClaw"],
];

async function renderProviders() {
  pop.innerHTML = `<div class="muted" style="margin-bottom:8px">Loading…</div>`;
  try {
    const s = await api("/api/owner/settings");
    const p = s.provider || {};
    pop.innerHTML = `
      <div style="font-weight:600;margin-bottom:8px">AI providers</div>
      ${PROVIDERS.map(([k, name, note]) => `
        <label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer">
          <input type="checkbox" data-k="${k}" ${p[k] ? "checked" : ""}/>
          <span style="flex:1"><strong>${name}</strong>${note ? ` <span class="muted" style="font-size:.85em">· ${esc(note)}</span>` : ""}</span>
        </label>`).join("")}
      <div class="muted" style="font-size:.8em;margin-top:8px">Toggles persist in the agent DB. API keys still come from your <code>.env</code>.</div>`;
    pop.querySelectorAll("input[data-k]").forEach((i) => {
      i.addEventListener("change", async () => {
        const patch = { provider: { [i.dataset.k]: i.checked } };
        try { await api("/api/owner/settings", { method: "POST", body: patch }); toast("Saved."); }
        catch (err) { toast(err.message); i.checked = !i.checked; }
      });
    });
  } catch (err) {
    pop.innerHTML = `<div class="muted">Owner login required to change providers. <a href="#" id="popOwner">Open owner panel →</a></div>`;
    pop.querySelector("#popOwner")?.addEventListener("click", (e) => {
      e.preventDefault();
      document.getElementById("ownerLink")?.click();
    });
  }
}

pill.addEventListener("click", (e) => {
  e.stopPropagation();
  const showing = !pop.classList.contains("hidden");
  pop.classList.toggle("hidden", showing);
  if (!showing) renderProviders();
});
document.addEventListener("click", (e) => {
  if (!pop.contains(e.target) && e.target !== pill) pop.classList.add("hidden");
});
