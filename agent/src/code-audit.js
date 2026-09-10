/**
 * Local code auditor. Scans a folder, reads every code file, and asks the
 * active AI provider to flag issues and suggest fixes. No external services
 * beyond the configured AI providers.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { ask } from "./ai.js";

const CODE_EXTS = new Set([".js", ".ts", ".jsx", ".tsx", ".py", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".cs", ".rb", ".php", ".swift", ".kt"]);

async function walk(dir, out = []) {
  const items = await fs.readdir(dir, { withFileTypes: true });
  for (const item of items) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (item.name.startsWith(".") || item.name === "node_modules" || item.name === "dist" || item.name === "build") continue;
      await walk(full, out);
    } else if (item.isFile() && CODE_EXTS.has(path.extname(item.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

export async function auditFolder(folderPath, { onFile, onIssue } = {}) {
  const files = await walk(folderPath);
  const issues = [];

  for (const file of files) {
    onFile?.(path.relative(folderPath, file));
    const content = await fs.readFile(file, "utf8").catch(() => null);
    if (!content) continue;
    const relative = path.relative(folderPath, file);

    const prompt = [
      { role: "system", content: "You are a strict code auditor. Review the file below and report concrete issues: bugs, security risks, performance problems, or style violations. For each issue give: line number, severity (low/medium/high/critical), one-sentence description, and a suggested fix. Return ONLY a JSON object with shape { issues: [{line, severity, description, fix}] }. If no issues, return { issues: [] }." },
      { role: "user", content: `FILE: ${relative}\n\n${content}` },
    ];

    try {
      const { reply } = await ask({ messages: prompt, mode: "coding" });
      const json = reply.replace(/```json\s*|```/g, "").trim();
      const parsed = JSON.parse(json);
      const fileIssues = (parsed.issues || []).map((i) => ({ ...i, file: relative }));
      issues.push(...fileIssues);
      for (const i of fileIssues) onIssue?.(i);
    } catch (err) {
      issues.push({ file: relative, line: 0, severity: "low", description: `Could not audit: ${err.message}`, fix: "" });
    }
  }

  return { files: files.length, issues };
}
