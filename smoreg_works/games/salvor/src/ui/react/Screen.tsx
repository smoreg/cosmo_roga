import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { RoomGame, RoomId } from "@jamrog/engine";
import { HexBoard, inkOf } from "./board/HexBoard.js";
import type { BoardDoor, BoardRoom, BoardThing } from "./board/HexBoard.js";
import { MenuSheet, Panel, Rail } from "./chrome/Panel.js";
import { AlertLadder, CoreRack } from "./meters/Rack.js";
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
  lessonOf,
  logOf,
  offersOf,
  rackOf,
  rackOfHull,
  routeIn,
  tugOf,
  virusOf,
} from "./model.js";
import type { LessonModel, Offer } from "./model.js";
import { doorWays } from "../doorlist.js";
import { VIRUS_KEY } from "../input.js";
import {
  AirlockCardView,
  BriefCardView,
  CodexCardView,
  EndingCard,
  HistoryCard,
  VirusCardView,
} from "./screens/Cards.js";
import { DockPreview, TugOrders } from "./screens/Tug.js";
import { lessonGateOf, roomActions } from "../actions.js";
import { gateRefuses } from "../lessongate.js";
import { briefing, lessonBrief } from "../lessoncard.js";
import { airlockCard } from "../airlockcard.js";
import { isTraining } from "../../content/tutorial.js";
import { voyageOf } from "../../systems/voyage.js";
import { codexQueue, readCodex } from "../../systems/codex.js";
import { t } from "../../i18n.js";

