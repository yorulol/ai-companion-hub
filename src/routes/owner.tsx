import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RobotMascot } from "@/components/RobotMascot";
import {
  api,
  getOwnerId,
  setOwnerId,
  clearOwnerId,
  type GuildConfig,
  type CommandInfo,
  type HealthInfo,
} from "@/lib/agent-client";

export const Route = createFileRoute("/owner")({
  head: () => ({
    meta: [
      { title: "Owner Control Panel — YORU Agent" },
      {
        name: "description",
        content:
          "Owner-only control panel: Discord bot and account responder, command prefix, per-server admin and moderation roles, and AI model routing.",
      },
      { property: "og:title", content: "Owner Control Panel — YORU Agent" },
      {
        property: "og:description",
        content: "Owner-only controls for the YORU self-hosted AI agent and Discord bot.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OwnerPanel,
});

function OwnerPanel() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [idInput, setIdInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = getOwnerId();
    if (!id) {
      setChecking(false);
      return;
    }
    api
      .verifyOwner(id)
      .then((ok) => setAuthed(ok))
      .catch(() => setAuthed(false))
      .finally(() => setChecking(false));
  }, []);

  async function unlock() {
    setError(null);
    const ok = await api.verifyOwner(idInput.trim()).catch(() => false);
    if (!ok) {
      setError("That Discord ID does not match the owner ID in your .env file (or the agent is offline).");
      return;
    }
    setOwnerId(idInput.trim());
    setAuthed(true);
  }

  if (checking) {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">Checking…</div>;
  }

  if (!authed) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <div className="panel glow w-full max-w-md space-y-4 p-6 text-center">
          <RobotMascot className="mx-auto h-24 w-24" />
          <h1 className="text-xl font-bold">Owner access only</h1>
          <p className="text-sm text-muted-foreground">
            Enter the Discord ID you set as the owner in your .env file.
          </p>
          <input
            value={idInput}
            onChange={(e) => setIdInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void unlock()}
            placeholder="Your Discord user ID"
            className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-center font-mono outline-none focus:ring-2 focus:ring-ring"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            onClick={() => void unlock()}
            className="w-full rounded-lg bg-primary px-4 py-2.5 font-semibold text-primary-foreground"
          >
            Unlock panel
          </button>
          <Link to="/" className="block text-sm text-muted-foreground hover:text-foreground">
            Back to chat
          </Link>
        </div>
      </main>
    );
  }

  return <OwnerDashboard onLock={() => { clearOwnerId(); setAuthed(false); }} />;
}

type Settings = {
  provider: { preferOllama: boolean; ollamaUrl: string; ollamaModel: string };
  discord: { botEnabled: boolean; selfbotEnabled: boolean; defaultPrefix: string; hasBotToken: boolean; hasUserToken: boolean };
  persona: string;
};

