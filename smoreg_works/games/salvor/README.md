# SALVOR

> A drone has no hit points. Every hit lands on whatever you just used.

You run a tug. Into a dead ship goes a drone: no health bar, six module slots. The
cutter attacks, the thrusters move you, the scanner sees, the plating shields. Whatever
module you just acted with is what the next hit lands on. A burned module is gone along
with its ability, and the only way back is salvaging worn parts off the machines you take
apart. The ship itself is a graph of compartments and doors, not a grid: "where you are"
is a compartment's name, "how far" is a number of doors.

This is the jam entry — see [`docs/design-doc.md`](../../docs/design-doc.md) (полностью,
по-русски) for the full design: the frame, the sortie/derelict/charter loop, the twist,
door and door-tool table, ship systems, the ten-rung alert, ghosts, the rival, the lesson. `games/fortnight2` is a
separate, finished tile-based game frozen at tag `submission-v1` — the insurance entry if
`salvor` doesn't make it to the deadline; it is not touched or built by default.

## Play

```bash
npm install        # from the repo root, once
npm run dev         # root command — starts SALVOR, not fortnight2
```

`?seed=<number>` in the URL reproduces a run exactly, turn for turn.

## Controls

| Key | Action |
|---|---|
| `1`–`9`, `0` | act — a line from the compartment's action list (attack, go through a door, use a tool on it, salvage, search, take, work a ship system…) |
| `Tab` / `Shift+Tab` | engage — close in and fight; shoots if a target is in range, `Shift+Tab` never fires |
| `o` | auto-explore; walks on, stops at the first thing worth a decision |
| `.` / `Space` | brace — wait a turn, PLATING takes the hit |
| `h` | hide, in a compartment with cover |
| `s` `e` `w` `p` `K` `f` `c` | module verbs, only if the module is fitted: scanner pulse · EMP stun · weld · power a lock · spike a lock · shoot · cut a door |
| `<` | leave through the airlock, back to the tug |
| `v` | the virus window: what the strain does and how to purge it (no turn) |
| `?` / `Esc` / `Shift+R` | help / close / new run |

`hjkl` and the numpad directions move nothing — there is no grid to move on. The arrow
keys move the highlight up and down the action list, and `Enter` does the highlighted line.

## Commands

```bash
npm run dev                # root — SALVOR dev server
npm test                   # every test in the monorepo, not just this game
npm run typecheck
npm run build               # root — builds SALVOR
npm run zip                 # root — dist + salvor-web.zip for an itch.io HTML5 upload
```

## Where things go

- `src/content/` — the `RoomContentPack`: compartment kinds (`zones.ts`), the derelict
  catalogue (`derelicts.ts`), modules, monsters, event cards and ship-system objectives.
  Balance and tuning live here; it never imports `src/ui/`.
- `src/twist/` — `rig.ts`: the drone's six module slots, which one is exposed, what burns.
- `src/systems/` — doors and locks, ship alert, jammers, the bloom hazard, ship-wide
  bookkeeping (`ship.ts`), populating a freshly generated derelict.
- `src/ui/` — the schematic renderer, side panel, keyboard input (`input.ts` — the actual
  key table lives there, not in the GDD) and auto-explore/auto-engage.
- `tests/` — this game's tests, run by bots against fixtures, not by playing in a browser.
