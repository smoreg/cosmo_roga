import { useEffect, useState } from "react";
import { useReveal } from "../../hooks/useReveal";
import { hexKey } from "../../core/hex";
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
  /** What the squad was sent to do, shown behind the `i`. */
  readonly objective?: string | undefined;
  readonly muted?: boolean | undefined;
  readonly onMute?: ((muted: boolean) => void) | undefined;
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
  const { canUndo = false, onUndo, objective, muted = false, onMute } = props;

  const [logOpen, setLogOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [tab, setTab] = useState<"tile" | "unit">("unit");
  const last = lines.at(-1);
  /* The two things that reveal rather than appear.

     The log line is the machine reporting, and it lands after the thing it
     reports — the `log` preset is 360ms of stagger before four ticks. The turn
     number is the only number that scrambles, because its change *is* the
     event; hit points and pool cut, per `design/ui-kit/motion.md` §2, since a
     840ms reveal is longer than the strike it describes. */
  const logRef = useReveal(last?.text ?? "Boarded.", "log");
  const turnRef = useReveal(String(state.turn), "value");
  const room =
    selected == null ? undefined : deck.zones.get(deck.cells.get(hexKey(selected))?.zoneId ?? -1);
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

      {/* Two buttons, and only two.

          The kit's rail has three — menu, information, sound — and there is no
          menu behind the first that is not either a dead end or a way to lose a
          mission by misclick. An option that is never the interesting one is
          the chaff `design/tactical-diversity.md` is about, and a button is an
          option. */}
      <nav className="screen__rail" aria-label="View">
        <button
          type="button"
          className="screen__railButton"
          aria-pressed={briefOpen}
          title="What you were sent for"
          onClick={function showBrief() {
            setBriefOpen(!briefOpen);
          }}
        >
          i
        </button>
        {onMute === undefined ? null : (
          <button
            type="button"
            className="screen__railButton"
            aria-pressed={muted}
            title={muted ? "Sound off" : "Sound on"}
            onClick={function toggleMute() {
              onMute(!muted);
            }}
          >
            {muted ? "◁" : "◁))"}
          </button>
        )}
      </nav>

      {briefOpen && objective !== undefined ? (
        <aside className="screen__card screen__brief">
          <h2 className="screen__sideHeading">Contract</h2>
          <p className="screen__briefText">{objective}</p>
        </aside>
      ) : null}

      <header className="screen__card screen__title">
        <span className="screen__ship">{deck.name}</span>
        <span className="screen__stats">
          turn <b ref={turnRef} /> · pool <b>{round(state.pool)}</b> · spawn zones{" "}
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

      {/* What you picked up, as the kit's two tabs.

          The squad was a permanent column listing every drone, and each drone's
          hit points are already drawn on its own token — it repeated the map at
          the cost of a quarter of the screen. This appears when you select
          something and goes when you clear, which is what both artboards do:
          4a shows nothing because nothing is selected, 4b shows the pair of
          tabs because something is. */}
      {room === undefined ? null : (
        <aside className="screen__card screen__side">
          <div className="screen__tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "tile"}
              className="screen__tab"
              onClick={function pickTile() {
                setTab("tile");
              }}
            >
              Tile
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "unit"}
              className="screen__tab"
              disabled={chosen === undefined}
              onClick={function pickUnit() {
                setTab("unit");
              }}
            >
              Unit
            </button>
          </div>
          {tab === "unit" && chosen !== undefined ? (
            <UnitCard unit={chosen} />
          ) : (
            <dl className="screen__facts">
              <dt>Room</dt>
              <dd>{room.name}</dd>
              <dt>Kind</dt>
              <dd>{room.kind}</dd>
              {room.hazard === null ? null : (
                <>
                  <dt>Hazard</dt>
                  <dd style={{ color: "var(--stamp)" }}>{room.hazard}</dd>
                </>
              )}
            </dl>
          )}
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
          <span className="screen__logLast" ref={logRef} />
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
