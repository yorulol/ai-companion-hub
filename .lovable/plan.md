# Make `/lookup` available as a user-installed Discord command

## Changes
- Register `/lookup` globally for Discord user installations instead of only inside servers containing the bot.
- Allow the command in server, bot-DM, and private-channel contexts supported by Discord user apps.
- Restrict every invocation to the Discord owner IDs configured in the environment.
- Remove old per-server registrations so they do not shadow the user-installed command.
- Print the account-install link at startup and clearly report any Discord registration failure.

## Verification
- Check the updated command module for syntax errors.
- Confirm registration uses Discord's user-install integration and all supported contexts.
- Confirm non-owner requests stop before any lookup runs.

## Required Discord setting
The Discord application must have **User Install** enabled in its Developer Portal Installation settings. The owner must install the app to their Discord account once; code cannot install an app into an account automatically.