function OwnerDashboard({ onLock }: { onLock: () => void }) {
  const [tab, setTab] = useState<"overview" | "discord" | "servers" | "commands" | "models" | "computer">("overview");
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [guilds, setGuilds] = useState<GuildConfig[]>([]);
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [models, setModels] = useState<{ free: string[]; coding: string[]; ollama: string[] } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = () => {
    api.health().then(setHealth).catch(() => setHealth(null));
    api.settings().then((s) => setSettings(s as unknown as Settings)).catch(() => {});
    api.guilds().then((r) => setGuilds(r.guilds)).catch(() => {});
    api.commands().then((r) => setCommands(r.commands)).catch(() => {});
    api.models().then(setModels).catch(() => {});
  };

  useEffect(refresh, []);

  async function patch(p: Record<string, unknown>) {
    const s = await api.saveSettings(p);
    setSettings(s as unknown as Settings);
    setNote("Saved");
    setTimeout(() => setNote(null), 1800);
  }

  const tabs = ["overview", "discord", "servers", "commands", "models", "computer"] as const;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <header className="panel mb-4 flex flex-wrap items-center gap-3 p-4">
        <RobotMascot className="h-14 w-14" state={health?.ok ? "idle" : "offline"} />
        <div className="flex-1">
          <h1 className="text-xl font-bold">Owner control panel</h1>
          <p className="text-sm text-muted-foreground">
            {health?.ok ? "Agent online" : "Agent offline"}
            {health?.bot.tag ? ` · bot ${health.bot.tag} in ${health.bot.guilds} servers` : ""}
          </p>
        </div>
        {note && <span className="text-sm" style={{ color: "var(--success)" }}>{note}</span>}
        <Link to="/" className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-secondary">
          Chat
        </Link>
        <button onClick={onLock} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-secondary">
          Lock
        </button>
      </header>

      <nav className="mb-4 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold capitalize ${
              tab === t ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="OpenRouter" value={health?.openrouter ? "Ready" : "No key"} ok={!!health?.openrouter} />
          <Stat label="Ollama backup" value={health?.ollama ? "Ready" : "Offline"} ok={!!health?.ollama} />
          <Stat label="Discord bot" value={health?.bot.running ? "Running" : "Stopped"} ok={!!health?.bot.running} />
          <Stat label="Account responder" value={health?.selfbot.running ? "Running" : "Stopped"} ok={!!health?.selfbot.running} />
          <Stat label="Free models found" value={String(health?.freeModels ?? 0)} ok={(health?.freeModels ?? 0) > 0} />
          <Stat label="Commands loaded" value={String(commands.length)} ok={commands.length > 0} />
          <Stat label="Servers configured" value={String(guilds.length)} ok={guilds.length > 0} />
          <Stat label="Prefix" value={settings?.discord.defaultPrefix ?? "…"} ok />
        </div>
      )}

      {tab === "discord" && settings && (
        <div className="space-y-4">
          <Card title="Official bot">
            <Row
              label="Bot token in .env"
              value={settings.discord.hasBotToken ? "Detected" : "Missing — add DISCORD_BOT_TOKEN"}
            />
            <div className="flex gap-2">
              <button
                onClick={() => api.control("bot:start").then(refresh)}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              >
                Start bot
              </button>
              <button
                onClick={() => api.control("bot:stop").then(refresh)}
                className="rounded-lg border border-border px-4 py-2 text-sm"
              >
                Stop bot
              </button>
            </div>
          </Card>

          <Card title="Command prefix (default for new servers)">
            <input
              defaultValue={settings.discord.defaultPrefix}
              onBlur={(e) => void patch({ discord: { defaultPrefix: e.target.value } })}
              className="w-32 rounded-lg border border-input bg-background px-3 py-2 font-mono outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-sm text-muted-foreground">Each server can override this on the Servers tab.</p>
          </Card>

          <Card title="Personal account responder">
            <p className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--warning)", color: "var(--warning)" }}>
              Heads up: automating a personal Discord account breaks Discord's rules and the account can be banned.
              Only use an alt you don't mind losing.
            </p>
            <Row
              label="User token in .env"
              value={settings.discord.hasUserToken ? "Detected" : "Missing — add DISCORD_USER_TOKEN"}
            />
            <div className="flex gap-2">
              <button
                onClick={() => api.control("self:start").then(refresh)}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground"
              >
                Start responder
              </button>
              <button
                onClick={() => api.control("self:stop").then(refresh)}
                className="rounded-lg border border-border px-4 py-2 text-sm"
              >
                Stop responder
              </button>
            </div>
          </Card>

          <Card title="Agent personality">
            <textarea
              defaultValue={settings.persona}
              rows={4}
              onBlur={(e) => void patch({ persona: e.target.value })}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </Card>
        </div>
      )}

      {tab === "servers" && (
        <div className="space-y-4">
          {guilds.length === 0 && (
            <p className="panel p-6 text-sm text-muted-foreground">
              No servers yet. Start the bot and invite it to a server, then reload this page.
            </p>
          )}
          {guilds.map((g) => (
            <GuildCard key={g.id} guild={g} onSaved={refresh} />
          ))}
        </div>
      )}

      {tab === "commands" && <CommandList commands={commands} />}

      {tab === "models" && models && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card title={`Free chat models (${models.free.length})`}>
            <ModelList items={models.free} />
          </Card>
          <Card title={`Coding models (${models.coding.length})`}>
            <ModelList items={models.coding} />
          </Card>
          <Card title={`Ollama models (${models.ollama.length})`}>
            <ModelList items={models.ollama} />
            {settings && (
              <label className="flex items-center gap-2 pt-2 text-sm">
                <input
                  type="checkbox"
                  defaultChecked={settings.provider.preferOllama}
                  onChange={(e) => void patch({ provider: { preferOllama: e.target.checked } })}
                />
                Use Ollama first instead of OpenRouter
              </label>
            )}
          </Card>
        </div>
      )}

      {tab === "computer" && <ComputerTab />}
    </main>
  );
}

