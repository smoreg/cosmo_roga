import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { linesOf, reveal } from "../reveal.js";
import * as FX from "../../fx/derelict-fx.js";
import { SEED_DIGITS, seedTyped, titleScreen } from "../../title.js";
import type { TitleSettings } from "../../title.js";

/**
 * The screen the game opens on, and the only one that exists before a run.
 *
 * `titleScreen` decides what the menu says — the rows, their order, what each
 * one answers with — so this draws that and owns nothing but the digits being
 * typed into the seed. A title that built its own list would be a second menu
 * to keep in step with the reducer's idea of which row is which.
 */
export function TitleScreen({
  settings,
  onVoyage,
  onTraining,
  onHelp,
  onSound,
  onSeed,
}: {
  settings: TitleSettings;
  onVoyage: (seed: number) => void;
  onTraining: (seed: number) => void;
  onHelp: () => void;
  onSound: (on: boolean) => void;
  onSeed: (seed: number) => void;
}): ReactElement {
  const [typing, setTyping] = useState<string | undefined>(undefined);
  const screen = titleScreen(settings, typing);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(function resolve() {
    if (ref.current === null) return;
    return reveal(linesOf(ref.current), FX.PRESETS.all);
  }, []);

  /* Typing a seed is the one thing the title holds state for, and it holds it
     the way the reducer does: digits, clamped, and committed on the way out. */
  const digit = (d: string): void => setTyping((now) => seedTyped(now ?? "", d));
  const commit = (): void => {
    if (typing !== undefined && typing.length > 0) onSeed(Number(typing) >>> 0);
    setTyping(undefined);
  };

  const rows: Array<{ key: string; label: string; value: string; act: () => void }> =
    screen.items.map((item, i) => ({
      key: item.key,
      label: item.label,
      value: item.value ?? "",
      act: [
        () => onVoyage(settings.seed),
        () => onTraining(settings.seed),
        onHelp,
        () => setTyping(typing === undefined ? "" : undefined),
        () => onSound(!settings.sound),
      ][i] ?? ((): void => undefined),
    }));

  const eyebrow = screen.hints[0] ?? "";

  return (
    <div
      ref={ref}
      onKeyDown={(e) => {
        if (typing === undefined) return;
        if (/^[0-9]$/.test(e.key)) digit(e.key);
        else if (e.key === "Enter" || e.key === "Escape") commit();
      }}
      tabIndex={-1}
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "radial-gradient(ellipse 70% 62% at 50% 44%, var(--sv-deck) 0%, var(--sv-deep) 76%)",
        userSelect: "none",
        outline: "none",
      }}
    >
      {/* The other half's arrangement in this half's materials: an eyebrow, the
          name at display size, one line about what the game is, and the choices
          stacked full width underneath — the first solid, the rest ghosted.
          A menu of five things does not need five key hints and a rule between
          them; it needs one obvious way in and four quieter ones. */}
      <div style={{ width: 460, maxWidth: "92vw" }}>
        <div
          data-sc
          style={{
            ...STENCIL,
            color: "var(--sv-soft)",
            marginBottom: 12,
          }}
        >
          {screen.tagline}
        </div>

        <div
          data-sc
          style={{
            font: "var(--sv-display)",
            fontSize: 62,
            letterSpacing: "var(--sv-display-track)",
            textTransform: "uppercase",
            color: "var(--sv-amber)",
            lineHeight: 1,
          }}
        >
          {screen.name}
        </div>

        <div
          data-sc
          style={{
            font: "var(--sv-body)",
            color: "var(--sv-fg)",
            margin: "12px 0 24px",
            maxWidth: "48ch",
          }}
        >
          {eyebrow}
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {rows.map((row, i) => (
            <Choice
              key={row.key}
              label={row.label}
              value={row.value}
              first={i === 0}
              onPick={row.act}
            />
          ))}
        </div>

        {typing === undefined ? null : (
          <div
            style={{
              marginTop: 12,
              display: "flex",
              flexWrap: "wrap",
              gap: 4,
              alignItems: "center",
            }}
          >
            {"0123456789".split("").map((d) => (
              <span
                key={d}
                onClick={() => digit(d)}
                style={{
                  width: 34,
                  textAlign: "center",
                  padding: "6px 0",
                  font: "var(--sv-stencil)",
                  background: "var(--sv-plate)",
                  color: "var(--sv-ink)",
                  cursor: "pointer",
                }}
              >
                {d}
              </span>
            ))}
            <span
              onClick={commit}
              style={{
                marginLeft: "auto",
                padding: "6px 12px",
                ...STENCIL,
                background: "var(--sv-amber)",
                color: "var(--sv-knock)",
                cursor: "pointer",
              }}
            >
              set · {SEED_DIGITS} digits
            </span>
          </div>
        )}

        <div
          data-sc
          style={{
            marginTop: 26,
            ...STENCIL,
            color: "var(--sv-line)",
          }}
        >
          {screen.foot}
        </div>
      </div>
    </div>
  );
}

const STENCIL = {
  font: "var(--sv-stencil)",
  letterSpacing: "var(--sv-stencil-track)",
  textTransform: "uppercase",
} as const;

/**
 * One way in, full width.
 *
 * The first is solid and the rest are ghosted, which is the whole of the
 * hierarchy: a title screen has one thing almost everybody came to do. The
 * corner is the one every pressable thing in this game has, and the row keeps
 * its answer on the right — a seed, an on or an off — because a choice that
 * cannot say what it is currently set to is a choice you have to open to read.
 */
function Choice({
  label,
  value,
  first,
  onPick,
}: {
  label: string;
  value: string;
  first: boolean;
  onPick: () => void;
}): ReactElement {
  return (
    <div
      onClick={onPick}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = first
          ? "var(--sv-amber-hi)"
          : "color-mix(in oklab, var(--sv-amber) 14%, transparent)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = first ? "var(--sv-amber)" : "transparent";
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "13px 16px",
        cursor: "pointer",
        clipPath: "var(--sv-cut-bl)",
        background: first ? "var(--sv-amber)" : "transparent",
        border: first ? "none" : "1px solid var(--sv-line)",
        color: first ? "var(--sv-knock)" : "var(--sv-ink)",
      }}
    >
      <span
        data-sc
        style={{
          font: "var(--sv-title)",
          letterSpacing: "var(--sv-title-track)",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      {value === "" ? null : (
        <span
          data-sc
          style={{
            marginLeft: "auto",
            ...STENCIL,
            opacity: first ? 0.8 : 1,
            color: first ? "var(--sv-knock)" : "var(--sv-soft)",
          }}
        >
          {value}
        </span>
      )}
    </div>
  );
}
