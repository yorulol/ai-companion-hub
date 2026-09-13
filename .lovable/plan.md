# Stabilize Ollama and owner commands

## Changes
- Add adaptive Ollama profiles that choose GPU-first, balanced GPU+CPU+RAM, or CPU/RAM execution from prompt size and expected reply length, while respecting detected hardware limits.
- Improve local-model reliability with cleaner recent history, stronger instruction boundaries, deterministic generation settings, output validation, and one safe retry when a response drifts into system data or fake tool output.
- Stop exposing executable computer tools to non-owners. Non-owners who request owner actions receive the requested blunt “master’s commands” denial without seeing command names or capabilities.
- Add an owner-only `class` command that lists owner commands and their current custom prefix.
- Route owner-prefixed commands through both the Discord bot and the alt-account responder, authenticated only by `OWNER_DISCORD_ID` / `OWNER_DISCORD_IDS`.
- Keep the bot’s per-server prefix and add a separately configurable owner prefix for direct owner commands.
- Replace file-encrypting lockdown with a non-destructive emergency lock that pauses computer-control actions until the owner releases it. Preserve owner confirmation and status commands.
- Update environment examples and setup guidance for the new owner prefix and Ollama adaptive execution settings.

## Validation
- Verify non-owners cannot execute or discover owner commands through direct commands or AI-generated tool calls.
- Verify the owner can run `class`, status, lockdown, and release through both bot and alt account using the configured prefix.
- Exercise short and long Ollama requests and confirm the selected CPU/GPU profile is logged without leaking system details into replies.
- Run command-registry checks and targeted agent tests/syntax checks.

## Technical details
- Authorization remains an exact Discord ID match from environment configuration.
- Tool execution will use an explicit allowlist per requester instead of relying on prompt instructions.
- Lockdown becomes reversible state gating; it will not encrypt, delete, or damage files.
