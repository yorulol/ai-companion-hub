/** In-memory rolling activity log (ring buffer). Used by the owner panel live feed. */
const MAX = 500;
const events = [];
const listeners = new Set();

export function logActivity(kind, message, meta = {}) {
  const entry = { id: Date.now() + Math.random(), kind, message, meta, at: new Date().toISOString() };
  events.push(entry);
  if (events.length > MAX) events.splice(0, events.length - MAX);
  for (const fn of listeners) { try { fn(entry); } catch {} }
  return entry;
}

export function listActivity({ since = 0, limit = 200 } = {}) {
  const filtered = since ? events.filter((e) => e.id > since) : events;
  return filtered.slice(-limit);
}

export function onActivity(fn) { listeners.add(fn); return () => listeners.delete(fn); }
