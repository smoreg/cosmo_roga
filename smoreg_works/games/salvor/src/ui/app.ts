import type { RoomCommand, RoomGame } from "@jamrog/engine";
import { startTraining } from "../content/hints.js";
import { TUTORIAL_SEED } from "../content/tutorial.js";
import { newGame } from "../game.js";
import { initLang } from "../i18n.js";
import { rigOf } from "../twist/rig.js";
import {
  AUTO_DELAY_MS,
  engage,
  isStop,
  makeExplorer,
  makeTraveller,
  type AutoResult,
  type Explorer,
} from "./auto.js";
import { Renderer } from "./render.js";
import {
  appReducer,
  crashSummary,
  crashed,
  initialState,
  syncStatus,
  stoppedAt,
  walkEnded,
  type AppEffect,
  type AppState,
} from "./appstate.js";
import { debugBlock } from "./debug.js";
import { ownFailure } from "./crashguard.js";
import { isChord, isDebugKey, toIntent, type UiIntent } from "./input.js";
import { BEAT_MS, SalvorMusic, soundEnabled } from "./music.js";
import {
  NO_PULSE,
  litNow,
  machinesInSight,
  nextPulseFrame,
  trackPulse,
  type Pulse,
} from "./pulse.js";
import { SalvorSfx, linesSince, sfxFor } from "./sfx.js";
import { initialView, isViewKey, nextView, rememberView, type View, type ViewStore } from "./view.js";
import { WebRenderer } from "./web/index.js";

/**
 * The browser half of the game, and nothing else: listeners, a URL and two
 * renderers. Every rule about what a key means lives in `input.ts`, every rule
 * about what the app does with it lives in `appstate.ts`, and what can be done
 * at all lives in `actions.ts` — all three testable without a DOM, which is the
 * whole point of this file being this short.
 *
 * There are two renderers and one game. `V` swaps which one is drawing; nothing
 * else about the run changes, because neither of them decides anything — the
 * screen is `schematic()`, `panelBlocks()` and `roomActions()` in both, and a
 * renderer is only what puts their output on a page (`ui/view.ts`).
 */
export class App {
  private game: RoomGame;
  private readonly mount: HTMLElement;
  private readonly asciiHost: HTMLElement;
  private readonly fontSize: number | undefined;
  /** Both built on first use: a session that never presses `V` pays for one. */
  private ascii: Renderer | undefined;
  private web: WebRenderer | undefined;
  private view: View;
  private readonly store: ViewStore | undefined;
  private state: AppState = initialState();
  /**
   * The owner's debug overlay (G68): `` ` `` flips it, `?debug=1` starts it
   * on. Kept here rather than in `AppState` — it is a DOM-layer setting like
   * the view is, not a fact `appReducer` or a save file has any business
   * knowing about, and its reducer's switch has no `default` to fall through.
   */
  private debug = false;
  /** The drawn hull under the honeycomb (G81). Read once off the URL, never remembered. */
  private hull = true;
  /** Tiles in place of glyphs on the schematic (G80). Read once off the URL, like the hull. */
  private tiles = false;
  /** The terminal view's overlay: a plain element beside the canvas, because the ASCII screen is a fixed-size `rot.js` grid with no rows spare for it. */
  private debugHost: HTMLElement | undefined;
  /** The walk in progress, and the timeout pacing it. Both null between walks. */
  private explorer: Explorer | undefined;
  private walkTimer: number | undefined;
  private readonly music: SalvorMusic;
  private readonly sfx: SalvorSfx;
  /** Log lines already turned into sound. Silent until the first key press. */
  private heard = 0;
  private audible = false;
  /**
   * The appearance pulse, and the timer redrawing it on the beat.
   *
   * The only thing on this screen that moves without a key press, and it moves
   * for two beats at a time: a machine coming into sight flashes its
   * compartment and its line in time with the track (`ui/pulse.ts`). The rule
   * is pure and lives there; what lives here is the clock and the one `setTimeout`
   * it needs, for the same reason the walk timer does.
   */
  private pulse: Pulse = NO_PULSE;
  private pulseTimer: number | undefined;
  /** Asked once: a browser that wants less motion gets colour and no blink. */
  private readonly steady = prefersReducedMotion();

