# derelict-fx

Vendored verbatim from `vuvko_works/extra_design/derelict-fx.js`, the animation
library exported alongside the Derelict UI Kit. 534 lines, ESM, no dependencies,
no build step.

Copied rather than imported across the directory boundary for the same reason
`geomorph-core.js` is: the game builds from `src/`, and a file outside it is not
in the build graph. Refresh it by copying again; nothing here is edited.

**Its one rule**, from its own header: _nothing interpolates_. Every visual
state is one of a small set of discrete frames held for a fixed number of
milliseconds — no easing, no tweens — so text reveals, token movement and combat
read as one machine rather than four effects. `FRAME` is 225ms and every
duration is a multiple of it.

**What it needs from a host**: plain DOM elements with text, and for token
effects a positioned parent and an injected `place(el, pos)`. It knows nothing
about hexes, SVG, React or coordinate systems — its own note calls `place()`
"the whole portability story".

**What it leaves behind**: `cancel()` stops timers and leaves the DOM as it
found it mid-effect, so a cancelled `wake` leaves its ghosts for `clearGhosts`.
`impact` and `edgeBurst` deliberately leave the target at a reduced opacity.
Anything driving it has to clean up after itself.

`prefersReducedMotion()` is honoured by every effect except `hitStop`, which is
a bare timeout and does nothing visible — see `design/ui-kit/motion.md`.
