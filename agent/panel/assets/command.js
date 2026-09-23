/* YORU command center — single-page HUD.
   Reuses /api/* on the panel server (proxied to the agent service). */
import { api, particles, render, toast, esc } from "./common.js";
import { coreOrb } from "./core-orb.js";

particles(document.getElementById("particles"));
const orb = coreOrb(document.getElementById("coreOrb"));

/* ========== view switching ========== */
const views = {
  chat: document.getElementById("chatView"),
  owner: document.getElementById("ownerFrame"),
  workspace: document.getElementById("workspaceFrame"),
};
function showView(name) {
  for (const [k, el] of Object.entries(views)) {
    const on = k === name;
    el.classList.toggle("active", on);
    if (on && el.tagName === "IFRAME" && !el.src && el.dataset.src) el.src = el.dataset.src;
  }
}
document.querySelectorAll("[data-nav]").forEach((b) =>
  b.addEventListener("click", () => { showView(b.dataset.nav); closeDropdowns(); }),
);
document.querySelectorAll("[data-svc]").forEach((b) =>
  b.addEventListener("click", () => {
    const urls = { ollama: "http://localhost:11434", openclaw: "http://localhost:18789", openrouter: "https://openrouter.ai" };
    window.open(urls[b.dataset.svc], "_blank", "noopener"); closeDropdowns();
  }),
);
function closeDropdowns(){ document.querySelectorAll("details[open]").forEach(d=>d.removeAttribute("open")); }
document.addEventListener("click", (e) => {
  document.querySelectorAll("details[open]").forEach((d) => { if (!d.contains(e.target)) d.removeAttribute("open"); });
});

/* ========== chat ========== */
const messages = document.getElementById("messages");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const quickInput = document.getElementById("quickInput");
const quickSend = document.getElementById("quickSend");
const SCOPE = "panel:" + (localStorage.getItem("yoru.scope") || (() => {
  const s = Math.random().toString(36).slice(2);
  localStorage.setItem("yoru.scope", s); return s;
})());

function bubble(who, text, tools) {
  const el = document.createElement("div");
  el.className = `msg ${who}`;
  el.innerHTML = `<div class="who">${who === "user" ? "oz" : who === "system" ? "system" : "yoru"}</div><div>${render(text)}</div>`;
  if (tools?.length) {
    const t = document.createElement("div"); t.className = "tools";
    t.textContent = "▶ " + tools.map((x) => x.tool).join(" → ");
    el.appendChild(t);
  }
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
  return el;
}
bubble("system", "yoru online. talk to me, or use the quick actions on the left.");

async function send(text) {
  text = (text || "").trim();
  if (!text) return;
  bubble("user", text);
  const pending = bubble("bot", "…thinking");
  sendBtn.disabled = true; quickSend.disabled = true;
  orb.setLevel(0.6);
  try {
    const r = await api("/api/chat", { method: "POST", body: { userText: text, mode: "general", scope: SCOPE } });
    pending.innerHTML = `<div class="who">yoru</div><div>${render(r.reply || "…")}</div>`;
    if (r.tools?.length) {
      const t = document.createElement("div"); t.className = "tools";
      t.textContent = "▶ " + r.tools.map((x) => x.tool).join(" → ");
      pending.appendChild(t);
    }
    if (r.provider) setProviderPill(`${r.provider}${r.model ? " · " + r.model : ""}`, true);
    speak(r.reply);
  } catch (err) {
    pending.innerHTML = `<div class="who">yoru</div><div>⚠ ${esc(err.message)}</div>`;
  } finally {
    sendBtn.disabled = false; quickSend.disabled = false; orb.setLevel(0.15);
    messages.scrollTop = messages.scrollHeight;
  }
}
sendBtn.addEventListener("click", () => { const t = input.value; input.value = ""; input.style.height = "auto"; showView("chat"); send(t); });
quickSend.addEventListener("click", () => { const t = quickInput.value; quickInput.value = ""; showView("chat"); send(t); });
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendBtn.click(); }
});
input.addEventListener("input", () => {
  input.style.height = "auto"; input.style.height = Math.min(180, input.scrollHeight) + "px";
});
quickInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); quickSend.click(); }});
input.focus();

