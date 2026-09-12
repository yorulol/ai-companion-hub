import { api, particles, MASCOT, esc, toast, requireOwner, OWNER_KEY } from "./common.js";

particles(document.getElementById("particles"));
document.getElementById("miniMascot").innerHTML = MASCOT;
document.getElementById("gateMascot").innerHTML = MASCOT;

document.getElementById("signOut").onclick = () => {
  localStorage.removeItem(OWNER_KEY);
  location.reload();
};

/* tabs */
const tabs = document.getElementById("tabs");
tabs.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (!b) return;
  document.querySelectorAll("#tabs button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("active", p.dataset.pane === b.dataset.tab));
  document.querySelectorAll("#tabs details").forEach((group) => { group.open = false; });
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#tabs")) document.querySelectorAll("#tabs details").forEach((group) => { group.open = false; });
});

requireOwner({ onReady: init });

async function init() {
  refreshHealth();
  setInterval(refreshHealth, 10000);
  loadSettings();
  loadGuilds();
  loadCommands();
  loadLookups();
  loadWhitelist();
  loadAltGuilds();
  loadAutomation();
  initAutomation();
  initSecurity();
  startActivity();


  document.querySelectorAll("[data-action]").forEach((b) =>
    b.addEventListener("click", async () => {
      try { await api("/api/owner/control", { method: "POST", body: { action: b.dataset.action } }); toast("Done."); refreshHealth(); }
      catch (err) { toast(err.message); }
    }),
  );

  document.getElementById("saveProviders").onclick = saveProviders;
  document.getElementById("refreshModels").onclick = refreshModels;
  document.getElementById("sysBtn").onclick = loadSystem;
  document.getElementById("scanBtn").onclick = runScan;
  document.getElementById("engageBtn").onclick = engageLockdown;
  document.getElementById("releaseBtn").onclick = releaseLockdown;
  document.getElementById("fsListBtn").onclick = listFs;
  document.getElementById("lookupBtn").onclick = runLookup;
  document.getElementById("cmdSearch").oninput = renderCommands;
  document.getElementById("wlAdd").onclick = addWhitelist;
  document.getElementById("wlValue").onkeydown = (e) => { if (e.key === "Enter") addWhitelist(); };
}

/* ---------- health ---------- */
async function refreshHealth() {
  const dot = document.getElementById("dotAgent");
  try {
    const h = await api("/api/health", { owner: false });
    dot.className = "dot on";
    document.getElementById("agentText").textContent = "online";
    document.getElementById("botInfo").textContent = h.bot?.running
      ? `${h.bot.tag || "connected"} — ${h.bot.guilds || 0} servers` : "stopped";
    document.getElementById("selfInfo").textContent = h.selfbot?.running
      ? `${h.selfbot.tag || "connected"}` : "stopped";
  } catch {
    dot.className = "dot off";
    document.getElementById("agentText").textContent = "agent offline";
  }
}

/* ---------- providers ---------- */
let SETTINGS = null;
async function loadSettings() {
  SETTINGS = await api("/api/owner/settings");
  const p = SETTINGS.provider || {};
  document.getElementById("preferred").value = p.preferred || "openrouter";
  const checks = document.getElementById("providerChecks");
  const list = [
    ["openrouterEnabled", "OpenRouter"], ["ollamaEnabled", "Ollama"],
    ["groqEnabled", "Groq"], ["openaiEnabled", "OpenAI"], ["anthropicEnabled", "Anthropic"],
    ["openclawEnabled", "OpenClaw"],
  ];
  checks.innerHTML = list.map(([k, label]) =>
    `<label><input type="checkbox" data-key="${k}" ${p[k] ? "checked" : ""}/> ${label}</label>`,
  ).join("");
  refreshModels();
}
async function saveProviders() {
  const patch = {
    provider: { preferred: document.getElementById("preferred").value },
  };
  document.querySelectorAll("#providerChecks input").forEach((i) => { patch.provider[i.dataset.key] = i.checked; });
  try { await api("/api/owner/settings", { method: "POST", body: patch }); toast("Saved. Restart the agent to apply key changes."); }
  catch (err) { toast(err.message); }
}
async function refreshModels() {
  const out = document.getElementById("modelsOut");
  out.textContent = "Loading…";
  try {
    const m = await api("/api/models", { owner: false });
    out.innerHTML = `
      <div><strong>${m.free.length}</strong> free OpenRouter models · <strong>${m.coding.length}</strong> coding-tuned · <strong>${m.ollama.length}</strong> local Ollama</div>
      <div style="margin-top:8px">${m.free.slice(0, 40).map((n) => `<span class="tag">${esc(n)}</span>`).join("")}</div>`;
  } catch (err) { out.textContent = err.message; }
}

