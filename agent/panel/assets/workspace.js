/* WorkSpace panel: YORU (Ollama) + ACE (OpenRouter/OpenClaw) collaborating. */
import { api, esc, render, particles, toast, MASCOT } from "/assets/common.js";

particles(document.getElementById("particles"));
document.getElementById("miniMascot").innerHTML = MASCOT;

const feed = document.getElementById("feed");
const runBtn = document.getElementById("run");
const stopBtn = document.getElementById("stop");
let sessionId = null;
let poller = null;
let seen = 0;

/* ---------- status ---------- */
(async () => {
  try {
    const h = await api("/api/health", { owner: false });
    document.getElementById("dotAgent").className = `dot ${h.ok ? "on" : "off"}`;
    document.getElementById("agentText").textContent = h.ok ? "agent online" : "offline";
    const info = await api("/api/workspace/info", { owner: false });
    document.getElementById("homeLabel").textContent = `home: ${info.home}`;
  } catch {
    document.getElementById("dotAgent").className = "dot off";
    document.getElementById("agentText").textContent = "agent offline";
  }
})();

/* ---------- session ---------- */
function bubble(m) {
  const div = document.createElement("div");
  div.className = `ws-msg ${m.agent === "YORU" ? "yoru" : "ace"}${m.error ? " error" : ""}`;
  div.innerHTML = `
    <div class="who">${esc(m.agent)} · round ${m.round}</div>
    <div>${render(m.reply)}</div>
    ${m.tool ? `<div class="tools">tool ${esc(m.tool.tool)} ${m.tool.ok ? "✓" : "✗"} — ${esc(String(m.tool.result).slice(0, 300))}</div>` : ""}
    <div class="meta">${m.provider ? `${esc(m.provider)}${m.model ? ` · ${esc(m.model)}` : ""}` : ""}</div>`;
  return div;
}

async function poll() {
  if (!sessionId) return;
  try {
    const s = await api(`/api/workspace/session/${sessionId}`, { owner: false });
    for (; seen < s.messages.length; seen++) {
      if (seen === 0) feed.innerHTML = "";
      feed.appendChild(bubble(s.messages[seen]));
      feed.scrollTop = feed.scrollHeight;
    }
    if (s.status !== "running") {
      clearInterval(poller);
      poller = null;
      runBtn.classList.remove("hidden");
      stopBtn.classList.add("hidden");
      const end = document.createElement("div");
      end.className = "muted";
      end.style.textAlign = "center";
      end.textContent = `Session ${s.status}.`;
      feed.appendChild(end);
    }
  } catch (err) {
    clearInterval(poller);
    poller = null;
    runBtn.classList.remove("hidden");
    stopBtn.classList.add("hidden");
    toast(err.message, 4000);
  }
}

runBtn.addEventListener("click", async () => {
  const task = document.getElementById("task").value.trim();
  if (!task) return toast("Give the agents a task first");
  const rounds = Number(document.getElementById("rounds").value || 4);
  const aceProvider = document.getElementById("aceProvider").value;
  try {
    const out = await api("/api/workspace/run", { method: "POST", body: { task, rounds, aceProvider }, owner: false });
    sessionId = out.id;
    seen = 0;
    feed.innerHTML = `<div class="muted" style="text-align:center">Session started — YORU &amp; ACE are working…</div>`;
    runBtn.classList.add("hidden");
    stopBtn.classList.remove("hidden");
    poller = setInterval(poll, 1500);
    poll();
  } catch (err) { toast(err.message, 4000); }
});

stopBtn.addEventListener("click", async () => {
  if (!sessionId) return;
  await api(`/api/workspace/stop/${sessionId}`, { method: "POST", owner: false }).catch(() => {});
});

/* ---------- home file browser ---------- */
let cwd = ".";
async function listDir() {
  try {
    const out = await api("/api/workspace/fs/list", { method: "POST", body: { path: cwd }, owner: false });
    document.getElementById("fsPath").textContent = cwd;
    const list = document.getElementById("fsList");
    list.innerHTML = "";
    for (const item of out.items) {
      const b = document.createElement("button");
      b.className = "ws-file";
      b.textContent = `${item.dir ? "📁" : "📄"} ${item.name}`;
      b.addEventListener("click", () => {
        if (item.dir) { cwd = item.path; listDir(); }
      });
      list.appendChild(b);
    }
  } catch (err) { toast(err.message, 4000); }
}
document.getElementById("fsUp").addEventListener("click", () => {
  if (cwd === "." || !cwd) return;
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  parts.pop();
  cwd = parts.length ? parts.join("/") : ".";
  listDir();
});
listDir();
