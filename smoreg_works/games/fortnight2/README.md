# SALVOR

> A drone has no hit points. Every hit lands on whatever you just used.

You are a repair drone on a dead station. There is no health bar — only six
module slots. The cutter attacks, the thrusters move you, the scanner sees,
the plating shields. Whatever module you just used is what the next hit
lands on: swing the cutter and it takes the punishment; step and your
thrusters do; stand still (`brace`) and the plating earns its keep. A burned
module is gone along with its ability, and the only way back is salvaging
scrap off the machines you take apart — parts that come in almost as worn as
the one you lost.

Full design: [`docs/design-doc.md`](../../docs/design-doc.md).

Right now this repo holds the reset skeleton (G1): a nameless drone with a
CORE of 3, one placeholder machine, and no modules yet — those, the deck
schematic, and the twist itself land in later tasks (see
[`docs/tasks/README.md`](../../docs/tasks/README.md)).

## Play

```bash
npm install                     # from the repo root, once
npm run dev -w games/fortnight2
```

`?seed=<number>` in the URL reproduces a run exactly — the cheapest bug
report there is; the game also rewrites the URL with the seed on every new
run so you can paste it back.

## Controls

| Key | Action |
|---|---|
| `hjkl` / `yubn` / arrows / numpad | move; walking into a machine attacks it |
| `.` / `5` / space | wait (brace) |
| `>` | descend, standing on the stairs |
| `?` | help · `Esc` closes it |
| `shift+R` | abandon this run, start a new one |

## Commands

```bash
npm run dev -w games/fortnight2   # dev server
npm test                          # every test in the monorepo, not just this game
npm run typecheck
npm run build -w games/fortnight2
npm run zip -w games/fortnight2   # dist + zip for an itch.io HTML5 upload
```

## Where things go

- `src/content/` — the `ContentPack`: player, bestiary, storylets. Balance
  and tuning live here and nowhere else; it never imports `src/ui/`.
- `src/ui/` — `ROT.Display` renderer, keyboard input, colour palette
  (`theme.ts`). Never imported by content.
- `music/` — adaptive score via `@jamrog/audio`; rules in `music/README.md`.
- `assets/` — art and audio used only by this game. Shared ones live in the
  repo's top-level `assets/`.
- `tests/` — this game's tests, including the balance harness
  (`tests/balance.test.ts`) and the traversability smoke test
  (`tests/winnable.test.ts`). Engine invariants are tested in the engine.
