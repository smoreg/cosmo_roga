import type { CSSProperties, ReactElement } from "react";

/**
 * The drone's rack, and the pieces it is made of.
 *
 * This is where damage lands. There is no hull bar in SALVOR: a hit lands on a
 * named system, that system's integrity drops, and when it burns out its slot
 * is empty for the rest of the sortie. Underneath is the core, read as pips —
 * when the pips are gone, so is the run.
 */

export type Tone = "amber" | "good" | "warn" | "bad" | "neutral";

const TONE: Record<Tone, string> = {
  amber: "var(--sv-amber)",
  good: "var(--sv-good)",
  warn: "var(--sv-warn)",
  bad: "var(--sv-bad)",
  neutral: "var(--sv-rim)",
};

/** What integrity a number implies, so nothing has to repeat the thresholds. */
export function toneFor(value: number, max: number): Tone {
  if (max <= 0) return "neutral";
  if (value <= max * 0.34) return "bad";
  if (value < max * 0.7) return "warn";
  return "good";
}

const LABEL: CSSProperties = {
  width: 78,
  flex: "none",
  font: "var(--sv-stencil)",
  fontSize: 14,
  letterSpacing: ".14em",
  textTransform: "uppercase",
  color: "var(--sv-soft)",
};

/**
 * Integrity written the way the machine prints it: one struck mark per step of
 * capacity, lit while the module holds it and dim where it has been lost.
 *
 * Left aligned and never stretched, so two modules of different size are
 * directly comparable and no number has to restate the count.
 */
export function SlashMeter({
  label,
  value = 0,
  max = 8,
  tone = "good",
  style,
}: {
  label?: string;
  value?: number;
  max?: number;
  tone?: Tone;
  style?: CSSProperties;
}): ReactElement {
  const c = TONE[tone];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, ...style }}>
      {label === undefined ? null : <div style={LABEL}>{label}</div>}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          gap: 1,
          font: "var(--sv-value)",
          fontSize: 17,
          lineHeight: 1,
          letterSpacing: 0,
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        {Array.from({ length: max }).map((_, i) => (
          <span key={i} style={{ color: i < value ? c : "var(--sv-plate-lit)" }}>
            /
          </span>
        ))}
      </div>
    </div>
  );
}

/** Segments rather than a bar: a cell is lit or it is out, nothing partial. */
export function SegmentMeter({
  label,
  value = 0,
  max = 8,
  tone = "good",
  height = 12,
  showValue = true,
  style,
}: {
  label?: string;
  value?: number;
  max?: number;
  tone?: Tone;
  height?: number;
  showValue?: boolean;
  style?: CSSProperties;
}): ReactElement {
  const c = TONE[tone];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, ...style }}>
      {label === undefined ? null : <div style={LABEL}>{label}</div>}
      <div style={{ flex: 1, display: "flex", gap: 2 }}>
        {Array.from({ length: max }).map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              minWidth: 2,
              height,
              background: i < value ? c : "var(--sv-plate)",
            }}
          />
        ))}
      </div>
      {showValue ? (
        <div style={{ font: "var(--sv-value)", color: "var(--sv-ink)", whiteSpace: "nowrap" }}>
          {value}
          <span style={{ color: "var(--sv-soft)" }}>/{max}</span>
        </div>
      ) : null}
    </div>
  );
}

/** The core's stability as pips. The last one is the run. */
export function CorePips({
  value = 1,
  max = 3,
  size = 15,
  style,
}: {
  value?: number;
  max?: number;
  size?: number;
  style?: CSSProperties;
}): ReactElement {
  const tone =
    value <= 1 ? "var(--sv-bad)" : value < max ? "var(--sv-warn)" : "var(--sv-good)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, ...style }}>
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
          style={{
            width: size,
            height: size,
            background: i < value ? tone : "transparent",
            border: `2px solid ${i < value ? tone : "var(--sv-plate-lit)"}`,
            boxSizing: "border-box",
            /* The last pip flickers, because that one is the run. */
            animation:
              i === value - 1 && value <= 1
                ? "sv-flick var(--sv-frame-3) var(--sv-step) infinite"
                : "none",
          }}
        />
      ))}
    </div>
  );
}