  constructor(mount: HTMLElement, seed: number, fontSize?: number) {
    // Before the run exists: the opening line the engine writes at construction
    // is already a line of the game, and it has to arrive in the language the
    // URL or the last session asked for — the same question the view is asked.
    initLang(window.location.search);
    this.mount = mount;
    this.fontSize = fontSize;
    this.asciiHost = mount.ownerDocument.createElement("div");
    mount.appendChild(this.asciiHost);
    this.store = viewStore();
    this.view = initialView(window.location.search, this.store);
    // `?training=1` beside `?seed=`: a training run can be linked and reloaded
    // like any other, which is the whole reason the flag lives in the URL.
    const params = new URLSearchParams(window.location.search);
    const training = params.get("training") === "1";
    // A tutorial is only a tutorial if it is the same ship twice, and the seed
    // is the whole of that: the training hull is drawn by the ordinary
    // generator, so what makes it repeatable is the run's own number
    // (`content/tutorial.ts`). A seed named in the URL still wins — a training
    // run has to be as reportable as any other.
    this.game = newGame(training && !params.has("seed") ? TUTORIAL_SEED : seed, training);
    // `?debug=1`: the owner's overlay, on from the first frame — linkable and
    // reloadable the same way `?seed=` and `?training=1` are.
    this.debug = params.get("debug") === "1";
    // `?hull=0`: the honeycomb without its drawn hull (G81) — the one switch
    // that takes the picture back to the day before, for a crowded frame or a
    // bug report about the hull itself.
    this.hull = params.get("hull") !== "0";
    // `?tiles=1`: the schematic with pictures where the letters are. A modifier
    // on the drawing rather than a fourth view, so `V` still walks three
    // (docs/tiles-design.md, 3) and the terminal ignores it entirely.
    this.tiles = params.get("tiles") === "1";
    const sound = soundEnabled(window.location.search);
    this.music = new SalvorMusic(sound);
    this.sfx = new SalvorSfx(sound);
    window.addEventListener("keydown", (e) => this.guard(() => this.onKey(e)));
    // Whatever the guards miss — a listener we do not own, a rejected promise —
    // still has to land on the error screen and not in a console nobody opens.
    window.addEventListener("error", (e) => {
      const stack = (e.error as { stack?: string } | undefined)?.stack;
      if (ownFailure({ filename: e.filename, message: e.message, stack }, window.location.origin)) {
        this.fail(e.error ?? e.message);
      } else {
        console.warn("SALVOR ignored an error from another script:", e.error ?? e.message);
      }
    });
    window.addEventListener("unhandledrejection", (e) => {
      const stack = (e.reason as { stack?: string } | undefined)?.stack;
      if (ownFailure({ stack }, window.location.origin)) {
        this.fail(e.reason);
      } else {
        console.warn("SALVOR ignored a rejection from another script:", e.reason);
      }
    });
    this.redraw();
  }

  /**
   * Every key press the page hands over.
   *
   * The first one of the session is also the only user gesture a browser will
   * accept as permission to start audio, which is why the title card exists at
   * all rather than dropping the player straight into the airlock: sound hooks
   * the title going down, right here.
   */
  private onKey(e: KeyboardEvent): void {
    if (isChord(e)) return;
    // The view key costs nothing and means nothing to the game: no turn, no
    // sound, and it works on the title card so both screens can be looked at
    // before the run starts.
    if (isViewKey(e)) {
      e.preventDefault();
      this.switchView();
      return;
    }
    // Same shape as the view key, and the same reason: never a turn, works
    // before the run has started, and has no business going through
    // `appReducer` for a setting the sim never asks about.
    if (isDebugKey(e)) {
      e.preventDefault();
      this.toggleDebug();
      return;
    }
    this.wakeSound();
    // Tab moves the browser's focus off the page, and it does so on the screens
    // where every other key is left to the browser as well. Both halves of it —
    // shift+tab included — are the game's on all of them.
    if (e.key === "Tab") e.preventDefault();
    this.apply(toIntent(e, rigOf(this.game.player)), e);
  }