function ModelList({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">None available.</p>;
  return (
    <ul className="max-h-72 space-y-1 overflow-y-auto font-mono text-xs text-muted-foreground">
      {items.map((m) => (
        <li key={m} className="truncate">{m}</li>
      ))}
    </ul>
  );
}

function GuildCard({ guild, onSaved }: { guild: GuildConfig; onSaved: () => void }) {
  const [prefix, setPrefix] = useState(guild.prefix);
  const [adminRoles, setAdminRoles] = useState<string[]>(guild.adminRoles);
  const [modRoles, setModRoles] = useState<string[]>(guild.modRoles);
  const [aiReplies, setAiReplies] = useState(guild.aiReplies);
  const roles = guild.roles ?? [];

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((r) => r !== id) : [...list, id]);

  return (
    <div className="panel space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="flex-1 font-semibold">{guild.name}</h3>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={aiReplies} onChange={(e) => setAiReplies(e.target.checked)} />
          AI replies when mentioned
        </label>
        <input
          value={prefix}
          onChange={(e) => setPrefix(e.target.value)}
          className="w-20 rounded-lg border border-input bg-background px-2 py-1 text-center font-mono text-sm"
        />
      </div>

      <RolePicker title="Admin command roles" roles={roles} selected={adminRoles} onToggle={(id) => toggle(adminRoles, setAdminRoles, id)} />
      <RolePicker title="Moderation command roles" roles={roles} selected={modRoles} onToggle={(id) => toggle(modRoles, setModRoles, id)} />

      <button
        onClick={() =>
          api.saveGuild(guild.id, { prefix, adminRoles, modRoles, aiReplies }).then(onSaved)
        }
        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
      >
        Save server settings
      </button>
    </div>
  );
}

