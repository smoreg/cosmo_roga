import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import type { RoomGame, RoomId } from "@jamrog/engine";
import { HexBoard } from "./board/HexBoard.js";
import type { BoardDoor, BoardRoom, BoardThing } from "./board/HexBoard.js";
import { MenuSheet, Panel, Rail } from "./chrome/Panel.js";
import { AlertDial, CoreRack } from "./meters/Rack.js";
import { LogStrip } from "./action/Log.js";
import {
  alertOf,
  boardOf,
  codexOf,
  commandsOf,
  goalOf,
  hereOf,
  endingOf,
  helpOf,
  historyOf,
  isHome,
  logOf,
  offersOf,
  rackOf,
  rackOfHull,
  routeIn,
  tugOf,
} from "./model.js";
import type { Offer } from "./model.js";
import { doorWays } from "../doorlist.js";
import { deckVersion, watchDeck } from "./deckindex.js";
import { CodexCardView, EndingCard, HistoryCard } from "./screens/Cards.js";
import { DockPreview, TugOrders } from "./screens/Tug.js";
import { roomActions } from "../actions.js";
import { codexQueue, readCodex } from "../../systems/codex.js";

/** The cards that can stand over the run. One at a time, and never a turn. */
type Card = "none" | "codex" | "history" | "ending";

/**
 * The drawers the rail opens: the system menu and what it leads to, and the
 * controls. One at a time, sliding in from the left edge of the play area.
 *
 * Separate from `Card` because they are a different kind of thing. A card is
 * the game talking — something happened, here is what it was. A drawer is the
 * player talking to the shell, and the run is paused underneath it.
 */
