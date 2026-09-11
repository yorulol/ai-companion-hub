# Fix chat panel dropdown layering

## Changes
- Move both the model picker and hamburger menu into a top-level overlay layer so chat content cannot cover them.
- Apply the same fix to the hosted panel and standalone desktop panel.
- Keep current menu contents and behavior unchanged.

## Verification
- Open both menus in the hosted preview at desktop width and confirm they render above the chat.
- Check the standalone panel markup and run the existing project validation.

## Technical details
- Use explicit isolation and stacking contexts on the headers and higher overlay levels on each popover.
- Prevent parent overflow and backdrop effects from trapping the menus behind chat surfaces.
