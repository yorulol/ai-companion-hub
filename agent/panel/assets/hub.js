/* Merged hub: one panel, one port — chat, owner controls, workspace, services. */
import { api, particles, toast, MASCOT } from "/assets/common.js";

particles(document.getElementById("particles"));
document.getElementById("miniMascot").innerHTML = MASCOT;

/* ---------- view switching (lazy iframes, only one visible at a time) ---------- */
const frames = [...document.querySelectorAll(".hub-frame")];
const navBtns = [...document.querySelectorAll("#hubNav [data-view]")];

function show(view) {
  for (const b of navBtns) b.setAttribute("aria-pressed", String(b.dataset.view === view));
  for (const f of frames) {
    const on = f.dataset.frame === view;
    if (on && !f.src) f.src = f.dataset.src;
    f.classList.toggle("active", on);
  }
}
for (const b of navBtns) b.addEventListener("click", () => show(b.dataset.view));
frames[0].addEventListener("load", () => frames[0].classList.add("loaded"));
frames[0].classList.add("active");

/* Close dropdowns when clicking elsewhere or opening another */
document.addEventListener("click", (e) => {
  document.querySelectorAll(".tab-group[open]").forEach((d) => {
    if (!d.contains(e.target)) d.removeAttribute("open");
  });
});
document.querySelectorAll(".tab-group > summary").forEach((s) =>
  s.addEventListener("click", () => {
    document.querySelectorAll(".tab-group[open]").forEach((d) => {
      if (d !== s.parentElement) d.removeAttribute("open");
    });
  }),
);

/* ---------- services ---------- */
const SERVICE_URLS = {
  ollama: "http://localhost:11434",
  openclaw: "http://localhost:18789",
  openrouter: "https://openrouter.ai",
};
document.querySelectorAll("[data-service]").forEach((b) =>
  b.addEventListener("click", () => window.open(SERVICE_URLS[b.dataset.service], "_blank", "noopener")),
);

/* ---------- status ---------- */
async function refreshStatus() {
  try {
    const h = await api("/api/health", { owner: false });
    const alive = !!h.ok;
    document.getElementById("dotAgent").className = `dot ${alive ? "on" : "off"}`;
    document.getElementById("agentText").textContent = alive ? `${h.preferred || "agent"} online` : "offline";
    document.getElementById("dotBot").className = `dot ${h.bot?.running ? "on" : "off"}`;
    document.getElementById("dotSelf").className = `dot ${h.selfbot?.running ? "on" : "off"}`;
  } catch {
    document.getElementById("dotAgent").className = "dot off";
    document.getElementById("agentText").textContent = "agent offline";
  }
  try {
    const v = await api("/api/owner/voice");
    document.getElementById("vcStatus").textContent = v.inChannel
      ? `In voice channel ${v.channelId} — ${v.events} events, ${v.notes} notes`
      : "Not in a voice channel.";
  } catch {}
}
refreshStatus();
setInterval(refreshStatus, 8000);

/* ---------- voice meetings ---------- */
document.getElementById("vcJoin").addEventListener("click", async () => {
  const channel = document.getElementById("vcChannel").value.trim();
  if (!channel) return toast("Enter a voice channel ID or exact name");
  try {
    const out = await api("/api/owner/voice/join", { method: "POST", body: { channel } });
    toast(`Joined #${out.channel}`);
    refreshStatus();
  } catch (err) { toast(err.message, 4000); }
});
document.getElementById("vcLeave").addEventListener("click", async () => {
  try {
    const out = await api("/api/owner/voice/leave", { method: "POST" });
    toast("Recap saved — check the chat or data/meetings/");
    document.getElementById("vcStatus").textContent = out.recap.split("\n").slice(0, 6).join("\n");
    refreshStatus();
  } catch (err) { toast(err.message, 4000); }
});
document.getElementById("vcRecap").addEventListener("click", async () => {
  try {
    const out = await api("/api/owner/voice/recap");
    document.getElementById("vcStatus").textContent = out.recap ? out.recap.split("\n").slice(0, 10).join("\n") : "No recaps yet.";
  } catch (err) { toast(err.message, 4000); }
});
