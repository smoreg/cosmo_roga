import { useEffect, useState } from "react";
import { PRESETS, setAndReveal } from "../../vendor/derelict-fx";
import { quicken } from "../../lib/tempo";
import { cancelOn } from "../../lib/running";
import { bindKeys } from "../../lib/keys";
import "./ConfirmEndTurn.css";

export interface ConfirmEndTurnProps {
  /** The drones that still have somewhere to go, named and counted. */
  readonly idle: readonly { readonly name: string; readonly movement: number }[];
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

/** "Drone 1 has 4 move points and Drone 2 has 2." */
function tally(idle: ConfirmEndTurnProps["idle"]): string {
  const parts = idle.map(function say(drone) {
    return `${drone.name} has ${String(drone.movement)}`;
  });
  const list =
    parts.length < 2
      ? (parts[0] ?? "")
      : `${parts.slice(0, -1).join(", ")} and ${String(parts.at(-1))}`;
  return `${list} move ${idle.length === 1 && idle[0]?.movement === 1 ? "point" : "points"}. They hold position and the ship acts next.`;
}

/**
 * The turn is nearly free to end and impossible to take back.
 *
 * Ending a turn seals the history — the ship rolls, and a roll cannot be
 * replayed — so it is the one action in the game that undo will not reach.
 * That is exactly when a game owes the player a question, and the kit asks it:
 * not on every end turn, only when a drone still had somewhere to go.
 */
export function ConfirmEndTurn({ idle, onCancel, onConfirm }: ConfirmEndTurnProps) {
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);

  useEffect(
    function ask() {
      if (panel === null) return;
      const running = setAndReveal(
        panel.querySelectorAll("[data-sc-line]"),
        ["End the turn?", tally(idle)],
        quicken(PRESETS.panel),
      );
      return cancelOn(running);
    },
    [panel, idle],
  );

  useEffect(
    function listenForEscape() {
      return bindKeys(function onKey(event) {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onCancel();
      });
    },
    [onCancel],
  );

  return (
    <>
      <div className="confirm__dim" onClick={onCancel} />
      <div className="confirm" ref={setPanel} role="dialog" aria-modal="true">
        {/* Both lines are written by the reveal, not by React: the kit fills
            them out of block glyphs and an element React keeps re-asserting
            the text of would fight it. */}
        <div className="confirm__title" data-sc-line="1" />
        <div className="confirm__body" data-sc-line="1" />
        <div className="confirm__acts">
          <button type="button" className="confirm__button" onClick={onCancel}>
            Keep playing
          </button>
          <button
            type="button"
            className="confirm__button confirm__button--go"
            onClick={onConfirm}
            autoFocus
          >
            End turn
          </button>
        </div>
      </div>
    </>
  );
}
