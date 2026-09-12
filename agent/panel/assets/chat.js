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
const PLABEL = { openrouter: "OpenRouter", ollama: "Ollama", openai: "OpenAI", anthropic: "Anthropic", groq: "Groq", openclaw: "OpenClaw" };
const PNOTE = {
  openrouter: "Rotates every free model automatically.",
  ollama: "Local models — no API key needed.",
  openclaw: "Self-hosted (github.com/openclaw/openclaw). Key optional.",
};

async function renderProviders() {
  pop.innerHTML = `<div class="muted" style="margin-bottom:8px">Loading…</div>`;
  try {
    const data = await api("/api/providers", { owner: false });
    const save = async (patch, ck) => {
      try { await api("/api/providers", { method: "POST", body: patch }); toast("Saved to .env"); renderProviders(); }
      catch (err) { toast(err.message); if (ck) ck.checked = !ck.checked; }
    };
    pop.innerHTML = `
      <div style="font-weight:600;margin-bottom:8px">AI providers</div>
      <div class="card" style="padding:8px;margin-bottom:8px">
        <div class="muted" style="font-size:.75em;text-transform:uppercase;margin-bottom:4px">Preferred (tried first)</div>
        <select id="prefSel" style="width:100%;padding:6px;background:var(--bg-2,#111);color:inherit;border:1px solid var(--border,#333);border-radius:6px">
          ${data.providers.map(p => `<option value="${p.name}" ${p.name===data.preferred?"selected":""}>${PLABEL[p.name]}</option>`).join("")}
        </select>
      </div>
      ${data.providers.map(p => `
        <div class="card" style="padding:8px;margin-bottom:6px">
          <label style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" data-name="${p.name}" ${p.enabled?"checked":""}/>
            <span style="flex:1;font-weight:600">${PLABEL[p.name]}</span>
            ${p.keyRequired ? `<span class="muted" style="font-size:.7em;color:${p.hasKey?"#4ade80":"#fbbf24"}">${p.hasKey?"key set":"no key"}</span>` : ""}
          </label>
          ${PNOTE[p.name] ? `<div class="muted" style="font-size:.75em;margin-top:4px">${esc(PNOTE[p.name])}</div>` : ""}
          ${(p.keyRequired || p.name === "openclaw") ? `
            <div style="display:flex;gap:4px;margin-top:6px">
              <input type="password" data-key="${p.name}" placeholder="${p.hasKey?"•••••••• (replace)":"Paste API key"}" style="flex:1;padding:4px 6px;font-size:.8em;background:var(--bg-2,#111);color:inherit;border:1px solid var(--border,#333);border-radius:6px"/>
              <button class="ghost sm" data-savekey="${p.name}">Save</button>
            </div>` : ""}
        </div>`).join("")}
      <div class="muted" style="font-size:.75em;margin-top:8px">Changes write to <code>agent/.env</code>. OpenClaw is a self-hosted OSS server — leave the key blank unless your instance requires one.</div>`;
    pop.querySelector("#prefSel").addEventListener("change", (e) => save({ preferred: e.target.value }));
    pop.querySelectorAll("input[data-name]").forEach(cb => cb.addEventListener("change", () =>
      save({ providers: { [cb.dataset.name]: { enabled: cb.checked } } }, cb)));
    pop.querySelectorAll("button[data-savekey]").forEach(btn => btn.addEventListener("click", () => {
      const name = btn.dataset.savekey;
      const val = pop.querySelector(`input[data-key="${name}"]`).value;
      save({ providers: { [name]: { key: val } } });
    }));
  } catch (err) {
    pop.innerHTML = `<div class="muted">Could not load providers: ${esc(err.message)}</div>`;
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
const personaWrap = document.getElementById("personaWrap");

function showPane(name) {
  chatWrap.classList.toggle("hidden", name !== "chat");
  codeWrap.classList.toggle("hidden", name !== "code");
  emailWrap.classList.toggle("hidden", name !== "email");
  personaWrap.classList.toggle("hidden", name !== "persona");
  menuPop.classList.add("hidden");
  if (name === "persona") loadPersona();
}

menuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  menuPop.classList.toggle("hidden");
});
menuPop.querySelectorAll(".menu-item").forEach((b) => b.addEventListener("click", () => showPane(b.dataset.pane)));
document.addEventListener("click", (e) => { if (!menuPop.contains(e.target) && e.target !== menuBtn) menuPop.classList.add("hidden"); });

/* ---------- persona editor ---------- */
async function loadPersona() {
  const ta = document.getElementById("personaText");
  ta.value = "Loading…";
  try {
    const r = await api("/api/persona", { owner: false });
    ta.value = r.persona || "";
  } catch (err) { ta.value = ""; document.getElementById("personaOut").textContent = err.message; }
}
document.getElementById("personaReload").onclick = loadPersona;
document.getElementById("personaSave").onclick = async () => {
  const out = document.getElementById("personaOut");
  const persona = document.getElementById("personaText").value;
  try {
    await api("/api/persona", { method: "POST", body: { persona } });
    out.innerHTML = `<span style="color:var(--ok)">Saved. New conversations will use this persona.</span>`;
    toast("Persona saved.");
  } catch (err) { out.innerHTML = `<span style="color:var(--bad)">${esc(err.message)}</span>`; }
};

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

/* ---------- mail forwarding (mail.thc.org) ---------- */
const mfPanes = { domains: "mfDomains", alias: "mfAlias", handle: "mfHandle", dns: "mfDns", keys: "mfKeys" };
document.querySelectorAll(".mf-tab").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".mf-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const target = btn.dataset.mf;
    Object.entries(mfPanes).forEach(([k, id]) => {
      document.getElementById(id).classList.toggle("hidden", k !== target);
    });
    document.getElementById("mfOut").innerHTML = "";
  };
});
function aliasDeleteArg() {
  const n = document.getElementById("mfAliasKeyName").value.trim();
  const d = document.getElementById("mfAliasKeyDomain").value.trim();
  return { alias: `${n}@${d}` };
}
const mfHelpers = { aliasDeleteArg };
document.querySelectorAll(".mf-run").forEach(btn => {
  btn.onclick = async () => {
    const op = btn.dataset.op;
    const out = document.getElementById("mfOut");
    let args = {};
    if (btn.dataset.argsFn) args = mfHelpers[btn.dataset.argsFn]();
    else if (btn.dataset.args) {
      const numIds = new Set((btn.dataset.num || "").split(",").filter(Boolean));
      btn.dataset.args.split(",").forEach(pair => {
        const [id, key] = pair.split(":");
        const v = document.getElementById(id)?.value.trim() || "";
        args[key] = numIds.has(id) ? Number(v) : v;
      });
    }
    if (btn.dataset.extra) Object.assign(args, JSON.parse(btn.dataset.extra));
    out.innerHTML = `<div class="muted">Running <b>${esc(op)}</b>…</div>`;
    try {
      const r = await api("/api/email-forward", { method: "POST", body: { op, args } });
      out.innerHTML = `<div class="card"><div class="muted" style="margin-bottom:6px">op: <b>${esc(op)}</b></div><pre class="out" style="white-space:pre-wrap;max-height:60vh;overflow:auto">${esc(typeof r.result === "string" ? r.result : JSON.stringify(r.result, null, 2))}</pre></div>`;
    } catch (err) { out.innerHTML = `<div style="color:var(--bad)">${esc(err.message)}</div>`; }
  };
});