  /**
   * One intent, whatever raised it. The graphic view's buttons come through here
   * as `pick`, which is the same intent the digit produces — so a click and a key
   * press are the same command and there is no second set of rules for the mouse.
   */
  private apply(intent: UiIntent, e?: KeyboardEvent): void {
    const next = appReducer(this.state, intent, this.game);
    if (next.effect.kind === "pass") return;
    e?.preventDefault();
    this.state = next;
    this.run(next.effect);
    this.redraw();
  }

  /** A row of the list clicked in the page: its position, never its digit. */
  private onLine(index: number): void {
    this.guard(() => {
      this.wakeSound();
      this.apply({ kind: "line", index });
    });
  }

  /** A compartment clicked on the schematic — "просто клик по отсеку", the owner. */
  private onRoom(room: number): void {
    this.guard(() => {
      this.wakeSound();
      this.apply({ kind: "room", id: room });
    });
  }

  /** The other screen, and the setting remembering it. Nothing about the run moves. */
  private switchView(): void {
    this.guard(() => {
      this.view = nextView(this.view);
      rememberView(this.view, this.store);
      this.redraw();
    });
  }

  /** The debug overlay, on or off. Not remembered between sessions — `?debug=1` is the link for that. */
  private toggleDebug(): void {
    this.guard(() => {
      this.debug = !this.debug;
      this.redraw();
    });
  }

  /** The one place a state transition becomes something the browser can see. */
  private run(effect: AppEffect): void {
    switch (effect.kind) {
      case "log":
        this.game.log.add(effect.text, this.game.schedule.time, "warn");
        break;
      case "command":
        this.spend(effect.cmd);
        break;
      case "explore":
        this.explorer = makeExplorer(effect.through);
        this.walk();
        break;
      case "travel":
        this.explorer = makeTraveller(effect.to, effect.through);
        this.walk();
        break;
      case "fight":
        this.follow(engage(this.game, effect.melee ? "melee" : "best"));
        break;
      case "stopAuto":
        this.stopWalk();
        break;
      case "language":
        // The reducer has already switched it. Everything on the screen is
        // rebuilt from the tables on the redraw that follows this.
        break;
      case "newRun":
        this.newRun();
        break;
      case "training":
        this.training();
        break;
      case "idle":
      case "pass":
        break;
    }
  }

  /**
   * One step of an explore run, and the timer that asks for the next.
   *
   * Every step is an ordinary player command — the walk has no privileges the
   * keyboard does not — so a refused one ends it rather than being retried: a
   * loop that cannot move must not spin against the sim forty times a second.
   */
  private walk(): void {
    this.walkTimer = undefined;
    if (!this.state.exploring || !this.explorer) return;

    const result = this.explorer.step(this.game);
    if (!this.follow(result)) return;
    this.redraw();
    if (this.game.isOver()) {
      this.endWalk();
      return;
    }
    this.walkTimer = window.setTimeout(() => this.guard(() => this.walk()), AUTO_DELAY_MS);
  }

  /**
   * Act on one decision from `auto.ts`. A stop is a line in the log and no
   * turn — the whole promise of both keys is that they hand the ship back the
   * moment there is something to decide, and say what it was.
   */
  private follow(result: AutoResult): boolean {
    if (isStop(result)) {
      this.game.log.add(result.stop, this.game.schedule.time, "warn");
      this.endWalk();
      // A walk stopped by something shut asks the question it stopped over:
      // that bulkhead's own ways through it (`ui/appstate.ts`, `stoppedAt`).
      if (result.door !== undefined) this.state = stoppedAt(this.state, this.game, result.door);
      return false;
    }
    const outcome = this.spend(result.cmd);
    if (outcome) return true;
    this.endWalk();
    return false;
  }

  /** A turn, and the ending it may have raised. True when it was actually spent. */
  private spend(cmd: RoomCommand): boolean {
    const outcome = this.game.playerCommand(cmd);
    this.state = syncStatus(this.state, this.game);
    return outcome.ok;
  }

  /** The walk ended on its own terms. Any key ending it goes through `stopWalk`. */
  private endWalk(): void {
    this.explorer = undefined;
    this.state = walkEnded(this.state);
  }

  private stopWalk(): void {
    if (this.walkTimer !== undefined) window.clearTimeout(this.walkTimer);
    this.walkTimer = undefined;
    this.explorer = undefined;
  }

