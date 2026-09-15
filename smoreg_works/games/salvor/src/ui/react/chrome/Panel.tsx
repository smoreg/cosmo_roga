import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { linesOf, reveal } from "../reveal.js";
import * as FX from "../../fx/derelict-fx.js";
import { t } from "../../../i18n.js";
import type { Tone } from "../meters/Rack.js";

/**
 * The housing everything on screen is mounted in.
 *
 * The design system carries five materials — plate, stencil, bracket, riveted
 * and readout — each answering a different tell from the audit that found the
 * old screens reading as an admin panel. Only `readout` is here, because it is
 * the one the screens chose and a game that ships two house styles has no house
 * style. The other four stay in the design system, which is where an
 * exploration belongs.
 *
 * Readout is the machine's own printout: the title knocked out of a solid
 * accent strip, scanlines over the body, one clipped corner. No gradients and
 * no drop shadows anywhere in the chrome — the board carries the lighting,
 * because the board is the world and this is not.
 */
const TONE: Record<Tone, string> = {
  amber: "var(--sv-amber)",
  good: "var(--sv-good)",
  warn: "var(--sv-warn)",
  bad: "var(--sv-bad)",
  neutral: "var(--sv-rim)",
};

export function Panel({
  title,
  stencil,
  tone = "amber",
  notch = 16,
  width,
  fill = false,
  children,
  style,
}: {
  title?: string;
  stencil?: string;
  tone?: Tone;
  notch?: number;
  width?: number;
  fill?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
}): ReactElement {
  const c = TONE[tone];
  const [hot, setHot] = useState(false);

  /* On hover the housing draws its own border out from the middle of each
     edge, in held frames rather than a transition. The title does not
     descramble: resolving text is for a panel that has just appeared, and this
     one was already here. */
  const line = (o: CSSProperties): CSSProperties => ({
    position: "absolute",
    background: c,
    zIndex: 12,
    pointerEvents: "none",
    transformOrigin: "center",
    ...o,
  });
  const draw = (axis: "x" | "y"): string =>
    `sv-draw-${axis} var(--sv-frame) var(--sv-step) 1 both`;

  const filled: CSSProperties = fill
    ? { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }
    : {};

  return (
    <div
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      style={{
        position: "relative",
        width,
        clipPath: `polygon(0 0, 100% 0, 100% 100%, ${notch}px 100%, 0 calc(100% - ${notch}px))`,
        background: "var(--sv-deep)",
        boxShadow: "var(--sv-cast)",
        fontFamily: "var(--sv-font-mono)",
        color: "var(--sv-fg)",
        ...(fill ? { display: "flex", flexDirection: "column" } : {}),
        ...style,
      }}
    >
      {hot ? (
        <>
          <div style={line({ left: 0, right: 0, top: 0, height: 2, animation: draw("x") })} />
          <div style={line({ left: 0, right: 0, bottom: 0, height: 2, animation: draw("x") })} />
          <div style={line({ top: 0, bottom: 0, left: 0, width: 2, animation: draw("y") })} />
          <div style={line({ top: 0, bottom: 0, right: 0, width: 2, animation: draw("y") })} />
        </>
      ) : null}

      {title === undefined && stencil === undefined ? null : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "3px 12px",
            background: c,
          }}
        >
          {title === undefined ? null : (
            <div
              style={{
                font: "var(--sv-title)",
                letterSpacing: "var(--sv-title-track)",
                textTransform: "uppercase",
                color: "var(--sv-knock)",
              }}
            >
              {title}
            </div>
          )}
          {stencil === undefined ? null : (
            <div
              style={{
                marginLeft: "auto",
                font: "var(--sv-stencil)",
                letterSpacing: "var(--sv-stencil-track)",
                textTransform: "uppercase",
                color: "var(--sv-knock)",
                opacity: 0.78,
              }}
            >
              {stencil}
            </div>
          )}
          <div style={{ width: 8, height: 15, background: "var(--sv-knock)" }} />
        </div>
      )}

      <div style={{ position: "relative", padding: "12px 14px 15px", ...filled }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "var(--sv-scan)",
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "relative", ...filled }}>{children}</div>
      </div>
    </div>
  );
}

