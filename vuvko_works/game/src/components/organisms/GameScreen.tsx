import type { Axial, Point } from "../../core/hex";
import { drones, hostiles, liveNodes, liveSpawners } from "../../core/topology";
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
}

function round(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * The whole screen. One component for both shapes: on a narrow viewport the
 * squad column becomes a strip you swipe and the map keeps the space, because
 * the map is the thing you are actually reading.
 */
export function GameScreen(props: GameScreenProps) {
  const { deck, state, lines, unreachableRooms = [], selected, reachable, forceable } = props;
  const { backdropUrl } = props;
  const { plan, pending, onPick, onHover, onChoose, onClear, onEndTurn } = props;

  return (
    <div className="screen">
      <header className="screen__bar">
        <span className="screen__ship">{deck.name}</span>
        <span className="screen__stats">
          turn <b>{state.turn}</b> · pool <b>{round(state.pool)}</b> · spawn zones{" "}
          <b>{liveSpawners(state).length}</b> · nodes <b>{liveNodes(state).length}</b> · hostiles{" "}
          <b>{hostiles(state).length}</b>
        </span>
        <span className="screen__spacer" />
        {state.outcome === null ? null : (
          <strong
            className="screen__outcome"
            style={{ color: state.outcome === "win" ? "var(--node)" : "var(--stamp)" }}
          >
            {state.outcome === "win" ? "MISSION COMPLETE" : "BOTH DRONES LOST"}
          </strong>
        )}
        <button
          type="button"
          className="screen__button"
          onClick={onEndTurn}
          disabled={state.outcome !== null}
        >
          End turn
        </button>
      </header>

      <div className="screen__body">
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

        <aside className="screen__side">
          <h2 className="screen__sideHeading">Squad</h2>
          {drones(state).map(function showDrone(unit) {
            return <UnitCard key={unit.id} unit={unit} />;
          })}
          {unreachableRooms.length === 0 ? null : (
            <p className="screen__note">
              Sealed, left without a node: {unreachableRooms.join(", ")}.
            </p>
          )}
        </aside>
      </div>

      <div className="screen__log">
        {plan?.why == null ? null : <p className="screen__hint">{plan.why}</p>}
        <MissionLog lines={lines} />
      </div>

      {pending == null || onChoose === undefined || onClear === undefined ? null : (
        <AttackChooser pending={pending} onChoose={onChoose} onCancel={onClear} />
      )}
    </div>
  );
}