  /**
   * The second line of the title menu: a fresh run with the training prompts on.
   *
   * A new run and not a mode, because that is what it is — the same game, the
   * same rules and the same generator, with every one-shot line the game knows
   * how to say switched on from the first turn instead of waiting for the thing
   * it explains to happen. It goes into the URL beside the seed, so a training
   * run can be linked, reloaded and bug-reported like any other.
   */
  private training(): void {
    this.newRun(true);
  }

  private newRun(training = false): void {
    this.stopWalk();
    // Entity ids start again with the new voyage, so what the old one had in
    // sight says nothing about this one. Anything aboard the first compartment
    // is where the run begins rather than something that turned up in it.
    this.stopPulse();
    this.pulse = NO_PULSE;
    // The tutorial is one hull and always the same one; everything else is a
    // fresh draw. The seed still goes into the URL either way, so the two are
    // reported and replayed by exactly the same route.
    const seed = training ? TUTORIAL_SEED : (Math.random() * 0xffffffff) >>> 0;
    this.game = newGame(seed, training);
    // Keep the seed reachable for bug reports: players can paste the URL back.
    const url = new URL(window.location.href);
    url.searchParams.set("seed", String(seed));
    if (training) url.searchParams.set("training", "1");
    else url.searchParams.delete("training");
    history.replaceState(null, "", url.toString());
  }

  /**
   * The first key of the session, spent on permission rather than on a turn.
   *
   * Browsers refuse audio that no one asked for, and refuse it silently, so
   * this has to happen inside the handler for a real key press — which is the
   * one thing the title card guarantees exists before the game starts. The
   * opening line is already on screen by now and is deliberately left behind:
   * the run's first sound should be the drone's first move, not the log
   * catching up with itself.
   */
  private wakeSound(): void {
    if (this.audible || this.state.crash !== undefined) return;
    this.audible = true;
    this.heard = this.game.log.lines.length;
    this.music.begin(this.game);
  }

  /**
   * Sound, and then the picture.
   *
   * Both hang off `redraw` because it is already the one place every change the
   * player can perceive funnels through — a key, a step of an auto-explore
   * walk, a new run. The one path that skips it is `fail`, which draws the
   * error screen itself, and a run that has crashed should not be scored.
   */
  private redraw(): void {
    try {
      if (this.audible) {
        this.music.update(this.game);
        const lines = this.game.log.lines;
        this.sfx.play(sfxFor(linesSince(lines, this.heard)));
        this.heard = lines.length;
      }
      // After the music, because the flash is scheduled against the track's own
      // playhead, and before the paint, because this frame is the first one it
      // could be on. A frame the game drew for its own reasons — a card opening,
      // a language changing — starts nothing: what has come into sight has not
      // changed, and `trackPulse` says so.
      this.pulse = trackPulse(this.pulse, machinesInSight(this.game), Date.now(), {
        beatMs: BEAT_MS,
        untilBeat: this.music.untilBeat(),
        steady: this.steady,
      });
      this.paint();
      this.schedulePulse();
    } catch (error) {
      this.fail(error);
    }
  }

  /**
   * The next frame the pulse itself asks for, if it asks for one.
   *
   * Nothing is scheduled between pulses, and nothing is ever scheduled under
   * `prefers-reduced-motion`: there the colour arrives with the frame the
   * appearance was noticed on and leaves with whatever the player does next, so
   * the screen never changes on its own.
   */
  private schedulePulse(): void {
    if (this.pulseTimer !== undefined) window.clearTimeout(this.pulseTimer);
    this.pulseTimer = undefined;
    const at = nextPulseFrame(this.pulse, Date.now());
    if (at === undefined) return;
    this.pulseTimer = window.setTimeout(
      () =>
        this.guard(() => {
          this.pulseTimer = undefined;
          this.paint();
          this.schedulePulse();
        }),
      Math.max(0, at - Date.now()),
    );
  }

  private stopPulse(): void {
    if (this.pulseTimer !== undefined) window.clearTimeout(this.pulseTimer);
    this.pulseTimer = undefined;
  }

