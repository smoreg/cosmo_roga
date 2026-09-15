import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import * as FX from "../../fx/derelict-fx.js";
import { Panel, Tag } from "../chrome/Panel.js";
import { AlertDial } from "../meters/Rack.js";
import type { Offer, TugModel } from "../model.js";

/**
 * Home, which is a decision and not a place.
 *
 * The honeycomb does not come back with the drone. What stands here is the
 * account, the hull the tug is tied to and the rack — and the offers, each one
 * an object carrying its own verb, exactly as a machine on the board does. The
 * rule the board keeps holds here too: the engine decided what may be done and
 * why not, and this draws the answer.
 */
export function TugScreen({
  tug,
  offers,
  level,
  onPick,
  onLevel,
}: {
  tug: TugModel;
  offers: readonly Offer[];
  level: string | null;
  onPick: (offer: Offer) => void;
  onLevel: (level: string | null) => void;
}): ReactElement {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflowY: "auto",
        display: "grid",
        gridTemplateColumns: "minmax(0,1fr) 360px",
        gap: 14,
        alignContent: "start",
        padding: 18,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <Panel title={tug.callsign} stencil="tug">
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <AlertDial value={tug.derelict.alert} max={5} label="alert" size={66} />
            <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
              <div
                style={{
                  font: "var(--sv-display)",
                  fontSize: 26,
                  letterSpacing: "var(--sv-display-track)",
                  color: "var(--sv-ink)",
                }}
              >
                {tug.derelict.name}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {tug.derelict.sold ? (
                  <Tag tone="good" solid>
                    under tow
                  </Tag>
                ) : (
                  <>
                    <Tag tone={tug.derelict.online === tug.derelict.of ? "good" : "warn"}>
                      {tug.derelict.online}/{tug.derelict.of} up
                    </Tag>
                    <Tag tone="amber">{tug.derelict.price} cr</Tag>
                  </>
                )}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title={level === null ? "Dock" : level} stencil={`sortie ${String(tug.account.sortie)}`} fill>
          <OfferList offers={offers} level={level} onPick={onPick} onLevel={onLevel} />
        </Panel>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Panel title="Account" stencil="credits">
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <Figure label="banked" value={tug.account.credits} big />
            <Figure label="carried" value={tug.account.loot} />
            <Figure label="keycards" value={tug.account.keys} />
            <Figure label="in the hold" value={tug.account.hold} />
          </div>
        </Panel>

        <Panel title="Rack" stencil="hulls">
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {tug.hulls.map((hull) => (
              <div
                key={hull.id}
                style={{
                  padding: "7px 9px",
                  background: hull.on
                    ? "color-mix(in oklab, var(--sv-amber) 16%, transparent)"
                    : "transparent",
                  borderLeft: `2px solid ${hull.on ? "var(--sv-amber)" : "var(--sv-line)"}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span
                    style={{
                      font: "var(--sv-title)",
                      letterSpacing: "var(--sv-title-track)",
                      textTransform: "uppercase",
                      color: hull.on ? "var(--sv-amber)" : "var(--sv-ink)",
                    }}
                  >
                    {hull.name}
                  </span>
                  <span
                    style={{
                      marginLeft: "auto",
                      font: "var(--sv-stencil)",
                      letterSpacing: "var(--sv-stencil-track)",
                      color: "var(--sv-soft)",
                    }}
                  >
                    {hull.on ? "on the rails" : `${String(hull.price)} cr`}
                  </span>
                </div>
                <div style={{ font: "var(--sv-body)", color: "var(--sv-soft)" }}>{hull.trait}</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Figure({ label, value, big = false }: { label: string; value: number; big?: boolean }): ReactElement {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
      <span
        style={{
          flex: 1,
          font: "var(--sv-stencil)",
          letterSpacing: "var(--sv-stencil-track)",
          textTransform: "uppercase",
          color: "var(--sv-soft)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          font: "var(--sv-display)",
          fontSize: big ? 30 : 20,
          letterSpacing: "var(--sv-display-track)",
          color: big ? "var(--sv-amber)" : "var(--sv-ink)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * The offers, under the headings the engine grouped them with.
 *
 * A refused line stays on the list wearing its reason rather than vanishing:
 * a shelf that hides what cannot be afforded teaches nothing about the price.
 */
function OfferList({
  offers,
  level,
  onPick,
  onLevel,
}: {
  offers: readonly Offer[];
  level: string | null;
  onPick: (offer: Offer) => void;
  onLevel: (level: string | null) => void;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(function resolve() {
    if (ref.current === null) return;
    const running = FX.scrambleReveal(ref.current.querySelectorAll("[data-sc]"), FX.PRESETS.list);
    return () => {
      running.cancel();
    };
  }, [level, offers.length]);

  return (
    <div ref={ref} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {offers.length === 0 ? (
        <div style={{ font: "var(--sv-body)", color: "var(--sv-soft)" }}>nothing on offer</div>
      ) : (
        offers.map((offer) => (
          <div key={offer.index}>
            {offer.head === undefined ? null : (
              <div
                style={{
                  marginTop: 9,
                  marginBottom: 2,
                  font: "var(--sv-stencil)",
                  letterSpacing: "var(--sv-stencil-track)",
                  textTransform: "uppercase",
                  color: "var(--sv-amber)",
                }}
              >
                {offer.head}
              </div>
            )}
            <div
              title={offer.enabled ? undefined : offer.why}
              onClick={() => {
                if (offer.into !== undefined) onLevel(offer.into);
                else if (offer.enabled) onPick(offer);
              }}
              onMouseEnter={(e) => {
                if (offer.enabled || offer.into !== undefined)
                  e.currentTarget.style.background =
                    "color-mix(in oklab, var(--sv-amber) 14%, transparent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                padding: "6px 9px",
                cursor: offer.enabled || offer.into !== undefined ? "pointer" : "not-allowed",
                opacity: offer.enabled || offer.into !== undefined ? 1 : 0.45,
              }}
            >
              <span
                style={{
                  width: 13,
                  flex: "none",
                  font: "var(--sv-stencil)",
                  color: "var(--sv-amber)",
                }}
              >
                {offer.into === null ? "‹" : offer.into === undefined ? "·" : "›"}
              </span>
              <span data-sc style={{ font: "var(--sv-body)", color: "var(--sv-ink)" }}>
                {offer.label}
              </span>
              {offer.note === undefined ? null : (
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
                  {offer.note}
                </span>
              )}
              {offer.enabled || offer.why === undefined ? null : (
                <span
                  style={{
                    marginLeft: offer.note === undefined ? "auto" : 8,
                    font: "var(--sv-stencil)",
                    letterSpacing: "var(--sv-stencil-track)",
                    textTransform: "uppercase",
                    color: "var(--sv-bad)",
                  }}
                >
                  {offer.why}
                </span>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
