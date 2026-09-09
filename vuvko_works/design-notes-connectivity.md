# How other generators model rooms, links and narrative

Observations from examining each tool. No table text is reproduced here — these
are structural notes about approach.

---

## Derelict Ship Generator (Alammo)

**Model: typed cards on a grid, orthogonal stubs between neighbours.**

Each room is a card carrying a **room type** as its heading (GALLEY, ENGINE,
COMMAND, BARRACKS, LIFE SUPPORT, CHAPEL…) and a **one-line condition** beneath
it. Cards sit on a flat grid; connections are drawn as short straight stubs
between adjacent cards. The whole plan renders in 3D perspective on a dark
field, pannable and zoomable.

Three things worth stealing:

1. **Condition is a separate roll from type.** The same GALLEY appears three
   times on one ship with different conditions. Two small tables cross-multiply
   into far more variety than one big table, and the room *type* stays legible.

2. **Conditions are terse and mechanical, not atmospheric.** They read like
   states, not prose — barren and booby-trapped, rigged to explode in five
   minutes, functional. Each is a thing the GM can act on immediately. Compare
   my generator's longer descriptive sentences: his are more *playable*, mine
   are more evocative. Both work; know which you want.

3. **Table pointers instead of inlined content.** Some rooms say to roll on a
   named table on a specific page of the source book. The generator deliberately
   does not reproduce the content it points at. That is both a licensing move
   and a design one — it keeps the tool small and sends you to the book.

Interaction: clicking a room marks it red and flags it "Hidden", which appears
to be a GM tool for concealing rooms from players rather than a game mechanic.
A user asked what it was for and the question went unanswered in the thread.

**Connectivity is the weak point.** Adjacency on a grid means the graph is
implied by layout rather than authored — there is no notion of a door being
locked, welded or breached, and no distinction between moving within a section
and passing between sections. That gap is exactly what `navmap.html` fills.

---

## Ironsworn: Starforged — derelict oracles

**Model: nested zones → areas, each with feature / peril / opportunity.**

The strongest published structure for this problem. A derelict rolls a type and
condition, then decomposes into **zones**, and each zone yields **areas**. Every
area can carry a feature, a peril and an opportunity, drawn from tables scoped
to the zone type.

Why this is better than a flat room table: the zone constrains what its areas
can contain, so an engineering zone never produces a chapel. That is the same
constraint direction `shipyard.html` uses for its deck plans — the container
gates the contents.

It also gives you a **three-slot content schema per node** (feature / peril /
opportunity) that maps almost directly onto the item / hazard / terminal split
in `navmap.html`.

CC BY 4.0 for the oracles, and available as JSON via Datasworn. If you want to
replace my hand-written content tables with something deeper and properly
playtested, this is the path.

---

## Geomorph Shipyard

**Model: connection-typed parts, validated after assembly.**

Parts are classed by their *connection topology*, encoded in the filename
prefix — fore and aft ends with one connection, wrappers with three, cores with
connections on two sides only, T-shaped half-cores, symmetrical sides at 20, 10
and under-10 squares.

Its random assembler picks nose, middle and tail, then checks the result has a
bridge and engineering and **re-rolls the entire ship** if not, up to ten
retries. Rejection sampling rather than constraint-satisfaction: simple to write,
and it means validity rules can be added without touching the generator.

Each part also carries a `uses` breakdown — how many tons of Lounge, Fuel,
Engineering, Staterooms and so on. That functional vocabulary is what makes
validation possible at all, and it's the direct ancestor of the section `mod`
types in my generators.

---

## rolegenerator.com

**Model: pre-assembled image, stats rolled around it.**

Not a room generator, but instructive as an anti-pattern. The ship image is a
finished plate chosen from a folder; tonnage and class are bound to the folder
rather than measured. The result is that a 91-ton ship and a 95-ton ship can
carry different size labels because they live in different directories.

Lesson: if the picture and the numbers are generated separately, they will
eventually contradict each other. Derive one from the other.

---

## Synthesis — what `navmap.html` took from each

| Source | Borrowed |
|---|---|
| Derelict Ship Generator | Type + condition as separate rolls; terse actionable states |
| Starforged | Zone gates area content; three content slots per node |
| Geomorph Shipyard | Functional `uses` vocabulary; validate-then-reroll |
| Own addition | Edges as first-class objects with open/sealed state and a reason |

The edge model is the piece none of the sources above have. A spanning tree is
computed first and kept open so the deck stays traversable; everything outside
it may seal freely, and tree edges may seal only when a connectivity check
confirms a detour survives.