/** The cards that can stand over the run. One at a time, and never a turn. */
type Card = "none" | "codex" | "history" | "ending" | "virus" | "brief" | "airlock" | "sold";

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
  /* A training run that has not moved opens on the card that says what the
     job is (G96, 2); any click puts it away, as every card is put away. */
  const [card, setCard] = useState<Card>(briefing(game) ? "brief" : "none");
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
  /* Both are read before the keys are bound, because both are what a key does
     or does not do: `v` with no strain aboard opens nothing, and `Esc` folds
     the lesson only in a run that has one. */
  const virus = useMemo(() => virusOf(game), [game, turn]);
  const lesson = useMemo(() => lessonOf(game), [game, turn]);

  /* The run ending is not something to be clicked into: the card comes up on
     the turn the status changes, and closing it leaves the record behind it. */
  useEffect(
    function ended() {
      if (over && card === "none") setCard("ending");
    },
    [over, card],
  );

  /* A strain that has been purged takes its own window down with it: the card
     is the virus on this rack, and there is no such thing as a card about one
     that is gone. The same rule the board keeps for a machine that dies under
     the pointer. */
  useEffect(
    function cured() {
      if (card === "virus" && virus === undefined) setCard("none");
    },
    [card, virus],
  );

  /* The two cards a *turn* raises rather than a key: a hull neutralised and
     towed, and the third system coming up with the drone still aboard. Both
     are edges and not states (`ui/appstate.ts`, `raisedBy`) — what is watched
     is the change, so a card put away stays away. */
  const sold = useMemo(() => voyageOf(game).state.filter((s) => s.sold).length, [game, turn]);
  const allUp = useMemo(() => {
    const mission = goalOf(game);
    return !isHome(game) && mission.online >= mission.of;
  }, [game, turn]);
  const wasSold = useRef(sold);
  /* Once a run and not once a hull: the second time the third system comes up
     the player knows, and a card that comes back is a card dismissed unread. */
  const airlockTold = useRef(isTraining(game.player));
  useEffect(
    function raised() {
      if (card !== "none" || over) return;
      if (sold > wasSold.current) {
        wasSold.current = sold;
        setCard("sold");
        return;
      }
      wasSold.current = sold;
      if (!allUp || airlockTold.current) return;
      airlockTold.current = true;
      setCard("airlock");
    },
    [sold, allUp, card, over],
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
   * `?` the controls, `i` what is going on here, `v` the virus on the rack,
   * `PageUp` the record, `Esc` out of whichever is up. The keys the terminal
   * had that were never about a terminal — a card is a thing to open, not a
   * thing to draw.
   *
   */
  useEffect(function keys() {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        if (drawer !== "none") shut();
        else setCard(over ? "ending" : "none");
      } else if (e.key === "?") go(drawer === "help" ? "none" : "help");
      else if (e.key === "i") openCodex();
      else if (e.key === VIRUS_KEY) {
        /* Nothing to say and nothing happens: the window is the strain on this
           rack, so with no strain aboard there is no window to open. */
        if (virus === undefined) return;
        setCard(card === "virus" ? "none" : "virus");
      } else if (e.key === "PageUp") {
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

  const board = useMemo(() => boardOf(game), [game, turn]);
  const things = useMemo(() => hereOf(game), [game, turn]);
  const commands = useMemo(() => commandsOf(game), [game, turn]);
  const goal = useMemo(() => goalOf(game), [game, turn]);
  const alert = useMemo(() => alertOf(game), [game, turn]);
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
    /* The lesson's gate (G96, 1): a step that is not about walking takes no
       walk off the board either, and the list beside it says why. */
    if (gateRefuses(lessonGateOf(game), game, { kind: "go", door: 0 }) !== undefined) return;
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
          { id: "sys", glyph: "≡", title: t("react.rail.menu") },
          { id: "help", glyph: "?", title: t("help.title") },
          {
            id: "sound",
            glyph: sound ? "◀" : "◁",
            title: t("react.rail.sound", {
              state: t(sound ? "title.sound.on" : "title.sound.off"),
            }),
          },
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
          stencil={t("panel.sortie", { n: goal.sortie })}
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
              {t("react.stat.goal")}
            </span>
            <span style={{ font: "var(--sv-body)", color: "var(--sv-ink)" }}>{goal.goal}</span>
            <span
              style={{
                marginLeft: "auto",
                font: "var(--sv-display)",
                fontSize: 22,
                letterSpacing: "var(--sv-display-track)",
                color: "var(--sv-amber-hi)",
                whiteSpace: "nowrap",
              }}
            >
              {goal.worth} <span style={{ color: "var(--sv-soft)" }}>{t("word.crShort")}</span>
            </span>
          </div>

          {/* The four numbers, and under them the ladder. Side by side it was a
              dial that fitted in a column beside them; ten rungs and whatever
              is burning need the panel's full width, and they belong under the
              run's numbers rather than beside them — one is what the drone has
              and the other is what the ship is doing about it. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 3,
              marginTop: 9,
              paddingTop: 9,
              borderTop: "1px solid var(--sv-line)",
            }}
          >
            <Stat
              label={t("react.stat.systems")}
              value={`${String(goal.online)}/${String(goal.of)}`}
            />
            <Stat label={t("react.stat.keys")} value={String(goal.keys)} />
            <Stat
              label={t("react.stat.held")}
              value={t("word.cr", { n: goal.held })}
              tone={goal.held > 0 ? "var(--sv-amber-hi)" : undefined}
            />
            <Stat label={t("react.stat.banked")} value={t("word.cr", { n: goal.banked })} />
          </div>

          <AlertLadder
            alert={alert}
            label={t("react.stat.alert")}
            style={{ marginTop: 9, paddingTop: 9, borderTop: "1px solid var(--sv-line)" }}
          />
        </Panel>
        )}

        {lesson === undefined ? null : (
          <LessonWindow lesson={lesson} />
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
        <Panel
          title={t("tug.group.rig")}
          stencil={t(preview === undefined ? "react.rack.drone" : "react.rack.preview")}
        >
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
            <Panel title={here?.name ?? t("react.room.unknown")} stencil={here?.label ?? "—"}>
              <Manifest things={things} onAct={(thing) => act(here as BoardRoom, thing)} />
            </Panel>

            <Panel title={t("panel.actions")} stencil={t("react.rack.drone")}>
              <Lines lines={commands} empty={t("engine.fail.nothing")} onPick={order} />
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
  /* The same card and the same figures, about one hull rather than the run:
     the voyage carries on behind it, so there is no way back offered. */
  if (card === "sold") return <EndingCard ending={endingOf(game, true)} onClose={onClose} />;
  if (card === "airlock") {
    const out = airlockCard(game);
    return out === undefined ? null : <AirlockCardView card={out} onClose={onClose} />;
  }
  if (card === "virus") {
    const strain = virusOf(game);
    return strain === undefined ? null : <VirusCardView card={strain} onClose={onClose} />;
  }
  if (card === "brief") return <BriefCardView card={lessonBrief()} onClose={onClose} />;
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
        {t("react.here.empty")}
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
                /* The same ink the honeycomb gives it an inch to the left: a
                   system green on the board and amber on the list beside it
                   would be two answers to one question. */
                color: inkOf(thing),
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
            {line.enabled ? (line.note ?? "") : (line.why ?? t("dist.none"))}
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
            width={420}
            title={t("title.name")}
            stencil={t("react.paused")}
            onClose={onShut}
            rows={[
              {
                key: "1",
                label: t("title.menu.voyage"),
                note: t("react.menu.abandon"),
                onPick: () => {
                  onShut();
                  onNewVoyage?.();
                },
              },
              { key: "2", label: t("react.menu.settings"), onPick: () => onGo("settings") },
              { key: "3", label: t("react.menu.credits"), onPick: () => onGo("credits") },
            ]}
          />
        ) : null}

        {drawer === "settings" ? (
          <MenuSheet
            leaving={leaving}
            width={420}
            title={t("react.menu.settings")}
            stencil={t("title.name")}
            onBack={() => onGo("sys")}
            onClose={onShut}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Switch
                letter="s"
                label={t("title.menu.sound")}
                on={sound}
                onFlip={onSound === undefined ? undefined : () => onSound(!sound)}
              />
              {/* Not ours to flip. The browser is asked and the answer is
                  obeyed — `derelict-fx.js` resolves text straight away under
                  it — so the row reports rather than offers. */}
              <Switch
                letter="m"
                label={t("react.settings.motion")}
                value={t("react.settings.fromSystem")}
              />
            </div>
          </MenuSheet>
        ) : null}

        {drawer === "credits" ? (
          <MenuSheet
            leaving={leaving}
            width={420}
            title={t("react.menu.credits")}
            stencil={t("title.name")}
            onBack={() => onGo("sys")}
            onClose={onShut}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              <div data-sc style={{ font: "var(--sv-body)", color: "var(--sv-fg)" }}>
                {t("title.tagline")}
              </div>
              {[
                [t("title.menu.seed"), `?seed=${String(game.seed)}`],
                [t("react.credits.typefaces"), "Barlow Condensed · IBM Plex Mono"],
                /* Two proper nouns and a middot: the game and the studio it
                   owes the look to are called the same thing in every
                   language, the way a callsign is. */
                [t("react.credits.debt"), "Cogmind · Grid Sage Games"],
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
        {value ?? t(on === true ? "title.sound.on" : "title.sound.off")}
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
    <MenuSheet
      leaving={leaving}
      width={470}
      title={t("help.title")}
      stencil={t("react.controls.how")}
      onClose={onShut}
    >
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

/**
 * The lesson's window: which step of the nine, what to do, and the key that
 * does it (`systems/tutorial.ts`, G90 E).
 *
 * Only a training run has one — `lessonOf` returns nothing in every other, and
 * nothing is what a run that is not being taught should show. It stands at the
 * foot of the hull rather than in the readout, because it is about the thing
 * the player is looking at. It never folds and never takes a click: the window
 * is the lesson (G96, 5).
 *
 * A step that closed on this turn wears a tick for exactly one frame: the step
 * the run is on is already the next one, so "done" and "next" are one line and
 * not two windows in a row.
 */
function LessonWindow({ lesson }: { lesson: LessonModel }): ReactElement {
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: 16,
        transform: "translateX(-50%)",
        zIndex: 20,
        maxWidth: "min(560px, 86%)",
        background: "var(--sv-knock)",
        border: `1px solid ${lesson.over ? "var(--sv-good)" : "var(--sv-amber)"}`,
        padding: "7px 12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        {lesson.done ? (
          <span
            style={{
              font: "var(--sv-stencil)",
              letterSpacing: "var(--sv-stencil-track)",
              textTransform: "uppercase",
              color: "var(--sv-good)",
            }}
          >
            {lesson.tick}
          </span>
        ) : null}
        <span
          style={{
            font: "var(--sv-stencil)",
            letterSpacing: "var(--sv-stencil-track)",
            textTransform: "uppercase",
            color: "var(--sv-amber)",
          }}
        >
          {lesson.head}
        </span>
        {lesson.press === "" ? null : (
          <span
            style={{
              font: "var(--sv-stencil)",
              letterSpacing: "var(--sv-stencil-track)",
              textTransform: "uppercase",
              background: "var(--sv-amber)",
              color: "var(--sv-knock)",
              padding: "1px 7px",
            }}
          >
            {lesson.press}
          </span>
        )}
      </div>
      <div style={{ font: "var(--sv-body)", color: "var(--sv-ink)", marginTop: 4 }}>{lesson.text}</div>
    </div>
  );
}
