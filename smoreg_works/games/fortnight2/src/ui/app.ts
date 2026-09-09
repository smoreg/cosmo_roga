import { type Game } from "@jamrog/engine";
import { newGame } from "../game.js";
import { rigOf } from "../twist/rig.js";
import { Renderer } from "./render.js";
import {
  appReducer,
  crashSummary,
  crashed,
  initialState,
  syncStatus,
  walkEnded,
  type AppEffect,
  type AppState,
} from "./appstate.js";
import { isChord, toIntent } from "./input.js";
import { AUTO_DELAY_MS, fightStep, isStop, makeExplorer, type AutoResult, type Explorer } from "./auto.js";

/**
 * The browser half of the game, and nothing else: listeners, a timer, a URL and
 * a renderer. Every rule about what a key means lives in `input.ts`, and every
 * rule about what the app does with it lives in `appstate.ts` — both testable
 * without a DOM, which is the whole point of this file being this short.
 */
export class App {
  private game: Game;
  private renderer: Renderer;
  private state: AppState = initialState();
  /** Set while `o` is walking. The pacing timer lives here and never in the sim. */
  private explorer: Explorer | undefined;
  private autoTimer: number | undefined;

  constructor(mount: HTMLElement, seed: number, fontSize?: number) {
    this.renderer = new Renderer(mount, fontSize);
    this.game = newGame(seed);
    window.addEventListener("keydown", (e) => this.guard(() => this.onKey(e)));
    // Whatever the guards miss — a listener we do not own, a rejected promise —
    // still has to land on the error screen and not in a console nobody opens.
    window.addEventListener("error", (e) => this.fail(e.error ?? e.message));
    window.addEventListener("unhandledrejection", (e) => this.fail(e.reason));
    this.redraw();
  }

  /**
   * Every key press the page hands over.
   *
   * The first one of the session is also the only user gesture a browser will
   * accept as permission to start audio, which is why the title card exists at
   * all rather than dropping the player straight onto deck 1: sound lands on
   * day 9 and hooks the title going down, right here.
   */
  private onKey(e: KeyboardEvent): void {
    if (isChord(e)) return;
    const next = appReducer(this.state, toIntent(e, rigOf(this.game.player)), this.game);
    if (next.effect.kind === "pass") return;
    e.preventDefault();
    this.state = next;
    this.run(next.effect);
    this.redraw();
  }

  /** The one place a state transition becomes something the browser can see. */
  private run(effect: AppEffect): void {
    switch (effect.kind) {
      case "log":
        this.game.log.add(effect.text, this.game.schedule.time, "warn");
        break;
      case "command":
        this.game.playerCommand(effect.cmd);
        this.state = syncStatus(this.state, this.game);
        break;
      case "explore":
        this.explorer = makeExplorer();
        this.autoStep();
        break;
      case "fight":
        this.apply(fightStep(this.game));
        break;
      case "stopAuto":
        this.stopAuto();
        break;
      case "newRun":
        this.newRun();
        break;
      case "idle":
      case "pass":
        break;
    }
  }

  private newRun(): void {
    this.stopAuto();
    const seed = (Math.random() * 0xffffffff) >>> 0;
    this.game = newGame(seed);
    // Keep the seed reachable for bug reports: players can paste the URL back.
    const url = new URL(window.location.href);
    url.searchParams.set("seed", String(seed));
    history.replaceState(null, "", url.toString());
  }

  /**
   * One turn of an auto-explore run: take the step, draw it, and schedule the
   * next one. The delay is cosmetic — it is what makes the walk readable — and
   * the sim never learns it exists, so the game stays as turn-based as it was
   * when the same steps came from a finger on `l`.
   */
  private autoStep(): void {
    this.autoTimer = undefined;
    if (!this.explorer) return;
    const walking = this.apply(this.explorer.step(this.game));
    this.redraw();
    if (!walking) {
      this.explorer = undefined;
      this.state = walkEnded(this.state);
      return;
    }
    this.autoTimer = window.setTimeout(() => this.guard(() => this.autoStep()), AUTO_DELAY_MS);
  }

  /**
   * Run one auto step. Returns false when the walk is over — a stop, a refused
   * command, or a run that just ended.
   */
  private apply(result: AutoResult): boolean {
    if (isStop(result)) {
      this.game.log.add(result.stop, this.game.schedule.time, "warn");
      return false;
    }
    const outcome = this.game.playerCommand(result.cmd);
    this.state = syncStatus(this.state, this.game);
    return outcome.ok && !this.game.isOver();
  }

  private stopAuto(): void {
    if (this.autoTimer !== undefined) window.clearTimeout(this.autoTimer);
    this.autoTimer = undefined;
    this.explorer = undefined;
  }

  private redraw(): void {
    try {
      this.renderer.draw(this.game, this.state);
    } catch (error) {
      this.fail(error);
    }
  }

  /**
   * Everything that can reach the simulation goes through here: key presses,
   * auto-explore steps, and the draw that follows either of them.
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
    this.stopAuto();
    const summary = crashSummary(this.game.seed, this.game.schedule.time, this.reportUrl(), error);
    this.state = crashed(this.state, summary);
    console.error(error);
    try {
      this.renderer.draw(this.game, this.state);
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
