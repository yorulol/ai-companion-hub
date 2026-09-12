# Fix and complete the owner panel

## Changes
- Replace the long flat owner navigation with grouped dropdown menus for Overview, Discord, AI, Data, and System controls on both hosted and standalone panels.
- Repair whitelist Add/Remove controls and show clear success, duplicate, and error states.
- Store related identities together so a whitelisted username also blocks matching IDs found in the same lookup record, and vice versa.
- Return an explicit “protected by whitelist” response when a direct or related identity lookup is blocked.
- Add the missing verification and auto-moderation controls to the owner panel, including server selection, verified role, moderation log channel, and security toggles.
- Mirror all currently supported owner features in both hosted and standalone panels.

## Validation
- Exercise whitelist add, direct blocking, related-identity blocking, and removal.
- Verify grouped navigation and new controls at desktop and mobile sizes.
- Run the agent’s command validation and project checks.

## Technical details
- Extend the local SQLite whitelist records with linked identity aliases derived only from matching local lookup rows.
- Keep lookup source filenames private in all returned results.
- Use the existing owner-authenticated local API for all settings changes.
