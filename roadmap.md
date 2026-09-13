# Roadmap

- [x] Fix OpenClaw request routing and add a live model readiness check
- [x] Keep a rotating 15-model OpenRouter pool with five-minute refresh and immediate reserve replacement
- [x] Prevent Ollama from leaking system/spec data and degrading over long chats
- [ ] Add adaptive Ollama CPU/RAM/GPU routing and stronger local reasoning
- [ ] Prevent Ollama tool/system-data drift and unauthorized owner actions
- [ ] Add owner-prefix `class` commands to bot and alt account
- [ ] Replace destructive lockdown encryption with a safe emergency lock
- [ ] Validate owner authorization, Ollama profiles, and command registry
