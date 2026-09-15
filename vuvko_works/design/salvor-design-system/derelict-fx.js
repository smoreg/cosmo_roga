/**
 * derelict-fx — a tiny animation library for turn-based games whose interface
 * is meant to look like damaged hardware.
 *
 * One rule underneath everything: NOTHING INTERPOLATES. Every visual state is
 * one of a small set of discrete frames held for a fixed number of ms. No
 * easing curves, no tweens. That is what makes text reveals, token movement
 * and combat read as the same machine rather than as four separate effects.
 *
 * No dependencies, no build step. Works with any DOM element in any framework.
 *
 *   import * as FX from './derelict-fx.js';
 *   FX.scrambleReveal(document.querySelectorAll('.line'), FX.PRESETS.panel);
 *
 * or drop it in with a plain <script src> and use the window.DerelictFX global.
 *
 * The scramble reveal is ported from vuvko-lab/coherence-7drl (src/main.ts).
 */

/**
 * The sampling rate of the whole system. Every held frame is a multiple of this.
 * Raising it slows every effect at once — text, movement and combat stay locked
 * to each other, which is the point of having a single constant.
 */
export const FRAME = 225;

/**
 * Block-drawing glyphs. Only safe where the box is a fixed size — unit tokens,
 * board cells — because most UI typefaces do not contain them and the browser
 * substitutes a fallback font with different metrics, which makes scrambled
 * text jump wider than the string it is standing in for.
 */
export const BLOCK_CHARS = '░▒▓█▀▄╔╗╚╝║═├┤┬┴┼─│┌┐└┘';

/** Fewer, denser glyphs — better for 1–2 character tokens. */
export const TOKEN_CHARS = '░▒▓█▚▞▙▟';

/** Kept for back-compat; text reveals now scramble per character class. */
export const SCRAMBLE_CHARS = BLOCK_CHARS;

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';

const pick = (s) => s[(Math.random() * s.length) | 0];

export function randomScramble(length, chars = BLOCK_CHARS) {
  let out = '';
  for (let i = 0; i < length; i++) out += chars[(Math.random() * chars.length) | 0];
  return out;
}

/**
 * Scramble a string while holding its shape: every character is replaced by a
 * random one of the SAME class — capital for capital, lowercase for lowercase,
 * digit for digit — and spaces, punctuation and symbols are left alone.
 *
 * Two things fall out of that. The line never changes width, because letters of
 * the same case have near-identical advances in a sane UI face and the spaces
 * stay where they were. And the reveal reads as a signal resolving rather than
 * as noise, since the word and number shapes are visible the whole time.
 */
export function scrambleLike(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch >= 'A' && ch <= 'Z') out += pick(UPPER);
    else if (ch >= 'a' && ch <= 'z') out += pick(LOWER);
    else if (ch >= '0' && ch <= '9') out += pick(DIGITS);
    else out += ch;
  }
  return out;
}

export function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Every function returns one of these. Call cancel() to stop and leave the DOM as-is. */
function handle(timers, intervals) {
  return {
    cancel() {
      timers.forEach(clearTimeout);
      (intervals || []).forEach(clearInterval);
      timers.length = 0;
    }
  };
}

/* ────────────────────────────── core sequencer ───────────────────────────── */

/**
 * Hold each step for `frame` ms, in order. The primitive everything else is
 * built from — use it directly for any effect not covered below.
 *
 *   FX.frames([
 *     () => el.textContent = '▚',
 *     () => el.style.background = '#fff',
 *     () => el.style.background = ''
 *   ]);
 */
export function frames(steps, { frame = FRAME, delay = 0, onDone, skip = prefersReducedMotion() } = {}) {
  if (skip) {
    steps.forEach(s => s());
    if (onDone) onDone();
    return handle([]);
  }
  const timers = [];
  let t = delay;
  for (const step of steps) {
    timers.push(setTimeout(step, t));
    t += frame;
  }
  if (onDone) timers.push(setTimeout(onDone, t));
  return handle(timers);
}

/* ──────────────────────────────── text ───────────────────────────────────── */

/**
 * Resolve text out of noise, element by element.
 *
 * Each element scrambles for `ticks` re-randomisations at `tickMs` apart, then
 * snaps to its real text. `stagger` offsets each element in the list, so a
 * panel assembles top to bottom. `block` groups lines into stagger slots, so
 * a thirty-line sheet arrives in six steps rather than thirty. The original
 * text is cached on
 * el.dataset.text, so calling this repeatedly on the same element is safe.
 */
