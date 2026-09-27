<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep Yoru's baseline persona in `agent/src/persona.js` and import it for default chat, UF, and model-builder prompts, so all agent surfaces share the same identity while saved custom personas remain intact.
- Run dependency checks inside the restart supervisor before every child boot, so update-triggered exits repeat the same startup preparation as `npm start`.
