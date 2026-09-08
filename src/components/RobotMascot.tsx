type MascotProps = {
  state?: "idle" | "thinking" | "talking" | "offline";
  className?: string;
};

/** Animated SVG mascot for the agent. Pure CSS animation, no deps. */
export function RobotMascot({ state = "idle", className = "" }: MascotProps) {
  const busy = state === "thinking" || state === "talking";
  const eye = state === "offline" ? "var(--muted-foreground)" : "var(--primary)";

  return (
    <div className={`relative ${className}`} aria-hidden="true">
      <svg viewBox="0 0 200 200" className={state === "offline" ? "" : "animate-bob"}>
        <defs>
          <linearGradient id="shellGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.42 0.04 253)" />
            <stop offset="100%" stopColor="oklch(0.27 0.035 253)" />
          </linearGradient>
        </defs>

        {/* halo */}
        {busy && (
          <circle cx="100" cy="104" r="66" fill="none" stroke={eye} strokeWidth="2" className="animate-ring" />
        )}

        {/* antenna */}
        <g className={busy ? "animate-sweep" : undefined}>
          <line x1="100" y1="52" x2="100" y2="30" stroke="var(--border)" strokeWidth="5" strokeLinecap="round" />
          <circle cx="100" cy="26" r="8" fill={state === "offline" ? "var(--muted)" : "var(--accent)"} />
        </g>

        {/* head */}
        <rect x="40" y="52" width="120" height="94" rx="28" fill="url(#shellGrad)" stroke="var(--border)" strokeWidth="3" />
        {/* visor */}
        <rect x="54" y="70" width="92" height="56" rx="22" fill="oklch(0.16 0.03 250)" stroke="var(--border)" strokeWidth="2" />

        {/* eyes */}
        <g className="animate-blink">
          <circle cx="82" cy="98" r="9" fill={eye} />
          <circle cx="118" cy="98" r="9" fill={eye} />
        </g>

        {/* mouth / equalizer */}
        <g fill={state === "offline" ? "var(--muted)" : "var(--accent)"}>
          {[0, 1, 2, 3, 4].map((i) => (
            <rect
              key={i}
              x={80 + i * 9}
              y={112}
              width="5"
              height="8"
              rx="2.5"
              style={
                busy
                  ? { animation: `dotWave 1.1s ease-in-out ${i * 0.11}s infinite` }
                  : { opacity: 0.55 }
              }
            />
          ))}
        </g>

        {/* ears */}
        <rect x="26" y="86" width="12" height="30" rx="6" fill="var(--secondary)" />
        <rect x="162" y="86" width="12" height="30" rx="6" fill="var(--secondary)" />

        {/* body */}
        <rect x="62" y="150" width="76" height="30" rx="14" fill="url(#shellGrad)" stroke="var(--border)" strokeWidth="3" />
        <circle cx="100" cy="165" r="6" fill={state === "offline" ? "var(--muted)" : "var(--primary)"} />
      </svg>
    </div>
  );
}
