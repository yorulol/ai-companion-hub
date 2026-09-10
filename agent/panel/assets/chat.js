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

/* ---------- hamburger menu / pane switching ---------- */
const menuBtn = document.getElementById("menuBtn");
const menuPop = document.getElementById("menuPop");
const chatWrap = document.getElementById("chatWrap");
const codeWrap = document.getElementById("codeWrap");

const emailWrap = document.getElementById("emailWrap");

function showPane(name) {
  chatWrap.classList.toggle("hidden", name !== "chat");
  codeWrap.classList.toggle("hidden", name !== "code");
  emailWrap.classList.toggle("hidden", name !== "email");
  menuPop.classList.add("hidden");
}

menuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  menuPop.classList.toggle("hidden");
});
menuPop.querySelectorAll(".menu-item").forEach((b) => b.addEventListener("click", () => showPane(b.dataset.pane)));
document.addEventListener("click", (e) => { if (!menuPop.contains(e.target) && e.target !== menuBtn) menuPop.classList.add("hidden"); });

/* ---------- code check ---------- */
let CODE_PATH = "";
let CODE_FILES = [];
let CODE_OPEN = "";

function buildTree(files, prefix = "") {
  const dirs = new Map();
  files.forEach((f) => {
    const rel = f.replace(prefix, "").replace(/^\//, "");
    const parts = rel.split("/").filter(Boolean);
    if (!parts.length) return;
    let cur = dirs;
    parts.forEach((part, idx) => {
      const isLast = idx === parts.length - 1;
      if (isLast) {
        cur.set(part, { file: f, name: part });
      } else {
        if (!cur.has(part) || typeof cur.get(part) !== "object" || Array.isArray(cur.get(part))) cur.set(part, new Map());
        cur = cur.get(part);
      }
    });
  });

  function render(node) {
    let html = `<ul style="list-style:none;margin:4px 0;padding-left:12px">`;
    const entries = [...node.entries()].sort((a, b) => {
      const aIsFile = a[1].file;
      const bIsFile = b[1].file;
      if (aIsFile !== bIsFile) return aIsFile ? 1 : -1;
      return a[0].localeCompare(b[0]);
    });
    for (const [name, val] of entries) {
      if (val.file) {
        html += `<li><button class="ghost sm code-file" data-file="${esc(val.file)}" style="width:100%;text-align:left;font-family:ui-monospace,monospace">📄 ${esc(val.name)}</button></li>`;
      } else {
        html += `<li><details open><summary style="cursor:pointer">📁 ${esc(name)}</summary>${render(val)}</details></li>`;
      }
    }
    html += `</ul>`;
    return html;
  }
  return render(dirs);
}

async function openCodeFolder() {
  const path = document.getElementById("codePath").value.trim();
  if (!path) return toast("Enter a folder path.");
  try {
    const r = await api("/api/owner/code-files", { method: "POST", body: { path } });
    CODE_PATH = r.path;
    CODE_FILES = r.files;
    document.getElementById("codeTree").innerHTML = buildTree(r.files, r.path);
    document.querySelectorAll(".code-file").forEach((b) => b.onclick = () => loadCodeFile(b.dataset.file));
    toast(`${r.files.length} files found.`);
  } catch (err) { toast(err.message); }
}

async function loadCodeFile(file) {
  CODE_OPEN = file;
  const editor = document.getElementById("codeEditor");
  editor.textContent = "Loading…";
  try {
    const r = await api("/api/owner/code-file", { method: "POST", body: { file } });
    editor.textContent = r.content;
    editor.contentEditable = "true";
    editor.dataset.dirty = "false";
  } catch (err) { editor.textContent = err.message; }
}

async function saveCodeFile() {
  if (!CODE_OPEN) return;
  const editor = document.getElementById("codeEditor");
  try {
    await api("/api/owner/code-file", { method: "POST", body: { file: CODE_OPEN, content: editor.textContent, save: true } });
    editor.dataset.dirty = "false";
    toast("Saved.");
  } catch (err) { toast(err.message); }
}

async function runCodeAudit() {
  const out = document.getElementById("codeAuditOut");
  if (!CODE_PATH) return toast("Open a folder first.");
  out.innerHTML = `<div class="muted">Auditing with OpenClaw…</div>`;
  try {
    const r = await api("/api/owner/code-audit", { method: "POST", body: { path: CODE_PATH } });
    out.innerHTML = r.reports.length
      ? r.reports.map((rep) => `
        <div class="card" style="margin-bottom:10px">
          <strong>${esc(rep.file)}</strong>
          ${rep.issues.map((i) => `<div class="pill" style="margin:4px 0">${esc(i.severity)} · ${esc(i.line ? `L${i.line}` : "general")}</div><pre class="out">${esc(i.message)}</pre>`).join("")}
        </div>`).join("")
      : `<div class="muted">No issues found. Great job.</div>`;
  } catch (err) { out.innerHTML = `<div style="color:var(--bad)">${esc(err.message)}</div>`; }
}

async function sendCodeChat() {
  const input = document.getElementById("codeMsg");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  const out = document.getElementById("codeAuditOut");
  const ctx = CODE_OPEN ? `Open file: ${CODE_OPEN}\n\n${document.getElementById("codeEditor").textContent.slice(0, 4000)}` : "";
  out.innerHTML += `<div class="card"><strong>you</strong><div>${esc(text)}</div></div>`;
  try {
    const r = await api("/api/chat", { method: "POST", body: { userText: `${ctx ? ctx + "\n\n---\n\n" : ""}${text}`, mode: "code", scope: SCOPE } });
    out.innerHTML += `<div class="card"><strong>yoru</strong><div>${render(r.reply)}</div></div>`;
  } catch (err) { out.innerHTML += `<div class="card" style="color:var(--bad)">${esc(err.message)}</div>`; }
  out.scrollTop = out.scrollHeight;
}

document.getElementById("codeOpen").onclick = openCodeFolder;
document.getElementById("codeAudit").onclick = runCodeAudit;
document.getElementById("codeSend").onclick = sendCodeChat;
document.getElementById("codeMsg").addEventListener("keydown", (e) => { if (e.key === "Enter") sendCodeChat(); });

// Ctrl/Cmd+S to save the open file
document.getElementById("codeEditor").addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    saveCodeFile();
  }
});

/* ---------- email forward ---------- */
document.getElementById("emailSend").onclick = async () => {
  const email = document.getElementById("emailInput").value.trim();
  const op = document.getElementById("emailOp")?.value || "analyze";
  const out = document.getElementById("emailOut");
  if (!email) return toast("Paste an email first.");
  out.innerHTML = `<div class="muted">Running <b>${esc(op)}</b> on reads.phrack.org…</div>`;
  try {
    const r = await api("/api/email-forward", { method: "POST", body: { email, op } });
    out.innerHTML = `<div class="card"><div class="muted" style="margin-bottom:6px">operation: <b>${esc(r.op)}</b></div><pre class="out" style="white-space:pre-wrap;max-height:60vh;overflow:auto">${esc(JSON.stringify(r.result, null, 2))}</pre></div>`;
  } catch (err) { out.innerHTML = `<div style="color:var(--bad)">${esc(err.message)}</div>`; }
};
