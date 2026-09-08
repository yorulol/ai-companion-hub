/** Owner-only commands: full control of the host machine and the bot itself. */
import {
  embed, okEmbed, errEmbed, infoEmbed, warnEmbed, COLORS,
  button, row, paginate, confirm, choose, prompt, listPages, codeBlock, bar, fmt,
} from "../ui.js";
import { config } from "../config.js";
import { COMMANDS } from "../commands.js";
import {
  systemInfo, listDir, readFile, writeFile, moveFile, removeFile,
  scanForMalware, engageLockdown, releaseLockdown, lockdownStatus,
} from "../computer.js";
import { listLookupFiles } from "../lookups.js";

export const commands = [];
const add = (c) => commands.push(c);

const deny = (message) =>
  message.reply({ embeds: [errEmbed("Owner only", "Only the configured owner ID can run this.")] }).catch(() => {});

const guard = (run) => async (ctx) => {
  if (!ctx.isOwner) return void deny(ctx.message);
  if (!config.computer.enabled && run.needsComputer) {
    return void ctx.message.reply({ embeds: [errEmbed("Computer control is off", "Set `COMPUTER_CONTROL_ENABLED=true` in `.env`.")] });
  }
  return run(ctx);
};

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

// 1 — sysinfo
add({ name: "sysinfo", category: "owner", description: "Host system overview.", usage: "sysinfo", permission: "owner",
  run: guard(async ({ message }) => {
    const s = await systemInfo();
    const used = (s.totalMem || 0) - (s.freeMem || 0);
    message.reply({ embeds: [embed({
      title: "🖥️ Host system",
      color: COLORS.info,
      fields: [
        { name: "Platform", value: `${s.platform || config.os.platform} ${s.release || ""}`, inline: true },
        { name: "Hostname", value: String(s.hostname || config.os.hostname), inline: true },
        { name: "CPU", value: String(s.cpu || s.cpus || "—"), inline: true },
        { name: "Memory", value: s.totalMem ? `${bar(used, s.totalMem)}\n${mb(used)} / ${mb(s.totalMem)}` : "—" },
        { name: "Uptime", value: s.uptime ? `${Math.round(s.uptime / 3600)}h` : "—", inline: true },
        { name: "Sandbox root", value: `\`${config.computer.root}\``, inline: true },
      ],
    })] });
  })});

// 2 — ls
add({ name: "ls", category: "owner", description: "List a folder.", usage: "ls <path>", permission: "owner", aliases: ["dir"],
  run: guard(async ({ message, args }) => {
    const p = args.join(" ") || config.computer.root;
    try {
      const items = await listDir(p);
      const rows = items.map((i) => `${i.type === "dir" || i.type === "directory" ? "📁" : "📄"} \`${i.name}\``);
      await paginate(message, listPages(rows, { title: `📂 ${p} · ${items.length} items`, perPage: 20 }), { userId: message.author.id });
    } catch (err) { message.reply({ embeds: [errEmbed("Can't read that folder", String(err.message))] }); }
  })});

// 3 — cat
add({ name: "cat", category: "owner", description: "Read a file.", usage: "cat <path>", permission: "owner", aliases: ["readfile"],
  run: guard(async ({ message, args }) => {
    const p = args.join(" ");
    if (!p) return void message.reply({ embeds: [infoEmbed("Which file?", "`cat /home/you/notes.txt`")] });
    try {
      const content = await readFile(p);
      const parts = [];
      for (let i = 0; i < content.length; i += 1600) parts.push(content.slice(i, i + 1600));
      const pages = (parts.length ? parts : ["(empty file)"]).map((c, i) =>
        embed({ title: `📄 ${p}`, description: codeBlock(c), footer: `Part ${i + 1} of ${parts.length || 1}` }));
      await paginate(message, pages, { userId: message.author.id });
    } catch (err) { message.reply({ embeds: [errEmbed("Can't read that file", String(err.message))] }); }
  })});

// 4 — writefile
add({ name: "writefile", category: "owner", description: "Create or overwrite a file.", usage: "writefile <path>", permission: "owner",
  run: guard(async ({ message, args }) => {
    const p = args.join(" ");
    if (!p) return void message.reply({ embeds: [infoEmbed("Which file?", "`writefile /home/you/note.txt`")] });
    const content = await prompt(message, { title: "Send the file contents", description: `Your next message becomes the contents of \`${p}\`.` });
    if (content == null) return void message.reply({ embeds: [infoEmbed("Timed out", "Nothing was written.")] });
    const yes = await confirm(message, { title: "Write this file?", description: `\`${p}\` · ${content.length} characters` });
    if (!yes) return;
    try {
      const res = await writeFile(p, content);
      message.channel.send({ embeds: [okEmbed("File written", `\`${res.path}\` · ${fmt(res.bytes)} bytes`)] });
    } catch (err) { message.channel.send({ embeds: [errEmbed("Write failed", String(err.message))] }); }
  })});

