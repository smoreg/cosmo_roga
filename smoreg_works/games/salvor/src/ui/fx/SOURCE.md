# derelict-fx

Vendored verbatim from the `SALVOR — Screens as Built` design system, which is
where it is authored. Do not edit it here: a change made in this copy is a
change the design system does not have, and the next pull silently reverts it.

The one rule the whole library is built on is that **nothing interpolates** —
every visual state is a discrete frame held for a multiple of `FRAME = 225ms`.
The keyframes in `react/styles.css` only hold state; this sequences it.
