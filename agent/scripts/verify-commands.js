/**
 * Sanity check for the command registry:
 *   node scripts/verify-commands.js
 * Confirms every command loads, has the required shape, and reports the counts.
 */
import { COMMANDS, CATEGORIES } from "../src/commands.js";

const PERMS = new Set(["everyone", "mod", "admin", "owner"]);
const problems = [];
const seen = new Set();

for (const c of COMMANDS) {
  const where = `${c.category}/${c.name}`;
  if (seen.has(c.name)) problems.push(`duplicate name: ${where}`);
  seen.add(c.name);
  if (!/^[a-z0-9-]+$/.test(c.name)) problems.push(`bad name: ${where}`);
  if (!c.description) problems.push(`missing description: ${where}`);
  if (!c.usage) problems.push(`missing usage: ${where}`);
  if (!PERMS.has(c.permission)) problems.push(`bad permission: ${where} (${c.permission})`);
  if (typeof c.run !== "function") problems.push(`missing run(): ${where}`);
  if (c.run.length > 1) problems.push(`run() should take one context object: ${where}`);
}

const counts = CATEGORIES.map((cat) => `${cat}: ${COMMANDS.filter((c) => c.category === cat).length}`);
console.log(counts.join("\n"));
console.log(`TOTAL: ${COMMANDS.length}`);

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(" - " + p);
  process.exit(1);
}
if (COMMANDS.length < 200) {
  console.error(`\nOnly ${COMMANDS.length} commands — target is 200+.`);
  process.exit(1);
}
console.log("\nAll good.");
