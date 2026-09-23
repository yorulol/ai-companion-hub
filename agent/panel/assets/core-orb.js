/* Animated core orb — Jarvis-style rotating ring with reactive pulse. */
export function coreOrb(canvas) {
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.width = canvas.clientWidth * dpr;
  const h = canvas.height = canvas.clientHeight * dpr;
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.4;
  let t = 0, level = 0.15, target = 0.15;
  const setLevel = (v) => { target = Math.max(0.1, Math.min(1, v)); };

  function frame() {
    t += 0.016;
    level += (target - level) * 0.08;
    ctx.clearRect(0, 0, w, h);
    const pulse = 1 + Math.sin(t * 2) * 0.03 + level * 0.12;

    // outer rotating ring
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.4);
    ctx.strokeStyle = `rgba(120,220,255,${0.35 + level * 0.4})`;
    ctx.lineWidth = 1.4 * dpr;
    ctx.setLineDash([8 * dpr, 12 * dpr]);
    ctx.beginPath();
    ctx.arc(0, 0, r * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // inner ring, opposite spin
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-t * 0.7);
    ctx.strokeStyle = `rgba(180,140,255,${0.28 + level * 0.35})`;
    ctx.lineWidth = 1.2 * dpr;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.72 * pulse, 0.3, Math.PI * 1.6);
    ctx.stroke();
    ctx.restore();

    // core
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.55 * pulse);
    grad.addColorStop(0, `rgba(180,240,255,${0.55 + level * 0.4})`);
    grad.addColorStop(0.6, `rgba(120,180,255,${0.15 + level * 0.25})`);
    grad.addColorStop(1, "rgba(20,40,80,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.7 * pulse, 0, Math.PI * 2);
    ctx.fill();

    // tick marks
    ctx.strokeStyle = `rgba(180,240,255,${0.5 + level * 0.4})`;
    ctx.lineWidth = 1.2 * dpr;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + t * 0.2;
      const r1 = r * 0.86, r2 = r * (0.94 + level * 0.05);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.stroke();
    }

    requestAnimationFrame(frame);
  }
  frame();
  return { setLevel };
}
