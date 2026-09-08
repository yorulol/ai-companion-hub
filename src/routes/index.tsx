import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { RobotMascot } from "@/components/RobotMascot";
import { api, getBaseUrl, setBaseUrl, DEFAULT_BASE, type ChatMessage, type HealthInfo } from "@/lib/agent-client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NOVA Agent — Local AI Chat Panel" },
      {
        name: "description",
        content:
          "Chat with your self-hosted AI agent. OpenRouter free models first, Ollama as automatic backup, with a Discord bot you control.",
      },
      { property: "og:title", content: "NOVA Agent — Local AI Chat Panel" },
      {
        property: "og:description",
        content: "Self-hosted AI agent panel with OpenRouter + Ollama fallback and a Discord bot.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ChatPanel,
});

function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"general" | "coding">("general");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [base, setBase] = useState(DEFAULT_BASE);
  const [lastRoute, setLastRoute] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setBase(getBaseUrl());
    let alive = true;
    const ping = () =>
      api
        .health()
        .then((h) => alive && setHealth(h))
        .catch(() => alive && setHealth(null));
    ping();
    const t = setInterval(ping, 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const res = await api.chat(next, mode);
      setMessages([...next, { role: "assistant", content: res.reply }]);
      setLastRoute(`${res.provider} · ${res.model}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the agent service.");
    } finally {
      setBusy(false);
    }
  }

  const online = !!health?.ok;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 px-4 py-6">
      <header className="panel flex flex-wrap items-center gap-4 p-4">
        <RobotMascot
          state={!online ? "offline" : busy ? "thinking" : "idle"}
          className="h-20 w-20 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">NOVA</h1>
          <p className="text-sm text-muted-foreground">
            {online ? "Connected to your local agent" : "Local agent service is not reachable"}
            {lastRoute && online ? ` · answered by ${lastRoute}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusDot label="OpenRouter" ok={!!health?.openrouter} />
          <StatusDot label="Ollama" ok={!!health?.ollama} />
          <StatusDot label="Discord" ok={!!health?.bot.running} />
          <Link
            to="/owner"
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-secondary"
          >
            Owner panel
          </Link>
        </div>
      </header>

      {!online && (
        <div className="panel space-y-3 p-4">
          <p className="text-sm text-muted-foreground">
            Start the agent on your computer, then set its address below. See{" "}
            <span className="font-mono text-xs">agent/README.md</span> for the two commands.
          </p>
          <div className="flex gap-2">
            <input
              value={base}
              onChange={(e) => setBase(e.target.value)}
              className="flex-1 rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder={DEFAULT_BASE}
            />
            <button
              onClick={() => {
                setBaseUrl(base);
                api.health().then(setHealth).catch(() => setHealth(null));
              }}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              Connect
            </button>
          </div>
        </div>
      )}

      <section ref={boxRef} className="panel flex-1 space-y-4 overflow-y-auto p-4 md:p-6">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-14 text-center">
            <RobotMascot state={online ? "idle" : "offline"} className="h-28 w-28" />
            <h2 className="text-lg font-semibold">Ask me anything</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              General chat or coding help. I try the best free model first and quietly fall back to
              your own machine if the internet ones are busy.
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex gap-3"}>
            {m.role === "assistant" && <RobotMascot className="mt-1 h-8 w-8 shrink-0" />}
            <div
              className={
                m.role === "user"
                  ? "max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-primary-foreground"
                  : "max-w-[85%] whitespace-pre-wrap text-[15px] leading-relaxed text-foreground"
              }
            >
              {m.content}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <RobotMascot state="thinking" className="h-8 w-8" />
            Thinking…
          </div>
        )}

        {error && (
          <p className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
            {error}
          </p>
        )}
      </section>

      <footer className="panel p-3">
        <div className="mb-2 flex gap-2">
          {(["general", "coding"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition ${
                mode === m ? "bg-accent text-accent-foreground" : "bg-secondary text-muted-foreground"
              }`}
            >
              {m}
            </button>
          ))}
          {messages.length > 0 && (
            <button
              onClick={() => setMessages([])}
              className="ml-auto rounded-full px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Clear chat
            </button>
          )}
        </div>
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Message NOVA…"
            className="flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-[15px] outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={() => void send()}
            disabled={busy || !input.trim()}
            className="h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </footer>
    </main>
  );
}

function StatusDot({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className="hidden items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground sm:inline-flex">
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: ok ? "var(--success)" : "var(--muted-foreground)" }}
      />
      {label}
    </span>
  );
}
