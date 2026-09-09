# itch.io page — SALVOR

Draft description text for the itch.io submission page, per `docs/itch-page-template.md`. Owner
checklist first (things only the owner can do — screenshots, cover, upload), then the page copy.

Everything below has been checked against the code it describes: every key against
`games/salvor/src/ui/input.ts` and `games/salvor/tests/input.test.ts`, every URL parameter against
`src/main.ts`, `src/i18n.ts`, `src/ui/view.ts` and `src/ui/music.ts`, the viewport against
`src/ui/theme.ts`. A line here that the build does not do is a line a voter will find.

## Owner checklist

- [ ] **Playable in browser** — upload `salvor-web.zip` from `npm run zip` (run it at the repo
      root; it builds `games/salvor`) as "This file will be played in the browser". The zip is
      904 KB, the unpacked build 1.1 MB — 301 KB of it code (96 KB gzipped), the rest fourteen
      `.ogg` files: the music track and thirteen sound effects. The track is 598 KB of that and
      does not compress, which is why the zip comes out only about 210 KB under the unpacked size.
- [ ] **Viewport size — 1718 × 764.** Worked out from `src/ui/theme.ts` rather than from the old
      draft, which had it wrong. `SCREEN_WIDTH` = `mapWidth` 66 + `sidebarWidth` 29 = **95
      columns**; `SCREEN_HEIGHT` = `mapHeight` 34 + `logHeight` 7 + 1 = **42 rows**. `render.ts`
      builds the `ROT.Display` with `forceSquareRatio: true`, so a cell is square and its side is
      the font size: at `fontSize: 18` that is 95 × 18 = 1710 px by 42 × 18 = 756 px. `main.ts`
      fits the font to the window less 8 px in each direction and never goes below 12, so a frame
      of **1718 × 764** is what renders at the full 18 px. A smaller frame still works and simply
      picks a smaller font — 1330 × 588 is the same screen at 14 px, and 1140 × 504 is the 12 px
      floor. The graphic view is `position: fixed; inset: 0` and fluid, so it fills whatever frame
      it is given. This is arithmetic off rot.js's own rule, not a measurement — sanity-check it
      against the real page before locking the embed.
- [ ] **4 screenshots**: the ASCII screen with schematic, module rack and action list all visible
      at once (this one first, it is the whole game in one frame); a compartment mid-fight with
      the `◀` on the module taking the hit; a moment of danger — alert high, an ENFORCER, or a
      rack with nothing left to expose; the end-of-run card.
- [ ] **1 gif of the twist**, 5–8 s: the action list, a hit landing, the `◀` moving to the module
      that acted, the module burning out, salvage going into the slot it left. The single most
      valuable asset on the page.
- [ ] Cover image, 630×500.
- [ ] Confirm in a private browser window that the game loads with no login.
- [ ] Confirm on a 1366×768 laptop screen: the whole game is in frame, no page scroll.
- [ ] Fill in the source link in the copy below — this worktree has no git remote
      configured, so the URL is not something the page can be written from.
- [ ] Upload on the **morning of the 15th**, not at 16:59.

## Page copy

````markdown
**A turn-based roguelike on a ship schematic. Your drone has no hit points — every
hit burns whatever you just used. Buy the next one and go back in.**

Made in two weeks for roguetemple's Fortnight 2.

### The twist

Your drone carries six module slots instead of hit points: a cutter that attacks, thrusters
that move you, a scanner that sees, plating that shields. Whatever module you just acted
with is what the next hit lands on — swing the cutter and it takes the punishment, step
through a door and the thrusters do, brace and the plating earns its keep. A burned module
is gone along with its ability, and the empty slot it leaves is the only place salvage
fits. The only way back is stripping worn parts off the machines you take apart, which come
in almost as damaged as the one you lost.

### The voyage

You run the tug, not the drone. The tug is four compartments on the same schematic — DOCK
buys drones and casts off, BENCH mends and grafts, HOLD sells, HELM signs jobs and jumps —
and there is not a menu anywhere in the game.