  /**
   * Whichever renderer is up, and the other one out of the way. Both are built
   * lazily and neither is ever thrown away: a view that has been drawn once
   * keeps what it remembers between frames — the panel's flash, the terminal's
   * canvas — so `V` is not a reset.
   */
  private paint(): void {
    // Two of the three views are the same renderer with a different map half,
    // so the choice is which drawing it puts there rather than which renderer
    // exists (`ui/web/screen.ts`, `MapKind`).
    const web = this.view !== "ascii";
    const lit = litNow(this.pulse, Date.now());
    this.asciiHost.hidden = web;
    if (web) {
      const renderer = this.webRenderer();
      renderer.setMap(this.view === "hex" ? "hex" : "graph");
      renderer.setHull(this.hull);
      renderer.setTiles(this.tiles);
      renderer.draw(this.game, this.state, lit, this.debug);
      this.paintDebugHost(false);
    } else {
      this.asciiRenderer().draw(this.game, this.state, lit);
      this.paintDebugHost(true);
    }
    this.web?.show(web);
  }

  /**
   * The terminal view's half of the overlay: `rot.js`'s canvas is a fixed
   * grid with no rows spare for it (`ui/render.ts`, `SCREEN_HEIGHT`), so it is
   * drawn as one plain element under the canvas instead — monospaced, and
   * built from the same lines `ui/panel.ts` hands the web view.
   */
  private paintDebugHost(ascii: boolean): void {
    const lines = debugBlock(this.game, ascii && this.debug);
    if (lines.length === 0) {
      if (this.debugHost) this.debugHost.hidden = true;
      return;
    }
    if (!this.debugHost) {
      this.debugHost = this.mount.ownerDocument.createElement("pre");
      // Set property by property rather than one `cssText` sentence: every
      // value here is a single token, so `tests/purity.test.ts` reads it as
      // markup rather than English, exactly as the font stack it borrows does.
      const style = this.debugHost.style;
      style.margin = "4px";
      style.padding = "4px";
      style.fontSize = "12px";
      // The same stack `ui/render.ts` gives the terminal canvas.
      style.fontFamily = "ui-monospace, 'DejaVu Sans Mono', Menlo, Consolas, monospace";
      style.color = "#8a8f98";
      style.whiteSpace = "pre-wrap";
      this.mount.appendChild(this.debugHost);
    }
    this.debugHost.hidden = false;
    this.debugHost.textContent = lines.join("\n");
  }

  private asciiRenderer(): Renderer {
    if (!this.ascii) this.ascii = new Renderer(this.asciiHost, this.fontSize);
    return this.ascii;
  }

  private webRenderer(): WebRenderer {
    if (!this.web) {
      this.web = new WebRenderer(
        this.mount,
        (index) => this.onLine(index),
        (room) => this.onRoom(room),
      );
    }
    return this.web;
  }

  /**
   * Everything that can reach the simulation goes through here: key presses and
   * the draw that follows one.
   */
  private guard(body: () => void): void {
    try {
      body();
    } catch (error) {
      this.fail(error);
    }
  }

  /**
   * The run is over — not dead, broken. Permadeath is honest; a half-applied
   * turn is not, so the game stops here rather than letting the player press on
   * against a state the rules never produced. The seed and the URL are the
   * whole point of the screen: one pasted line reproduces this exactly.
   *
   * Draws directly instead of through `redraw`, and the first failure wins:
   * the exception that broke the renderer must not recurse through it again.
   */
  private fail(error: unknown): void {
    if (this.state.crash !== undefined) return;
    const summary = crashSummary(this.game, this.reportUrl(), error);
    this.state = crashed(this.state, summary);
    console.error(error);
    try {
      this.paint();
    } catch {
      // The display itself is gone. The console line above is all that is left.
    }
  }

  private reportUrl(): string {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("seed", String(this.game.seed));
      return url.toString();
    } catch {
      return `?seed=${this.game.seed}`;
    }
  }
}

/**
 * `localStorage`, if this browser has one it will let us touch. Reading the
 * property itself throws where site data is switched off, which is why the try
 * is around the access and not only around the call.
 */
/**
 * Whether this browser has asked for less motion.
 *
 * Read once and wrapped, because `matchMedia` is missing in some embeddings and
 * throws in others, and the accessible answer to not knowing is the calm one.
 */
function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function viewStore(): ViewStore | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
