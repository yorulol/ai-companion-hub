# Complete YORU control center rebuild

## Scope

- Finish the remaining owner controls first: trusted killswitch/voice admin editing, full-computer file navigation and editing, and selectable WorkSpace roots.
- Replace the current command panel with a dense, futuristic YORU control center based on the supplied reference: fixed left navigation, system header, animated YORU core, live intelligence/status panels, agent overview, mission activity, system monitors, providers, and a persistent voice strip.
- Make Chat a dedicated terminal-style screen rather than message bubbles.
- Remove Email Forward from all command-center navigation and actions.
- Replace raw lookup JSON with a structured results interface containing a summary, result cards, labeled fields, protected-result state, errors, and empty state.
- Rebuild Files as a navigable explorer/editor: drives and roots, breadcrumbs, folders/files, editable text preview, save, rename, delete, and “ask YORU” using the selected path.
- Extend WorkSpace so the owner can enter/open any local folder, browse it, make it the active agent root, and run YORU/ACE sessions against that root.
- Keep the settings menu above every panel and make navigation responsive without overlap.
- Update repository packaging so the downloadable/runnable project is centered on the `agent` application; avoid breaking Lovable’s required app shell.
- Keep bug-bounty SQLi proof limited to schema/metadata enumeration. Do not dump private row contents; surface discovered database, schema, table, and column names plus exact reproducible proof for responsible disclosure.

## Design direction

- Reference-locked palette and composition: near-black navy surfaces, cyan telemetry lines, compact technical typography, crisp rectangular modules, thin luminous borders, and restrained status accents.
- No cartoon emoji. Use consistent inline system icons and small signal indicators.
- High information density with clear categories: Command Center, AI Core, Agents, Missions, Memory, Conversations, Knowledge, Tools, WorkSpace, Lookups, Files, Security, and Settings.
- Preserve YORU identity rather than copying JARVIS wording or branding.

## Technical details

- Refactor `command.html`, `command.css`, and `command.js` into navigable control-center views while retaining the existing local API proxy.
- Add safe absolute-path and root-listing helpers to computer control, with server endpoints for browsing and editing.
- Refactor WorkSpace path confinement from one compile-time folder to a validated per-session selected root, supplied by the local owner panel.
- Add structured status/activity data from existing health, providers, activity, voice, calls, system, and settings endpoints.
- Add owner-panel controls for `killswitchAdmins` and `voiceAdmins` through their existing endpoints.
- Update install/package documentation and repository ignore/export guidance without moving Lovable’s required root files.
- Validate syntax, installer/package metadata, and panel behavior locally where the Node agent can run.

## Safety boundary

- Scanner automation may verify SQLi and enumerate database structure on explicitly authorized targets.
- It will not extract or save user records, credentials, private row data, or other database contents. Reports will explain that schema-level proof is sufficient and safer for disclosure.
