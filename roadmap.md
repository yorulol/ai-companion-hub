# Roadmap

- [x] Fix OpenClaw request routing and add a live model readiness check
- [x] Keep a rotating 15-model OpenRouter pool with five-minute refresh and immediate reserve replacement
- [x] Prevent Ollama from leaking system/spec data and degrading over long chats
- [x] Add adaptive Ollama CPU/RAM/GPU routing and stronger local reasoning
- [x] Prevent Ollama tool/system-data drift and unauthorized owner actions
- [x] Add owner-prefix `class` commands to bot and alt account
- [x] Replace destructive lockdown encryption with a safe emergency lock
- [x] Validate owner authorization, Ollama profiles, and command registry
- [x] Make OpenClaw readiness require a successful live chat and surface exact startup failures
