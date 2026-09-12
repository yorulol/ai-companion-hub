# Speed up local Ollama replies

## Goal
Make Yoru respond substantially faster on the i7, RTX 1660 Ti 6 GB, and 16 GB RAM system without breaking chat, Discord, or tool use.

## Changes
- Replace the default 8B chat model with a faster 3B quantized model that fits fully in GPU memory; keep the stronger coding model available for coding requests.
- Make Ollama context size and response length configurable, with performance-focused defaults.
- Send only the most recent conversation messages that fit the local model's smaller context instead of replaying up to 24 full messages.
- Keep and pre-warm the selected model, then report Ollama timing and token-rate diagnostics in the terminal after each response.
- Update the environment template and local setup documentation with the new defaults and upgrade instructions.

## Technical details
- Add `OLLAMA_NUM_CTX`, `OLLAMA_NUM_PREDICT`, and `OLLAMA_HISTORY_MESSAGES` settings.
- Use those values in `/api/chat` and boot pre-warming.
- Preserve the existing fallback and automatic model-pull behavior.
- Verify the affected modules with targeted runtime checks.
