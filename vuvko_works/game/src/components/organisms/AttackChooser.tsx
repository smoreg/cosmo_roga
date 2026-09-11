import type { PendingAttack } from "../../hooks/useMissionInput";
import { HIT_CHANCE } from "../../core/roster";
import { HitPointsBar } from "../atoms/HitPointsBar";
import { OddsBar } from "../atoms/OddsBar";
import { Tag } from "../atoms/Tag";

export interface AttackChooserProps {
  readonly pending: PendingAttack;
  readonly onChoose: (weaponIndex: number) => void;
  readonly onCancel: () => void;
}

/**
 * The bet, before it is taken.
 *
 * It blocks the turn on purpose — a chooser you can click past invites
 * half-committed moves — and it states both sides of every option, because the
 * whole point of showing real odds is that a fair fight stops feeling rigged.
 */
export function AttackChooser({ pending, onChoose, onCancel }: AttackChooserProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Attack ${pending.targetName}`}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 40,
        background: "rgba(8,10,12,.45)",
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          width: "min(320px, 100%)",
          background: "var(--panel)",
          border: "1px solid var(--rule)",
          boxShadow: "0 10px 34px rgba(0,0,0,.6)",
          padding: "13px 14px",
          display: "grid",
          gap: 10,
        }}
        onClick={function keepOpen(event) {
          event.stopPropagation();
        }}
      >
        <div>
          <strong style={{ fontSize: "var(--font-sm)" }}>Attack {pending.targetName}</strong>
          <HitPointsBar current={pending.targetHp} max={pending.targetMaxHp} showNumbers />
        </div>

        {pending.options.map(function offer(option) {
          const answering = option.odds.answering;
          return (
            <div key={option.index} style={{ display: "grid", gap: 5 }}>
              <button
                type="button"
                onClick={function choose() {
                  onChoose(option.index);
                }}
                style={{
                  font: "700 var(--font-sm)/var(--line-sm) var(--font-mono)",
                  textAlign: "left",
                  padding: "8px 9px",
                  background: "var(--ink)",
                  color: "var(--void)",
                  border: "1px solid var(--ink)",
                  cursor: "pointer",
                }}
              >
                {option.name} &middot; {option.damage}-{option.strikes}{" "}
                <Tag>{option.weaponClass}</Tag>
              </button>
              <OddsBar chance={option.odds.chanceTargetDies} label="kills it" />
              <OddsBar chance={option.odds.chanceAttackerDies} label="you die" tone="bad" />
              <div
                style={{
                  font: "400 var(--font-xs)/var(--line-xs) var(--font-mono)",
                  color: "var(--dim)",
                }}
              >
                expect <b style={{ color: "var(--ink)" }}>{option.odds.expectedDealt.toFixed(1)}</b>{" "}
                dealt, <b style={{ color: "var(--ink)" }}>{option.odds.expectedTaken.toFixed(1)}</b>{" "}
                taken
                {answering === null ? (
                  <>
                    {" "}
                    — no {option.weaponClass} weapon,{" "}
                    <b style={{ color: "var(--node)" }}>it cannot answer</b>
                  </>
                ) : (
                  <> — it answers with {answering.name}</>
                )}
              </div>
            </div>
          );
        })}

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span
            style={{
              font: "400 var(--font-xs)/var(--line-xs) var(--font-mono)",
              color: "var(--dim)",
              flex: 1,
            }}
          >
            every strike is an independent {Math.round(HIT_CHANCE * 100)}%
          </span>
          <button
            type="button"
            onClick={onCancel}
            style={{
              font: "700 var(--font-sm)/1 var(--font-body)",
              padding: "7px 11px",
              background: "transparent",
              color: "var(--ink)",
              border: "1px solid var(--rule)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
