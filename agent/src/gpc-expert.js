/**
 * GPC (GamePack Compiler) expertise for Cronus Zen. When the user asks Yoru
 * for a GPC script or anything Cronus-related, we inject a deep authoring
 * guide into the system prompt AND expose a save_gpc tool that writes a
 * ready-to-flash .gpc file into agent/gpc/.
 */
import fs from "node:fs/promises";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GPC_DIR = path.resolve(HERE, "..", "gpc");

// Ensure agent/gpc/ exists the moment Yoru boots — no reinstall needed.
try { mkdirSync(GPC_DIR, { recursive: true }); } catch {}

export const GPC_TRIGGER_RE = /\b(?:gpc|cronus(?:\s*zen)?|zen\s*studio|gamepack)\b/i;

export const GPC_EXPERT_PROMPT = `
CRONUS ZEN / GPC AUTHORING MODE — you are an expert GPC (GamePack Compiler) engineer for Cronus Zen (Zen Studio, GPC 3.x). When asked for a GPC script, output a COMPLETE, COMPILE-CLEAN .gpc file that can be pasted straight into Zen Studio and flashed to a Cronus Zen with zero edits.

Hard rules (a violation means the script fails to compile on Zen):
- Every script starts with a header comment block: title, author (Yoru), target game, target controller layout (PS4/PS5/XB1/XBSX/Switch Pro), and a one-line description.
- Use GPC 3 syntax: 'main { ... }', 'init { ... }', 'combo NAME { ... }', 'function name() { ... }'. Wait times use 'wait(ms);'. Combos are triggered with 'combo_run(NAME);' and stopped with 'combo_stop(NAME);'.
- Use PlayStation button constants by default (PS4_CROSS, PS4_CIRCLE, PS4_SQUARE, PS4_TRIANGLE, PS4_R1, PS4_R2, PS4_L1, PS4_L2, PS4_R3, PS4_L3, PS4_UP, PS4_DOWN, PS4_LEFT, PS4_RIGHT, PS4_OPTIONS, PS4_SHARE, PS4_PS, PS4_TOUCH, PS4_LX, PS4_LY, PS4_RX, PS4_RY). If the user asks for Xbox, translate to XB1_* / XBOX_*. Never mix layouts in one script.
- Read inputs with get_val(BUTTON), sticks with get_val(PS4_LX)/get_val(PS4_LY) (range -100..100), triggers with get_val(PS4_R2) (0..100). Override with set_val(BUTTON, value). Block a button with set_val(BUTTON, 0) or block_rumble().
- Every 'combo' MUST end with a final wait() and use call statements only (set_val + wait). Never call another combo from inside a combo — use combo_run in main{} instead.
- Every 'define' constant is UPPER_SNAKE_CASE and terminated with ';'. Persistent variables use 'int NAME;' at file scope (Zen preserves ints across power cycles when declared with 'persist NAME;').
- Use // for single-line comments and /* ... */ for blocks. No C++ // inside preprocessor lines.
- Always add a small toggle UI: hold OPTIONS + a face button to toggle each mod, with a rumble + LED confirmation via combo NOTIFY that flashes 'set_led(LED_1, 1); wait(120); set_led(LED_1, 0);'. Use LED_1..LED_4 to indicate active mods.
- Anti-recoil: read RY, apply set_val(PS4_RY, clamp(get_val(PS4_RY) + ANTI_RECOIL_V, -100, 100)) only when get_val(PS4_R2) > 75, and expose ANTI_RECOIL_V / ANTI_RECOIL_H as tunable defines.
- Rapid fire: combo RAPID_FIRE { set_val(PS4_R2,100); wait(RF_HOLD); set_val(PS4_R2,0); wait(RF_REST); set_val(PS4_R2,0); }. Trigger only when the user is actually holding R2.
- Auto-sprint: when |LY|>90 or |LX|>90, set_val(PS4_L3, 100).
- Drop-shot / quick-scope / jitter / akimbo / hair-trigger: implement as separate named combos, each individually toggleable.
- Wrap all logic inside 'main { ... }'. Do NOT put logic at file scope.
- Finish with a friendly footer comment listing every toggle combo and its shortcut.

Output format:
- Reply with a short one-paragraph summary of what the script does and how to toggle its mods, then the FULL .gpc source in a single fenced code block tagged 'gpc' (\`\`\`gpc ... \`\`\`).
- If the user says 'save it' / 'make the file' / 'export' / gives a filename, ALSO call the save_gpc tool with { filename, content } to write it to agent/gpc/. Filename must end in .gpc and contain no path separators.
- Never output partial scripts, TODOs, placeholder button names, or "you can add ..." — the file must compile as-is.
`.trim();

export async function saveGpc(filename, content) {
  const safeName = String(filename || "").replace(/[^\w.-]/g, "_");
  if (!safeName || !/\.gpc$/i.test(safeName)) throw new Error("filename must end in .gpc");
  await fs.mkdir(GPC_DIR, { recursive: true });
  const outPath = path.join(GPC_DIR, safeName);
  const body = String(content || "").replace(/\r\n/g, "\n");
  if (!/main\s*\{/.test(body)) throw new Error("script missing required 'main { ... }' block");
  await fs.writeFile(outPath, body, "utf8");
  return { path: outPath, bytes: Buffer.byteLength(body, "utf8") };
}
