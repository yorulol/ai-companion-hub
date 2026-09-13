export const OPENCLAW_NODE_REQUIREMENT = "Node.js 24.16.x or 26.1+";

export function supportsOpenClawNode(version = process.versions.node) {
  const [major = 0, minor = 0] = String(version).split(".").map(Number);
  return (major === 24 && minor >= 16) || (major === 26 && minor >= 1) || major > 26;
}