export function scrambleReveal(els, {
  stagger = 0, staggerTotal = 0, block = 1, ticks = 3, tickMs = 40, chars = null,
  dim = 0.42, blockChance = 0.3, onDone, skip = prefersReducedMotion()
} = {}) {
  const list = Array.from(els || []);
  if (!list.length) { if (onDone) onDone(); return handle([]); }

  // Cogmind's rule for a list reveal: the whole animation must finish in a
  // bounded time no matter how many rows there are, so the per-row offset is
  // derived from a total budget rather than fixed. (Kyzrati: each item is
  // staggered within 0–700ms, each move takes 300ms, so the sort never runs
  // longer than a second regardless of item count.)
  if (staggerTotal && list.length > 1) {
    stagger = Math.min(stagger || Infinity, staggerTotal / (list.length - 1));
  }

  // Which stagger slot a line sits in. With block = 1 this is just its index;
  // with block = 5 the first five lines all start at 0, the next five one
  // stagger later, and a thirty-line sheet costs six slots instead of thirty.
  const slot = (i) => (block > 1 ? Math.floor(i / block) : i);

  if (skip) {
    list.forEach(el => { el.textContent = el.dataset.text != null ? el.dataset.text : el.textContent; });
    if (onDone) onDone();
    return handle([]);
  }

  const timers = [], intervals = [];
  let pending = list.length;

  list.forEach((el, i) => {
    const text = el.dataset.text != null ? el.dataset.text : el.textContent;
    el.dataset.text = text;

    // Block glyphs only where they cannot change the line's width: monospace
    // runs, where every glyph shares one advance. Elsewhere the browser would
    // substitute a fallback font and the text would jump.
    const mono = chars ? true : isMono(el);
    const noise = (ch) => chars
      ? chars[(Math.random() * chars.length) | 0]
      : noiseChar(ch, mono, blockChance);

    el.textContent = '';
    timers.push(setTimeout(() => {
      let tick = 0;
      const paint = () => {
        // characters lock left to right as the signal resolves
        const locked = Math.floor((tick / ticks) * text.length);
        let html = '';
        for (let k = 0; k < text.length; k++) {
          if (k < locked) html += esc(text[k]);
          else html += '<span style="opacity:' + dim + '">' + esc(noise(text[k])) + '</span>';
        }
        el.innerHTML = html;
      };
      paint();
      const iv = setInterval(() => {
        tick++;
        if (tick >= ticks) {
          clearInterval(iv);
          el.textContent = text;
          if (--pending === 0 && onDone) onDone();
          return;
        }
        paint();
      }, tickMs);
      intervals.push(iv);
    }, slot(i) * stagger));
  });

  return handle(timers, intervals);
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isMono(el) {
  try {
    return /mono|courier|consolas/i.test(getComputedStyle(el).fontFamily || '');
  } catch (e) { return false; }
}

function noiseChar(ch, mono, blockChance) {
  if (ch === ' ' || ch === '\n' || ch === '\t') return ch;
  const isUpper = ch >= 'A' && ch <= 'Z';
  const isLower = ch >= 'a' && ch <= 'z';
  const isDigit = ch >= '0' && ch <= '9';
  if (!isUpper && !isLower && !isDigit) return ch;
  if (mono && Math.random() < blockChance) return pick(TOKEN_CHARS);
  if (isUpper) return pick(UPPER);
  if (isLower) return pick(LOWER);
  return pick(DIGITS);
}

/**
 * Timings that have been tuned in a shipped game. Reach for these before
 * inventing numbers — the differences between them carry meaning.
 *
 *   hover  no stagger at all, so a glance feels like focusing, not building
 *   panel  assembles top to bottom; the reader watches it arrive
 *   value  no stagger, many ticks — one number working itself out
 *   boot   slow and theatrical; only for a loading screen
 */
export const PRESETS = {
  hover: { stagger: 0, ticks: 4, tickMs: 84 },
  panel: { stagger: 135, ticks: 4, tickMs: 114 },
  panelEdge: { stagger: 120, ticks: 3, tickMs: 120 },
  value: { stagger: 0, ticks: 7, tickMs: 120 },
  log: { stagger: 360, ticks: 4, tickMs: 150 },
  name: { stagger: 165, ticks: 5, tickMs: 105 },
  menu: { stagger: 900, ticks: 5, tickMs: 180 },
  boot: { stagger: 900, ticks: 5, tickMs: 180 },
  /** A list of unknown length — bounded total, so ten rows read like three. */
  list: { stagger: 135, staggerTotal: 700, ticks: 3, tickMs: 110 },
  /** A sheet of many lines: five at a time, so length costs almost nothing. */
  sheet: { stagger: 112, block: 5, ticks: 3, tickMs: 95 },
  /** Everything at once — for a record that was already written. */
  all: { stagger: 0, ticks: 3, tickMs: 95 }
};

/**
 * Arrival flash. Cogmind flashes a moved item white and lets it fade back over
 * 400ms, which is what tells you at a glance which rows just changed. Ours
 * steps rather than fades — three held frames, white, half, base — because a
 * fade is the one thing this system does not do.
 */
export function arrive(els, { frame = 135, color = '#ffffff', mid = null, onDone, skip = prefersReducedMotion() } = {}) {
  const list = Array.from(els || []);
  if (!list.length) { if (onDone) onDone(); return handle([]); }
  const prev = list.map(el => el.style.color);
  if (skip) { if (onDone) onDone(); return handle([]); }
  const half = mid || 'color-mix(in oklab, ' + color + ' 50%, currentColor)';
  return frames([
    () => list.forEach(el => { el.style.color = color; }),
    () => list.forEach(el => { el.style.color = half; }),
    () => list.forEach((el, i) => { el.style.color = prev[i] || ''; })
  ], { frame, onDone });
}

/** Write new text into elements and reveal it. Convenience for panels that change content. */
export function setAndReveal(els, texts, preset = PRESETS.panel) {
  const list = Array.from(els || []);
  list.forEach((el, i) => {
    const t = texts[i] != null ? texts[i] : '';
    el.dataset.text = t;
    el.textContent = t;
  });
  return scrambleReveal(list, preset);
}

/* ─────────────────────────────── tokens ──────────────────────────────────── */

/**
 * A ghost must never impersonate the element it was cloned from: duplicate ids
 * are invalid HTML and break #id selectors, and a consumer iterating its units
 * by data attribute would otherwise find phantom copies mid-move.
 */
function stripIdentity(node, extra) {
  node.removeAttribute('id');
  node.removeAttribute('name');
  Array.from(node.attributes).forEach(a => {
    if (a.name.indexOf('data-') === 0 || a.name.indexOf('aria-') === 0) node.removeAttribute(a.name);
  });
  (extra || []).forEach(a => node.removeAttribute(a));
  node.querySelectorAll('[id]').forEach(child => child.removeAttribute('id'));
}

/**
 * `place` tells the library how to put a token somewhere. The default writes
 * {left, top} as pixels; pass your own for grids, transforms or canvas.
 */
const defaultPlace = (el, pos) => {
  if (pos == null) return;
  if (typeof pos === 'object') {
    if (pos.left != null) el.style.left = typeof pos.left === 'number' ? pos.left + 'px' : pos.left;
    if (pos.top != null) el.style.top = typeof pos.top === 'number' ? pos.top + 'px' : pos.top;
  }
};

/**
 * Scrambled wake — the default way to move a token one or more tiles.
 *
 * The token steps from tile to tile, never between them, with its face broken
 * into block glyphs the whole way. Each tile it leaves keeps a decaying ghost,
 * so the route is revealed by the movement itself and no arrow is needed.
 *
 *   FX.wake(token, [{left: 50}, {left: 88}, {left: 126}], { label: 'D1' });
 *
 * If the token is a drawing rather than a text node, pass `faceEl` — the child
 * that carries the readable face (mark it `data-fx-face` so ghosts find it too).
 * The host element moves; only the face scrambles.
 *
 * Ghosts are clones, so they are stripped of anything that identifies the
 * original before being inserted: the id, every data-* attribute, and any
 * name/aria hooks. They carry only `data-fx-ghost`. That means you can keep
 * querying your own tokens by id or data attribute while a move is playing —
 * add to `stripAttrs` if your project hangs identity on something else.
 */
export function wake(el, path, {
  place = defaultPlace,
  frame = FRAME,
  ghostMs = 1350,
  faceEl = null,
  label = null,
  chars = TOKEN_CHARS,
  scrambleFace = true,
  ghostOpacity = 0.5,
  stripAttrs = [],
  onDone,
  skip = prefersReducedMotion()
} = {}) {
  const steps = Array.from(path || []);
  if (!el || !steps.length) { if (onDone) onDone(); return handle([]); }

  const face = faceEl || el;
  const text = label != null ? label : (face.textContent || '');

  if (skip) {
    place(el, steps[steps.length - 1]);
    face.textContent = text;
    if (onDone) onDone();
    return handle([]);
  }

  const timers = [], intervals = [];
  const faceLen = (text || '··').length;

  steps.forEach((pos, i) => {
    timers.push(setTimeout(() => {
      const ghost = el.cloneNode(true);
      stripIdentity(ghost, stripAttrs);
      ghost.setAttribute('data-fx-ghost', '');
      ghost.style.pointerEvents = 'none';
      ghost.style.opacity = String(ghostOpacity);
      ghost.style.transition = 'opacity ' + ghostMs + 'ms linear';
      if (scrambleFace) ghost.textContent = randomScramble(faceLen, chars);
      el.parentNode.appendChild(ghost);

      const ghostFace = faceEl
        ? ghost.querySelector('[data-fx-face]') || ghost
        : ghost;
      let gt = 0;
      const giv = setInterval(() => {
        ghostFace.textContent = randomScramble(faceLen, chars);
        if (++gt > 3) clearInterval(giv);
      }, frame);
      intervals.push(giv);

      requestAnimationFrame(() => { ghost.style.opacity = '0'; });
      timers.push(setTimeout(() => { clearInterval(giv); ghost.remove(); }, ghostMs + 60));

      place(el, pos);
      if (scrambleFace) face.textContent = randomScramble(faceLen, chars);
    }, i * frame));
  });

  const tail = steps.length * frame;
  timers.push(setTimeout(() => { face.textContent = text; if (onDone) onDone(); }, tail + frame));
  return handle(timers, intervals);
}

/**
 * Blink-step — the token cuts out and reappears elsewhere, flickering once as
 * the feed re-acquires it. No path is shown, which makes it right for
 * teleports, deploys, and anything that did not physically travel.
 */
export function blink(el, to, {
  place = defaultPlace, frame = FRAME, flickers = 2, onDone, skip = prefersReducedMotion()
} = {}) {
  if (!el) { if (onDone) onDone(); return handle([]); }
  if (skip) { place(el, to); if (onDone) onDone(); return handle([]); }

  const steps = [
    () => { el.style.opacity = '0'; },
    () => { place(el, to); }
  ];
  for (let i = 0; i < flickers; i++) {
    steps.push(() => { el.style.opacity = '1'; });
    steps.push(() => { el.style.opacity = '0'; });
  }
  steps.push(() => { el.style.opacity = '1'; });
  return frames(steps, { frame: Math.round(frame * 0.6), onDone });
}

/**
 * Teleport — dissolve into noise here, reassemble there. No path is drawn, so
 * the move reads as a cut rather than a walk. Longer and more expensive than
 * blink.
 *
 * If the token is a drawing rather than a text node, pass `faceEl` — the child
 * carrying the readable face. The host moves; only the face scrambles.
 */
export function teleport(el, to, {
  place = defaultPlace, frame = FRAME, faceEl = null, label = null,
  chars = TOKEN_CHARS, onDone, skip = prefersReducedMotion()
} = {}) {
  if (!el) { if (onDone) onDone(); return handle([]); }
  const face = faceEl || el;
  const text = label != null ? label : (face.textContent || '');
  if (skip) { place(el, to); face.textContent = text; if (onDone) onDone(); return handle([]); }

  const n = (text || '··').length;
  const scr = () => { face.textContent = randomScramble(n, chars); };
  return frames([
    scr, scr, scr,
    () => { el.style.opacity = '0'; },
    () => { place(el, to); el.style.opacity = '1'; scr(); },
    scr, scr,
    () => { face.textContent = text; }
  ], { frame: Math.round(frame * 0.6), onDone });
}

/** Stepped transit — drawn on each tile, never between them, and no ghosts. */
export function steppedTransit(el, path, {
  place = defaultPlace, frame = FRAME, onDone, skip = prefersReducedMotion()
} = {}) {
  const steps = Array.from(path || []);
  if (!el || !steps.length) { if (onDone) onDone(); return handle([]); }
  if (skip) { place(el, steps[steps.length - 1]); if (onDone) onDone(); return handle([]); }
  return frames(steps.map(pos => () => place(el, pos)), { frame, onDone });
}

/* ─────────────────────────────── combat ──────────────────────────────────── */

/**
 * Impact frames — a heavy adjacent hit. Nothing travels: the attacker's face
 * flips to a strike mark, the shared edge fills, the target goes solid white
 * for exactly one frame, then returns scrambled and dimmed.
 *
 * Every element is optional; pass what you have.
 */
export function impact({
  attacker, target, edge, damageEl,
  damage = '', frame = FRAME, chars = TOKEN_CHARS,
  strikeGlyph = '▚', flashColor = '#ffffff', hurtOpacity = 0.62,
  targetLabel, onDone, skip = prefersReducedMotion()
} = {}) {
  const tLabel = targetLabel != null ? targetLabel : (target && target.textContent);
  const aLabel = attacker && attacker.textContent;
  const tBg = target && target.style.background;

  if (skip) {
    if (target) target.style.opacity = String(hurtOpacity);
    if (damageEl) { damageEl.textContent = damage; damageEl.style.opacity = '1'; }
    if (onDone) onDone();
    return handle([]);
  }

  return frames([
    () => { if (attacker) attacker.textContent = strikeGlyph; },
    () => { if (edge) { edge.style.opacity = '1'; edge.textContent = '▓▒░'; } },
    () => {
      if (target) { target.style.background = flashColor; target.textContent = '██'; }
      if (edge) edge.textContent = '█▓█';
    },
    () => {
      if (target) { target.style.background = tBg || ''; target.textContent = randomScramble(2, chars); }
      if (edge) edge.style.opacity = '0';
      if (damageEl && damage) { damageEl.textContent = damage; damageEl.style.opacity = '1'; }
    },
    () => {
      if (target) target.textContent = randomScramble(2, chars);
      if (attacker) attacker.textContent = aLabel;
    },
    () => { if (target) { target.textContent = tLabel; target.style.opacity = String(hurtOpacity); } },
    () => { if (damageEl) damageEl.style.opacity = '0'; }
  ], { frame, onDone });
}

/**
 * Edge burst — the cheapest legible adjacent hit. Only the shared edge
 * changes, stepping ░ → █ → ▓ while the target inverts. Nothing moves and no
 * glyph is swapped on the attacker, so any number of these can resolve in
 * sequence without the turn dragging.
 */
export function edgeBurst({
  target, edge, damageEl, damage = '', frame = FRAME,
  hurtOpacity = 0.62, onDone, skip = prefersReducedMotion()
} = {}) {
  if (skip) {
    if (target) target.style.opacity = String(hurtOpacity);
    if (damageEl) { damageEl.textContent = damage; damageEl.style.opacity = '1'; }
    if (onDone) onDone();
    return handle([]);
  }
  return frames([
    () => { if (edge) { edge.style.opacity = '1'; edge.textContent = '░'; } },
    () => { if (edge) { edge.textContent = '█'; edge.style.color = '#ffffff'; } },
    () => {
      if (edge) edge.textContent = '▓';
      if (target) target.style.filter = 'invert(1) brightness(2)';
      if (damageEl && damage) { damageEl.textContent = damage; damageEl.style.opacity = '1'; }
    },
    () => {
      if (edge) edge.style.opacity = '0';
      if (target) { target.style.filter = ''; target.style.opacity = String(hurtOpacity); }
    },
    () => { if (damageEl) damageEl.style.opacity = '0'; }
  ], { frame, onDone });
}

/**
 * Exchange — a strike and the answering blow, with a deliberate dead frame
 * between them. The pause is what makes the counter legible as its own event.
 * Runs `impact` in both directions; both parties end dimmed.
 */
export function exchange({
  attacker, target, edge, damageEl,
  damage = '', counterDamage = '', frame = FRAME,
  counterColor = '#cf6a5a', onDone, skip = prefersReducedMotion()
} = {}) {
  const first = impact({ attacker, target, edge, damageEl, damage, frame, skip });
  if (skip) {
    if (attacker) attacker.style.opacity = '0.72';
    if (onDone) onDone();
    return first;
  }
  const gap = frame * 8;
  const second = setTimeout(() => {
    if (edge) edge.style.color = counterColor;
    impact({
      attacker: target, target: attacker, edge, damageEl,
      damage: counterDamage, frame, strikeGlyph: '▞', onDone
    });
  }, gap);
  return {
    cancel() { first.cancel(); clearTimeout(second); }
  };
}

/* ──────────────────────────── screen-level ───────────────────────────────── */

/**
 * Hit-stop. Freeze everything for a beat on a heavy blow — it sells weight
 * better than any motion. Applies a class you define, or pauses your own tick.
 */
export function hitStop(ms = 60, { onResume } = {}) {
  const t = setTimeout(() => { if (onResume) onResume(); }, ms);
  return handle([t]);
}

/** Remove any ghosts left behind by a cancelled wake(). */
export function clearGhosts(root = document) {
  root.querySelectorAll('[data-fx-ghost]').forEach(g => g.remove());
}

/* ───────────────────────────── global build ──────────────────────────────── */

const API = {
  FRAME, SCRAMBLE_CHARS, TOKEN_CHARS, PRESETS,
  BLOCK_CHARS, randomScramble, scrambleLike, prefersReducedMotion, frames,
  scrambleReveal, setAndReveal, arrive,
  wake, blink, teleport, steppedTransit,
  impact, edgeBurst, exchange, hitStop, clearGhosts
};

if (typeof window !== 'undefined') window.DerelictFX = API;

export default API;

/* ─────────────────────────────────────────────────────────── safe reveals ──
 *
 * `scrambleReveal` empties every line it is given *synchronously* and fills it
 * back in over held frames, and `cancel` stops the frames and leaves the DOM
 * where they got to. That is right for the library on its own terms — a
 * cancelled animation should not fight whatever cancelled it — and wrong
 * everywhere a framework is driving it, because a framework cancels routinely.
 *
 * React's StrictMode runs every effect, cleans it up and runs it again. The
 * first pass blanks every line; the cleanup cancels it; and the second pass
 * asks the DOM which elements hold text — and the answer is none, because the
 * first pass just emptied them. So it reveals nothing and the blanks stand.
 * This was shipped, in a whole screen that came up empty.
 *
 * These two are what a component should reach for instead. They were learned
 * by integrating this system into a real game (`INTEGRATION.md`).
 */

/**
 * Run a reveal so that cancelling it can never leave a blank screen.
 *
 * The text is remembered before the reveal starts and put back if the reveal
 * does not finish. `data-text` is where it is kept, which is also where
 * `scrambleReveal` looks for it, so a second pass over the same lines reads
 * the words rather than the wreckage of the first.
 *
 * Returns a plain function, so it drops straight into a React effect:
 *
 *   React.useEffect(() => FX.reveal(FX.linesOf(ref.current), FX.PRESETS.sheet), [deps]);
 */
export function reveal(nodes, preset) {
  const list = Array.from(nodes || []);
  const kept = list.map(el => {
    const text = el.dataset.text != null ? el.dataset.text : el.textContent;
    el.dataset.text = text;
    return { el, text };
  });
  let done = false;
  const running = scrambleReveal(list, {
    ...preset,
    onDone: () => { done = true; if (preset && preset.onDone) preset.onDone(); }
  });
  return () => {
    running.cancel();
    if (done) return;
    for (const k of kept) k.el.textContent = k.text;
  };
}

/**
 * Every line of a subtree, whether the author marked it or not.
 *
 * Marked ones win where there are any — a component that says which of its
 * text is a line means it. Where there are none, a leaf is any element whose
 * children are all text nodes, so a panel that grows a row does not need
 * remembering to.
 *
 * A line that has been revealed before counts even while it is blank, and that
 * is the whole reason this is a function rather than a selector: mid-reveal
 * the DOM says these elements have no text, and a filter that believes it
 * drops exactly the lines that most need putting back.
 */
export function linesOf(host, selector = '[data-sc]') {
  if (!host) return [];
  const marked = Array.from(host.querySelectorAll(selector));
  if (marked.length) return marked;
  return Array.from(host.querySelectorAll('div,span,p')).filter(el => {
    if (!Array.from(el.childNodes).every(n => n.nodeType === 3)) return false;
    if (el.dataset.text != null) return true;
    return el.textContent.trim() !== '';
  });
}
