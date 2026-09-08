/** Chat with tool-use loop. Handles up to 5 sequential tool calls per reply. */
import { ask } from "./ai.js";
import { extractToolCall, executeTool, TOOL_SPEC } from "./tools.js";
import { getSettings, rememberMessage, recallMessages } from "./db.js";

export async function chat({ scope, userText, mode = "general", isOwner = false }) {
  rememberMessage(scope, "user", userText);
  const history = recallMessages(scope);
  const persona = getSettings().persona;
  const messages = [
    { role: "system", content: `${persona}\n\n${TOOL_SPEC}` },
    ...history,
  ];

  let finalReply = "";
  let provider = "";
  let model = "";
  const toolTrace = [];

  for (let step = 0; step < 5; step++) {
    const { reply, provider: pv, model: md } = await ask({ messages, mode });
    provider = pv; model = md;

    const call = extractToolCall(reply);
    if (!call) { finalReply = reply; break; }

    const visible = reply.replace(call.raw, "").trim();
    if (visible) finalReply += visible + "\n\n";

    const result = await executeTool(call, { requesterIsOwner: isOwner });
    toolTrace.push({ tool: call.tool, args: call.args, result });

    messages.push({ role: "assistant", content: reply });
    messages.push({
      role: "system",
      content: `TOOL RESULT for ${call.tool}:\n${JSON.stringify(result).slice(0, 4000)}\n\nContinue the answer for the user. Do NOT repeat the tool block.`,
    });
  }

  if (!finalReply) finalReply = "(no response)";
  rememberMessage(scope, "assistant", finalReply);
  return { reply: finalReply.trim(), provider, model, tools: toolTrace };
}
