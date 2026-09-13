import { useEffect, useState } from "react";
import type { Axial, Point } from "../../core/hex";
import { hostiles, liveNodes, liveSpawners } from "../../core/topology";
import type { DeckMap, GameState } from "../../core/types";
import type { PendingAttack, Plan } from "../../hooks/useMissionInput";
import type { LogLine } from "../../lib/log";
import { UnitCard } from "../molecules/UnitCard";
import { AttackChooser } from "./AttackChooser";
import { DeckView } from "./DeckView";
import { MissionLog } from "./MissionLog";
import "./GameScreen.css";

export interface GameScreenProps {
  readonly deck: DeckMap;
  readonly state: GameState;
  readonly lines: readonly LogLine[];
  readonly unreachableRooms?: readonly string[] | undefined;
  readonly selected?: Axial | null | undefined;
  readonly reachable?: ReadonlySet<string> | undefined;
  readonly forceable?: ReadonlySet<string> | undefined;
  readonly backdropUrl?: string | undefined;
  readonly plan?: Plan | null | undefined;
  readonly pending?: PendingAttack | null | undefined;
  readonly onPick?: (() => void) | undefined;
  readonly onHover?: ((point: Point | null) => void) | undefined;
  readonly onChoose?: ((weaponIndex: number) => void) | undefined;
  readonly onClear?: (() => void) | undefined;
  readonly onEndTurn?: (() => void) | undefined;
  /** Whether the last action can still be taken back — see design/ui-kit/undo.md. */
  readonly canUndo?: boolean | undefined;
  readonly onUndo?: (() => void) | undefined;
}

function round(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * The whole screen, which is the map with everything else floating on it.
 *
 * It was a three-row grid — bar, body, log — and the map shared the middle row
 * with a fixed column, which on a 1280 by 900 screen left the deck 78% of the
 * width and a 165 pixel dead band beneath it. Everything is a card over the
 * deck now, and the deck is the surface.
 */
export function GameScreen(props: GameScreenProps) {
  const { deck, state, lines, unreachableRooms = [], selected, reachable, forceable } = props;
  const { backdropUrl } = props;
  const { plan, pending, onPick, onHover, onChoose, onClear, onEndTurn } = props;
  const { canUndo = false, onUndo } = props;

  const [logOpen, setLogOpen] = useState(false);
  const last = lines.at(-1);
  const chosen =
    selected == null
      ? undefined
      : state.units.find(function standingThere(unit) {
          return unit.at.q === selected.q && unit.at.r === selected.r && unit.hp > 0;
        });

  /* The two keys the buttons advertise. Space ends the turn, z takes back —
     both ignored while a text field has focus, which there is not one of today
     and will be the moment anything is nameable. */
  const live = state.outcome === null;
  useEffect(
    function bindKeys() {
      function onKey(event: KeyboardEvent): void {
        const target = event.target;
        if (target instanceof HTMLElement && target.tagName === "INPUT") return;
        if (event.key === " " && live && onEndTurn !== undefined) {
          event.preventDefault();
          onEndTurn();
        }
        if ((event.key === "z" || event.key === "Z") && canUndo && onUndo !== undefined) {
          event.preventDefault();
          onUndo();
        }
      }
      window.addEventListener("keydown", onKey);
      return function unbind() {
        window.removeEventListener("keydown", onKey);
      };
    },
    [live, canUndo, onEndTurn, onUndo],
  );

  return (
    <div className="screen">
      <div
        className="screen__map"
        onMouseLeave={
          onHover === undefined
            ? undefined
            : function leave() {
                onHover(null);
              }
        }
        onContextMenu={
          onClear === undefined
            ? undefined
            : function clear(event) {
                event.preventDefault();
                onClear();
              }
        }
      >
        <DeckView
          deck={deck}
          state={state}
          selected={selected ?? null}
          reachable={reachable}
          forceable={forceable}
          arrows={plan?.arrows ?? []}
          backdropUrl={backdropUrl}
          onPick={onPick}
          onHover={onHover}
        />
      </div>

      <header className="screen__card screen__title">
        <span className="screen__ship">{deck.name}</span>
        <span className="screen__stats">
          turn <b>{state.turn}</b> · pool <b>{round(state.pool)}</b> · spawn zones{" "}
          <b>{liveSpawners(state).length}</b> · nodes <b>{liveNodes(state).length}</b> · hostiles{" "}
          <b>{hostiles(state).length}</b>
        </span>
      </header>

      {state.outcome === null ? null : (
        <strong
          className="screen__card screen__outcome"
          style={{ color: state.outcome === "win" ? "var(--node)" : "var(--stamp)" }}
        >
          {state.outcome === "win" ? "Mission complete" : "Both drones lost"}
        </strong>
      )}

      {/* Only what is selected, and nothing when nothing is.

          The squad was a permanent column listing every drone. Each drone's hit
          points are already drawn on its own token, so the column repeated the
          map at the cost of a quarter of the screen — and the kit's 4a has no
          such column. It appears when you pick somebody up and goes when you
          put them down. */}
      {chosen === undefined ? null : (
        <aside className="screen__card screen__side">
          <h2 className="screen__sideHeading">{chosen.side === "drone" ? "Drone" : "Contact"}</h2>
          <UnitCard unit={chosen} />
          {unreachableRooms.length === 0 ? null : (
            <p className="screen__note">
              Sealed, left without a node: {unreachableRooms.join(", ")}.
            </p>
          )}
        </aside>
      )}

      <div className="screen__acts">
        <button
          type="button"
          className="screen__button"
          onClick={onUndo}
          disabled={onUndo === undefined || !canUndo}
          title={
            canUndo ? "Take back the last move" : "That action revealed something, so it stands"
          }
        >
          Undo
          <span className="screen__key">[z]</span>
        </button>
        <button
          type="button"
          className="screen__button screen__button--go"
          onClick={onEndTurn}
          disabled={state.outcome !== null}
        >
          End turn
          <span className="screen__key">[space]</span>
        </button>
      </div>

      <div className="screen__log">
        {plan?.why == null ? null : <p className="screen__hint">{plan.why}</p>}
        <div className="screen__logStrip">
          <span className="screen__logTag">Log</span>
          <span className="screen__logLast">{last?.text ?? "Boarded."}</span>
          <button
            type="button"
            className="screen__logToggle"
            onClick={function toggle() {
              setLogOpen(!logOpen);
            }}
            aria-expanded={logOpen}
          >
            {logOpen ? "collapse ▼" : "expand ▲"} · {lines.length} events
          </button>
        </div>
        {logOpen ? (
          <div className="screen__logFull">
            <MissionLog lines={lines} />
          </div>
        ) : null}
      </div>

      {pending == null || onChoose === undefined || onClear === undefined ? null : (
        <AttackChooser pending={pending} onChoose={onChoose} onCancel={onClear} />
      )}
    </div>
  );
}
