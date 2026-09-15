import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import * as FX from "../../fx/derelict-fx.js";
import { Panel } from "../chrome/Panel.js";
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
    const running = FX.scrambleReveal(ref.current.querySelectorAll("[data-sc]"), FX.PRESETS.all);
    return () => {
      running.cancel();
    };
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
      <div style={{ width: 620, maxWidth: "94vw" }}>
        <div
          data-sc
          style={{
            font: "var(--sv-display)",
            fontSize: 72,
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
            font: "var(--sv-stencil)",
            letterSpacing: "var(--sv-stencil-track)",
            textTransform: "uppercase",
            color: "var(--sv-soft)",
            margin: "6px 0 18px",
          }}
        >
          {screen.tagline}
        </div>

        <Panel title={screen.menuHead} stencil={`seed ${String(settings.seed)}`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {rows.map((row) => (
              <div
                key={row.key}
                onClick={row.act}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background =
                    "color-mix(in oklab, var(--sv-amber) 15%, transparent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 12,
                  padding: "8px 10px",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    width: 15,
                    flex: "none",
                    font: "var(--sv-stencil)",
                    color: "var(--sv-amber)",
                  }}
                >
                  {row.key}
                </span>
                <span data-sc style={{ font: "var(--sv-body)", color: "var(--sv-ink)" }}>
                  {row.label}
                </span>
                <span
                  data-sc
                  style={{
                    marginLeft: "auto",
                    font: "var(--sv-stencil)",
                    letterSpacing: "var(--sv-stencil-track)",
                    textTransform: "uppercase",
                    color: "var(--sv-soft)",
                  }}
                >
                  {row.value}
                </span>
              </div>
            ))}
          </div>

          {typing === undefined ? null : (
            <div
              style={{
                marginTop: 10,
                paddingTop: 10,
                borderTop: "1px solid var(--sv-line)",
                display: "flex",
                flexWrap: "wrap",
                gap: 4,
              }}
            >
              {"0123456789".split("").map((d) => (
                <span
                  key={d}
                  onClick={() => digit(d)}
                  style={{
                    width: 30,
                    textAlign: "center",
                    padding: "4px 0",
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
                  padding: "4px 10px",
                  font: "var(--sv-stencil)",
                  letterSpacing: "var(--sv-stencil-track)",
                  textTransform: "uppercase",
                  background: "var(--sv-amber)",
                  color: "var(--sv-knock)",
                  cursor: "pointer",
                }}
              >
                set · {SEED_DIGITS} digits
              </span>
            </div>
          )}
        </Panel>

        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 3 }}>
          {[...screen.hints, screen.keysHead, ...screen.keys].map((line, i) => (
            <div
              key={i}
              data-sc
              style={{
                font: i === 0 ? "var(--sv-body)" : "var(--sv-stencil)",
                letterSpacing: i === 0 ? undefined : "var(--sv-stencil-track)",
                textTransform: i === 0 ? undefined : "uppercase",
                color: i === 0 ? "var(--sv-fg)" : "var(--sv-soft)",
              }}
            >
              {line}
            </div>
          ))}
          <div
            data-sc
            style={{
              marginTop: 10,
              font: "var(--sv-stencil)",
              letterSpacing: "var(--sv-stencil-track)",
              textTransform: "uppercase",
              color: "var(--sv-line)",
            }}
          >
            {screen.foot}
          </div>
        </div>
      </div>
    </div>
  );
}