A voyage is three hulls: a freighter that teaches you the trade, one of five classes drawn
from the catalogue — laboratory, military, smuggler, corsair, quarantine — and then your
father's tug, which is the last one and the reason for all of it. Each hull is a graph of
twelve to twenty-five compartments joined by doors, generated whole: the rooms, the locks,
where the keycard is, what is lying about, which machines are aboard.

You start with one SCRAPPER hull and 25 credits. A drone costs 40, 55 or 70 depending on
what it is; a jump to the next hull costs 30; a point of repair on the bench costs 4. When
the rack is empty and the account will not cover the cheapest hull, the voyage is over.

Sign charters at the HELM before you cast off: SALVAGE wants credits' worth in the hold,
RETRIEVE wants a crate carried out, UPLOAD wants five uninterrupted turns at a console, and
NEUTRALIZE — always on the board — wants the engine, the core and the terminal brought
online. That last one sells the whole hull, and it is the difference between scraping by
and getting somewhere.

### The ship remembers

A derelict is one place you walk back into, not a level you reroll. Doors you welded stay
welded. Crates you took are gone. Machines you killed stay dead. And the compartment where
a drone of yours died is where its GHOST will be waiting on the next sortie, carrying the
same rack you lost — the fattest salvage on the ship, and the one thing aboard that knows
exactly what you hit with.

Some hulls have a rival tug tied on the other side. Its drone is racing you for the same
three systems, and it cuts through locked doors on the way — which makes following it
cheaper than cutting for yourself, right up until it finishes first.

Stand in the same compartment as that drone and you can deal instead of fight. Pay it 100
credits and it drops everything it was carrying and leaves the hull for good. Take 100 from
it and it brings one system online on the spot — the noise and the alert are yours to
live with, the contract stays yours. Or split the sale: it works the ship alongside you and
every system it raises counts as yours, and the hull goes under tow for half. A deal holds
for the rest of the voyage, and neither of you lands another blow on the other.

### Controls

Everything is a key. There is no cursor over the world and no mouse in the terminal view.

```
1-9 0        act — a numbered line of this compartment's list: attack, go
             through a door, work a lock, salvage, search, take, work a
             ship system
up / down    move the mark down the list; enter does the line it is on
. or space   brace — wait a turn with the PLATING towards the room
h            hide, in a compartment that has cover
<            leave through the airlock, back to the tug
o            auto-explore — walks on, stops at the first thing worth a
             decision and says what it was
tab          engage: shoot if a target is in range, otherwise close in
shift+tab    engage in melee only — never fires
s e w p K f c   module verbs, while the rack still carries them:
             s  scanner pulse, two doors out, loud
             e  EMP: stun this compartment
             w  weld — mend the weakest module, or seal a door
             p  power cell on a locked door or a console
             K  spike a lock — two turns, quiet   (shift+k)
             f  shoot
             c  cut a door — three turns, and the whole ship hears it
a            keycard on a locked door — silent, instant, and the card is
             gone. The list offers it last: the terminal wants one too
V            switch view: ASCII terminal ⇄ graphic
L            language: EN · ES · RU
?            help          esc  close          shift+R  new run
```

Not grid-based: this is a turn-based roguelike on the ship's schematic: rooms are the tiles,
doors are the walls. `hjkl`, the arrows-as-movement and the numpad directions are gone with
the grid; the numpad digits still pick lines.

### Two screens, three languages, and sound

`V` switches between the ASCII terminal and a graphic view — the same schematic, panel and
action list drawn as SVG and HTML instead of as characters, with the action lines clickable.
Neither view decides anything: both draw the same pure functions of the same run, and the
choice is remembered. ASCII is the default, because that is what this is.

`L` cycles the language: English, Spanish, Russian. It works on every screen, including the
title, and changes nothing but the words — same seed, same voyage, any language.

There is one piece of music, written for the game, and the run mixes it: the tug is the
quiet place, an ENFORCER aboard is the loudest the ship gets, and the level slides between
them over two beats rather than stepping. Thirteen sound effects sit on top of it. Add
`?sound=off` to the URL to play in silence.

