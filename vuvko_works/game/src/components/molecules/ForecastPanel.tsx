import { forecast } from "../../core/combat";
import type { Weapon } from "../../core/types";
import { OddsBar } from "../atoms/OddsBar";
import { Tag } from "../atoms/Tag";

export interface ForecastPanelProps {
  readonly weapon: Weapon;
  readonly answering: Weapon | null;
  readonly attackerHp: number;
  readonly targetHp: number;
}

/**
 * The bet, stated before it is taken. This is where the design's central
 * asymmetry becomes visible: a weapon the target cannot answer costs nothing,
 * and the panel says so in as many words.
 */
export function ForecastPanel({ weapon, answering, attackerHp, targetHp }: ForecastPanelProps) {
  const odds = forecast({ weapon, answering, attackerHp, targetHp });
  const unanswered = answering === null;

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ font: "700 var(--font-sm)/var(--line-sm) var(--font-mono)" }}>
        {weapon.name} &middot; {weapon.damage}-{weapon.strikes} <Tag>{weapon.weaponClass}</Tag>
      </div>

      <OddsBar chance={odds.chanceTargetDies} label="kills it" tone="good" />
      <OddsBar chance={odds.chanceAttackerDies} label="you die" tone="bad" />

      <div
        style={{ font: "400 var(--font-xs)/var(--line-xs) var(--font-mono)", color: "var(--dim)" }}
      >
        expect <strong style={{ color: "var(--ink)" }}>{odds.expectedDealt.toFixed(1)}</strong>{" "}
        dealt, <strong style={{ color: "var(--ink)" }}>{odds.expectedTaken.toFixed(1)}</strong>{" "}
        taken
        {unanswered ? (
          <>
            {" "}
            — no {weapon.weaponClass} weapon,{" "}
            <strong style={{ color: "var(--node)" }}>it cannot answer</strong>
          </>
        ) : (
          <> — it answers with {answering.name}</>
        )}
      </div>
    </div>
  );
}
