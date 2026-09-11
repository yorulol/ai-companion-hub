import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { RobotMascot } from "@/components/RobotMascot";
import { api, type ChatMessage, type HealthInfo } from "@/lib/agent-client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "YORU Agent — Local AI Chat Panel" },
      {
        name: "description",
        content:
          "Chat with your self-hosted AI agent. OpenRouter free models first, Ollama as automatic backup, with a Discord bot you control.",
      },
      { property: "og:title", content: "YORU Agent — Local AI Chat Panel" },
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
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRoute, setLastRoute] = useState<string | null>(null);
  const [pane, setPane] = useState<"chat" | "email">("chat");
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let alive = true;
    const ping = () =>
      api
        .health()
        .then((h) => alive && setHealth(h))
        .catch(() => alive && setHealth(null));
    ping();
    const t = setInterval(ping, 5000);
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
      const res = await api.chat(text, "general", "panel:main");
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
      <header className="panel relative z-[110] flex flex-wrap items-center gap-4 p-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">YORU</h1>
          <p className="text-sm text-muted-foreground">
            {online ? "Connected to your local agent" : "Local agent service is not reachable"}
            {lastRoute && online ? ` · answered by ${lastRoute}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ProviderToggle health={health} />
          <Link
            to="/owner"
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-secondary"
          >
            Owner panel
          </Link>
          <HamburgerMenu pane={pane} setPane={setPane} />
        </div>
      </header>

      {!online && (
        <div className="panel space-y-2 p-4 text-sm text-muted-foreground">
          <p>
            <span className="font-semibold text-foreground">Agent offline.</span> Start it on your
            computer and this panel will connect automatically.
          </p>
          <pre className="overflow-x-auto rounded-lg bg-secondary/60 px-3 py-2 font-mono text-xs">
{`cd agent
npm install   # first time only
npm run yoru`}
          </pre>
        </div>
      )}

      {pane === "email" && <MailForwardPane />}

      <section ref={boxRef} className={`panel flex-1 space-y-4 overflow-y-auto p-4 md:p-6 ${pane !== "chat" ? "hidden" : ""}`}>
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
            placeholder="Message YORU…"
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

function HamburgerMenu({ pane, setPane }: { pane: "chat" | "email"; setPane: (p: "chat" | "email") => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);
  const item = "block w-full rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-secondary";
  const active = " bg-secondary font-semibold";
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-secondary"
        aria-label="Menu"
      >
        ☰
      </button>
      {open && (
        <div className="absolute right-0 top-full z-[100] mt-2 w-52 rounded-xl border border-border bg-popover p-2 shadow-xl shadow-black/60">
          <button className={item + (pane === "chat" ? active : "")} onClick={() => { setPane("chat"); setOpen(false); }}>
            Chat
          </button>
          <button className={item + (pane === "email" ? active : "")} onClick={() => { setPane("email"); setOpen(false); }}>
            Mail Forwarding
          </button>
          <a
            href="http://localhost:8788"
            target="_blank"
            rel="noreferrer"
            className={item}
            onClick={() => setOpen(false)}
          >
            Code check (local)
          </a>
        </div>
      )}
    </div>
  );
}

type MailTab = "domains" | "alias" | "handle" | "dns" | "keys";

function MailForwardPane() {
  const [tab, setTab] = useState<MailTab>("domains");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(op: string, args: Record<string, unknown> = {}) {
    setBusy(true); setErr(null); setResult(null);
    try {
      const r = await api.mailFwd(op, args);
      setResult(r.result);
    } catch (e) { setErr(e instanceof Error ? e.message : "Request failed"); }
    finally { setBusy(false); }
  }

  return (
    <section className="panel space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs text-[#4ade80]">
          ⟩_ mail.thc.org
        </span>
        <a href="https://reads.phrack.org/docs/" target="_blank" rel="noreferrer"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline">API docs ↗</a>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto rounded-lg bg-secondary/40 p-1">
        {([
          ["domains", "Domains"],
          ["alias", "Aliases"],
          ["handle", "Handles"],
          ["dns", "DNS Check"],
          ["keys", "API Keys"],
        ] as const).map(([k, label]) => (
          <button key={k} onClick={() => { setTab(k); setResult(null); setErr(null); }}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 font-mono text-xs transition-colors ${tab === k ? "bg-[#4ade80]/15 text-[#4ade80] font-semibold" : "text-muted-foreground hover:text-foreground"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "domains" && <MailDomains run={run} busy={busy} />}
      {tab === "alias" && <MailAliases run={run} busy={busy} />}
      {tab === "handle" && <MailHandles run={run} busy={busy} />}
      {tab === "dns" && <MailDns run={run} busy={busy} />}
      {tab === "keys" && <MailKeys run={run} busy={busy} />}

      {err && (
        <p className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive-foreground">{err}</p>
      )}
      {result !== null && (
        <pre className="max-h-[50vh] overflow-auto rounded-xl bg-secondary/60 p-3 font-mono text-xs text-foreground">
          {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
        </pre>
      )}
    </section>
  );
}

function MfInput({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="font-mono text-[11px] text-muted-foreground">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-1 focus:ring-[#4ade80]/50" />
    </label>
  );
}

function MfBtn({ onClick, busy, children }: { onClick: () => void; busy: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={busy}
      className="rounded-lg border border-[#4ade80]/30 bg-[#4ade80]/10 px-4 py-2 font-mono text-xs font-semibold text-[#4ade80] transition-colors hover:bg-[#4ade80]/20 disabled:opacity-40">
      {busy ? "…" : children}
    </button>
  );
}

function MailDomains({ run, busy }: { run: (op: string, a?: Record<string, unknown>) => void; busy: boolean }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">List all public mail domains and live stats.</p>
      <div className="flex gap-2">
        <MfBtn onClick={() => run("domains")} busy={busy}>List domains</MfBtn>
        <MfBtn onClick={() => run("stats")} busy={busy}>Stats</MfBtn>
      </div>
    </div>
  );
}

function MailAliases({ run, busy }: { run: (op: string, a?: Record<string, unknown>) => void; busy: boolean }) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [to, setTo] = useState("");
  const [alias, setAlias] = useState("");
  const [token, setToken] = useState("");
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Create or remove email aliases. Confirmation tokens are sent to the destination email.</p>

      <div className="space-y-2 rounded-lg border border-border/50 p-3">
        <span className="font-mono text-[11px] text-[#4ade80]">Create alias</span>
        <div className="grid gap-2 sm:grid-cols-3">
          <MfInput label="Name" value={name} onChange={setName} placeholder="research" />
          <MfInput label="Domain" value={domain} onChange={setDomain} placeholder="reads.phrack.org" />
          <MfInput label="Forward to" value={to} onChange={setTo} placeholder="you@example.com" />
        </div>
        <MfBtn onClick={() => run("alias-subscribe", { name, domain, to })} busy={busy}>Subscribe</MfBtn>
      </div>

      <div className="space-y-2 rounded-lg border border-border/50 p-3">
        <span className="font-mono text-[11px] text-[#4ade80]">Remove alias</span>
        <MfInput label="Alias address" value={alias} onChange={setAlias} placeholder="research@reads.phrack.org" />
        <MfBtn onClick={() => run("alias-unsubscribe", { alias })} busy={busy}>Unsubscribe</MfBtn>
      </div>

      <div className="space-y-2 rounded-lg border border-border/50 p-3">
        <span className="font-mono text-[11px] text-[#4ade80]">Confirm (6-digit token from email)</span>
        <MfInput label="Token" value={token} onChange={setToken} placeholder="123456" />
        <MfBtn onClick={() => run("alias-confirm", { token })} busy={busy}>Confirm</MfBtn>
      </div>

      <div className="space-y-2 rounded-lg border border-border/50 p-3">
        <span className="font-mono text-[11px] text-[#4ade80]">API-key operations</span>
        <div className="flex flex-wrap gap-2">
          <MfBtn onClick={() => run("alias-list")} busy={busy}>List my aliases</MfBtn>
          <MfBtn onClick={() => run("alias-stats")} busy={busy}>My stats</MfBtn>
          <MfBtn onClick={() => run("alias-activity")} busy={busy}>Activity log</MfBtn>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <MfInput label="Handle (create)" value={name} onChange={setName} placeholder="research" />
          <MfInput label="Domain (create)" value={domain} onChange={setDomain} placeholder="reads.phrack.org" />
        </div>
        <div className="flex gap-2">
          <MfBtn onClick={() => run("alias-create", { alias_handle: name, alias_domain: domain })} busy={busy}>Create (API key)</MfBtn>
          <MfBtn onClick={() => run("alias-delete", { alias: `${name}@${domain}` })} busy={busy}>Delete (API key)</MfBtn>
        </div>
      </div>
    </div>
  );
}

function MailHandles({ run, busy }: { run: (op: string, a?: Record<string, unknown>) => void; busy: boolean }) {
  const [handle, setHandle] = useState("");
  const [to, setTo] = useState("");
  const [domain, setDomain] = useState("");
  const [token, setToken] = useState("");
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">A handle reserves one local part across <b>all</b> managed domains.</p>

      <div className="space-y-2 rounded-lg border border-border/50 p-3">
        <span className="font-mono text-[11px] text-[#4ade80]">Create handle</span>
        <div className="grid gap-2 sm:grid-cols-2">
          <MfInput label="Handle" value={handle} onChange={setHandle} placeholder="alice" />
          <MfInput label="Forward to" value={to} onChange={setTo} placeholder="you@example.com" />
        </div>
        <MfBtn onClick={() => run("handle-subscribe", { handle, to })} busy={busy}>Subscribe</MfBtn>
      </div>

      <div className="space-y-2 rounded-lg border border-border/50 p-3">
        <span className="font-mono text-[11px] text-[#4ade80]">Remove handle</span>
        <MfInput label="Handle" value={handle} onChange={setHandle} placeholder="alice" />
        <MfBtn onClick={() => run("handle-unsubscribe", { handle })} busy={busy}>Unsubscribe</MfBtn>
      </div>

      <div className="space-y-2 rounded-lg border border-border/50 p-3">
        <span className="font-mono text-[11px] text-[#4ade80]">Confirm (6-digit token)</span>
        <MfInput label="Token" value={token} onChange={setToken} placeholder="123456" />
        <MfBtn onClick={() => run("handle-confirm", { token })} busy={busy}>Confirm</MfBtn>
      </div>

      <div className="space-y-2 rounded-lg border border-border/50 p-3">
        <span className="font-mono text-[11px] text-[#4ade80]">Domain control</span>
        <div className="grid gap-2 sm:grid-cols-2">
          <MfInput label="Handle" value={handle} onChange={setHandle} placeholder="alice" />
          <MfInput label="Domain" value={domain} onChange={setDomain} placeholder="thc.org" />
        </div>
        <div className="flex gap-2">
          <MfBtn onClick={() => run("handle-domain-disable", { handle, domain })} busy={busy}>Disable domain</MfBtn>
          <MfBtn onClick={() => run("handle-domain-enable", { handle, domain })} busy={busy}>Enable domain</MfBtn>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-border/50 p-3">
        <span className="font-mono text-[11px] text-[#4ade80]">API-key operations</span>
        <div className="flex gap-2">
          <MfBtn onClick={() => run("handle-create", { handle })} busy={busy}>Create (API key)</MfBtn>
          <MfBtn onClick={() => run("handle-delete", { handle })} busy={busy}>Delete (API key)</MfBtn>
        </div>
      </div>
    </div>
  );
}

function MailDns({ run, busy }: { run: (op: string, a?: Record<string, unknown>) => void; busy: boolean }) {
  const [target, setTarget] = useState("");
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Check DNS verification status for a domain.</p>
      <MfInput label="Domain" value={target} onChange={setTarget} placeholder="example.com" />
      <MfBtn onClick={() => run("check-dns", { target })} busy={busy}>Check DNS</MfBtn>
    </div>
  );
}

function MailKeys({ run, busy }: { run: (op: string, a?: Record<string, unknown>) => void; busy: boolean }) {
  const [email, setEmail] = useState("");
  const [days, setDays] = useState("30");
  const [token, setToken] = useState("");
  const [apiKey, setApiKey] = useState("");
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Request, renew, and manage API keys. Keys are shown <b>once</b> at confirmation — save them immediately.</p>

      <div className="space-y-2 rounded-lg border border-border/50 p-3">
        <span className="font-mono text-[11px] text-[#4ade80]">Request new key</span>
        <div className="grid gap-2 sm:grid-cols-2">
          <MfInput label="Email" value={email} onChange={setEmail} placeholder="you@example.com" />
          <MfInput label="Days" value={days} onChange={setDays} placeholder="30" type="number" />
        </div>
        <MfBtn onClick={() => run("credentials-create", { email, days: Number(days) })} busy={busy}>Request API key</MfBtn>
      </div>

      <div className="space-y-2 rounded-lg border border-border/50 p-3">
        <span className="font-mono text-[11px] text-[#4ade80]">Confirm key (6-digit token)</span>
        <MfInput label="Token" value={token} onChange={setToken} placeholder="123456" />
        <div className="flex gap-2">
          <MfBtn onClick={() => run("credentials-confirm-preview", { token })} busy={busy}>Preview</MfBtn>
          <MfBtn onClick={() => run("credentials-confirm", { token })} busy={busy}>Issue key</MfBtn>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-border/50 p-3">
        <span className="font-mono text-[11px] text-[#4ade80]">Manage existing key</span>
        <MfInput label="API key (64 chars)" value={apiKey} onChange={setApiKey} placeholder="0123456789abcdef…" />
        <div className="flex flex-wrap gap-2">
          <MfBtn onClick={() => run("credentials-renew", { api_key: apiKey, days: Number(days) })} busy={busy}>Renew (+{days}d)</MfBtn>
          <MfBtn onClick={() => run("credentials-auto-renew", { api_key: apiKey, automatic_renew: true })} busy={busy}>Auto-renew ON</MfBtn>
          <MfBtn onClick={() => run("credentials-auto-renew", { api_key: apiKey, automatic_renew: false })} busy={busy}>Auto-renew OFF</MfBtn>
          <MfBtn onClick={() => run("credentials-destroy", { api_key: apiKey })} busy={busy}>Destroy key</MfBtn>
        </div>
      </div>
    </div>
  );
}

type ProviderRow = { name: string; enabled: boolean; hasKey: boolean; keyRequired: boolean; model: string | null };
const PROVIDER_LABEL: Record<string, string> = {
  openrouter: "OpenRouter",
  ollama: "Ollama",
  openai: "OpenAI",
  anthropic: "Anthropic",
  groq: "Groq",
  openclaw: "OpenClaw",
};
const PROVIDER_NOTE: Record<string, string> = {
  openrouter: "Rotates every free model automatically.",
  ollama: "Local models — no API key needed.",
  openclaw: "Self-hosted (github.com/openclaw/openclaw). Key optional.",
  openai: "",
  anthropic: "",
  groq: "",
};

function ProviderToggle({ health }: { health: HealthInfo | null }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ preferred: string; providers: ProviderRow[] } | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api.providers().then(setData).catch(() => setData(null));
  useEffect(() => { if (open) load(); }, [open]);

  const save = async (patch: Parameters<typeof api.saveProviders>[0], label: string) => {
    setSaving(label); setMsg(null);
    try { await api.saveProviders(patch); await load(); setMsg("Saved to .env"); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
    finally { setSaving(null); setTimeout(() => setMsg(null), 2000); }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="hidden items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground sm:inline-flex hover:text-foreground"
      >
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: health?.openrouter ? "var(--success)" : "var(--muted-foreground)" }}
        />
        {health?.preferred || "provider"}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 max-h-[70vh] overflow-auto rounded-xl border border-border bg-background p-3 shadow-lg">
          <div className="mb-2 text-xs font-semibold text-muted-foreground">AI providers</div>
          {!data && <div className="text-xs text-muted-foreground">Loading…</div>}
          {data && (
            <>
              <div className="mb-3 rounded-lg border border-border/50 p-2">
                <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Preferred (tried first)</div>
                <select
                  value={data.preferred}
                  onChange={(e) => save({ preferred: e.target.value }, "preferred")}
                  disabled={saving === "preferred"}
                  className="w-full rounded-md border border-border bg-secondary px-2 py-1 text-sm"
                >
                  {data.providers.map((p) => (
                    <option key={p.name} value={p.name}>{PROVIDER_LABEL[p.name]}</option>
                  ))}
                </select>
              </div>

              {data.providers.map((p) => (
                <div key={p.name} className="mb-2 rounded-lg border border-border/50 p-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      onChange={(e) => save({ providers: { [p.name]: { enabled: e.target.checked } } }, p.name)}
                      disabled={saving === p.name}
                      className="rounded"
                    />
                    <span className="flex-1 font-medium">{PROVIDER_LABEL[p.name]}</span>
                    {p.keyRequired && (
                      <span className={`text-[10px] ${p.hasKey ? "text-emerald-400" : "text-amber-400"}`}>
                        {p.hasKey ? "key set" : "no key"}
                      </span>
                    )}
                  </label>
                  {PROVIDER_NOTE[p.name] && (
                    <div className="mt-1 text-[10px] text-muted-foreground">{PROVIDER_NOTE[p.name]}</div>
                  )}
                  {(p.keyRequired || p.name === "openclaw") && (
                    <div className="mt-2 flex gap-1">
                      <input
                        type="password"
                        placeholder={p.hasKey ? "•••••••• (replace)" : "Paste API key"}
                        value={keys[p.name] ?? ""}
                        onChange={(e) => setKeys({ ...keys, [p.name]: e.target.value })}
                        className="flex-1 rounded-md border border-border bg-secondary px-2 py-1 text-xs"
                      />
                      <button
                        onClick={() => { save({ providers: { [p.name]: { key: keys[p.name] ?? "" } } }, p.name + ":key"); setKeys({ ...keys, [p.name]: "" }); }}
                        disabled={saving === p.name + ":key"}
                        className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground"
                      >
                        Save
                      </button>
                    </div>
                  )}
                </div>
              ))}
              <div className="mt-2 text-[10px] text-muted-foreground">
                Changes write to <code>agent/.env</code>. OpenClaw is a self-hosted OSS server — leave the key blank unless your instance requires one.
              </div>
              {msg && <div className="mt-1 text-[10px] text-emerald-400">{msg}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