export interface RackSlot {
  /** Absent when the bay is empty, whether it was ever filled or not. */
  name?: string;
  value?: number;
  max?: number;
  tone?: Tone;
}

export function CoreRack({
  core = 1,
  coreMax = 3,
  slots,
  title = "Core",
  style,
}: {
  core?: number;
  coreMax?: number;
  slots: readonly RackSlot[];
  title?: string;
  style?: CSSProperties;
}): ReactElement {
  return (
    <div style={style}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          paddingBottom: 11,
          borderBottom: "1px solid var(--sv-line)",
        }}
      >
        <div
          style={{
            font: "var(--sv-stencil)",
            letterSpacing: "var(--sv-stencil-track)",
            textTransform: "uppercase",
            color:
              core <= 1 ? "color-mix(in oklab, var(--sv-bad) 30%, var(--sv-ink))" : "var(--sv-ink)",
          }}
        >
          {title}
        </div>
        <CorePips value={core} max={coreMax} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 11 }}>
        {slots.map((slot, i) =>
          /* A burned slot and an empty slot are the same thing to look at: the
             bay is there and nothing is in it. Naming what used to be in it is
             a fact for the log, not a permanent label on the rack. */
          slot.name === undefined ? (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                height: 19,
                padding: "0 9px",
                border: "1px dotted var(--sv-rule)",
                boxSizing: "border-box",
                font: "var(--sv-stencil)",
                fontSize: 14,
                letterSpacing: ".14em",
                textTransform: "uppercase",
                color: "var(--sv-faint)",
              }}
            >
              empty
            </div>
          ) : (
            <SlashMeter
              key={i}
              label={slot.name}
              value={slot.value ?? 0}
              max={slot.max ?? 0}
              tone={slot.tone ?? toneFor(slot.value ?? 0, slot.max ?? 0)}
            />
          ),
        )}
      </div>
    </div>
  );
}

/** Alert. Five steps, and only the fifth sweeps: a printed gauge, not a bezel. */
export function AlertDial({
  value = 0,
  max = 5,
  label = "Alert",
  size = 76,
  style,
}: {
  value?: number;
  max?: number;
  label?: string;
  size?: number;
  style?: CSSProperties;
}): ReactElement {
  const c = TONE.bad;
  const seg = 360 / max;
  const deg = Math.max(0, Math.min(max, value)) * seg;
  return (
    <div
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, ...style }}
    >
      <div
        style={{
          position: "relative",
          width: size,
          height: size,
          borderRadius: "50%",
          background: "var(--sv-knock)",
          border: `1px solid ${value > 0 ? c : "var(--sv-plate-lit)"}`,
          boxSizing: "border-box",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 4,
            borderRadius: "50%",
            background: `conic-gradient(${c} 0deg ${deg}deg, color-mix(in oklab, ${c} 14%, var(--sv-knock)) ${deg}deg 360deg)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 4,
            borderRadius: "50%",
            background: `repeating-conic-gradient(from -2deg, transparent 0 ${seg - 4}deg, var(--sv-knock) ${seg - 4}deg ${seg}deg)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: Math.round(size * 0.17),
            borderRadius: "50%",
            background: "var(--sv-knock)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              font: "var(--sv-display)",
              fontSize: Math.round(size * 0.45),
              color: value > 0 ? c : "var(--sv-soft)",
              animation:
                value >= max ? "sv-flick var(--sv-frame-3) var(--sv-step) infinite" : "none",
            }}
          >
            {value}
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "var(--sv-scan)",
            pointerEvents: "none",
          }}
        />
      </div>
      <div
        style={{
          font: "var(--sv-stencil)",
          letterSpacing: "var(--sv-stencil-track)",
          textTransform: "uppercase",
          color: "var(--sv-soft)",
        }}
      >
        {label}
      </div>
    </div>
  );
}
