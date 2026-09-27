// Supervisor: keeps YORU running and restarts it when the agent exits with
// code 42 (auto-update signal). Used by `npm start`.
//
// Every boot (initial and update-triggered) runs the same dependency pass.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSupervised } from "../src/auto-update.js";
import { updateDependencies } from "./update-deps.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.resolve(HERE, "..", "src", "index.js");

await runSupervised(ENTRY, () => updateDependencies().catch(() => {}));
