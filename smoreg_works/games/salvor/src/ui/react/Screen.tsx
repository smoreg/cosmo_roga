import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import type { RoomGame, RoomId } from "@jamrog/engine";
import { HexBoard } from "./board/HexBoard.js";
import type { BoardDoor, BoardRoom, BoardThing } from "./board/HexBoard.js";
import { Panel, Rail } from "./chrome/Panel.js";
import { AlertDial, CoreRack, SegmentMeter } from "./meters/Rack.js";
import { LogStrip } from "./action/Log.js";
import * as FX from "../fx/derelict-fx.js";
import { FRAME_MS, motionNow } from "./settings.js";
import { sfx, soundFor } from "./sfx.js";
import { remember } from "./suspend.js";
import { alertOf, boardOf, codexOf, commandsOf, goalOf, hereOf, endingOf, isHome, logOf, offersOf, rackOf, routeIn, nameOfDrone, tugOf, whoOf, workingOf, alertModelOf, hullMovedDoor } from "./model.js";
import type { Offer } from "./model.js";
import { doorWays } from "../doorlist.js";
import { deckVersion, loadDeckIndex, watchDeck } from "./deckindex.js";
import { CodexCardView, EndingCard } from "./screens/Cards.js";
import { DroneIcon, ThingIcon } from "./board/Icon.js";
import { COG_ICON } from "./board/machines.js";
import { AboutSheet, SettingsSheet, type MenuSettings } from "./screens/Menu.js";
import { DEFAULT_MOTION, DEFAULT_VOLUME } from "./settings.js";
import { DockPreview, TugOrders } from "./screens/Tug.js";
import { roomActions } from "../actions.js";
import { isStop, makeTraveller } from "../auto.js";
import { codexQueue, readCodex } from "../../systems/codex.js";

/** When this drone last scanned, or nothing if it has not. */
function pulsedAt(game: RoomGame): number | undefined {
  const at = (game.player.data ?? {}).pulsedAt;
  return typeof at === "number" ? at : undefined;
}

/** Nothing withheld — one value, so "no sweep running" is one identity check. */
const NONE_HELD: ReadonlySet<RoomId> = new Set<RoomId>();