// 5 — mvfile
add({ name: "mvfile", category: "owner", description: "Move or rename a file.", usage: "mvfile <from> | <to>", permission: "owner",
  run: guard(async ({ message, args }) => {
    const [from, to] = args.join(" ").split("|").map((s) => s.trim());
    if (!from || !to) return void message.reply({ embeds: [infoEmbed("Two paths needed", "`mvfile /a/old.txt | /a/new.txt`")] });
    const yes = await confirm(message, { title: "Move this file?", description: `\`${from}\`\n→ \`${to}\`` });
    if (!yes) return;
    try { await moveFile(from, to); message.channel.send({ embeds: [okEmbed("Moved", `\`${to}\``)] }); }
    catch (err) { message.channel.send({ embeds: [errEmbed("Move failed", String(err.message))] }); }
  })});

// 6 — rmfile
add({ name: "rmfile", category: "owner", description: "Delete a file.", usage: "rmfile <path>", permission: "owner",
  run: guard(async ({ message, args }) => {
    const p = args.join(" ");
    if (!p) return void message.reply({ embeds: [infoEmbed("Which file?", "`rmfile /home/you/old.txt`")] });
    const yes = await confirm(message, { title: "Delete permanently?", description: `\`${p}\` cannot be recovered.` });
    if (!yes) return;
    try { await removeFile(p); message.channel.send({ embeds: [okEmbed("Deleted", `\`${p}\``)] }); }
    catch (err) { message.channel.send({ embeds: [errEmbed("Delete failed", String(err.message))] }); }
  })});

// 7 — scan
add({ name: "scan", category: "owner", description: "Full malware scan.", usage: "scan", permission: "owner",
  run: guard(async ({ message }) => {
    const yes = await confirm(message, { title: "Run a full malware scan?", description: "This can take a long while and uses a lot of CPU.", danger: false });
    if (!yes) return;
    const live = await message.channel.send({ embeds: [infoEmbed("Scanning…", "Working through the drive. I'll report back here.")] });
    try {
      const res = await scanForMalware();
      await live.edit({ embeds: [embed({
        title: res.code === 0 ? "🛡️ Scan clean" : "⚠️ Scan finished with findings",
        color: res.code === 0 ? COLORS.ok : COLORS.warn,
        description: codeBlock(String(res.output || "").slice(-1500)),
        fields: [{ name: "Target", value: `\`${res.target}\``, inline: true }, { name: "Exit code", value: String(res.code), inline: true }],
      })] });
    } catch (err) { live.edit({ embeds: [errEmbed("Scan failed", String(err.message))] }).catch(() => {}); }
  })});

// 8 — lockdown
add({ name: "lockdown", category: "owner", description: "Encrypt the lockdown target.", usage: "lockdown", permission: "owner",
  run: guard(async ({ message }) => {
    const first = await confirm(message, { title: "Engage lockdown?", description: `Everything under \`${config.computer.lockdownTarget || "(LOCKDOWN_TARGET not set)"}\` gets encrypted.` });
    if (!first) return;
    const second = await confirm(message, { title: "Last chance", description: "Without the key those files stay locked. Continue?" });
    if (!second) return;
    try {
      const res = await engageLockdown();
      await message.author.send({ embeds: [embed({
        title: "🔐 Lockdown key",
        description: `Keep this safe — it's the only way back.\n${codeBlock(res.decryptionKey)}`,
        color: COLORS.danger,
        fields: [{ name: "Target", value: `\`${res.target}\`` }, { name: "Files encrypted", value: fmt(res.encryptedFiles) }],
      })] });
      message.channel.send({ embeds: [okEmbed("Lockdown engaged", `${fmt(res.encryptedFiles)} files encrypted. The key is in your DMs — never posted here.`)] });
    } catch (err) { message.channel.send({ embeds: [errEmbed("Lockdown failed", String(err.message))] }); }
  })});

// 9 — unlock
add({ name: "unlock", category: "owner", description: "Release lockdown with your key.", usage: "unlock", permission: "owner",
  run: guard(async ({ message }) => {
    const dm = await message.author.createDM().catch(() => null);
    if (!dm) return void message.reply({ embeds: [errEmbed("DMs closed", "Open your DMs so the key never appears in a channel.")] });
    await message.reply({ embeds: [infoEmbed("Check your DMs", "Send me the decryption key there.")] });
    await dm.send({ embeds: [infoEmbed("Send the decryption key", "Reply here with the key from lockdown.")] });
    const collected = await dm.awaitMessages({ filter: (m) => m.author.id === message.author.id, max: 1, time: 120_000 }).catch(() => null);
    const key = collected?.first()?.content?.trim();
    if (!key) return void dm.send({ embeds: [infoEmbed("Timed out", "Nothing was changed.")] });
    try {
      const res = await releaseLockdown(key);
      dm.send({ embeds: [okEmbed("Lockdown released", `${fmt(res.restoredFiles)} files restored in \`${res.target}\`.`)] });
    } catch (err) { dm.send({ embeds: [errEmbed("Wrong key", String(err.message))] }); }
  })});

