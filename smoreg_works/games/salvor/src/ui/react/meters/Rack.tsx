import type { CSSProperties, ReactElement } from "react";
import { t } from "../../../i18n.js";

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

/**
 * The column a module is named in.
 *
 * Wide enough for the longest name in any of the three languages — ten
 * characters is what `tests/i18n.test.ts` holds every module to, and at this
 * size and tracking ten characters is 104px. It was 78, which cut `THRUSTERS`
 * in English and `ИЗЛУЧАТЕЛЬ` in Russian across the meter beside it. Fixed
 * rather than fitted to the content, because the meters have to start at the
 * same x or two modules cannot be compared by eye, which is the whole point of
 * drawing them as struck marks.
 */
const LABEL: CSSProperties = {
  width: 112,
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
  /* Read at call time, not at module load: the language can change mid-run. */
  title = t("react.core"),
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
              {t("react.slot.empty")}
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

/**
 * The alert, as the ladder it is: ten rungs, in the ship's own words.
 *
 * It was a dial of five, which is the gauge the game had before the ladder was
 * built (`systems/alert.ts`, `MAX_LEVEL`) — and a dial can only ever say *how
 * far*, never *what next*, which is the question the top of this one is
 * entirely about. So it is drawn the way the corner of the graphic view draws
 * it (`ui/web/panel-html.ts`, `cornerHtml`): passed rungs go dim, the one the
 * ship is on takes the gauge's colour, and the rest wait in between.
 *
 * Under the rungs stand the things the last two of them put aboard: the hunter,
 * every charge burning with the turns left on it, and — once the hull has armed
 * itself — how long there is before it goes, which is the one number on this
 * screen that is counting down towards the end of the run.
 *
 * The component holds no rule and no threshold. Which rung is lit, what each is
 * called, what is burning and what the countdown stands at all arrive decided
 * (`ui/react/model.ts`, `alertOf`).
 */
export interface AlertLadderModel {
  level: number;
  max: number;
  rungs: readonly string[];
  word: string;
  off: boolean;
  boom?: number;
  charging: boolean;
  hunter: boolean;
  fuses: ReadonlyArray<{ room: string; turns: number }>;
}

export function AlertLadder({
  alert,
  label = t("react.stat.alert"),
  style,
}: {
  alert: AlertLadderModel;
  label?: string;
  style?: CSSProperties;
}): ReactElement {
  const tone = alert.off
    ? "var(--sv-good)"
    : alert.charging
      ? "var(--sv-bad)"
      : alert.level >= 5
        ? "var(--sv-warn)"
        : "var(--sv-amber)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, ...style }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            font: "var(--sv-stencil)",
            letterSpacing: "var(--sv-stencil-track)",
            textTransform: "uppercase",
            color: "var(--sv-soft)",
          }}
        >
          {label}
        </span>
        <span style={{ font: "var(--sv-mono)", fontSize: 13, letterSpacing: 0, color: tone }}>
          {"▮".repeat(alert.level) + "▯".repeat(Math.max(0, alert.max - alert.level))}
        </span>
        {alert.boom === undefined ? null : (
          <span
            style={{
              marginLeft: "auto",
              font: "var(--sv-display)",
              fontSize: 19,
              letterSpacing: "var(--sv-display-track)",
              color: "var(--sv-bad)",
              animation: "sv-flick var(--sv-frame-3) var(--sv-step) infinite",
            }}
          >
            {alert.boom}
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {alert.rungs.map((word, i) => {
          const at = i + 1;
          const now = at === alert.level;
          return (
            <div
              key={at}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 6,
                font: now ? "var(--sv-stencil)" : "var(--sv-body)",
                letterSpacing: now ? "var(--sv-stencil-track)" : undefined,
                textTransform: "uppercase",
                color: now ? tone : at < alert.level ? "var(--sv-soft)" : "var(--sv-line)",
              }}
            >
              <span style={{ font: "var(--sv-mono)", fontSize: 12, letterSpacing: 0 }}>
                {at <= alert.level ? "▮" : "▯"}
              </span>
              <span>{word}</span>
            </div>
          );
        })}
      </div>

      {alert.hunter ? (
        <div
          style={{
            font: "var(--sv-stencil)",
            letterSpacing: "var(--sv-stencil-track)",
            textTransform: "uppercase",
            color: "var(--sv-bad)",
          }}
        >
          {t("panel.hunter")}
        </div>
      ) : null}

      {alert.fuses.map((fuse) => (
        <div
          key={fuse.room}
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            font: "var(--sv-stencil)",
            letterSpacing: "var(--sv-stencil-track)",
            textTransform: "uppercase",
            color: "var(--sv-bad)",
          }}
        >
          <span>{t("react.alert.charge", { room: fuse.room })}</span>
          <span style={{ marginLeft: "auto", font: "var(--sv-display)", fontSize: 16 }}>
            {fuse.turns}
          </span>
        </div>
      ))}
    </div>
  );
}
