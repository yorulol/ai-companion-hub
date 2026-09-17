# Roadmap

- [x] Merge chat + owner panels into ONE panel on ONE localhost port (hub.html on 8788; chat/owner/workspace embedded), full redesign (black/white glossy glass, cursor-following particles, animated dropdowns, glossy buttons, dropdowns layered above content)
- [x] Provider services (Ollama :11434, OpenClaw :18789, OpenRouter) reachable from the new panel (Services dropdown)
- [x] Panels auto-owner: loopback requests trusted in server.js; owner gate auto-unlocks; only alt account / Discord bot verify owner ID
- [x] Selfbot: owner voice commands joinvoice/leavevoice/meetingnote/meetingnotes + Meetings controls in the panel; recap saved to agent/data/meetings/
- [x] Selfbot: never respond to @everyone / @here pings
- [x] WorkSpace panel (8789, and embedded in the hub): YORU (Ollama default) + ACE (OpenRouter/OpenClaw) collaborate; home auto-detected as agent/; both can edit their own code files via confined tools