One thing on the screen is timed to the track. When a machine comes into sight that was not
in sight a moment ago — you walk in on it, it walks in on you, a door opens, the alert sends
it — its compartment on the schematic and its line in the contacts block flash red for two
beats, on the beat. Nothing else in the game flashes, nothing moves, and a browser asking
for reduced motion gets the colour without the blink.

### This is a traditional roguelike

Turn-based: nothing moves except through your command, and the machines aboard take their
turn only after yours. There are no clocks in the rules at all — a test forbids the code
from so much as asking what time it is.

Run-based, no meta-progression: one run = one voyage, nothing carries over between runs. No
credit, no drone, no unlocked hull, no blueprint. A new run is a new tug, a new itinerary
and 25 credits. The only two things the browser remembers are your language and which view
you like.

Permanent consequences: a burned module is gone, a dead drone is gone along with everything
fitted to it and everything it was carrying, a welded door stays welded, and an alerted ship
stays alerted. No undo, no turn rollback, no save to scum.

Procedural generation that decides something: the hull is a generated graph of compartments
and doors, with the locks placed so the keycard is always on your side of them and every one
of the three systems can be reached — even by the GHOST hull, which carries no cutter at
all. Two seeds are two different ships and two different problems.

Single character: one drone, aboard, at a time.

### Known issues

- The schematic will not draw an edge it cannot route cleanly. When that happens the door is
  still in the compartment's action list, under its own number — the picture can be silent,
  it is never wrong.
- `?seed=` reproduces the world of a run exactly, turn for turn. The message log can still
  come out different, because a command the game refuses ticks the log without being
  recorded as a turn. Report the seed and what you pressed, not the log.
- A module is only ever worth what the rack can hold: grafting stops two points over a
  module's own base, and the salvage you were going to graft is simply refused at that
  ceiling. The rack marks how far a module has been raised, `+` or `++`, and nothing tells
  you in advance which wreck would have been worth taking apart.
- No save file. Closing the tab ends the voyage — deliberate, but worth knowing before you
  are two hulls deep.
- Your father's tug is much harder than anything before it, and most voyages end there. That
  is the intended shape of the ending; whether it is the right amount of harder is the thing
  we are least sure of.
- The graphic view draws the whole ship at once with no viewport of its own, so the biggest
  hulls get dense in it. The ASCII view scrolls and counts what is off-screen.

### Technically

TypeScript, no game engine. The terminal view is `rot-js` and nothing else from it — the
field of view, the pathfinding, the generator and the turn scheduler are all our own. The
graphic view is inline SVG and HTML with no library at all. 301 KB of code, and the rest of
the download is audio.

`?seed=12345` in the URL reproduces a run exactly — the cheapest bug report there is.
`?lang=es` and `?view=web` pin the language and the screen the same way, and `?sound=off`
mutes it.

Source: <repository link>

### Credits

Made for this jam by one person. Nothing in the build is somebody else's file — no sample
pack, no sprite sheet, no font — but two thirds of the audio came out of a generative model,
and that is worth saying plainly rather than leaving to be discovered.

- **Music** — `Dead Compartment`, written by me in Suno: the prompting and the selection are
  mine, the synthesis is the model's. What ships is a 16-bar loop cut out of that track at
  74.9 bpm, and the game mixes it live rather than switching between pieces.
- **Sound effects** — ten of the thirteen were generated for this project with ElevenLabs
  Sound Effects, under their terms for generated audio; the prompts are in the repository.
  The other three are Strudel patterns written for the game and rendered offline, with the
  drums synthesised from code after a description of a TR-909 rather than from a sample bank.
  Strudel (AGPL-3.0) is a tool that renders them and is not part of the game.
- **Type** — whatever monospace your browser already has. No font is shipped.
- **Ship vocabulary** — the compartment names and the fixed-port docking rule in the
  generator are after Robert Pearce's *Starship Geomorphs 2.0* (rpgmobius.com/geomorphs,
  CC BY-NC 4.0). A dictionary and an idea, not assets: not one image or file from it is
  used, and the generator is ours.
````