/** Hex distance, for the order a sweep arrives in: what is near lands first. */
function reach(from: { q: number; r: number } | undefined, to: { q: number; r: number }): number {
  if (from === undefined) return 0;
  const dq = to.q - from.q;
  const dr = to.r - from.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

/** The cards that can stand over the run. One at a time, and never a turn. */
type Card = "none" | "codex" | "ending";

/** What the rail can put over the run: two sheets, both dismissed by a click away. */
type Sheet = "none" | "about" | "settings";

/**
 * The screen, and the only thing that talks to the game.
 *
 * Every command goes through `playerCommand`, which is the engine's one door
 * in — so the machines answer, the alert climbs and the log fills exactly as
 * they do for any other caller. The React tree owns no rule and remembers no
 * state the game already holds; `turn` exists only to say "read it again".
 */
export function Screen({
  game,
  muted = false,
  settings = { volume: DEFAULT_VOLUME, motion: DEFAULT_MOTION },
  onMute,
  onSettings,
  onMenu,
  onNewVoyage,
}: {
  game: RoomGame;
  muted?: boolean;
  /* Defaulted, so the board can be rendered on its own — by a test, or by any
     future screen that wants one without the whole shell around it. */
  settings?: MenuSettings;
  onMute?: (muted: boolean) => void;
  onSettings?: (next: MenuSettings) => void;
  /** Out to the menu, which is this same chrome with the drawer open. */
  onMenu?: () => void;
  onNewVoyage?: () => void;
}): ReactElement {
  const [turn, setTurn] = useState(0);
  const [logOpen, setLogOpen] = useState(false);
  const [card, setCard] = useState<Card>("none");
  const [page, setPage] = useState(0);
  const [queue, setQueue] = useState<string[]>([]);
  const [sheet, setSheet] = useState<Sheet>("none");
  /** Which group of the tug's list is open. `null` is the top of it. */
  const [level, setLevel] = useState<string | null>(null);
  /* Which drone the dock is pointing the rack at. Null is the one on the
     rails, which is the drone that actually exists. */
  /*
   * A turn has been spent: redraw, and write the run down.
   *
   * Every path that moves the game goes through here — it is what tells React
   * the world changed — so it is also the one place that can promise the save
   * is never behind the screen. A roguelike has no checkpoints, and the whole
   * record is `(seed, inputs)`, so there is nothing to be clever about.
   */
  const again = useCallback(() => {
    remember(game);
    setTurn((n) => n + 1);
  }, [game]);

  const home = isHome(game);
  const over = game.status !== "playing";

  /* The run ending is not something to be clicked into: the card comes up on
     the turn the status changes, and closing it leaves the record behind it. */
  useEffect(
    function ended() {
      if (over && card === "none") setCard("ending");
    },
    [over, card],
  );

  /* And the same for the codex: the ship shows you a thing, the card says what
     it is. Only when nothing else is up, so it never lands on top of an
     ending. */
  useEffect(
    function explain() {
      if (over || card !== "none") return;
      if (codexQueue(game).length > 0) openCodex();
    },
    [game, turn, card, over],
  );

  /**
   * What is going on here, shown when there is something to show.
   *
   * It was a key, and there are no keys now. That is not a loss: the queue is
   * the engine's own list of things this voyage has turned up and not
   * explained yet, so a card that waits to be asked for is a card most players
   * never see. It comes up on the turn the ship first shows them the thing.
   */
  const openCodex = (): void => {
    const waiting = codexQueue(game);
    setPage(0);
    /* Nothing waiting is nothing to say. It used to fall through to the
       controls, which were a drawer and are now the menu's business. */
    if (waiting.length === 0) return;
    readCodex(game, waiting[0] as never);
    setQueue(waiting);
    setCard("codex");
    again();
  };

  /** A line of the tug's list, spent. A group opens instead of spending. */
  const pick = (offer: Offer): void => {
    sfx.click();
    const action = roomActions(game, level ?? undefined)[offer.index];
    if (action === undefined || !action.enabled) return;
    game.playerCommand(action.cmd);
    setLevel(null);
    again();
  };

  /**
   * A way through a bulkhead, spent.
   *
   * The index is the engine's own place in its own list, and which list it is
   * depends on the sign: the door's ways where it has more than one, and the
   * compartment's list where the single way lives (`model.ts`, `waysOf`). The
   * view never carried the command itself, so it cannot have edited it.
   */
  const doorAct = (door: BoardDoor, index: number): void => {
    sfx.click();
    const action =
      index >= 0 ? doorWays(game, door.id)?.[index] : roomActions(game)[-1 - index];
    if (action === undefined || !action.enabled) return;
    game.playerCommand(action.cmd);
    again();
  };

  /**
   * A command that is about the drone rather than about anything in the room.
   *
   * A negative index is a line the view added rather than one the engine
   * offered — the scan is the only one — and it names the rack slot to spend
   * instead of a place in a list it was never in.
   */
  const order = (offer: Offer): void => {
    sfx.click();
    if (offer.index < 0) {
      game.playerCommand({ kind: "act", verb: "use", slot: -1 - offer.index });
      again();
      return;
    }
    const action = roomActions(game)[offer.index];
    if (action === undefined || !action.enabled) return;
    game.playerCommand(action.cmd);
    again();
  };

  /* The deck art lands after the first paint, and a board that had already
     read the index while it was empty would never read it again — so the
     arrival is a store the board subscribes to, like any other change. */
  const art = useSyncExternalStore(watchDeck, deckVersion, deckVersion);

  /* And ask for it, rather than trusting that something already did.
     The splash fetches it on the way in and the mount asks before that, which
     covers a player opening the game — and covers nothing else. A board
     reached any other way had no plating and no way of getting any: a module
     reloaded under a running page, a test that renders the screen on its own,
     a future screen that skips the door. Asking is free once it has arrived
     and retries if the last attempt came back empty. */
  useEffect(function art_() {
    void loadDeckIndex();
  }, []);

  /**
   * The sweep: compartments a scan has just reached, arriving one at a time.
   *
   * Nothing about the game changes here — the rooms are already scanned, the
   * turn is already spent. What changes is the order the board admits them in,
   * nearest first, inside one fixed budget however many there are
   * (`fx/derelict-fx.js`, `sweep`). A scan is the only action whose whole
   * output is a change in what the screen shows, and reached all at once it
   * reads as a redraw rather than as something going out from the drone.
   */
  const [held, setHeld] = useState<ReadonlySet<RoomId>>(NONE_HELD);
  /*
   * The sweep hangs on the scanner's stamp, not on the turn counter.
   *
   * On the turn a scan finds a machine the codex opens itself, and opening a
   * card ticks the turn — so a sweep keyed on the turn was cancelled by its
   * own good news, one frame after it started. What a scan did is a fact about
   * the drone; the number of times the screen has been asked to redraw is not.
   */
  const pulseAt = useMemo(() => pulsedAt(game), [game, turn]);
  const shown = useRef<Set<RoomId>>(new Set());
  /* The scanner's last stamp as this screen last saw it. `undefined` until the
     first scan of the sortie, which is also what a fresh drone reports. */
  const pulse = useRef<number | undefined>(undefined);
  const board = useMemo(() => boardOf(game, held), [game, turn, art, held]);

  useEffect(
    function sweep() {
      const known = boardOf(game).rooms.filter((r) => r.id >= 0 && r.knows !== "undetected");
      const fresh = known.filter((r) => !shown.current.has(r.id));
      for (const room of known) shown.current.add(room.id);
      /*
       * Only a scan sweeps, and this is how the screen knows one happened:
       * the stamp the scanner leaves moved (`twist/rig.ts`, `pulsedAt`).
       *
       * Asking "did several compartments arrive at once" instead is the
       * version I wrote first and it is wrong twice over. Boarding a hull is
       * several compartments at once and is not a sweep — the whole board
       * would fade down to unknown and resolve every time the drone came
       * through the airlock, which looks exactly like the deck failing to
       * load. And walking through a door can reveal two, which would put a
       * frame between the press and the drone moving.
       */
      const swept = pulseAt !== undefined && pulseAt !== pulse.current;
      pulse.current = pulseAt;
      if (!swept || fresh.length < 2) {
        if (held !== NONE_HELD) setHeld(NONE_HELD);
        return;
      }
      const from = board.rooms.find((r) => r.id === board.drone);
      const order = [...fresh].sort((a, b) => reach(from, a) - reach(from, b));
      setHeld(new Set(order.map((r) => r.id)));
      const run = FX.sweep(order, {
        onItem: (room) =>
          setHeld((now) => {
            const next = new Set(now);
            next.delete((room as { id: RoomId }).id);
            return next;
          }),
        onDone: () => setHeld(NONE_HELD),
        skip: motionNow() === "instant" || FX.prefersReducedMotion(),
      });
      return () => {
        run.cancel();
        /* Cancelled halfway would leave compartments the drone has scanned
           drawn as though it had not. Whatever stops it, everything arrives. */
        setHeld(NONE_HELD);
      };
    },
    [game, pulseAt],
  );

  /* And every other way a compartment becomes known — a step, a door opening,
     something walking into sight — is recorded without ceremony, so the next
     sweep knows what was already on the board. After the sweep's own effect,
     because on a scan turn that one has to read this as it was. */
  useEffect(
    function noted() {
      for (const room of boardOf(game).rooms) {
        if (room.id >= 0 && room.knows !== "undetected") shown.current.add(room.id);
      }
    },
    [game, turn],
  );
  const things = useMemo(() => hereOf(game), [game, turn]);
  const commands = useMemo(() => commandsOf(game), [game, turn]);
  const working = useMemo(() => workingOf(game), [game, turn]);
  const alert = useMemo(() => alertModelOf(game), [game, turn]);
  /*
   * The noise a turn made.
   *
   * Read off the log after the fact rather than pushed out by whatever caused
   * it, for the same reason the codex reads the state: there are a dozen paths
   * to a blow landing, and a sound that needed each of them to remember to
   * announce itself is a sound that is missing on the path nobody thought of.
   * Only lines this screen has not already heard, so a re-render is silent.
   */
  const heard = useRef(0);
  const wasIn = useRef<RoomId | null>(null);
  useEffect(
    function noise() {
      const lines = game.log.lines;
      /* The log is capped, so its length is not a cursor once it is full: what
         is new is what was written on a turn we have not sounded yet. */
      const now = game.schedule.time;
      if (heard.current !== now) {
        heard.current = now;
        for (const line of lines) {
          if (line.turn !== now) continue;
          const id = soundFor(line.key, game);
          if (id !== undefined) sfx.play(id);
        }
      }
      /* And the step, which writes no line at all: walking through a door is
         the most common thing in the game and the quietest. */
      const here = game.player.room ?? null;
      if (wasIn.current !== null && here !== null && here !== wasIn.current) sfx.play("step");
      wasIn.current = here;
    },
    [game, turn],
  );

  /* Whether the bulkhead that just moved was the ship's doing or the drone's. */
  const hullMoved = useMemo(() => hullMovedDoor(game), [game, turn]);
  const goal = useMemo(() => goalOf(game), [game, turn]);
  /* Which machine this drone was built as. A fact about the sortie, so it is
     read once and not per cell. */
  const who = useMemo(() => whoOf(game), [game, turn]);
  const droneName = useMemo(() => nameOfDrone(game), [game, turn]);
  /**
   * The rack shows the drone that exists, unless the dock is pointing it at
   * one that does not yet. A preview says so by being a preview: nothing has
   * been spent on a hull nobody has undocked in, so every bay is full.
   */
  const tug = useMemo(() => tugOf(game), [game, turn]);
  const offers = useMemo(() => offersOf(game, level ?? undefined), [game, turn, level]);
  const route = useMemo(() => routeIn(game, board), [game, board]);
  const rack = useMemo(() => rackOf(game), [game, turn]);
  const log = useMemo(() => logOf(game), [game, turn]);
  const here = board.rooms.find((r) => r.id === board.drone);

  /**
   * Walk it, one compartment at a time, at the speed of the animation.
   *
   * It used to spend the whole route inside one frame: the loop ran until the
   * traveller said stop and the screen was told once, at the end. Every rule
   * was obeyed and none of it could be watched — five compartments of walking,
   * five turns of machines moving and whatever happened on the way, all
   * resolved between two paints. The drone simply appeared somewhere else.
   *
   * So the loop is a clock now, and the order inside one tick is the order the
   * turn actually has: the drone takes one step, the world takes its turn with
   * it, and only then is the question asked again — is there a reason to stop?
   * If there is, the walk ends there and the player has it back. If there is
   * not, the next tick is scheduled. One frame a compartment, which is the
   * frame everything else in this interface is cut to.
   *
   * `makeTraveller` is still the rule and is untouched: it hands back a command
   * or a reason, and a reason is where the walk ends. What changed is only who
   * is holding the stopwatch.
   */
  const walking = useRef<{ cancel: () => void } | null>(null);
  useEffect(
    () => () => {
      walking.current?.cancel();
    },
    [],
  );

  const walk = (to: RoomId): void => {
    sfx.click();
    /* A second destination replaces the first rather than racing it. */
    walking.current?.cancel();
    const traveller = makeTraveller(to);

    let timer: number | undefined;
    let stopped = false;
    const tick = (): void => {
      if (stopped) return;
      const next = traveller.step(game);
      if (isStop(next)) {
        if (next.stop !== "") game.log.add(next.stop, game.schedule.time, "warn");
        again();
        walking.current = null;
        return;
      }
      /* The step, and the world's answer to it — `playerCommand` runs the
         schedule, so the machines have already moved by the time this returns
         and the next question is asked of the ship as it now stands. */
      const done = game.playerCommand(next.cmd);
      again();
      if (!done.ok || game.status !== "playing") {
        walking.current = null;
        return;
      }
      timer = window.setTimeout(tick, motionNow() === "instant" ? 0 : FRAME_MS[motionNow()]);
    };

    walking.current = {
      cancel: () => {
        stopped = true;
        if (timer !== undefined) window.clearTimeout(timer);
      },
    };
    tick();
  };

  /**
   * Spend a thing's own verb on it, by finding the command the engine offered.
   *
   * The prefix decides which list the number is in. A machine is an entity and
   * a wreck is one of the ship's own things, and they are numbered separately —
   * so looking a bare integer up in both would be one number meaning two
   * things, and the wrong one would be spent the first time they collided.
   */
  const act = (_room: BoardRoom, thing: BoardThing): void => {
    sfx.click();
    const id = Number(thing.id.slice(1));
    const entity = thing.id.startsWith("m");
    const action = roomActions(game).find((a) => {
      const cmd = a.cmd;
      if (cmd.kind === "attack") return entity && cmd.target === id;
      if (cmd.kind === "act") return cmd.target === id;
      return false;
    });
    if (action === undefined || !action.enabled) return;
    game.playerCommand(action.cmd);
    again();
  };

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "grid",
        gridTemplateColumns: "46px minmax(0,1fr) 420px",
        gridTemplateRows: "minmax(0,1fr) auto",
        background: "var(--sv-deep)",
        overflow: "hidden",
        userSelect: "none",
      }}
    >
      {/* Four keys. The first leaves — the menu is this same chrome with its
          drawer open, so going to it is going out rather than opening a third
          thing over the run. The other three answer where they stand: two open
          a sheet, and the sound is a toggle, because it is the one setting
          somebody reaches for mid-turn and a menu-page-row is three presses
          for a thing that is one. */}
      <Rail
        style={{ gridColumn: 1, gridRow: 1, zIndex: 90 }}
        active={sheet === "none" ? undefined : sheet}
        onSelect={(id) => {
          sfx.click();
          if (id === "sys") {
            onMenu?.();
            return;
          }
          if (id === "sound") {
            onMute?.(!muted);
            return;
          }
          setSheet(sheet === id ? "none" : (id as Sheet));
        }}
        items={[
          { id: "sys", glyph: "≡", title: "menu" },
          { id: "about", glyph: "i", title: "about" },
          { id: "settings", path: COG_ICON, title: "settings" },
          { id: "sound", glyph: muted ? "◁" : "◀", title: muted ? "sound off" : "sound on" },
        ]}
      />

      <div
        style={{
          gridColumn: 2,
          gridRow: 1,
          position: "relative",
          minWidth: 0,
          minHeight: 0,
          background:
            "radial-gradient(ellipse 66% 60% at 46% 48%, var(--sv-deck) 0%, var(--sv-deep) 78%)",
        }}
      >
        {home ? (
          <TugOrders
            tug={tug}
            offers={offers}
            level={level}
            onPick={pick}
            onLevel={setLevel}
          />
        ) : (
          <HexBoard
            rooms={board.rooms}
            doors={board.doors}
            hullMoved={hullMoved}
            drone={board.drone}
            route={route}
            onWalk={(to) => walk(to)}
            onAct={act}
            onDoorAct={doorAct}
            who={who}
          />
        )}

        {/* Who you are and what you came for, mounted to the map's top-left —
            the arrangement the design draws. What the hull is worth is a fact
            about the whole voyage; what the drone is carrying is a fact about
            the next mistake, since loot dies with it and banked credits do
            not. That pair is the decision "one more compartment, or home". */}
        {home ? null : (
        <Panel
          title={goal.hull}
          stencil={`${droneName} · sortie ${String(goal.sortie)}`}
          width={300}
          style={{ position: "absolute", left: 14, top: 14, zIndex: 5 }}
        >
          {/* What was signed, rather than what a voyage is generally for. The
              line used to say "neutralize" whatever the contract was, so a run
              carrying a RETRIEVE read it and went looking for three systems. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {(goal.contracts.length === 0
              ? [{ name: goal.goal, text: "", done: false, payout: goal.worth }]
              : goal.contracts
            ).map((c) => (
              <div key={c.name} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
                  <span
                    style={{
                      font: "var(--sv-stencil)",
                      letterSpacing: "var(--sv-stencil-track)",
                      textTransform: "uppercase",
                      color: c.done ? "var(--sv-good)" : "var(--sv-amber)",
                    }}
                  >
                    {c.done ? "done" : "goal"}
                  </span>
                  <span
                    style={{
                      font: "var(--sv-title)",
                      letterSpacing: "var(--sv-title-track)",
                      textTransform: "uppercase",
                      color: "var(--sv-ink)",
                    }}
                  >
                    {c.name}
                  </span>
                  <span
                    style={{
                      marginLeft: "auto",
                      font: "var(--sv-display)",
                      fontSize: 20,
                      letterSpacing: "var(--sv-display-track)",
                      color: "var(--sv-amber-hi)",
                    }}
                  >
                    {c.payout} <span style={{ color: "var(--sv-soft)" }}>cr</span>
                  </span>
                </div>
                {c.text === "" ? null : (
                  <div style={{ font: "var(--sv-body)", color: "var(--sv-fg)" }}>{c.text}</div>
                )}
              </div>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 18,
              marginTop: 9,
              paddingTop: 9,
              borderTop: "1px solid var(--sv-line)",
            }}
          >
            <AlertDial
              value={alert.level}
              max={alert.top}
              word={alert.word}
              quiet={alert.quiet}
              needed={alert.needed}
              hidden={alert.hidden}
              label="alert"
              size={58}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
              <Stat label="systems" value={`${String(goal.online)}/${String(goal.of)}`} />
              <Stat label="keys" value={String(goal.keys)} />
              <Stat
                label="held"
                value={`${String(goal.held)} cr`}
                tone={goal.held > 0 ? "var(--sv-amber-hi)" : undefined}
              />
              <Stat label="banked" value={`${String(goal.banked)} cr`} />
            </div>
          </div>
        </Panel>
        )}


      </div>

      <div
        style={{
          gridColumn: 3,
          gridRow: 1,
          minHeight: 0,
          overflowY: "auto",
          backgroundImage: "var(--sv-scan)",
          backgroundColor: "var(--sv-void)",
          borderLeft: "1px solid var(--sv-line)",
          padding: "10px 16px 0",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <Panel title="Rack" stencil="drone">
          {/* Whose rack this is, drawn as the machine it belongs to — the one
              flying, or whichever the dock is pointing at. */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
            <DroneIcon who={who} size={26} />
            <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
              <span
                style={{
                  font: "var(--sv-title)",
                  letterSpacing: "var(--sv-title-track)",
                  textTransform: "uppercase",
                  color: "var(--sv-ink)",
                  whiteSpace: "nowrap",
                }}
              >
                {droneName}
              </span>
              <span
                style={{
                  font: "var(--sv-stencil)",
                  letterSpacing: "var(--sv-stencil-track)",
                  textTransform: "uppercase",
                  color: "var(--sv-soft)",
                }}
              >
                {rack.hull}
              </span>
            </div>
          </div>
          <CoreRack core={rack.core} coreMax={rack.coreMax} slots={rack.slots} virus={rack.virus} />
        </Panel>

        {home ? (
          <DockPreview tug={tug} />
        ) : (
          <>
            <Panel title={here?.name ?? "unscanned"} stencil={here?.label ?? "—"}>
              <Manifest things={things} onAct={(t) => act(here as BoardRoom, t)} />
            </Panel>

            {working === undefined ? null : (
              <Panel title={working.name} stencil="in progress" tone="warn">
                {/* The template every multi-turn action draws through: how far
                    in, and that the whole thing is lost if the drone does
                    anything else. The second half is the one a player cannot
                    infer and the one the game used to charge them for finding
                    out — five turns at a console read exactly like a verb that
                    takes one. */}
                <SegmentMeter
                  label="done"
                  value={working.done}
                  max={working.of}
                  tone="warn"
                  height={13}
                />
                <div style={{ marginTop: 9, font: "var(--sv-body)", color: "var(--sv-soft)" }}>
                  Anything else and it starts again.
                </div>
              </Panel>
            )}

            <Panel title="Orders" stencil="drone">
              <Lines lines={commands} empty="nothing to order" onPick={order} />
            </Panel>
          </>
        )}
      </div>

      {/* Over the whole screen, not over the board.
          It used to live inside the board's own column, which is where the
          drone token lives too — and the drone is drawn at a higher layer than
          the card was, so a compartment card opened *underneath* the thing it
          was explaining. A card is modal: it belongs to the screen. Below the
          log alone, which is the one thing nothing covers. */}
      {/* A sheet is dismissed by a click anywhere that is not the sheet. On the
          main menu there is nowhere else — the menu *is* the screen — so only
          here does the scrim take a click.

          A direct child of the grid, which it has to be and was not: it was
          nested inside the board's own column, where `gridColumn` means
          nothing at all and the block collapses to no height behind whatever
          the column is already drawing. On the tug — where the column is full
          — pressing About or Settings opened a scrim nobody could see. */}
      {sheet === "none" ? null : (
        <div
          onClick={() => setSheet("none")}
          style={{
            gridColumn: "2 / -1",
            gridRow: 1,
            position: "relative",
            zIndex: 50,
            background: "color-mix(in oklab, var(--sv-deep) 66%, transparent)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: "absolute", left: 0, top: 0, bottom: 0, display: "flex" }}
          >
            {sheet === "about" ? <AboutSheet onClose={() => setSheet("none")} /> : null}
            {sheet === "settings" ? (
              <SettingsSheet
                settings={settings}
                onSettings={onSettings ?? (() => undefined)}
                onClose={() => setSheet("none")}
              />
            ) : null}
          </div>
        </div>
      )}

      {card === "none" ? null : (
        <div style={{ gridColumn: "1 / -1", gridRow: "1 / -1", position: "relative", zIndex: 95 }}>
          <Cards
            card={card}
            game={game}
            page={page}
            queue={queue}
            onPage={setPage}
            onClose={() => setCard(over ? "ending" : "none")}
            onAgain={onNewVoyage}
          />
        </div>
      )}

      <LogStrip
        entries={log}
        expanded={logOpen}
        onToggle={() => setLogOpen(!logOpen)}
        /* Above the drawers on purpose: the log is the game still talking
           while the player is in a menu, and its record opens over the top of
           whatever is up. It is the one thing a drawer never covers. */
        style={{ gridColumn: "1 / -1", gridRow: 2, zIndex: 100 }}
      />
    </div>
  );
}

/**
 * Whichever card is up, built from the game on the frame it opens.
 *
 * Pulled out of `Screen` so the four of them share one place to be chosen
 * between rather than four conditionals in the middle of the layout, and so
 * the cost of reading the game for a card is only paid while one is open.
 */
function Cards({
  card,
  game,
  page,
  queue,
  onPage,
  onClose,
  onAgain,
}: {
  card: Exclude<Card, "none">;
  game: RoomGame;
  page: number;
  queue: readonly string[];
  onPage: (n: number) => void;
  onClose: () => void;
  onAgain?: () => void;
}): ReactElement | null {
  if (card === "ending") {
    return <EndingCard ending={endingOf(game)} onAgain={onAgain} onClose={onClose} />;
  }
  const at = Math.min(Math.max(0, page), Math.max(0, queue.length - 1));
  const entry = codexOf(game, queue[at] ?? "");
  if (entry === undefined) return null;
  return (
    <CodexCardView
      card={entry}
      page={at}
      pages={queue.length}
      onPage={(n) => {
        const to = queue[n];
        if (to !== undefined) readCodex(game, to as never);
        onPage(n);
      }}
      onClose={onClose}
    />
  );
}

/**
 * What is in this compartment, in words, with the verb each thing answers to.
 *
 * The hexagon says the same thing in shapes. Both are here because they fail
 * differently: a shape is quicker to read and impossible to find when it is
 * behind the pointer, and a list is slower and always there. A thing with no
 * verb is still listed — knowing a crate is present and cannot be opened from
 * here is knowing something.
 */
function Manifest({
  things,
  onAct,
}: {
  things: readonly BoardThing[];
  onAct: (thing: BoardThing) => void;
}): ReactElement {
  if (things.length === 0) {
    return (
      <div
        style={{
          font: "var(--sv-stencil)",
          letterSpacing: "var(--sv-stencil-track)",
          textTransform: "uppercase",
          color: "var(--sv-soft)",
        }}
      >
        nothing in here
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {things.map((thing) => {
        const can = thing.verb !== undefined;
        return (
          <div
            key={thing.id}
            onClick={can ? () => onAct(thing) : undefined}
            onMouseEnter={(e) => {
              if (can)
                e.currentTarget.style.background =
                  "color-mix(in oklab, var(--sv-amber) 14%, transparent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 9,
              padding: "5px 8px",
              cursor: can ? "pointer" : "default",
            }}
          >
            {/* The same drawing as on the hexagon. The list used to print the
                engine's own letter here, so a scout was a triangle on the board
                and a `c` in the panel, and the catalogue had to be learned
                twice for one set of things. */}
            <ThingIcon thing={thing} size={13} style={{ alignSelf: "center" }} />
            <span style={{ font: "var(--sv-body)", color: "var(--sv-ink)" }}>{thing.name}</span>
            {/* Whose it was, as the only thing about it that decides anything:
                a sealed crate is free and a dead drone's rack is a quarter. */}
            {thing.risk === undefined ? null : (
              <span
                style={{
                  font: "var(--sv-stencil)",
                  letterSpacing: "var(--sv-stencil-track)",
                  textTransform: "uppercase",
                  color: thing.risk >= 0.25 ? "var(--sv-bad)" : "var(--sv-warn)",
                }}
              >
                {`virus ${String(Math.round(thing.risk * 100))}%`}
              </span>
            )}
            {thing.work === undefined ? null : (
              <span
                style={{
                  font: "var(--sv-stencil)",
                  letterSpacing: "var(--sv-stencil-track)",
                  textTransform: "uppercase",
                  color: "var(--sv-good)",
                }}
              >
                {thing.work.done}/{thing.work.of}
              </span>
            )}
            <span
              style={{
                marginLeft: "auto",
                font: "var(--sv-stencil)",
                letterSpacing: "var(--sv-stencil-track)",
                textTransform: "uppercase",
                color: can ? "var(--sv-amber)" : "var(--sv-line)",
              }}
            >
              {thing.verb ?? "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** A list of the engine's own lines, refusals kept and wearing their reason. */
export function Lines({
  lines,
  empty,
  onPick,
}: {
  lines: readonly Offer[];
  empty: string;
  onPick: (offer: Offer) => void;
}): ReactElement {
  if (lines.length === 0) {
    return (
      <div
        style={{
          font: "var(--sv-stencil)",
          letterSpacing: "var(--sv-stencil-track)",
          textTransform: "uppercase",
          color: "var(--sv-soft)",
        }}
      >
        {empty}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {lines.map((line) => (
        <div
          key={line.index}
          title={line.enabled ? undefined : line.why}
          onClick={line.enabled ? () => onPick(line) : undefined}
          onMouseEnter={(e) => {
            if (line.enabled)
              e.currentTarget.style.background =
                "color-mix(in oklab, var(--sv-amber) 14%, transparent)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 9,
            padding: "5px 8px",
            cursor: line.enabled ? "pointer" : "not-allowed",
            opacity: line.enabled ? 1 : 0.5,
          }}
        >
          <span style={{ width: 11, flex: "none", font: "var(--sv-stencil)", color: "var(--sv-amber)" }}>
            ·
          </span>
          <span style={{ font: "var(--sv-body)", color: "var(--sv-ink)" }}>{line.label}</span>
          <span
            style={{
              marginLeft: "auto",
              font: "var(--sv-stencil)",
              letterSpacing: "var(--sv-stencil-track)",
              textTransform: "uppercase",
              color: line.enabled ? "var(--sv-soft)" : "var(--sv-bad)",
            }}
          >
            {line.enabled ? (line.note ?? "") : (line.why ?? "no")}
          </span>
        </div>
      ))}
    </div>
  );
}

/** One line of the goal panel: a name and the number that answers it. */
function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}): ReactElement {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span
        style={{
          flex: 1,
          font: "var(--sv-stencil)",
          letterSpacing: "var(--sv-stencil-track)",
          textTransform: "uppercase",
          color: "var(--sv-soft)",
        }}
      >
        {label}
      </span>
      <span style={{ font: "var(--sv-body)", color: tone ?? "var(--sv-ink)" }}>{value}</span>
    </div>
  );
}