type Drawer = "none" | "sys" | "settings" | "credits" | "help";

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
  sound = true,
  onSound,
  onNewVoyage,
}: {
  game: RoomGame;
  sound?: boolean;
  onSound?: (on: boolean) => void;
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
  const [looking, setLooking] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<Drawer>("none");
  /* A sheet on its way out is still on screen, so which one is leaving is a
     fact the layer needs and the animation is the only thing that ends it. */
  const [leaving, setLeaving] = useState(false);
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

  /**
   * Opening and shutting a drawer, with the slide it leaves on.
   *
   * `go` between two sheets does not slide — the housing stays and its
   * contents change, which is what makes Settings feel like a page of the menu
   * rather than a second menu. Only leaving the stack altogether slides.
   */
  const go = (to: Drawer): void => {
    setLeaving(false);
    setDrawer(to);
  };
  const shut = (): void => {
    if (drawer === "none") return;
    setLeaving(true);
    window.setTimeout(() => {
      setDrawer("none");
      setLeaving(false);
    }, 240);
  };

  /**
   * `?` the controls, `i` what is going on here, `PageUp` the record, `Esc`
   * out of whichever is up. The four keys the terminal had that were never
   * about a terminal — a card is a thing to open, not a thing to draw.
   */
  useEffect(function keys() {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        if (drawer !== "none") shut();
        else setCard(over ? "ending" : "none");
      } else if (e.key === "?") go(drawer === "help" ? "none" : "help");
      else if (e.key === "i") openCodex();
      else if (e.key === "PageUp") {
        setPage(0);
        setCard("history");
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  });

  /**
   * What is going on here: the cards this voyage has turned up and not shown.
   * With nothing waiting it is the controls, which is where the list of
   * everything already read lives.
   */
  const openCodex = (): void => {
    const waiting = codexQueue(game);
    setPage(0);
    if (waiting.length === 0) {
      /* Nothing waiting, so the key does the next most useful thing: the
         controls, where the list of everything already read lives. It is a
         drawer now rather than a card, which is the only change. */
      go("help");
      return;
    }
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

  const board = useMemo(() => boardOf(game), [game, turn, art]);
  const things = useMemo(() => hereOf(game), [game, turn]);
  const commands = useMemo(() => commandsOf(game), [game, turn]);
  const goal = useMemo(() => goalOf(game), [game, turn]);
  /**
   * The rack shows the drone that exists, unless the dock is pointing it at
   * one that does not yet. A preview says so by being a preview: nothing has
   * been spent on a hull nobody has undocked in, so every bay is full.
   */
  const preview = useMemo(
    () => (looking === null ? undefined : rackOfHull(looking)),
    [looking],
  );
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
      {/* Three keys, and one of them is not a menu at all. Sound is the one
          setting a player reaches for mid-turn — someone walks in, the room
          goes quiet — and making that a menu to open, a page to find and a row
          to press is three presses for a thing that is one. */}
      <Rail
        style={{ gridColumn: 1, gridRow: 1, zIndex: 90 }}
        active={
          drawer === "none"
            ? undefined
            : drawer === "settings" || drawer === "credits"
              ? "sys"
              : drawer
        }
        onSelect={(id) => {
          if (id === "sound") {
            onSound?.(!sound);
            return;
          }
          if (drawer === id || (id === "sys" && (drawer === "settings" || drawer === "credits"))) {
            shut();
            return;
          }
          go(id as Drawer);
        }}
        items={[
          { id: "sys", glyph: "≡", title: "menu" },
          { id: "help", glyph: "?", title: "controls" },
          { id: "sound", glyph: sound ? "◀" : "◁", title: sound ? "sound on" : "sound off" },
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
            drone={board.drone}
            route={route}
            onWalk={walk}
            onAct={act}
            onDoorAct={doorAct}
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
          stencil={`sortie ${String(goal.sortie)}`}
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
        <Panel title="Rack" stencil={preview === undefined ? "drone" : "preview"}>
          <CoreRack
            core={(preview ?? rack).core}
            coreMax={(preview ?? rack).coreMax}
            slots={(preview ?? rack).slots}
          />
        </Panel>

        {home ? (
          <DockPreview tug={tug} onLook={setLooking} />
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

      {drawer === "none" ? null : (
        <Drawers
          drawer={drawer}
          leaving={leaving}
          game={game}
          sound={sound}
          onSound={onSound}
          onGo={go}
          onShut={shut}
          onNewVoyage={onNewVoyage}
        />
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
  if (card === "history") {
    return <HistoryCard entries={historyOf(game)} page={page} onPage={onPage} onClose={onClose} />;
  }
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
            <span
              style={{
                width: 14,
                flex: "none",
                font: "var(--sv-mono)",
                color: thing.hostile === true ? "var(--sv-bad)" : "var(--sv-amber)",
              }}
            >
              {thing.glyph}
            </span>
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

/**
 * The drawers, and the one layer they all arrive in.
 *
 * They come in from the left edge of the play area and stand its full height,
 * stopping at the log — the log is the one thing that is never covered,
 * because it is the game still talking while the player is in a menu, and its
 * record opens over the top of whatever is up.
 *
 * The rail stays outside the scrim and stays live, so one key goes straight to
 * another without a shut and an open in between.
 */
function Drawers({
  drawer,
  leaving,
  game,
  sound,
  onSound,
  onGo,
  onShut,
  onNewVoyage,
}: {
  drawer: Exclude<Drawer, "none">;
  leaving: boolean;
  game: RoomGame;
  sound: boolean;
  onSound?: (on: boolean) => void;
  onGo: (to: Drawer) => void;
  onShut: () => void;
  onNewVoyage?: () => void;
}): ReactElement {
  return (
    <div
      onClick={onShut}
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
        {drawer === "sys" ? (
          <MenuSheet
            leaving={leaving}
            width={360}
            title="Salvor"
            stencil="paused"
            onClose={onShut}
            rows={[
              {
                key: "1",
                label: "New voyage",
                note: "abandons this one",
                onPick: () => {
                  onShut();
                  onNewVoyage?.();
                },
              },
              { key: "2", label: "Settings", onPick: () => onGo("settings") },
              { key: "3", label: "Credits", onPick: () => onGo("credits") },
            ]}
          />
        ) : null}

        {drawer === "settings" ? (
          <MenuSheet
            leaving={leaving}
            width={380}
            title="Settings"
            stencil="salvor"
            onBack={() => onGo("sys")}
            onClose={onShut}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Switch
                letter="s"
                label="Sound"
                on={sound}
                onFlip={onSound === undefined ? undefined : () => onSound(!sound)}
              />
              {/* Not ours to flip. The browser is asked and the answer is
                  obeyed — `derelict-fx.js` resolves text straight away under
                  it — so the row reports rather than offers. */}
              <Switch letter="m" label="Reduced motion" value="system" />
            </div>
          </MenuSheet>
        ) : null}

        {drawer === "credits" ? (
          <MenuSheet
            leaving={leaving}
            width={380}
            title="Credits"
            stencil="salvor"
            onBack={() => onGo("sys")}
            onClose={onShut}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              <div data-sc style={{ font: "var(--sv-body)", color: "var(--sv-fg)" }}>
                A turn-based salvage game about sending one drone into a hulk and getting it
                back out.
              </div>
              {[
                ["seed", `?seed=${String(game.seed)}`],
                ["typefaces", "Barlow Condensed · IBM Plex Mono"],
                ["owes a debt to", "Cogmind, by Grid Sage Games"],
              ].map(([k, v]) => (
                <div
                  key={k}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 10,
                    paddingTop: 9,
                    borderTop: "1px solid var(--sv-line)",
                  }}
                >
                  <span
                    data-sc
                    style={{
                      font: "var(--sv-stencil)",
                      letterSpacing: "var(--sv-stencil-track)",
                      textTransform: "uppercase",
                      color: "var(--sv-soft)",
                    }}
                  >
                    {k}
                  </span>
                  <span
                    data-sc
                    style={{
                      marginLeft: "auto",
                      font: "var(--sv-body)",
                      color: "var(--sv-ink)",
                      textAlign: "right",
                    }}
                  >
                    {v}
                  </span>
                </div>
              ))}
            </div>
          </MenuSheet>
        ) : null}

        {drawer === "help" ? <Controls game={game} leaving={leaving} onShut={onShut} /> : null}
      </div>
    </div>
  );
}

/** A setting: a letter, a name, and either a state to flip or one to report. */
function Switch({
  letter,
  label,
  on,
  value,
  onFlip,
}: {
  letter: string;
  label: string;
  on?: boolean;
  value?: string;
  onFlip?: () => void;
}): ReactElement {
  return (
    <div
      onClick={onFlip}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "7px 9px",
        cursor: onFlip === undefined ? "default" : "pointer",
      }}
    >
      <span style={{ width: 13, flex: "none", font: "var(--sv-stencil)", color: "var(--sv-amber)" }}>
        {letter}
      </span>
      <span data-sc style={{ font: "var(--sv-body)", color: "var(--sv-ink)" }}>
        {label}
      </span>
      <span
        style={{
          marginLeft: "auto",
          font: "var(--sv-stencil)",
          letterSpacing: "var(--sv-stencil-track)",
          textTransform: "uppercase",
          padding: "2px 7px",
          background: on === true ? "var(--sv-amber)" : "transparent",
          border: on === true ? "none" : "1px solid var(--sv-line)",
          color: on === true ? "var(--sv-knock)" : "var(--sv-soft)",
        }}
      >
        {value ?? (on === true ? "on" : "off")}
      </span>
    </div>
  );
}

/** The controls, as a sheet rather than a card: it is the shell, not the game. */
function Controls({
  game,
  leaving,
  onShut,
}: {
  game: RoomGame;
  leaving: boolean;
  onShut: () => void;
}): ReactElement {
  const help = helpOf(game);
  return (
    <MenuSheet leaving={leaving} width={430} title="Controls" stencil="how to fly it" onClose={onShut}>
      <div style={{ display: "flex", flexDirection: "column", overflowY: "auto" }}>
        {help.pages.flat().map((line, i) =>
          line === "" ? (
            <div key={i} style={{ height: 8 }} />
          ) : (
            <div
              key={i}
              data-sc
              style={{
                font: help.headings.has(line.trim()) ? "var(--sv-stencil)" : "var(--sv-body)",
                letterSpacing: help.headings.has(line.trim())
                  ? "var(--sv-stencil-track)"
                  : undefined,
                textTransform: help.headings.has(line.trim()) ? "uppercase" : undefined,
                color: help.headings.has(line.trim()) ? "var(--sv-amber)" : "var(--sv-fg)",
                marginTop: help.headings.has(line.trim()) ? 7 : 0,
                whiteSpace: "pre-wrap",
              }}
            >
              {line}
            </div>
          ),
        )}
      </div>
    </MenuSheet>
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
