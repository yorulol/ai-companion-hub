# Fix OpenClaw startup and model readiness

## Goal
Make `npm start` launch one stable OpenClaw gateway without fighting an old system service, and make the configured Ollama model pass a meaningful live check.

## Changes
- Remove inherited service-manager markers from the foreground OpenClaw process so it does not mistake YORU's parent process for an OpenClaw-managed service.
- Detect and disable only OpenClaw's stale managed gateway before YORU starts its own foreground gateway, avoiding the current stop/restart loop.
- Raise hardware-tuned OpenClaw context limits to its supported local-model range and write complete Ollama model metadata.
- Preflight the selected Ollama model directly, pull it when missing, and report the actual response error instead of the generic “configured model failed” message.
- Keep one startup attempt and one owned gateway process; OpenRouter and direct Ollama remain available if OpenClaw truly cannot initialize.

## Verification
- Add focused checks for service-marker sanitization, model preflight, configuration output, and repeated startup behavior.
- Confirm status output identifies the exact failed layer: Ollama unavailable, model missing, model rejected, or gateway unavailable.