/** A printed label: ink knocked out of a fill, one corner clipped. */
export function Tag({
  tone = "neutral",
  solid = false,
  children,
  style,
}: {
  tone?: Tone;
  solid?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
}): ReactElement {
  const c = TONE[tone];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 8px",
        font: "var(--sv-stencil)",
        letterSpacing: "var(--sv-stencil-track)",
        textTransform: "uppercase",
        clipPath: "polygon(0 0,100% 0,100% 100%,6px 100%,0 calc(100% - 6px))",
        background: solid ? c : `color-mix(in oklab, ${c} 24%, var(--sv-knock))`,
        color: solid ? "var(--sv-knock)" : c,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export interface SheetRow {
  key?: string;
  label: string;
  note?: string;
  onPick?: () => void;
}

/**
 * A menu is a plate bolted over the view, never a dialog beside it. It slides
 * in over four held frames and resolves its own text on arrival — appearing is
 * the animation, so there is no separate state to track.
 */
export function MenuSheet({
  title,
  stencil,
  rows = [],
  onBack,
  onClose,
  width = 360,
  leaving = false,
  children,
  style,
}: {
  title?: string;
  stencil?: string;
  rows?: readonly SheetRow[];
  onBack?: () => void;
  onClose?: () => void;
  width?: number;
  leaving?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(
    function resolve() {
      if (leaving || ref.current === null) return;
      return reveal(linesOf(ref.current), FX.PRESETS.sheet);
    },
    [leaving],
  );

  return (
    <div
      ref={ref}
      style={{
        height: "100%",
        animation: `${leaving ? "sv-slide-out" : "sv-slide-in"} var(--sv-frame) var(--sv-step) 1 both`,
      }}
    >
      <Panel title={title} stencil={stencil} width={width} fill style={{ height: "100%", ...style }}>
        {children}
        {rows.length === 0 ? null : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {rows.map((row, i) => (
              <div
                key={i}
                onClick={row.onPick}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background =
                    "color-mix(in oklab, var(--sv-amber) 16%, transparent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "7px 9px",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    width: 13,
                    flex: "none",
                    font: "var(--sv-stencil)",
                    fontSize: 14,
                    letterSpacing: 0,
                    color: "var(--sv-amber)",
                  }}
                >
                  {row.key ?? "·"}
                </span>
                <span data-sc style={{ font: "var(--sv-body)", color: "var(--sv-ink)" }}>
                  {row.label}
                </span>
                {row.note === undefined ? null : (
                  <span
                    data-sc
                    style={{
                      marginLeft: "auto",
                      font: "var(--sv-stencil)",
                      fontSize: 14,
                      letterSpacing: ".1em",
                      textTransform: "uppercase",
                      color: "var(--sv-soft)",
                    }}
                  >
                    {row.note}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        {onBack === undefined && onClose === undefined ? null : (
          <div
            style={{
              display: "flex",
              gap: 8,
              marginTop: "auto",
              paddingTop: 12,
              borderTop: "1px solid var(--sv-line)",
            }}
          >
            {onBack === undefined ? null : (
              <span
                onClick={onBack}
                style={{
                  font: "var(--sv-stencil)",
                  fontSize: 14,
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                  background: "var(--sv-amber)",
                  color: "var(--sv-knock)",
                  padding: "3px 9px",
                  cursor: "pointer",
                }}
              >
                {t("action.backRoom")}
              </span>
            )}
            {onClose === undefined ? null : (
              <span
                onClick={onClose}
                style={{
                  marginLeft: "auto",
                  font: "var(--sv-stencil)",
                  fontSize: 14,
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                  color: "var(--sv-soft)",
                  cursor: "pointer",
                }}
              >
                {t("react.close")}
              </span>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

export interface RailItem {
  id: string;
  glyph: string;
  title: string;
}

/** The left rail: printed keys on a flat strip, the active one knocked out. */
export function Rail({
  items,
  active,
  onSelect,
  width = 46,
  style,
}: {
  items: readonly RailItem[];
  active?: string;
  onSelect?: (id: string) => void;
  width?: number;
  style?: CSSProperties;
}): ReactElement {
  return (
    <div
      style={{
        width,
        background: "var(--sv-knock)",
        borderRight: "1px solid var(--sv-line)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "10px 0",
        gap: 6,
        ...style,
      }}
    >
      {items.map((it) => (
        <div
          key={it.id}
          title={it.title}
          onClick={() => onSelect?.(it.id)}
          style={{
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            clipPath: "polygon(0 0,100% 0,100% 100%,6px 100%,0 calc(100% - 6px))",
            background: active === it.id ? "var(--sv-amber)" : "var(--sv-deck)",
            color: active === it.id ? "var(--sv-knock)" : "var(--sv-soft)",
            font: "var(--sv-stencil)",
          }}
        >
          {it.glyph}
        </div>
      ))}
    </div>
  );
}
