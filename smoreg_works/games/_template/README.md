# __GAME_NAME__

Created from `games/_template`. Engine lives in `packages/engine` — see
`docs/cookbook.md` for what it already provides.

```bash
npm run dev -w games/__GAME_ID__      # dev server
npm test                              # all tests in the monorepo
npm run zip -w games/__GAME_ID__      # dist + zip for an itch.io HTML5 upload
```

## Where things go

- `src/content/` — monsters, items, vaults, the ContentPack. Balance lives here.
- `src/ui/` — renderer and input. Nothing here may be imported by content.
- `assets/` — art, fonts and audio used only by this game. Shared ones: `/assets`.
- `tests/` — this game's tests. Engine invariants are tested in the engine.
