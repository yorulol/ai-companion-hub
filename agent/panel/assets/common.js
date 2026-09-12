/* Shared runtime for the bundled YORU panels. No build step, no framework. */

export const OWNER_KEY = "yoru.ownerId";

/* ---------- API (same origin — the panel server proxies /api/* to the agent) ---------- */
export async function api(path, { method = "GET", body, owner = true } = {}) {
  const headers = { "content-type": "application/json" };
  const id = localStorage.getItem(OWNER_KEY);
  if (owner && id) headers["x-owner-id"] = id;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function toast(msg, ms = 2600) {
  const el = document.createElement("div");
  el.className = "toast glass";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Minimal, safe markdown: fenced code, inline code, bold. */
export function render(text) {
  const parts = String(text ?? "").split(/```/);
  return parts
    .map((chunk, i) =>
      i % 2
        ? `<pre><code>${esc(chunk.replace(/^[a-z]*\n/i, ""))}</code></pre>`
        : esc(chunk).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>"),
    )
    .join("");
}

/* ---------- particle field ---------- */
export function particles(canvas) {
  const ctx = canvas.getContext("2d");
  let w, h, dots;
  const count = () => Math.min(120, Math.round((window.innerWidth * window.innerHeight) / 14000));
  function size() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = canvas.width = window.innerWidth * dpr;
    h = canvas.height = window.innerHeight * dpr;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    dots = Array.from({ length: count() }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: (Math.random() * 1.7 + 0.5) * dpr,
      vx: (Math.random() - 0.5) * 0.25 * dpr,
      vy: (Math.random() - 0.5) * 0.25 * dpr,
      a: Math.random() * 0.5 + 0.2,
    }));
  }
  function frame() {
    ctx.clearRect(0, 0, w, h);
    for (const d of dots) {
      d.x += d.vx; d.y += d.vy;
      if (d.x < 0 || d.x > w) d.vx *= -1;
      if (d.y < 0 || d.y > h) d.vy *= -1;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(180,130,255,${d.a})`;
      ctx.shadowBlur = 12;
      ctx.shadowColor = "rgba(150,90,255,0.8)";
      ctx.fill();
    }
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const dx = dots[i].x - dots[j].x, dy = dots[i].y - dots[j].y;
        const dist = Math.hypot(dx, dy);
        if (dist < 130) {
          ctx.beginPath();
          ctx.moveTo(dots[i].x, dots[i].y);
          ctx.lineTo(dots[j].x, dots[j].y);
          ctx.strokeStyle = `rgba(150,90,255,${0.12 * (1 - dist / 130)})`;
          ctx.lineWidth = 1;
          ctx.shadowBlur = 0;
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(frame);
  }
  size();
  window.addEventListener("resize", size);
  frame();
}

/* ---------- animated robot mascot ---------- */
export const MASCOT = `
<svg class="mascot" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle class="ring" cx="64" cy="64" r="52" stroke="rgba(168,118,255,.35)" stroke-width="1.5" stroke-dasharray="6 12"/>
  <circle cx="64" cy="64" r="40" fill="rgba(126,61,255,.10)"/>
  <path d="M64 20v12" stroke="#a678ff" stroke-width="3" stroke-linecap="round"/>
  <circle cx="64" cy="18" r="4.5" fill="#c9a7ff"/>
  <rect x="34" y="34" width="60" height="50" rx="18" fill="rgba(24,12,46,.95)" stroke="#8b5cf6" stroke-width="2"/>
  <g class="eye">
    <circle cx="52" cy="57" r="6.5" fill="#c9a7ff"/>
    <circle cx="76" cy="57" r="6.5" fill="#c9a7ff"/>
  </g>
  <path d="M53 71q11 8 22 0" stroke="#a678ff" stroke-width="3" stroke-linecap="round"/>
  <rect x="44" y="88" width="40" height="18" rx="9" fill="rgba(24,12,46,.9)" stroke="#8b5cf6" stroke-width="2"/>
  <rect x="52" y="95" width="24" height="4" rx="2" fill="#7c3aed"/>
</svg>`;

/* ---------- owner gate ---------- */
export async function requireOwner({ onReady }) {
  const gate = document.getElementById("gate");
  const input = document.getElementById("ownerInput");
  const btn = document.getElementById("ownerBtn");
  const err = document.getElementById("ownerErr");

  async function tryId(id) {
    const res = await fetch("/api/owner/verify", { method: "POST", headers: { "content-type": "application/json", "x-owner-id": id } });
    return res.ok;
  }
  const saved = localStorage.getItem(OWNER_KEY);
  if (saved && (await tryId(saved).catch(() => false))) {
    gate.classList.add("hidden");
    return onReady();
  }
  gate.classList.remove("hidden");
  btn.onclick = async () => {
    const id = input.value.trim();
    if (!id) return;
    btn.disabled = true;
    const ok = await tryId(id).catch(() => false);
    btn.disabled = false;
    if (!ok) { err.textContent = "That ID isn't the owner ID in the .env file."; return; }
    localStorage.setItem(OWNER_KEY, id);
    gate.classList.add("hidden");
    onReady();
  };
  input.onkeydown = (e) => { if (e.key === "Enter") btn.click(); };
}