function RolePicker({
  title,
  roles,
  selected,
  onToggle,
}: {
  title: string;
  roles: { id: string; name: string }[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium">{title}</p>
      {roles.length === 0 ? (
        <p className="text-sm text-muted-foreground">Roles load once the bot is running.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {roles.map((r) => (
            <button
              key={r.id}
              onClick={() => onToggle(r.id)}
              className={`rounded-full px-3 py-1 text-xs ${
                selected.includes(r.id)
                  ? "bg-accent text-accent-foreground"
                  : "bg-secondary text-muted-foreground"
              }`}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CommandList({ commands }: { commands: CommandInfo[] }) {
  const [q, setQ] = useState("");
  const filtered = commands.filter(
    (c) =>
      c.name.includes(q.toLowerCase()) ||
      c.category.includes(q.toLowerCase()) ||
      c.description.toLowerCase().includes(q.toLowerCase()),
  );
  const groups = filtered.reduce<Record<string, CommandInfo[]>>((acc, c) => {
    (acc[c.category] ||= []).push(c);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Search ${commands.length} commands…`}
        className="w-full rounded-lg border border-input bg-background px-3 py-2.5 outline-none focus:ring-2 focus:ring-ring"
      />
      {Object.entries(groups).map(([cat, list]) => (
        <div key={cat} className="panel p-4">
          <h3 className="mb-3 font-semibold capitalize">
            {cat} <span className="text-sm font-normal text-muted-foreground">({list.length})</span>
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((c) => (
              <div key={c.name} className="rounded-lg bg-secondary/60 p-2.5">
                <p className="font-mono text-sm">
                  {c.name}
                  {c.permission !== "everyone" && (
                    <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] uppercase" style={{ backgroundColor: "var(--muted)" }}>
                      {c.permission}
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{c.description}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel space-y-3 p-4">
      <h3 className="font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Stat({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="panel p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold" style={{ color: ok ? "var(--success)" : "var(--muted-foreground)" }}>
        {value}
      </p>
    </div>
  );
}

function ComputerTab() {
  const [sys, setSys] = useState<Record<string, unknown> | null>(null);
  const [lock, setLock] = useState<{ active: boolean; target?: string; files?: number } | null>(null);
  const [lookupFiles, setLookupFiles] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [lookupResult, setLookupResult] = useState<string>("");
  const [scanOut, setScanOut] = useState<string>("");
  const [key, setKey] = useState<string>("");
  const [releaseKey, setReleaseKey] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [busy, setBusy] = useState<string>("");

  const refresh = () => {
    api.system().then(setSys).catch(() => {});
    api.lockdownStatus().then(setLock).catch(() => {});
    api.lookupFiles().then((r) => setLookupFiles(r.files)).catch(() => {});
  };
  useEffect(refresh, []);

  const doScan = async () => {
    setBusy("scan"); setScanOut("Running…");
    try { const r = await api.scan(); setScanOut(r.output || `Exit ${r.code}`); }
    catch (e) { setScanOut(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  };
  const doLockdown = async () => {
    if (!confirm("Encrypt every file in LOCKDOWN_TARGET? Save the key somewhere safe.")) return;
    setBusy("lock");
    try {
      const r = await api.lockdownEngage();
      setKey(r.decryptionKey);
      setNote(`🔒 Encrypted ${r.encryptedFiles} files. SAVE THE KEY.`);
      refresh();
    } catch (e) { setNote(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  };
  const doRelease = async () => {
    setBusy("release");
    try { const r = await api.lockdownRelease(releaseKey.trim()); setNote(`🔓 Restored ${r.restoredFiles} files.`); refresh(); }
    catch (e) { setNote(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  };
  const doLookup = async () => {
    setBusy("lookup"); setLookupResult("Searching…");
    try { const r = await api.lookup(query); setLookupResult(JSON.stringify(r.matches, null, 2) || "No matches."); }
    catch (e) { setLookupResult(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="panel space-y-2 p-4">
        <h3 className="font-semibold">System</h3>
        <pre className="max-h-64 overflow-auto rounded-lg bg-black/30 p-3 text-xs">
{sys ? JSON.stringify(sys, null, 2) : "…"}
        </pre>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-semibold">Malware scan</h3>
        <p className="text-sm text-muted-foreground">
          Linux uses ClamAV (`clamscan`); Windows uses Defender (`MpCmdRun`). Set the path in .env if it isn't on your PATH.
        </p>
        <button onClick={doScan} disabled={!!busy}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40">
          {busy === "scan" ? "Scanning…" : "Run full scan"}
        </button>
        {scanOut && <pre className="max-h-52 overflow-auto rounded-lg bg-black/30 p-3 text-xs">{scanOut}</pre>}
      </div>

      <div className="panel space-y-3 p-4 lg:col-span-2">
        <h3 className="font-semibold">Lockdown / encryption</h3>
        <p className="text-sm text-muted-foreground">
          Encrypts every file inside <code>LOCKDOWN_TARGET</code> with AES-256-GCM. You get a one-time hex key —
          store it somewhere safe. Paste the key below to decrypt.
        </p>
        <p className="text-sm">Status: {lock?.active ? <span style={{ color: "var(--warning)" }}>🔒 ACTIVE ({lock.files} files)</span> : "🟢 Not active"}</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={doLockdown} disabled={!!busy}
            className="rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground disabled:opacity-40">
            {busy === "lock" ? "Encrypting…" : "Engage lockdown"}
          </button>
        </div>
        {key && (
          <div className="rounded-lg border border-warning/50 bg-warning/10 p-3">
            <p className="mb-1 text-xs uppercase tracking-wide">Decryption key — copy now</p>
            <code className="break-all text-sm">{key}</code>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input value={releaseKey} onChange={(e) => setReleaseKey(e.target.value)}
            placeholder="Paste decryption key…"
            className="min-w-64 flex-1 rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs" />
          <button onClick={doRelease} disabled={!!busy || !releaseKey}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40">
            {busy === "release" ? "Restoring…" : "Release lockdown"}
          </button>
        </div>
        {note && <p className="text-sm" style={{ color: "var(--success)" }}>{note}</p>}
      </div>

      <div className="panel space-y-3 p-4 lg:col-span-2">
        <h3 className="font-semibold">Lookups — {lookupFiles.length} file(s)</h3>
        <p className="text-sm text-muted-foreground">
          Drop PDF / CSV / TXT / JSON into <code>agent/lookups/</code>. Search across all of them here.
        </p>
        <ul className="flex flex-wrap gap-2 text-xs">
          {lookupFiles.map((f) => (<li key={f} className="rounded-full bg-secondary px-2.5 py-1 font-mono">{f}</li>))}
        </ul>
        <div className="flex gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void doLookup()}
            placeholder="Search value (username, ID, email, …)"
            className="flex-1 rounded-lg border border-input bg-background px-3 py-2" />
          <button onClick={doLookup} disabled={!!busy || query.length < 2}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40">
            {busy === "lookup" ? "Searching…" : "Search"}
          </button>
        </div>
        {lookupResult && <pre className="max-h-72 overflow-auto rounded-lg bg-black/30 p-3 text-xs">{lookupResult}</pre>}
      </div>
    </div>
  );
}