// 10 — lockdownstatus
add({ name: "lockdownstatus", category: "owner", description: "Is lockdown active?", usage: "lockdownstatus", permission: "owner",
  run: guard(async ({ message }) => {
    try {
      const s = await lockdownStatus();
      message.reply({ embeds: [s.active
        ? warnEmbed("Lockdown active", `\`${s.target}\` · ${fmt(s.files || 0)} files encrypted.`)
        : okEmbed("All clear", "No lockdown is active.")] });
    } catch (err) { message.reply({ embeds: [errEmbed("Couldn't check", String(err.message))] }); }
  })});

// 11 — lookupsources
add({ name: "lookupsources", category: "owner", description: "Files in the lookups folder.", usage: "lookupsources", permission: "owner",
  run: guard(async ({ message }) => {
    const files = await listLookupFiles().catch(() => []);
    if (!files.length) return void message.reply({ embeds: [warnEmbed("Empty", "Drop PDF / CSV / TXT / JSON files into `agent/lookups/`.")] });
    await paginate(message, listPages(files.map((f) => `📄 \`${f}\``), { title: `Lookup sources (${files.length})`, perPage: 15 }), { userId: message.author.id });
  })});

// 12 — botstats
add({ name: "botstats", category: "owner", description: "Bot process stats.", usage: "botstats", permission: "owner",
  run: guard(async ({ message, client }) => {
    const mem = process.memoryUsage();
    const users = client.guilds.cache.reduce((a, g) => a + (g.memberCount || 0), 0);
    message.reply({ embeds: [embed({
      title: "📊 YORU stats",
      color: COLORS.info,
      fields: [
        { name: "Servers", value: fmt(client.guilds.cache.size), inline: true },
        { name: "Users", value: fmt(users), inline: true },
        { name: "Commands", value: fmt(COMMANDS.length), inline: true },
        { name: "Memory", value: mb(mem.rss), inline: true },
        { name: "Uptime", value: `${Math.round(process.uptime() / 60)} min`, inline: true },
        { name: "Node", value: process.version, inline: true },
      ],
    })] });
  })});

// 13 — broadcast
add({ name: "broadcast", category: "owner", description: "Announce to every server.", usage: "broadcast <message>", permission: "owner",
  run: guard(async ({ message, args, client }) => {
    const text = args.join(" ");
    if (!text) return void message.reply({ embeds: [infoEmbed("Say what?", "`broadcast Maintenance tonight at 9pm.`")] });
    const yes = await confirm(message, { title: `Send to ${client.guilds.cache.size} servers?`, description: text.slice(0, 1000) });
    if (!yes) return;
    let sent = 0;
    for (const [, g] of client.guilds.cache) {
      const ch = g.systemChannel || g.channels.cache.find((c) => c.isTextBased?.() && c.viewable);
      if (!ch) continue;
      const ok = await ch.send({ embeds: [embed({ title: "📢 Announcement", description: text, color: COLORS.brand })] }).catch(() => null);
      if (ok) sent++;
    }
    message.channel.send({ embeds: [okEmbed("Broadcast sent", `Delivered to ${sent} servers.`)] });
  })});

// 14 — leaveguild
add({ name: "leaveguild", category: "owner", description: "Leave a server.", usage: "leaveguild", permission: "owner",
  run: guard(async ({ message, client }) => {
    const options = client.guilds.cache.map((g) => ({ label: g.name.slice(0, 100), value: g.id, description: `${g.memberCount} members` })).slice(0, 25);
    if (!options.length) return void message.reply({ embeds: [infoEmbed("No servers", "I'm not in any server yet.")] });
    const id = await choose(message, { title: "Leave which server?", options });
    if (!id) return;
    const guild = client.guilds.cache.get(id);
    const yes = await confirm(message, { title: `Leave ${guild?.name}?`, description: "I'll need a fresh invite to come back." });
    if (!yes) return;
    await guild?.leave().catch(() => {});
    message.channel.send({ embeds: [okEmbed("Left", guild?.name || id)] });
  })});

// 15 — restartbot
add({ name: "restartbot", category: "owner", description: "Reconnect the Discord bot.", usage: "restartbot", permission: "owner",
  run: guard(async ({ message }) => {
    const yes = await confirm(message, { title: "Restart the bot connection?", description: "I'll disconnect and come straight back.", danger: false });
    if (!yes) return;
    await message.channel.send({ embeds: [infoEmbed("Restarting…", "Back in a moment.")] });
    const { stopBot, startBot } = await import("../bot.js");
    await stopBot();
    setTimeout(() => startBot().catch((e) => console.error("[bot] restart failed", e.message)), 1500);
  })});

// 16 — shutdown
add({ name: "shutdown", category: "owner", description: "Stop the Discord bot.", usage: "shutdown", permission: "owner",
  run: guard(async ({ message }) => {
    const yes = await confirm(message, { title: "Shut the bot down?", description: "It stays offline until you start it from the owner panel." });
    if (!yes) return;
    await message.channel.send({ embeds: [okEmbed("Going offline", "See you soon.")] });
    const { stopBot } = await import("../bot.js");
    await stopBot();
  })});
