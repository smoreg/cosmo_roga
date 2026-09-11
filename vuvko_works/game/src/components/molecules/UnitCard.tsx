import { ROSTER } from "../../core/roster";
import type { Unit } from "../../core/types";
import { HitPointsBar } from "../atoms/HitPointsBar";
import { Tag } from "../atoms/Tag";

export interface UnitCardProps {
  readonly unit: Unit;
  readonly heldInPlace?: boolean;
}

export function UnitCard({ unit, heldInPlace = false }: UnitCardProps) {
  const profile = ROSTER[unit.type];
  const accent = unit.side === "drone" ? "var(--drone)" : "var(--ship)";

  return (
    <div style={{ display: "grid", gap: 6, minWidth: 220 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <strong style={{ color: accent }}>{unit.name}</strong>
        <span style={{ font: "400 var(--font-xs)/1 var(--font-mono)", color: "var(--dim)" }}>
          {profile.label}
        </span>
      </div>

      <HitPointsBar current={unit.hp} max={unit.maxHp} showNumbers />

      <div
        style={{ font: "400 var(--font-xs)/var(--line-xs) var(--font-mono)", color: "var(--dim)" }}
      >
        move {unit.movement}/{unit.maxMovement}
        {unit.hasAttacked ? " · has attacked" : ""}
      </div>

      <div>
        {profile.weapons.map(function showWeapon(weapon) {
          return (
            <Tag key={weapon.name}>
              {weapon.name} {weapon.damage}-{weapon.strikes}
            </Tag>
          );
        })}
      </div>

      {heldInPlace ? (
        <div
          style={{
            font: "400 var(--font-xs)/var(--line-xs) var(--font-mono)",
            color: "var(--door)",
          }}
        >
          Held in a zone of control.
        </div>
      ) : null}
    </div>
  );
}
