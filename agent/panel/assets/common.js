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

/* ---------- particle field: white motes that follow the cursor ---------- */
export function particles(canvas) {
  const ctx = canvas.getContext("2d");
  let w, h, dots;
  const mouse = { x: -9999, y: -9999, active: false };
  const count = () => Math.min(140, Math.round((window.innerWidth * window.innerHeight) / 13000));
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
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  window.addEventListener("mousemove", (e) => {
    const d = dpr();
    mouse.x = e.clientX * d;
    mouse.y = e.clientY * d;
    mouse.active = true;
  });
  window.addEventListener("mouseleave", () => { mouse.active = false; mouse.x = mouse.y = -9999; });

  function frame() {
    ctx.clearRect(0, 0, w, h);
    const d = dpr();
    const pullRadius = 220 * d;
    for (const p of dots) {
      // Gentle drift + soft attraction toward the cursor.
      if (mouse.active) {
        const dx = mouse.x - p.x, dy = mouse.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist < pullRadius && dist > 1) {
          const force = (1 - dist / pullRadius) * 0.06 * d;
          p.vx += (dx / dist) * force;
          p.vy += (dy / dist) * force;
        }
      }
      // Damping so they don't accelerate forever.
      p.vx *= 0.985; p.vy *= 0.985;
      // Baseline drift floor.
      if (Math.abs(p.vx) < 0.05 * d) p.vx += (Math.random() - 0.5) * 0.02 * d;
      if (Math.abs(p.vy) < 0.05 * d) p.vy += (Math.random() - 0.5) * 0.02 * d;
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) { p.x = 0; p.vx *= -1; }
      if (p.x > w) { p.x = w; p.vx *= -1; }
      if (p.y < 0) { p.y = 0; p.vy *= -1; }
      if (p.y > h) { p.y = h; p.vy *= -1; }
      const near = mouse.active && Math.hypot(mouse.x - p.x, mouse.y - p.y) < pullRadius;
      ctx.beginPath();
      ctx.arc(p.x, p.y, near ? p.r * 1.5 : p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${near ? Math.min(1, p.a + 0.35) : p.a})`;
      ctx.shadowBlur = near ? 16 : 10;
      ctx.shadowColor = "rgba(255,255,255,0.8)";
      ctx.fill();
    }
    // Constellation lines.
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const dx = dots[i].x - dots[j].x, dy = dots[i].y - dots[j].y;
        const dist = Math.hypot(dx, dy);
        if (dist < 130 * d) {
          ctx.beginPath();
          ctx.moveTo(dots[i].x, dots[i].y);
          ctx.lineTo(dots[j].x, dots[j].y);
          ctx.strokeStyle = `rgba(255,255,255,${0.11 * (1 - dist / (130 * d))})`;
          ctx.lineWidth = 1;
          ctx.shadowBlur = 0;
          ctx.stroke();
        }
      }
      // Line from cursor to nearby motes.
      if (mouse.active) {
        const dx = dots[i].x - mouse.x, dy = dots[i].y - mouse.y;
        const dist = Math.hypot(dx, dy);
        if (dist < pullRadius) {
          ctx.beginPath();
          ctx.moveTo(dots[i].x, dots[i].y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.strokeStyle = `rgba(255,255,255,${0.18 * (1 - dist / pullRadius)})`;
          ctx.lineWidth = 1;
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

/* ---------- animated robot mascot (monochrome) ---------- */
export const MASCOT = `
<svg class="mascot" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle class="ring" cx="64" cy="64" r="52" stroke="rgba(255,255,255,.3)" stroke-width="1.5" stroke-dasharray="6 12"/>
  <circle cx="64" cy="64" r="40" fill="rgba(255,255,255,.08)"/>
  <path d="M64 20v12" stroke="#d8d8e2" stroke-width="3" stroke-linecap="round"/>
  <circle cx="64" cy="18" r="4.5" fill="#ffffff"/>
  <rect x="34" y="34" width="60" height="50" rx="18" fill="rgba(16,16,20,.95)" stroke="#9a9aa8" stroke-width="2"/>
  <g class="eye">
    <circle cx="52" cy="57" r="6.5" fill="#ffffff"/>
    <circle cx="76" cy="57" r="6.5" fill="#ffffff"/>
  </g>
  <path d="M53 71q11 8 22 0" stroke="#d8d8e2" stroke-width="3" stroke-linecap="round"/>
  <rect x="44" y="88" width="40" height="18" rx="9" fill="rgba(16,16,20,.9)" stroke="#9a9aa8" stroke-width="2"/>
  <rect x="52" y="95" width="24" height="4" rx="2" fill="#cfcfda"/>
</svg>`;

/* ---------- embed mode: pages framed inside the hub hide their chrome ---------- */
if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("embed") === "1") {
  document.documentElement.classList.add("embed");
  if (document.body) document.body.classList.add("embed");
  else document.addEventListener("DOMContentLoaded", () => document.body.classList.add("embed"));
}

/* ---------- owner gate (local panels are loopback-trusted — auto unlock) ---------- */
export async function requireOwner({ onReady }) {
  const gate = document.getElementById("gate");
  // The agent service trusts loopback panel requests, so panels never ask
  // for the owner ID anymore. Keep the call shape for older pages.
  if (gate) gate.classList.add("hidden");
  return onReady();
}
