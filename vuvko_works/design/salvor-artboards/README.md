# SALVOR artboards — for rework in Claude Design

Eight standalone pages showing SALVOR's screens as they are today, ready to be
uploaded and reworked. Each `.html` in `pages/` stands on its own: the game's
own CSS is inlined, there is no script, no font to fetch and no network call.
The `.png` beside it is the same page at 1366×768, which is the size the web
view is built for.

| Page | What it is | What to look at |
|---|---|---|
| `01-title` | The title | Seven keyed rows, every one clickable |
| `02-tug` | The hub between runs | Rack left, actions right, no map at all |
| `03-derelict-graph` | Aboard, default view | Box-and-wire compartment graph |
| `04-derelict-hex` | Aboard, honeycomb | The same screen with the drawn hull under it |
| `05-help` | Help card | A text card over the screen, sized by column arithmetic |
| `06-codex` | Codex | Left list, right body |
| `07-history` | The log, opened full | Compare with the kit's expanding drawer |
| `08-lost` | An ending | Banner and run summary |

## How they were made, and the rule they obey

`docs/tasks/G61-web-design.md` on the other half records what happened the last
time artboards met this codebase: they were used, and the artboard source was
deliberately *not* committed, because 145 KB of markup with words baked into it
must not become a second source of truth next to `t()`.

That rule is why these run in one direction only. Every page here is produced
by calling the game's own `screenHtml` — the same function `ui/web/mount.ts`
writes into the document — with the game's own `WEB_CSS`. Nothing is retyped
and nothing is hand-authored, so nothing can drift, and the pages are a
*picture* of the code rather than a source anything is generated from.

**When these come back from Claude Design, the markup does not come with
them.** What comes back is the design: spacing, weight, colour, hierarchy,
motion. It lands in the components, and every string in it goes through `t()`
first. A reworked artboard is never pasted.

## Running it again

    node build.mjs

`render.ts` boards a real derelict — it walks the game through `listOf`, the
same action list a player is offered, so the boards show a genuine mid-run
state rather than a hand-built fixture. Change `SEED` for a different ship.

Nothing in `smoreg_works/` is touched to build these, and nothing is installed
into it: that half ships raw TypeScript with no build step, so `build.mjs`
bundles its sources directly with this half's esbuild, aliasing the two
workspace packages and stubbing `rot-js`, which only the ASCII display needs.

## What the boards are for

The merge plan ([../merging-the-halves.md](../merging-the-halves.md)) says the
face comes from this half and the engine from that one. These are the screens
that face has to cover. Read them as a list of surfaces, and note two things
the kit does not have an answer for yet:

- **The rack, not a hit-points bar.** `02-tug` and both derelict boards show
  damage landing in named modules that burn out. `HitPointsBar` draws a bar.
- **The action list is the whole interface.** Numbered rows, ten at a time,
  nested. Extraction moves by clicking the map. Both are on screen here.
