import { useCallback, useMemo, useState } from "react";
import type { ReactElement } from "react";
import type { RoomGame, RoomId } from "@jamrog/engine";
import { HexBoard } from "./board/HexBoard.js";
import type { BoardRoom, BoardThing } from "./board/HexBoard.js";
import { Panel, Rail } from "./chrome/Panel.js";
import { AlertDial, CoreRack } from "./meters/Rack.js";
import { LogStrip } from "./action/Log.js";
import { alertOf, boardOf, logOf, rackOf, routeIn } from "./model.js";
import { roomActions } from "../actions.js";

/**
 * The screen, and the only thing that talks to the game.
 *
 * Every command goes through `playerCommand`, which is the engine's one door
 * in — so the machines answer, the alert climbs and the log fills exactly as
 * they do for any other caller. The React tree owns no rule and remembers no
 * state the game already holds; `turn` exists only to say "read it again".
 */
export function Screen({ game }: { game: RoomGame }): ReactElement {
  const [turn, setTurn] = useState(0);
  const [logOpen, setLogOpen] = useState(false);
  const again = useCallback(() => setTurn((n) => n + 1), []);

  const board = useMemo(() => boardOf(game), [game, turn]);
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
        items={[
          { id: "sys", glyph: "≡", title: "menu" },
          { id: "help", glyph: "?", title: "controls" },
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
        <HexBoard
          rooms={board.rooms}
          doors={board.doors}
          drone={board.drone}
          route={route}
          onWalk={walk}
          onAct={act}
        />

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
