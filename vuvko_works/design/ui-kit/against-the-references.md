# Against the references

What was built, photographed beside the artboards it was built from. The
references are `example-missions/ref-4a.png` and `ref-4b.png`, taken out of
`extra_design/Derelict UI Kit.dc.html` by `game/scripts/kit-shot.mjs` so the
comparison is against the thing rather than a memory of it.

Shot at the artboards' own sizes — 1280×720 and 844×390 — which needed
`VIEWPORT` adding to `screenshot.mjs`, because it only ever took 1280×900 and
every comparison before that was against a shape the kit does not have.

## The shots

| file | what it shows |
|---|---|
| `ui-1-palette.png` | before: the old three-row grid, on the new palette |
| `ui-4-1280x720.png` | 4a's size, nothing selected |
| `ui-5-rail.png` | the rail and the title clear of it |
| `ui-6-tabs.png` | a drone picked up: the panel with its two tabs |
| `ui-3-narrow.png` | 844×390, 4b's size |
| `ui-7-reduced-motion.png` | the same screen for someone who asked for no motion |

## Element by element

| 4a / 4b | here | note |
|---|---|---|
| full-bleed map | **yes** | the deck had 78% of the width and a 165px dead band; it has the surface now |
| title card, top left | **yes** | moved right to clear the rail |
| icon rail, far left | **two of three** | information and sound. Nothing goes behind a menu that is not a dead end or a way to lose a mission by misclick |
| alert dial, top right | **no** | there is no `alert` in `GameState`. A dial with nothing behind it is a decoration that lies |
| view controls, bottom left | **yes** | moved off the bottom right, where they sat beside the two buttons that commit a turn |
| undo + end turn, bottom right | **yes** | with `[z]` and `[space]`, as the kit labels them |
| one-line log, expandable | **yes** | was 168px showing what its last line already said |
| tile / unit tabs | **yes** | appears on selection, absent otherwise — which is both artboards |
| permanent squad column | **removed** | neither artboard has one, and each drone's hit points are already on its token |
| navy ground, Plex + Barlow | **yes** | |
| stepped board, eased chrome | **yes** | see `motion.md` §2 for why the kit's two halves could not both win |

## What is deliberately not the same

**The alert dial.** Everything else on 4a reports something the game knows. The
dial reports an alert level that does not exist, and building the state to feed
it is a rules change rather than a UI one.

**The third rail button.** An option that is never the interesting one is the
chaff `design/tactical-diversity.md` is about, and a button is an option.

**`impact` and `edgeBurst`.** The library's combat effects want an attacker
element, an edge element and a damage readout as positioned HTML. The deck is
SVG and has none of them. What is used instead is `frames`, the sequencer those
effects are built from, at the same `FRAME` — so a struck token beats in time
with the text rather than beside it. Bending a renderer to fit an effect's
assumed DOM is how a kit ends up owning a game.

## Still to do

- **The `DeckView` render split.** 835 lines, thirteen layers in one body, and
  every pan tick reconciles one to two thousand SVG nodes. It must land before
  any effect that moves a token along a path, or those effects will be fine on
  the 73-hex deck the kit was drawn from and wrong on a 200-hex one.
- **Token movement with ghosts** (`wake`), which depends on the split and on a
  path being available — `unitMoved` carries `from` and `to`, not the route.
Contrast is no longer among them. Measured against the navy ground:

```
  ink       13.44:1      drone      7.75:1
  ink-text  11.08:1      node       7.81:1
  dim        5.78:1      door      10.12:1
  ship       4.86:1      rule       1.64:1
```

Every foreground clears AA — `--dim` at 5.78 is the one worth naming, because
the quiet colour on a dark ground is where a palette usually fails and it owes
the full 4.5 rather than the large-text 3, being small text. `--rule` is below
3 deliberately and the test records that as a decision: it is a one-pixel
border and nothing is ever written in it.