/* ---------- guilds ---------- */
async function loadGuilds() {
  const wrap = document.getElementById("guilds");
  try {
    const { guilds } = await api("/api/owner/guilds");
    if (!guilds.length) { wrap.innerHTML = `<div class="muted">Bot isn't in any servers yet.</div>`; return; }
    wrap.innerHTML = guilds.map((g) => `
      <div class="card" data-guild="${g.id}">
        <div class="row" style="justify-content:space-between">
          <strong>${esc(g.name || g.id)}</strong>
          <span class="muted">${g.id}</span>
        </div>
        <div class="grid two" style="margin-top:12px">
          <div class="field"><label>Prefix</label><input data-k="prefix" value="${esc(g.prefix || "!")}"/></div>
          <div class="field"><label>AI auto-reply</label>
            <select data-k="aiReplies">
              <option value="true" ${g.aiReplies ? "selected" : ""}>On</option>
              <option value="false" ${!g.aiReplies ? "selected" : ""}>Off</option>
            </select>
          </div>
          <div class="field"><label>Admin roles</label>
            <select multiple data-k="adminRoles" size="4">${(g.roles || []).map((r) => `<option value="${r.id}" ${g.adminRoles?.includes(r.id) ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select>
          </div>
          <div class="field"><label>Mod roles</label>
            <select multiple data-k="modRoles" size="4">${(g.roles || []).map((r) => `<option value="${r.id}" ${g.modRoles?.includes(r.id) ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select>
          </div>
        </div>
        <button class="sm primary" data-save>Save server</button>
      </div>`).join("");

    wrap.querySelectorAll("[data-save]").forEach((b) =>
      b.addEventListener("click", async () => {
        const card = b.closest("[data-guild]");
        const id = card.dataset.guild;
        const patch = {};
        card.querySelectorAll("[data-k]").forEach((el) => {
          const k = el.dataset.k;
          if (el.multiple) patch[k] = [...el.selectedOptions].map((o) => o.value);
          else if (k === "aiReplies") patch[k] = el.value === "true";
          else patch[k] = el.value;
        });
        try { await api(`/api/owner/guilds/${id}`, { method: "POST", body: patch }); toast("Saved."); }
        catch (err) { toast(err.message); }
      }),
    );
  } catch (err) { wrap.textContent = err.message; }
}

/* ---------- commands ---------- */
let COMMANDS = [];
async function loadCommands() {
  try {
    const r = await api("/api/commands", { owner: false });
    COMMANDS = r.commands;
    document.getElementById("cmdCount").textContent = `${r.total} commands`;
    renderCommands();
  } catch (err) { document.getElementById("cmdList").textContent = err.message; }
}
function renderCommands() {
  const q = document.getElementById("cmdSearch").value.toLowerCase();
  const list = COMMANDS.filter((c) =>
    !q || c.name.includes(q) || c.category.includes(q) || c.description.toLowerCase().includes(q),
  );
  const byCat = list.reduce((acc, c) => ((acc[c.category] = acc[c.category] || []).push(c), acc), {});
  document.getElementById("cmdList").innerHTML = Object.entries(byCat).map(([cat, arr]) => `
    <div class="card">
      <h3 style="margin:0 0 10px;text-transform:capitalize;color:var(--violet-hot)">${esc(cat)} <span class="muted" style="font-weight:400">${arr.length}</span></h3>
      <table><thead><tr><th>Name</th><th>Description</th><th>Access</th></tr></thead><tbody>
      ${arr.map((c) => `<tr><td><code>${esc(c.name)}</code></td><td>${esc(c.description)}</td><td><span class="tag">${esc(c.permission)}</span></td></tr>`).join("")}
      </tbody></table>
    </div>`).join("");
}

/* ---------- computer ---------- */
async function loadSystem() {
  const out = document.getElementById("sysOut");
  out.textContent = "Loading…";
  try { out.textContent = JSON.stringify(await api("/api/owner/system"), null, 2); }
  catch (err) { out.textContent = err.message; }
}
async function runScan() {
  const out = document.getElementById("scanOut");
  out.textContent = "Running scan… this can take a while.";
  try { const r = await api("/api/owner/scan", { method: "POST" }); out.textContent = r.output || JSON.stringify(r, null, 2); }
  catch (err) { out.textContent = err.message; }
}
async function engageLockdown() {
  if (!confirm("Encrypt the lockdown target folder now?")) return;
  try {
    const r = await api("/api/owner/lockdown/engage", { method: "POST" });
    document.getElementById("lockOut").textContent = `Encrypted ${r.encryptedFiles} files.\nDecryption key (SAVE THIS):\n${r.decryptionKey}`;
    document.getElementById("releaseKey").value = r.decryptionKey;
  } catch (err) { document.getElementById("lockOut").textContent = err.message; }
}
async function releaseLockdown() {
  const key = document.getElementById("releaseKey").value.trim();
  if (!key) return toast("Paste the key first.");
  try { const r = await api("/api/owner/lockdown/release", { method: "POST", body: { key } });
    document.getElementById("lockOut").textContent = `Released. Decrypted ${r.decrypted || 0} files.`; }
  catch (err) { document.getElementById("lockOut").textContent = err.message; }
}
async function listFs() {
  const p = document.getElementById("fsPath").value.trim();
  if (!p) return;
  try { const r = await api("/api/owner/fs/list", { method: "POST", body: { path: p } });
    document.getElementById("fsOut").textContent = r.items.map((i) => `${i.type === "directory" ? "📁" : "📄"} ${i.name}`).join("\n"); }
  catch (err) { document.getElementById("fsOut").textContent = err.message; }
}

/* ---------- lookups ---------- */
async function loadLookups() {
  try { const r = await api("/api/owner/lookups");
    document.getElementById("lookupFiles").innerHTML = r.files.length
      ? r.files.map((f) => `<span class="tag">📄 ${esc(f)}</span>`).join(" ")
      : `<span class="muted">No files yet — drop some into <code>agent/lookups/</code>.</span>`; }
  catch (err) { document.getElementById("lookupFiles").textContent = err.message; }
}
async function runLookup() {
  const q = document.getElementById("lookupQ").value.trim();
  const out = document.getElementById("lookupOut");
  if (!q) return;
  out.innerHTML = `<div class="muted">Searching…</div>`;
  try {
    const r = await api("/api/owner/lookup", { method: "POST", body: { query: q } });
    if (r.protected) { out.innerHTML = `<div class="card" style="color:var(--warn)">🛡 ${esc(r.message || "That identity is protected by the lookup whitelist.")}</div>`; return; }
    if (!r.matches?.length) { out.innerHTML = `<div class="muted">No matches across ${r.files} files.</div>`; return; }
    out.innerHTML = r.matches.map((m) => `
      <div class="card">
        ${m.error ? `<span style="color:var(--bad)">${esc(m.error)}</span>` : `<strong>${(m.hits || []).length} result${(m.hits || []).length === 1 ? "" : "s"}</strong>`}
        ${(m.hits || []).slice(0, 20).map((h) => `<pre class="out" style="margin-top:8px">${esc(typeof h === "string" ? h : JSON.stringify(h, null, 2))}</pre>`).join("")}
      </div>`).join("");
  } catch (err) { out.innerHTML = `<div style="color:var(--bad)">${esc(err.message)}</div>`; }
}

/* ---------- lookup whitelist ---------- */
async function loadWhitelist() {
  const list = document.getElementById("wlList");
  try {
    const r = await api("/api/owner/lookup-whitelist");
    list.innerHTML = r.items.length
      ? r.items.map((i) => `
        <div class="card" style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px">
          <div><strong>${esc(i.value)}</strong>${i.note ? ` <span class="muted">· ${esc(i.note)}</span>` : ""}</div>
          <button class="sm danger" data-wl-del="${esc(i.value)}">Remove</button>
        </div>`).join("")
      : `<div class="muted">No whitelisted values yet.</div>`;
    list.querySelectorAll("[data-wl-del]").forEach((b) => b.onclick = async () => {
      try { await api(`/api/owner/lookup-whitelist/${encodeURIComponent(b.dataset.wlDel)}`, { method: "DELETE" }); toast("Removed."); loadWhitelist(); }
      catch (err) { toast(err.message); }
    });
  } catch (err) { list.textContent = err.message; }
}
async function addWhitelist() {
  const value = document.getElementById("wlValue").value.trim();
  const note = document.getElementById("wlNote").value.trim();
  const out = document.getElementById("wlOut");
  if (!value) { out.textContent = "Enter a Discord username or ID first."; return; }
  try {
    const saved = await api("/api/owner/lookup-whitelist", { method: "POST", body: { value, note } });
    const linked = saved.aliases?.length ? ` Linked ${saved.aliases.length} matching ID${saved.aliases.length === 1 ? "" : "s"}.` : "";
    out.innerHTML = `<span style="color:var(--ok)">Protected ${esc(saved.value)}.${esc(linked)}</span>`;
    toast("Whitelist updated.");
    await loadWhitelist();
    document.getElementById("wlValue").value = "";
    document.getElementById("wlNote").value = "";
  } catch (err) { out.innerHTML = `<span style="color:var(--bad)">${esc(err.message)}</span>`; }
}

/* ---------- security & verification ---------- */
let SECURITY_GUILDS = [];
function initSecurity() {
  document.getElementById("securityGuild").onchange = loadSecurity;
  document.getElementById("securitySave").onclick = saveSecurity;
  loadSecurity();
}
async function loadSecurity() {
  const select = document.getElementById("securityGuild");
  const out = document.getElementById("securityOut");
  try {
    if (!SECURITY_GUILDS.length) {
      SECURITY_GUILDS = (await api("/api/owner/guilds")).guilds;
      select.innerHTML = SECURITY_GUILDS.length
        ? SECURITY_GUILDS.map((g) => `<option value="${esc(g.id)}">${esc(g.name || g.id)}</option>`).join("")
        : `<option value="">No connected servers</option>`;
    }
    const id = select.value;
    if (!id) { out.textContent = "Start the Discord bot to load server settings."; return; }
    const cfg = await api(`/api/owner/guilds/${id}/automod`);
    document.querySelectorAll("[data-security]").forEach((input) => { input.checked = !!cfg[input.dataset.security]; });
    document.getElementById("securityLogChannel").value = cfg.log_channel_id || "";
    const guild = SECURITY_GUILDS.find((g) => g.id === id);
    const roles = document.getElementById("securityVerifyRole");
    roles.innerHTML = `<option value="">Choose a role</option>` + (guild?.roles || []).map((role) =>
      `<option value="${esc(role.id)}" ${cfg.verify_role_id === role.id ? "selected" : ""}>${esc(role.name)}</option>`
    ).join("");
    out.textContent = "";
  } catch (err) { out.textContent = err.message; }
}
async function saveSecurity() {
  const id = document.getElementById("securityGuild").value;
  const out = document.getElementById("securityOut");
  if (!id) return;
  const body = {
    log_channel_id: document.getElementById("securityLogChannel").value.trim() || null,
    verify_role_id: document.getElementById("securityVerifyRole").value || null,
  };
  document.querySelectorAll("[data-security]").forEach((input) => { body[input.dataset.security] = input.checked ? 1 : 0; });
  try { await api(`/api/owner/guilds/${id}/automod`, { method: "POST", body }); out.innerHTML = `<span style="color:var(--ok)">Security settings saved.</span>`; toast("Security saved."); }
  catch (err) { out.innerHTML = `<span style="color:var(--bad)">${esc(err.message)}</span>`; }
}

/* ---------- alt account guilds ---------- */
async function loadAltGuilds() {
  const wrap = document.getElementById("altGuilds");
  const status = document.getElementById("altStatus");
  try {
    const r = await api("/api/owner/selfbot-guilds");
    status.innerHTML = r.guilds.length
      ? `<span class="pill">${r.guilds.length} servers found</span>`
      : `<span class="muted">Alt account is not connected or not in any servers.</span>`;
    wrap.innerHTML = r.guilds.map((g) => `
      <div class="card" style="display:flex;align-items:center;gap:12px">
        ${g.icon ? `<img src="${esc(g.icon)}" style="width:40px;height:40px;border-radius:50%" alt=""/>` : `<div style="width:40px;height:40px;border-radius:50%;background:var(--glass-strong);display:grid;place-items:center;font-size:18px">🖥</div>`}
        <div><strong>${esc(g.name)}</strong><div class="muted">${g.memberCount.toLocaleString()} members · ${g.id}</div></div>
      </div>`).join("");
  } catch (err) { status.textContent = err.message; wrap.innerHTML = ""; }
}

/* ---------- automation ---------- */
let AUTO_GUILDS = [];
let AUTO_GUILD = "";
function initAutomation() {
  const subTabs = document.querySelectorAll("[data-sub]");
  subTabs.forEach((b) => b.onclick = () => {
    subTabs.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    document.querySelectorAll("[data-subpane]").forEach((p) => p.classList.toggle("hidden", p.dataset.subpane !== b.dataset.sub));
  });

  document.getElementById("autoGuild").addEventListener("change", () => {
    AUTO_GUILD = document.getElementById("autoGuild").value;
    loadAutomation();
  });
  document.getElementById("ccAdd").onclick = async () => {
    const name = document.getElementById("ccName").value.trim().toLowerCase();
    const content = document.getElementById("ccContent").value.trim();
    if (!name || !content || !AUTO_GUILD) return;
    try { await api(`/api/owner/guilds/${AUTO_GUILD}/custom-commands`, { method: "POST", body: { name, content } }); toast("Saved."); loadAutomation(); }
    catch (err) { toast(err.message); }
  };
  document.getElementById("arAdd").onclick = async () => {
    const trigger = document.getElementById("arTrigger").value.trim().toLowerCase();
    const response = document.getElementById("arResponse").value.trim();
    if (!trigger || !response || !AUTO_GUILD) return;
    try { await api(`/api/owner/guilds/${AUTO_GUILD}/autoresponder`, { method: "POST", body: { trigger, response } }); toast("Saved."); loadAutomation(); }
    catch (err) { toast(err.message); }
  };
  document.getElementById("wcSave").onclick = async () => {
    if (!AUTO_GUILD) return;
    try {
      await api(`/api/owner/guilds/${AUTO_GUILD}/welcome`, {
        method: "POST",
        body: {
          channel_id: document.getElementById("wcChannel").value.trim() || null,
          message: document.getElementById("wcMessage").value.trim(),
          goodbye_channel_id: document.getElementById("wcGoodbyeChannel").value.trim() || null,
          goodbye_message: document.getElementById("wcGoodbyeMessage").value.trim(),
        },
      });
      toast("Saved.");
    } catch (err) { toast(err.message); }
  };
  document.getElementById("rrAdd").onclick = async () => {
    const message_id = document.getElementById("rrMessage").value.trim();
    const emoji = document.getElementById("rrEmoji").value.trim();
    const role_id = document.getElementById("rrRole").value.trim();
    if (!message_id || !emoji || !role_id || !AUTO_GUILD) return;
    try { await api(`/api/owner/guilds/${AUTO_GUILD}/reaction-roles`, { method: "POST", body: { message_id, emoji, role_id } }); toast("Saved."); loadAutomation(); }
    catch (err) { toast(err.message); }
  };
}

async function loadAutomation() {
  const select = document.getElementById("autoGuild");
  if (!AUTO_GUILDS.length) {
    try { AUTO_GUILDS = (await api("/api/owner/guilds")).guilds; } catch { return; }
    select.innerHTML = AUTO_GUILDS.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join("");
    if (!AUTO_GUILD && AUTO_GUILDS.length) { AUTO_GUILD = AUTO_GUILDS[0].id; select.value = AUTO_GUILD; }
  }
  if (!AUTO_GUILD) return;

  try {
    const cc = await api(`/api/owner/guilds/${AUTO_GUILD}/custom-commands`);
    document.getElementById("ccList").innerHTML = cc.items.length
      ? cc.items.map((c) => `<div class="card" style="padding:10px 14px;display:flex;justify-content:space-between"><code>!${esc(c.name)}</code><span>${esc(c.content)}</span><button class="sm danger" data-cc="${esc(c.name)}">Delete</button></div>`).join("")
      : `<div class="muted">No custom commands yet.</div>`;
    document.querySelectorAll("[data-cc]").forEach((b) => b.onclick = async () => {
      try { await api(`/api/owner/guilds/${AUTO_GUILD}/custom-commands`, { method: "POST", body: { delete: true, name: b.dataset.cc } }); toast("Deleted."); loadAutomation(); }
      catch (err) { toast(err.message); }
    });

    const ar = await api(`/api/owner/guilds/${AUTO_GUILD}/autoresponder`);
    document.getElementById("arList").innerHTML = ar.items.length
      ? ar.items.map((a) => `<div class="card" style="padding:10px 14px;display:flex;justify-content:space-between"><span><strong>${esc(a.trigger)}</strong> → ${esc(a.response)}</span><button class="sm danger" data-ar="${esc(a.trigger)}">Delete</button></div>`).join("")
      : `<div class="muted">No auto-responder triggers yet.</div>`;
    document.querySelectorAll("[data-ar]").forEach((b) => b.onclick = async () => {
      try { await api(`/api/owner/guilds/${AUTO_GUILD}/autoresponder`, { method: "POST", body: { delete: true, trigger: b.dataset.ar } }); toast("Deleted."); loadAutomation(); }
      catch (err) { toast(err.message); }
    });

    const wc = await api(`/api/owner/guilds/${AUTO_GUILD}/welcome`);
    document.getElementById("wcChannel").value = wc.channel_id || "";
    document.getElementById("wcMessage").value = wc.message;
    document.getElementById("wcGoodbyeChannel").value = wc.goodbye_channel_id || "";
    document.getElementById("wcGoodbyeMessage").value = wc.goodbye_message;

    const rr = await api(`/api/owner/guilds/${AUTO_GUILD}/reaction-roles`);
    document.getElementById("rrList").innerHTML = rr.items.length
      ? rr.items.map((r) => `<div class="card" style="padding:10px 14px;display:flex;justify-content:space-between"><span>${esc(r.emoji)} on <code>${esc(r.message_id)}</code> → <code>${esc(r.role_id)}</code></span><button class="sm danger" data-rr-msg="${esc(r.message_id)}" data-rr-emoji="${esc(r.emoji)}">Delete</button></div>`).join("")
      : `<div class="muted">No reaction role mappings yet.</div>`;
    document.querySelectorAll("[data-rr-msg]").forEach((b) => b.onclick = async () => {
      try { await api(`/api/owner/guilds/${AUTO_GUILD}/reaction-roles`, { method: "POST", body: { delete: true, message_id: b.dataset.rrMsg, emoji: b.dataset.rrEmoji } }); toast("Deleted."); loadAutomation(); }
      catch (err) { toast(err.message); }
    });
  } catch (err) {
    toast(err.message);
  }
}

/* ---------- Live activity feed ---------- */
let actSince = 0;
const actEvents = [];
async function startActivity() {
  const list = document.getElementById("actList");
  const filter = document.getElementById("actFilter");
  const clear = document.getElementById("actClear");
  if (!list) return;

  const render = () => {
    const kind = filter.value;
    const rows = actEvents
      .filter((e) => !kind || e.kind === kind)
      .slice(-200)
      .map((e) => `<div style="padding:6px 0;border-bottom:1px solid var(--glass-strong)">
        <span class="muted">${esc(new Date(e.at).toLocaleTimeString())}</span>
        <span class="pill" style="margin:0 6px;padding:1px 8px;font-size:11px">${esc(e.kind)}</span>
        ${esc(e.message)}
      </div>`).join("");
    list.innerHTML = rows || `<div class="muted">No events yet.</div>`;
    list.scrollTop = list.scrollHeight;
  };
  filter.onchange = render;
  clear.onclick = () => { actEvents.length = 0; render(); };

  const poll = async () => {
    try {
      const r = await api(`/api/owner/activity?since=${actSince}`);
      for (const e of r.events || []) {
        actEvents.push(e);
        if (e.id > actSince) actSince = e.id;
      }
      if (actEvents.length > 500) actEvents.splice(0, actEvents.length - 500);
      render();
    } catch {}
  };
  poll();
  setInterval(poll, 2500);
}
