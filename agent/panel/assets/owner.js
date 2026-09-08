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
});

requireOwner({ onReady: init });

async function init() {
  refreshHealth();
  setInterval(refreshHealth, 10000);
  loadSettings();
  loadGuilds();
  loadCommands();
  loadLookups();

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
    if (!r.matches?.length) { out.innerHTML = `<div class="muted">No matches across ${r.files} files.</div>`; return; }
    out.innerHTML = r.matches.map((m) => `
      <div class="card">
        <strong>${esc(m.file)}</strong> — ${m.error ? `<span style="color:var(--bad)">${esc(m.error)}</span>` : `${(m.hits || []).length} hits`}
        ${(m.hits || []).slice(0, 20).map((h) => `<pre class="out" style="margin-top:8px">${esc(typeof h === "string" ? h : JSON.stringify(h, null, 2))}</pre>`).join("")}
      </div>`).join("");
  } catch (err) { out.innerHTML = `<div style="color:var(--bad)">${esc(err.message)}</div>`; }
}
