// Supervisor: keeps YORU running and restarts it when the agent exits with
// code 42 (auto-update signal). Used by `npm start`.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSupervised } from "../src/auto-update.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.resolve(HERE, "..", "src", "index.js");
runSupervised(ENTRY);
