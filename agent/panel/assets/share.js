/* Team-share panel: terminal chat + lookup only. Token is in the URL. */
const TOKEN = new URLSearchParams(location.search).get("token") || "";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const render = (t) => {
  const parts = String(t ?? "").split(/```/);
  return parts.map((c, i) => i % 2
    ? `<pre><code>${esc(c.replace(/^[a-z]*\n/i, ""))}</code></pre>`
    : esc(c).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")).join("");
};

async function api(path, body) {
  const res = await fetch(`${path}?token=${encodeURIComponent(TOKEN)}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-share-token": TOKEN },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const $ = (id) => document.getElementById(id);
document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === b));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `${b.dataset.view}View`));
}));

const messages = $("messages"), input = $("input"), sendBtn = $("send");
const SCOPE = "share:" + (localStorage.getItem("yoru.share.scope") || (() => {
  const s = (crypto.randomUUID?.() || Math.random().toString(36).slice(2));
  localStorage.setItem("yoru.share.scope", s);
  return s;
})());

function line(role, text) {
  const el = document.createElement("div");
  el.className = `term-line ${role}`;
  const label = role === "user" ? "team@yoru:~$" : role === "system" ? "system::" : "yoru::";
  el.innerHTML = `<div class="prompt">${label}</div><div class="content">${render(text)}</div>`;
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
  return el;
}
line("system", "Connected to YORU. Terminal chat and lookup are available; nothing else is exposed to this session.");

async function send(text) {
  text = String(text || "").trim();
  if (!text) return;
  line("user", text);
  const pending = line("assistant", "processing…");
  sendBtn.disabled = true;
  try {
    const r = await api("/api/chat", { userText: text, mode: "general", scope: SCOPE });
    pending.querySelector(".content").innerHTML = render(r.reply || "No response.");
  } catch (e) {
    pending.querySelector(".content").textContent = `ERROR / ${e.message}`;
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}
$("composer").addEventListener("submit", (e) => { e.preventDefault(); const t = input.value; input.value = ""; input.style.height = "auto"; send(t); });
input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("composer").requestSubmit(); } });
input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(150, input.scrollHeight) + "px"; });

function flatten(hit) {
  if (hit.row && typeof hit.row === "object") return Object.entries(hit.row);
  if (hit.context) return [["Context", hit.context], ["Line", hit.line || "—"]];
  return Object.entries(hit).filter(([k]) => !["row", "context"].includes(k));
}
async function runLookup() {
  const q = $("lookupQuery").value.trim();
  if (q.length < 3) { $("lookupSummary").innerHTML = "<b>TOO SHORT</b><span>Use at least three characters.</span>"; return; }
  $("lookupSummary").innerHTML = "<b>SEARCHING</b><span>Scanning indexed sources…</span>";
  $("lookupResults").innerHTML = "";
  try {
    const r = await api("/api/lookup", { query: q });
    const hits = (r.matches || []).flatMap((g) => (g.hits || []).map((hit) => ({ hit })));
    if (r.protected && !hits.length) {
      $("lookupSummary").innerHTML = "<b>PROTECTED</b><span>This identity is excluded from lookup output.</span>";
      return;
    }
    $("lookupSummary").innerHTML = `<b>${hits.length} MATCH${hits.length === 1 ? "" : "ES"}</b><span>Searched ${r.files || 0} sources for “${esc(q)}”.</span>`;
    $("lookupResults").innerHTML = hits.map(({ hit }, i) => `<article class="result-card"><header><b>RESULT ${String(i + 1).padStart(3, "0")}</b><span>CONFIRMED MATCH</span></header><dl class="result-fields">${flatten(hit).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(typeof v === "object" ? JSON.stringify(v) : v)}</dd>`).join("")}</dl></article>`).join("") || `<div class="lookup-summary"><b>NO MATCHES</b><span>No indexed records matched that query.</span></div>`;
  } catch (e) {
    $("lookupSummary").innerHTML = `<b>ERROR</b><span>${esc(e.message)}</span>`;
  }
}
$("lookupGo").addEventListener("click", runLookup);
$("lookupQuery").addEventListener("keydown", (e) => { if (e.key === "Enter") runLookup(); });
