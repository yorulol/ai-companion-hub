// Supervisor: keeps YORU running and restarts it when the agent exits with
// code 42 (auto-update signal). Used by `npm start`.
//
// Before the very first boot, it runs a dependency update pass so any pending
// npm updates are applied before YORU starts. If nothing is outdated it prints
// a single "up to date" line and moves on immediately.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSupervised } from "../src/auto-update.js";
import { updateDependencies } from "./update-deps.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.resolve(HERE, "..", "src", "index.js");

await updateDependencies().catch(() => {});
runSupervised(ENTRY);
