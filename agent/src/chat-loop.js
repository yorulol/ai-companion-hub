/** Chat with tool-use loop. Handles up to 5 sequential tool calls per reply. */
import { ask } from "./ai.js";
import { extractToolCall, executeTool, stripToolArtifacts, TOOL_SPEC } from "./tools.js";
import { getSettings, rememberMessage, recallMessages } from "./db.js";

/**
 * @param {object} opts
 * @param {string} opts.scope       memory scope key
 * @param {string} opts.userText    the incoming text
 * @param {string} [opts.mode]      "general" | "code"
 * @param {boolean}[opts.isOwner]
 * @param {object} [opts.context]   { platform, guildName, channelName, isDm,
 *                                    authorTag, authorId, selfId,
 *                                    mentioned: [{id,tag}], replyToTag }
 */
export async function chat({ scope, userText, mode = "general", isOwner = false, context = null }) {
  rememberMessage(scope, "user", userText);
  const history = recallMessages(scope);
  const persona = getSettings().persona;
  const secrecy = isOwner
    ? "The requester is the verified OWNER. You may discuss and use all commands and capabilities with them."
    : "The requester is NOT the owner. Never reveal commands, tool names, computer-control features, lookup file names, or config details. Present lookup results without citing filenames.";

  const platformNote = buildPlatformNote(context);

  const lookupRules = [
    "LOOKUP RULES (non-negotiable):",
    "1. When the user asks to look up / search / find anything (a username, ID, email, word, etc.), your FIRST reply must be a lookup tool call and nothing else.",
    "2. NEVER invent, guess, or example-fabricate lookup results. You have zero lookup data until the tool returns it. Every match you report must come verbatim from a TOOL RESULT message.",
    "3. If the tool returns no matches, say plainly that nothing was found. Do not pad it with made-up entries.",
    "4. Never mention lookup filenames, file types, line numbers, or folder details to anyone.",
  ].join("\n");

  const messages = [
    { role: "system", content: `${persona}\n\n${secrecy}\n\n${platformNote}\n\n${lookupRules}\n\n${TOOL_SPEC}` },
    ...history,
  ];

  let finalReply = "";
  let provider = "";
  let model = "";
  const toolTrace = [];

  let lookupRan = false;

  for (let step = 0; step < 5; step++) {
    const { reply, provider: pv, model: md } = await ask({ messages, mode });
    provider = pv; model = md;

    const call = extractToolCall(reply);

    // Safety net: if the reply presents lookup results but the lookup tool
    // never actually ran this turn, it's fabricated. Reject it and force
    // the model to run the tool instead.
    if (!lookupRan && !call && /match(es)? (for|found)|found \d+|no matches/i.test(reply) && step < 4) {
      messages.push({ role: "assistant", content: reply });
      messages.push({
        role: "system",
        content: "You just described lookup results without running the lookup tool — that data does not exist. Run the lookup tool now with the user's query. Reply with ONLY the tool block.",
      });
      continue;
    }

    if (!call) { finalReply = stripToolArtifacts(reply); break; }

    if (call.tool === "lookup") lookupRan = true;

    const visible = stripToolArtifacts(reply.replace(call.raw, ""));
    if (visible) finalReply += visible + "\n\n";

    const result = await executeTool(call, { requesterIsOwner: isOwner });
    toolTrace.push({ tool: call.tool, args: call.args, result });

    messages.push({ role: "assistant", content: reply });
    messages.push({
      role: "system",
      content: `TOOL RESULT for ${call.tool}:\n${JSON.stringify(result).slice(0, 4000)}\n\nReport EXACTLY what this result contains — nothing more. If matches is empty, say nothing was found. Never mention filenames. Do NOT repeat the tool block or any tool syntax — reply in plain text only.`,
    });
  }

  finalReply = stripToolArtifacts(finalReply);
  if (!finalReply) finalReply = "(no response)";
  rememberMessage(scope, "assistant", finalReply);
  return { reply: finalReply.trim(), provider, model, tools: toolTrace };
}

function buildPlatformNote(ctx) {
  if (!ctx) {
    return "Reply naturally, like a real person in a chat. Keep messages tight — no long lectures unless asked. No bullet-lists for casual chat.";
  }
  const lines = [];
  lines.push("You are talking on Discord. Reply like a real person in a chat: short, casual, lowercase when it fits, contractions, no corporate tone, no bullet points for casual chat. Do NOT sign messages, do NOT prefix with your name, do NOT say things like 'as an AI'.");
  if (ctx.platform === "selfbot") {
    lines.push("You are posting from a personal Discord account (not a bot). Write like a human user would — casual, natural, no embeds, no bot-speak. Never announce you are an AI or bot.");
  } else if (ctx.platform === "bot") {
    lines.push("You are the server's Discord bot. You can be witty but stay tight and helpful.");
  }
  if (ctx.isDm) lines.push("This is a DM — one-on-one conversation.");
  else {
    if (ctx.guildName) lines.push(`Server: ${ctx.guildName}${ctx.channelName ? ` • #${ctx.channelName}` : ""}.`);
  }
  if (ctx.authorTag) lines.push(`You are replying to ${ctx.authorTag} (id ${ctx.authorId}).`);
  if (ctx.mentioned && ctx.mentioned.length) {
    const list = ctx.mentioned.map((m) => `${m.tag} → <@${m.id}>`).join(", ");
    lines.push(`Other users mentioned in the message: ${list}. If the request asks you to greet, ping, or address one of them, include their <@id> literally in your reply — Discord will render it as a ping.`);
  }
  lines.push("To ping any Discord user, write <@USER_ID> exactly (angle brackets, @, then the numeric id). To mention a channel use <#CHANNEL_ID>. Emojis are fine when they fit.");
  lines.push("Keep replies under ~1500 characters. If a task needs a tool (files, lookups, system), use it silently and just give the answer.");
  return lines.join(" ");
}
