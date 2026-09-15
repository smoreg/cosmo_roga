import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import type { RoomGame, RoomId } from "@jamrog/engine";
import { HexBoard } from "./board/HexBoard.js";
import type { BoardDoor, BoardRoom, BoardThing } from "./board/HexBoard.js";
import { Panel, Rail } from "./chrome/Panel.js";
import { AlertDial, CoreRack } from "./meters/Rack.js";
import { LogStrip } from "./action/Log.js";
import { alertOf, boardOf, codexOf, commandsOf, goalOf, hereOf, endingOf, isHome, logOf, offersOf, rackOf, routeIn, nameOfDrone, tugOf, whoOf } from "./model.js";
import type { Offer } from "./model.js";
import { doorWays } from "../doorlist.js";
import { deckVersion, loadDeckIndex, watchDeck } from "./deckindex.js";
import { CodexCardView, EndingCard } from "./screens/Cards.js";
import { DroneIcon, ThingIcon } from "./board/Icon.js";
import { DockPreview, TugOrders } from "./screens/Tug.js";
import { roomActions } from "../actions.js";
import { codexQueue, readCodex } from "../../systems/codex.js";

/** The cards that can stand over the run. One at a time, and never a turn. */
type Card = "none" | "codex" | "ending";

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
  onMenu,
  onNewVoyage,
}: {
  game: RoomGame;
  /** Out to the menu, which is this same chrome with the drawer open. */
  onMenu?: () => void;
  onNewVoyage?: () => void;
}): ReactElement {
  const [turn, setTurn] = useState(0);
  const [logOpen, setLogOpen] = useState(false);
  const [card, setCard] = useState<Card>("none");
  const [page, setPage] = useState(0);
  const [queue, setQueue] = useState<string[]>([]);
  /** Which group of the tug's list is open. `null` is the top of it. */
  const [level, setLevel] = useState<string | null>(null);
  /* Which drone the dock is pointing the rack at. Null is the one on the
     rails, which is the drone that actually exists. */
  const again = useCallback(() => setTurn((n) => n + 1), []);

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
    const action =
      index >= 0 ? doorWays(game, door.id)?.[index] : roomActions(game)[-1 - index];
    if (action === undefined || !action.enabled) return;
    game.playerCommand(action.cmd);
    again();
  };

  /** A command that is about the drone rather than about anything in the room. */
  const order = (offer: Offer): void => {
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

  const board = useMemo(() => boardOf(game), [game, turn, art]);
  const things = useMemo(() => hereOf(game), [game, turn]);
  const commands = useMemo(() => commandsOf(game), [game, turn]);
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

  /** Walk it. The board has already played the hops; this spends the turns. */
  const walk = (_to: RoomId, path: readonly number[]): void => {
    for (const step of path) {
      const door = game.ship
        .doorsOf(game.player.room as RoomId)
        .find((d) => game.ship.other(d, game.player.room as RoomId) === step);
      if (door === undefined) break;
      game.playerCommand({ kind: "go", door: door.id });
    }
    again();
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
      {/* One key. Everything that used to be behind the other two is in the
          menu now, and the menu is this same chrome with its drawer open. */}
      <Rail
        style={{ gridColumn: 1, gridRow: 1, zIndex: 90 }}
        onSelect={(id) => {
          /* One key, and it leaves. The menu is this chrome with its drawer
             open, so going to it is going out rather than opening something
             over the top of the run. */
          if (id === "sys") onMenu?.();
        }}
        items={[{ id: "sys", glyph: "≡", title: "menu" }]}
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
            drone={board.drone}
            route={route}
            onWalk={walk}
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
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span
              style={{
                font: "var(--sv-stencil)",
                letterSpacing: "var(--sv-stencil-track)",
                textTransform: "uppercase",
                color: "var(--sv-amber)",
              }}
            >
              goal
            </span>
            <span style={{ font: "var(--sv-body)", color: "var(--sv-ink)" }}>{goal.goal}</span>
            <span
              style={{
                marginLeft: "auto",
                font: "var(--sv-display)",
                fontSize: 22,
                letterSpacing: "var(--sv-display-track)",
                color: "var(--sv-amber-hi)",
              }}
            >
              {goal.worth} <span style={{ color: "var(--sv-soft)" }}>cr</span>
            </span>
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
            <AlertDial value={alertOf(game)} max={5} label="alert" size={58} />
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

        {card === "none" ? null : (
          <Cards
            card={card}
            game={game}
            page={page}
            queue={queue}
            onPage={setPage}
            onClose={() => setCard(over ? "ending" : "none")}
            onAgain={onNewVoyage}
          />
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
          <CoreRack core={rack.core} coreMax={rack.coreMax} slots={rack.slots} />
        </Panel>

        {home ? (
          <DockPreview tug={tug} />
        ) : (
          <>
            <Panel title={here?.name ?? "unscanned"} stencil={here?.label ?? "—"}>
              <Manifest things={things} onAct={(t) => act(here as BoardRoom, t)} />
            </Panel>

            <Panel title="Orders" stencil="drone">
              <Lines lines={commands} empty="nothing to order" onPick={order} />
            </Panel>
          </>
        )}
      </div>

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
