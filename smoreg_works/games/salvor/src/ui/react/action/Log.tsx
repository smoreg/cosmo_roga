import { useEffect, useRef } from "react";
import type { CSSProperties, ReactElement } from "react";
import { linesOf, reveal } from "../reveal.js";
import * as FX from "../../fx/derelict-fx.js";
import { t } from "../../../i18n.js";

export interface LogEntry {
  /**
   * The turn the line was written on, printed in the amber tab's colour.
   *
   * It was the first segment of the line's key — and that is `log` on three
   * lines in four, `engine` on most of the rest and `hint` on a dozen a run,
   * so the column was saying almost nothing, and saying it in English on a
   * Russian screen. A turn number says something (a ship's log is kept by the
   * turn, and two lines of the same turn happened together) and says it the
   * same in all three languages.
   */
  turn: number;
  text: string;
  tone?: "bad" | "warn";
}

const ink = (tone: LogEntry["tone"]): string =>
  tone === "bad"
    ? "color-mix(in oklab, var(--sv-bad) 30%, var(--sv-ink))"
    : tone === "warn"
      ? "var(--sv-warn)"
      : "var(--sv-fg)";

/**
 * The log: a ticker bolted to the bottom of the screen, and the record behind
 * it.
 *
 * Expanding it overlays the record *upward* over whatever is above rather than
 * taking layout space, so the board does not resize under you when you open it.
 *
 * Two reveals, and the difference between them is the whole point. The ticker
 * resolves whenever a new line arrives, because that is news. The record
 * resolves all at once when it opens, because it was already written — a log
 * you have to wait through is a log you stop opening.
 */
export function LogStrip({
  entries,
  expanded = false,
  onToggle,
  height = 30,
  style,
}: {
  entries: readonly LogEntry[];
  expanded?: boolean;
  onToggle?: () => void;
  height?: number;
  style?: CSSProperties;
}): ReactElement {
  const last: LogEntry = entries[0] ?? { turn: 0, text: "" };
  const recordRef = useRef<HTMLDivElement>(null);
  const tickerRef = useRef<HTMLDivElement>(null);

  useEffect(
    function openRecord() {
      if (!expanded || recordRef.current === null) return;
      return reveal(linesOf(recordRef.current), FX.PRESETS.all);
    },
    [expanded],
  );

  useEffect(
    function resolveNews() {
      if (tickerRef.current === null) return;
      return reveal(linesOf(tickerRef.current), FX.PRESETS.hover);
    },
    [last.text, last.turn],
  );

  return (
    <div
      style={{
        position: "relative",
        background: "var(--sv-plate)",
        borderTop: "1px solid var(--sv-line)",
        fontFamily: "var(--sv-font-mono)",
        ...style,
      }}
    >
      {expanded ? (
        <div
          ref={recordRef}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: "100%",
            maxHeight: 260,
            overflow: "auto",
            padding: "10px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 7,
            background: "var(--sv-knock)",
            borderTop: "1px solid var(--sv-line)",
            zIndex: 30,
            boxShadow: "var(--sv-cast)",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "var(--sv-scan)",
              pointerEvents: "none",
            }}
          />
          {entries.map((e, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
              <div
                data-sc
                style={{
                  width: 70,
                  flex: "none",
                  font: "var(--sv-stencil)",
                  fontSize: 14,
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  color: i === 0 ? "var(--sv-amber)" : "var(--sv-soft)",
                }}
              >
                {e.turn}
              </div>
              <div
                data-sc
                style={{ font: "var(--sv-body)", color: i === 0 ? "var(--sv-ink)" : ink(e.tone) }}
              >
                {e.text}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div
        onClick={onToggle}
        style={{
          height,
          display: "flex",
          alignItems: "center",
          cursor: onToggle === undefined ? "default" : "pointer",
        }}
      >
        <div
          style={{
            alignSelf: "stretch",
            display: "flex",
            alignItems: "center",
            padding: "0 12px",
            background: "var(--sv-amber)",
            clipPath: "polygon(0 0,100% 0,100% 100%,6px 100%,0 calc(100% - 6px))",
            font: "var(--sv-stencil)",
            fontSize: 14,
            letterSpacing: "var(--sv-stencil-track)",
            textTransform: "uppercase",
            color: "var(--sv-knock)",
            whiteSpace: "nowrap",
          }}
        >
          {t("help.name.log")}
        </div>
        <div
          ref={tickerRef}
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "0 14px",
          }}
        >
          <div
            data-sc
            style={{
              flex: "none",
              font: "var(--sv-stencil)",
              fontSize: 14,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              color: "var(--sv-amber)",
            }}
          >
            {last.turn}
          </div>
          <div
            data-sc
            style={{
              font: "var(--sv-body)",
              color: "var(--sv-fg)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {last.text}
          </div>
          <div
            style={{
              marginLeft: "auto",
              flex: "none",
              font: "var(--sv-stencil)",
              fontSize: 14,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              color: "var(--sv-soft)",
              whiteSpace: "nowrap",
            }}
          >
            {expanded ? t("react.close") : t("react.log.kept", { n: entries.length })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The one commit a turn has, built as hardware: a printed slab, ink reversed. */
export function Lever({
  label,
  hint,
  ready = false,
  disabled = false,
  width = 186,
  height = 62,
  onClick,
  style,
}: {
  label: string;
  hint?: string;
  ready?: boolean;
  disabled?: boolean;
  width?: number;
  height?: number;
  onClick?: () => void;
  style?: CSSProperties;
}): ReactElement {
  const c = disabled ? "var(--sv-plate-lit)" : "var(--sv-amber)";
  const ink2 = disabled ? "var(--sv-soft)" : "var(--sv-knock)";
  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={{
        position: "relative",
        width,
        height,
        clipPath: "var(--sv-cut-bl)",
        background: c,
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        animation: ready ? "sv-flick var(--sv-frame-3) var(--sv-step) infinite" : "none",
        ...style,
      }}
    >
      <div
        style={{ position: "absolute", inset: 0, background: "var(--sv-scan)", pointerEvents: "none" }}
      />
      <div
        style={{
          position: "relative",
          font: "var(--sv-display)",
          fontSize: 27,
          letterSpacing: "var(--sv-display-track)",
          textTransform: "uppercase",
          color: ink2,
        }}
      >
        {label}
      </div>
      {hint === undefined ? null : (
        <div
          style={{
            position: "relative",
            font: "var(--sv-stencil)",
            letterSpacing: "var(--sv-stencil-track)",
            textTransform: "uppercase",
            color: ink2,
            opacity: 0.75,
          }}
        >
          [{hint}]
        </div>
      )}
    </div>
  );
}
