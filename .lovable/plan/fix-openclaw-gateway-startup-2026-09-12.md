# Fix OpenClaw gateway startup

## Changes
- Replace the conflicting service-start loop with one deterministic gateway lifecycle.
- Detect and terminate only the stale OpenClaw gateway process before a single clean start.
- Verify the authenticated models and chat endpoints before marking OpenClaw ready.
- Prevent overlapping startup or recovery attempts from the boot process and chat requests.
- Surface a precise terminal error with diagnostics instead of repeatedly restarting.

## Validation
- Exercise stale-process, already-ready, and fresh-start paths with controlled process mocks.
- Run the focused tests and verify startup emits one result without a restart loop.

## Technical details
- Keep OpenClaw optional and preserve OpenRouter/Ollama fallback behavior.
- Use cross-platform process handling for Windows, macOS, and Linux.
