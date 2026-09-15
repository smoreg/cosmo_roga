import { useEffect, useRef } from "react";
import type { CSSProperties, ReactElement } from "react";
import { linesOf, reveal } from "../reveal.js";
import * as FX from "../../fx/derelict-fx.js";

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
  ...rest
}: {
  label?: string;
  value?: number;
  max?: number;
  tone?: Tone;
  style?: CSSProperties;
  /** How the rack finds this row again when this module is the one that was hit. */
  "data-slot"?: string;
}): ReactElement {
  const c = TONE[tone];
  return (
    <div {...rest} style={{ display: "flex", alignItems: "center", gap: 10, ...style }}>
      {label === undefined ? null : (
        <div data-sc style={LABEL}>
          {label}
        </div>
      )}
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
  virus,
  onStrain,
  onSlotRef,
  style,
}: {
  core?: number;
  coreMax?: number;
  slots: readonly RackSlot[];
  title?: string;
  /** The strain aboard: which bay it is living in, and what it is called. */
  virus?: { name: string; slot: number };
  /** Told when a bay with a strain in it is pointed at. */
  onStrain?: (slot: number) => void;
  /** Where the bay is on screen, so a callout can be drawn against it. */
  onSlotRef?: (slot: number, el: HTMLDivElement | null) => void;
  style?: CSSProperties;
}): ReactElement {
  const rows = useRef<HTMLDivElement>(null);
  /* What each module was worth last time this was drawn. A hit is a number
     going down, and that is the only way the rack finds out one happened:
     nothing tells it, and nothing needs to. */
  const was = useRef<(number | undefined)[]>([]);

  useEffect(function struck() {
    const now = slots.map((s) => (s.name === undefined ? undefined : (s.value ?? 0)));
    const last = was.current;
    was.current = now;
    if (rows.current === null) return;

    /*
     * The module that took the blow scrambles, and only that one.
     *
     * SALVOR has no hull bar: a hit lands on a *named* system, and the whole
     * point of that design is lost if the player has to read four numbers to
     * find out which. The scramble is the rack pointing at itself — the name
     * that went wrong is the name that breaks up — and it costs nothing when
     * motion is set to instant, which is the setting for players this would
     * be noise for.
     *
     * A slot that has just been unbolted or burned out reads as `undefined`
     * rather than as a drop, and is not a hit.
     */
    const hit: Element[] = [];
    now.forEach((value, i) => {
      const before = last[i];
      if (before === undefined || value === undefined || value >= before) return;
      const row = rows.current?.querySelector(`[data-slot="${String(i)}"]`);
      if (row !== null && row !== undefined) hit.push(...linesOf(row));
    });
    if (hit.length === 0) return;
    return reveal(hit, FX.PRESETS.value);
  });

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
      <div ref={rows} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 11 }}>
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
            <div
              key={i}
              ref={(el) => onSlotRef?.(i, el)}
              onMouseEnter={virus?.slot === i ? () => onStrain?.(i) : undefined}
              onClick={virus?.slot === i ? () => onStrain?.(i) : undefined}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                cursor: virus?.slot === i ? "pointer" : "default",
                /* The condition, kept on the row for as long as the strain is
                   aboard: a frame the player can find again after dismissing
                   what it points at. */
                ...(virus?.slot === i
                  ? { outline: "2px solid var(--sv-bad)", outlineOffset: 2 }
                  : {}),
              }}
            >
              <SlashMeter
                data-slot={String(i)}
                label={slot.name}
                value={slot.value ?? 0}
                max={slot.max ?? 0}
                tone={virus?.slot === i ? "bad" : (slot.tone ?? toneFor(slot.value ?? 0, slot.max ?? 0))}
                style={{ flex: 1, minWidth: 0 }}
              />
              {/* The strain's own name, at the end of the bay it is living in.
                  Which bay decides what to do about it: burning that module is
                  one of the three ways out. */}
              {virus?.slot !== i ? null : (
                <span
                  data-sc
                  style={{
                    flex: "none",
                    marginLeft: 8,
                    font: "var(--sv-stencil)",
                    fontSize: 14,
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                    color: "var(--sv-bad)",
                  }}
                >
                  {virus.name}
                </span>
              )}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/** Alert. Five steps, and only the fifth sweeps: a printed gauge, not a bezel. */
export function AlertDial({
  value = 0,
  max = 10,
  word = "QUIET",
  quiet = 0,
  needed = 8,
  hidden = false,
  label = "Alert",
  size = 76,
  style,
}: {
  value?: number;
  max?: number;
  /** What this rung is called. The word is the gauge; the number is a footnote. */
  word?: string;
  /** Quiet turns banked toward the next rung down. */
  quiet?: number;
  needed?: number;
  /** In cover: the climb down costs half as much, said as speed not as size. */
  hidden?: boolean;
  label?: string;
  size?: number;
  style?: CSSProperties;
}): ReactElement {
  const c = TONE.bad;
  const seg = 360 / max;
  const deg = Math.max(0, Math.min(max, value)) * seg;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, ...style }}>
      <div
        style={{
          position: "relative",
          width: size,
          height: size,
          flex: "none",
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

      {/*
        The word, and the way back down.

        A ten-rung ladder where each rung does something different is a script
        the ship is reading out, and "6" does not say which line it is on. The
        teeth under it are the only clock the mechanic has: quiet turns banked
        against the quiet turns a rung costs. Cover shows up as the count
        filling twice as fast rather than as a shorter track, because a gauge
        that changed size when the drone stepped behind a bulkhead would be
        reporting the drone and not the ship.
      */}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          data-sc
          style={{
            font: "var(--sv-title)",
            letterSpacing: "var(--sv-title-track)",
            textTransform: "uppercase",
            color: value > 0 ? "var(--sv-ink)" : "var(--sv-soft)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {word}
        </div>
        <div
          style={{
            font: "var(--sv-stencil)",
            letterSpacing: "var(--sv-stencil-track)",
            textTransform: "uppercase",
            color: "var(--sv-soft)",
            marginTop: 2,
          }}
        >
          {label}
        </div>
        {value <= 0 ? null : (
          <div style={{ marginTop: 5 }}>
            <SlashMeter
              value={Math.min(quiet, needed)}
              max={needed}
              tone={hidden ? "good" : "warn"}
            />
          </div>
        )}
      </div>
    </div>
  );
}