/* ========== voice: mic + browser TTS (server voice pipe ships in the next batch) ========== */
const micBtn = document.getElementById("micBtn");
let recog = null;
try {
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (R) {
    recog = new R();
    recog.continuous = false;
    recog.interimResults = true;
    recog.lang = "en-US";
    let last = "";
    recog.onresult = (e) => {
      last = "";
      for (const r of e.results) last += r[0].transcript;
      quickInput.value = last;
      orb.setLevel(0.5 + Math.min(0.4, last.length / 80));
    };
    recog.onend = () => {
      micBtn.classList.remove("on");
      orb.setLevel(0.15);
      if (last.trim()) { const t = last; last = ""; quickInput.value = ""; showView("chat"); send(t); }
    };
    recog.onerror = () => { micBtn.classList.remove("on"); orb.setLevel(0.15); };
  }
} catch {}
micBtn.addEventListener("click", () => {
  if (!recog) { toast("browser mic unsupported — type instead"); return; }
  if (micBtn.classList.contains("on")) { recog.stop(); return; }
  micBtn.classList.add("on"); orb.setLevel(0.55);
  try { recog.start(); } catch {}
});
function speak(text) {
  if (!text || !window.speechSynthesis) return;
  const clean = String(text).replace(/```[\s\S]*?```/g, " ").replace(/[*_`>#]/g, "").slice(0, 400);
  if (!clean.trim()) return;
  const u = new SpeechSynthesisUtterance(clean);
  u.rate = 1.05; u.pitch = 0.95;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

/* ========== drawer (quick actions) ========== */
const drawer = document.getElementById("drawer");
const drawerTitle = document.getElementById("drawerTitle");
const drawerBody = document.getElementById("drawerBody");
document.getElementById("drawerClose").addEventListener("click", () => drawer.classList.add("hidden"));
function openDrawer(title, html) {
  drawerTitle.textContent = title;
  drawerBody.innerHTML = html;
  drawer.classList.remove("hidden");
}

const ACTIONS = {
  "voice-toggle": () => micBtn.click(),
  killswitch: async () => {
    const s = await api("/api/owner/killswitch").catch(() => ({ active: false }));
    openDrawer("Killswitch", `
      <div class="muted">current: <b>${s.active ? "ACTIVE" : "idle"}</b></div>
      <div class="drawer-actions">
        <button class="primary" id="ksEngage">Engage killswitch</button>
        <button class="ghost" id="ksJump">Jumpstart (release)</button>
      </div>
      <pre id="ksOut" class="muted">—</pre>`);
    document.getElementById("ksEngage").onclick = async () => {
      try { const r = await api("/api/owner/killswitch", { method: "POST", body: { reason: "panel" } });
        document.getElementById("ksOut").textContent = JSON.stringify(r, null, 2); refreshStatus(); }
      catch (e) { toast(e.message); }
    };
    document.getElementById("ksJump").onclick = async () => {
      try { const r = await api("/api/owner/jumpstart", { method: "POST" });
        document.getElementById("ksOut").textContent = JSON.stringify(r, null, 2); refreshStatus(); }
      catch (e) { toast(e.message); }
    };
  },
  lookup: () => {
    openDrawer("Lookup", `
      <label>query</label>
      <input id="lkq" placeholder="handle, id, email…" />
      <div class="drawer-actions"><button class="primary" id="lkGo">Search</button></div>
      <pre id="lkOut" class="muted">results appear here</pre>`);
    document.getElementById("lkGo").onclick = async () => {
      const q = document.getElementById("lkq").value.trim(); if (!q) return;
      document.getElementById("lkOut").textContent = "searching…";
      try { const r = await api("/api/owner/lookup", { method: "POST", body: { query: q } });
        document.getElementById("lkOut").textContent = JSON.stringify(r, null, 2); }
      catch (e) { document.getElementById("lkOut").textContent = "error: " + e.message; }
    };
  },
  email: () => {
    openDrawer("Email forward", `
      <label>operation</label>
      <select id="efOp">
        <option value="domains">list domains</option>
        <option value="aliases">list aliases</option>
        <option value="create">create alias</option>
        <option value="delete">delete alias</option>
      </select>
      <label>domain</label><input id="efDom" placeholder="example.com" />
      <label>alias (for create/delete)</label><input id="efAlias" placeholder="hello" />
      <label>destination (for create)</label><input id="efDest" placeholder="you@gmail.com" />
      <div class="drawer-actions"><button class="primary" id="efGo">Run</button></div>
      <pre id="efOut" class="muted">—</pre>`);
    document.getElementById("efGo").onclick = async () => {
      const body = {
        op: document.getElementById("efOp").value,
        domain: document.getElementById("efDom").value.trim(),
        alias: document.getElementById("efAlias").value.trim(),
        destination: document.getElementById("efDest").value.trim(),
      };
      document.getElementById("efOut").textContent = "…";
      try { const r = await api("/api/email-forward", { method: "POST", body });
        document.getElementById("efOut").textContent = JSON.stringify(r, null, 2); }
      catch (e) { document.getElementById("efOut").textContent = "error: " + e.message; }
    };
  },
  scan: () => {
    openDrawer("Web scan", `
      <div class="muted">web scans run in the terminal — say "scan a site" or type <code>/scan &lt;url&gt;</code> in your <b>npm start</b> terminal. Files land under <code>agent/web/&lt;host&gt;/</code>. This panel just kicks it off through chat.</div>
      <label>target URL</label><input id="scanUrl" placeholder="https://example.com" />
      <div class="drawer-actions"><button class="primary" id="scanGo">Ask yoru to scan</button></div>`);
    document.getElementById("scanGo").onclick = () => {
      const u = document.getElementById("scanUrl").value.trim(); if (!u) return;
      drawer.classList.add("hidden"); showView("chat"); send(`scan ${u}`);
    };
  },
  meetings: async () => {
    const v = await api("/api/owner/voice").catch(()=>({ inChannel:false }));
    openDrawer("Meetings", `
      <div class="muted">alt account joins a voice channel, records + transcribes on speech; leave saves PDF + TXT + MP3 into <code>agent/calls</code>.</div>
      <div class="muted">status: ${v.inChannel ? `in voice channel ${v.channelId} — ${v.events||0} events, ${v.notes||0} notes` : "not in a voice channel"}</div>
      <label>channel (ID or exact name)</label>
      <input id="vcCh" placeholder="voice channel ID or name" />
      <div class="drawer-actions">
        <button class="primary" id="vcJoin">Join</button>
        <button id="vcLeave">Leave &amp; save</button>
        <button class="ghost" id="vcRecap">Last recap</button>
      </div>
      <pre id="vcOut" class="muted">—</pre>`);
    const out = document.getElementById("vcOut");
    document.getElementById("vcJoin").onclick = async () => {
      const ch = document.getElementById("vcCh").value.trim(); if (!ch) return toast("channel ID or name required");
      try { const r = await api("/api/owner/voice/join", { method: "POST", body: { channel: ch } });
        out.textContent = JSON.stringify(r, null, 2); refreshStatus(); }
      catch (e) { toast(e.message); }
    };
    document.getElementById("vcLeave").onclick = async () => {
      try { const r = await api("/api/owner/voice/leave", { method: "POST" });
        out.textContent = JSON.stringify(r, null, 2); refreshStatus(); }
      catch (e) { toast(e.message); }
    };
    document.getElementById("vcRecap").onclick = async () => {
      try { const r = await api("/api/owner/voice/recap"); out.textContent = r.recap || "no recaps yet"; }
      catch (e) { toast(e.message); }
    };
  },
  files: () => {
    openDrawer("Files", `
      <label>path (absolute, or ~)</label>
      <input id="fpath" value="~" />
      <div class="drawer-actions">
        <button class="primary" id="flist">List</button>
        <button id="fread">Read</button>
      </div>
      <pre id="fout" class="muted">—</pre>`);
    document.getElementById("flist").onclick = async () => {
      try { const r = await api("/api/owner/fs/list", { method: "POST", body: { path: document.getElementById("fpath").value } });
        document.getElementById("fout").textContent = r.items.map(i => `${i.type.padEnd(4)}  ${i.name}`).join("\n"); }
      catch (e) { document.getElementById("fout").textContent = "error: " + e.message; }
    };
    document.getElementById("fread").onclick = async () => {
      try { const r = await api("/api/owner/fs/read", { method: "POST", body: { path: document.getElementById("fpath").value } });
        document.getElementById("fout").textContent = r.content.slice(0, 8000); }
      catch (e) { document.getElementById("fout").textContent = "error: " + e.message; }
    };
  },
  system: async () => {
    try { const r = await api("/api/owner/system");
      openDrawer("System", `<pre>${esc(JSON.stringify(r, null, 2))}</pre>`); }
    catch (e) { toast(e.message); }
  },
};
document.querySelectorAll("[data-action]").forEach((b) =>
  b.addEventListener("click", () => ACTIONS[b.dataset.action]?.()),
);

/* ========== provider selector ========== */
const providerSelect = document.getElementById("providerSelect");
async function loadProviders() {
  try {
    const r = await api("/api/providers");
    providerSelect.innerHTML = "";
    const auto = document.createElement("option"); auto.value = ""; auto.textContent = `auto (${r.preferred || "?"})`;
    providerSelect.appendChild(auto);
    for (const p of r.providers.filter((x) => x.enabled)) {
      const o = document.createElement("option"); o.value = p.name; o.textContent = p.name; providerSelect.appendChild(o);
    }
    renderProviderList(r.providers, r.preferred);
  } catch {}
}
providerSelect.addEventListener("change", async () => {
  if (!providerSelect.value) return;
  try { await api("/api/providers", { method: "POST", body: { preferred: providerSelect.value } }); toast(`preferred: ${providerSelect.value}`); loadProviders(); }
  catch (e) { toast(e.message); }
});
function renderProviderList(providers, preferred) {
  const el = document.getElementById("providerList");
  el.innerHTML = providers.map((p) => {
    const state = p.enabled ? (p.keyRequired && !p.hasKey ? "off" : "ok") : "off";
    const label = p.enabled ? (state === "ok" ? "on" : "no key") : "off";
    const star = p.name === preferred ? " ★" : "";
    return `<div class="row"><span class="k">${esc(p.name)}${star}</span><span class="v ${state}">${label}</span></div>`;
  }).join("");
}

/* ========== providers pill ========== */
function setProviderPill(text, ok) {
  const pill = document.getElementById("pillProvider");
  pill.querySelector(".dot").className = "dot " + (ok ? "on" : "off");
  pill.lastChild.textContent = " " + text;
}

/* ========== live status ========== */
async function refreshStatus() {
  try {
    const h = await api("/api/health", { owner: false });
    document.getElementById("dotAgent").className = "dot " + (h.ok ? "on" : "off");
    document.getElementById("txtAgent").textContent = h.ok ? `${h.preferred || "agent"} online` : "offline";
    setProviderPill(h.preferred || "?", !!h.ok);
    document.getElementById("dotBot").className = "dot " + (h.bot?.running ? "on" : "off");
    document.getElementById("txtBot").textContent = h.bot?.running ? "connected" : "offline";
    document.getElementById("dotSelf").className = "dot " + (h.selfbot?.running ? "on" : "off");
    document.getElementById("txtSelf").textContent = h.selfbot?.running ? "connected" : "offline";
  } catch {
    document.getElementById("dotAgent").className = "dot off";
    document.getElementById("txtAgent").textContent = "offline";
  }
  try {
    const v = await api("/api/owner/voice");
    document.getElementById("dotCall").className = "dot " + (v.inChannel ? "on" : "");
    document.getElementById("txtCall").textContent = v.inChannel
      ? `channel ${v.channelId} · ${v.events||0} events, ${v.notes||0} notes` : "not in a voice channel";
  } catch {}
  try {
    const k = await api("/api/owner/killswitch");
    document.getElementById("dotKill").className = "dot " + (k.active ? "off" : "on");
    document.getElementById("txtKill").textContent = k.active ? "ACTIVE (jumpstart to release)" : "idle";
    const kp = document.getElementById("pillKill");
    kp.querySelector(".dot").className = "dot " + (k.active ? "off" : "on");
    kp.lastChild.textContent = " killswitch: " + (k.active ? "ACTIVE" : "idle");
  } catch {}
  try {
    const s = await api("/api/owner/system");
    document.getElementById("txtSys").textContent =
      `${s.platform} ${s.arch} · ${s.cpus} cpu · ${(s.memGB - s.freeMemGB).toFixed(1)}/${s.memGB} GB · up ${s.uptimeMin}m`;
  } catch {}
}
refreshStatus();
setInterval(refreshStatus, 6000);
loadProviders();
setInterval(loadProviders, 30000);
