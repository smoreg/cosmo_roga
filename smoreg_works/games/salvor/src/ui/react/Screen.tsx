import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import type { RoomGame, RoomId } from "@jamrog/engine";
import { HexBoard } from "./board/HexBoard.js";
import type { BoardRoom, BoardThing } from "./board/HexBoard.js";
import { Panel, Rail } from "./chrome/Panel.js";
import { AlertDial, CoreRack } from "./meters/Rack.js";
import { LogStrip } from "./action/Log.js";
import {
  alertOf,
  boardOf,
  codexOf,
  endingOf,
  helpOf,
  historyOf,
  isHome,
  logOf,
  offersOf,
  rackOf,
  routeIn,
  tugOf,
} from "./model.js";
import type { Offer } from "./model.js";
import { CodexCardView, EndingCard, HelpCard, HistoryCard } from "./screens/Cards.js";
import { TugScreen } from "./screens/Tug.js";
import { roomActions } from "../actions.js";
import { codexQueue, readCodex } from "../../systems/codex.js";

/** The cards that can stand over the run. One at a time, and never a turn. */
type Card = "none" | "help" | "codex" | "history" | "ending";

/**
 * The screen, and the only thing that talks to the game.
 *
 * Every command goes through `playerCommand`, which is the engine's one door
 * in — so the machines answer, the alert climbs and the log fills exactly as
 * they do for any other caller. The React tree owns no rule and remembers no
 * state the game already holds; `turn` exists only to say "read it again".
 */
export function Screen({ game, onNewVoyage }: { game: RoomGame; onNewVoyage?: () => void }): ReactElement {
  const [turn, setTurn] = useState(0);
  const [logOpen, setLogOpen] = useState(false);
  const [card, setCard] = useState<Card>("none");
  const [page, setPage] = useState(0);
  const [queue, setQueue] = useState<string[]>([]);
  /** Which group of the tug's list is open. `null` is the top of it. */
  const [level, setLevel] = useState<string | null>(null);
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
   * `?` the controls, `i` what is going on here, `PageUp` the record, `Esc`
   * out of whichever is up. The four keys the terminal had that were never
   * about a terminal — a card is a thing to open, not a thing to draw.
   */
  useEffect(function keys() {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setCard(over ? "ending" : "none");
      else if (e.key === "?") {
        setPage(0);
        setCard("help");
      } else if (e.key === "i") openCodex();
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
      setCard("help");
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

  const board = useMemo(() => boardOf(game), [game, turn]);
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

  /** Spend a thing's own verb on it, by finding the command the engine offered. */
  const act = (_room: BoardRoom, thing: BoardThing): void => {
    const id = Number(thing.id.slice(1));
    const action = roomActions(game).find((a) => {
      const cmd = a.cmd;
      if (cmd.kind === "attack") return cmd.target === id;
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
      <Rail
        style={{ gridColumn: 1, gridRow: 1, zIndex: 8 }}
        active={card === "none" ? undefined : card}
        onSelect={(id) => {
          setPage(0);
          if (id === "codex") openCodex();
          else setCard(card === id ? "none" : (id as Card));
        }}
        items={[
          { id: "help", glyph: "?", title: "controls" },
          { id: "codex", glyph: "i", title: "what is going on here" },
          { id: "history", glyph: "≡", title: "the record" },
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
          <TugScreen
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
          />
        )}

        {home ? null : (
        <Panel
          title={game.ship.rooms.length > 0 ? "Derelict" : "Hull"}
          stencil={`turn ${String(game.schedule.time)}`}
          width={300}
          style={{ position: "absolute", left: 14, top: 14, zIndex: 5 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <AlertDial value={alertOf(game)} max={5} label="alert" size={66} />
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div
                style={{
                  font: "var(--sv-stencil)",
                  letterSpacing: "var(--sv-stencil-track)",
                  textTransform: "uppercase",
                  color: "var(--sv-soft)",
                }}
              >
                compartments
              </div>
              <div
                style={{
                  font: "var(--sv-display)",
                  fontSize: 34,
                  letterSpacing: "var(--sv-display-track)",
                  color: "var(--sv-ink)",
                }}
              >
                {board.rooms.length}
              </div>
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
          <CoreRack core={rack.core} coreMax={rack.coreMax} slots={rack.slots} />
        </Panel>

        <Panel title={here?.name ?? "unscanned"} stencil={here?.label ?? "—"}>
          <div
            style={{
              font: "var(--sv-stencil)",
              fontSize: 14,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: "var(--sv-soft)",
            }}
          >
            {here === undefined || here.things.length === 0
              ? "nothing in here"
              : "hover a shape for what it is · click to spend its verb"}
          </div>
        </Panel>
      </div>

      <LogStrip
        entries={log}
        expanded={logOpen}
        onToggle={() => setLogOpen(!logOpen)}
        style={{ gridColumn: "1 / -1", gridRow: 2 }}
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
  if (card === "help") {
    const help = helpOf(game);
    return (
      <HelpCard
        pages={help.pages}
        headings={help.headings}
        page={page}
        onPage={onPage}
        onClose={onClose}
      />
    );
  }
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
