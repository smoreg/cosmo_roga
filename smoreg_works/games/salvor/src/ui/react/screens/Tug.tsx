import { useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import * as FX from "../../fx/derelict-fx.js";
import { Panel, Tag } from "../chrome/Panel.js";
import { AlertDial } from "../meters/Rack.js";
import type { Offer, TugModel } from "../model.js";

/**
 * Home, which is a decision and not a place.
 *
 * The honeycomb does not come back with the drone, so what stands where it
 * would have been is the decision: the hull the tug is tied to, and the orders
 * that can be given about it. Each is an object carrying its own verb, exactly
 * as a machine on the board is, and the rule the board keeps holds here too —
 * the engine decided what may be done and why not, and this draws the answer.
 *
 * What is merely *looked at* — the account, the drones on the rack — is not
 * here. It is in the readout down the right-hand side, where the rack and the
 * compartment are when there is a ship to be aboard, so that one side of the
 * screen is always the thing being done and the other is always the state.
 */
export function TugOrders({
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
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: 18,
      }}
    >
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

        <Panel title={level === null ? "Orders" : level} stencil="dock" fill>
          <OfferList offers={offers} level={level} onPick={onPick} onLevel={onLevel} />
        </Panel>

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

/**
 * A section of the dock, which opens and shuts.
 *
 * Three panels stacked down the side of the tug was three headers, three
 * borders and three sets of scanlines for what is one readout, and the third
 * of them was always below the fold. One housing, three sections, and the ones
 * a player is not looking at cost a line each.
 */
function Fold({
  head,
  open = false,
  children,
}: {
  head: string;
  open?: boolean;
  children?: ReactNode;
}): ReactElement {
  const [on, setOn] = useState(open);
  return (
    <div style={{ borderTop: "1px solid var(--sv-line)", paddingTop: 7, marginTop: 7 }}>
      <div
        onClick={() => setOn(!on)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: "pointer",
          font: "var(--sv-stencil)",
          letterSpacing: "var(--sv-stencil-track)",
          textTransform: "uppercase",
          color: on ? "var(--sv-amber)" : "var(--sv-soft)",
          marginBottom: on ? 6 : 0,
        }}
      >
        <span style={{ width: 11 }}>{on ? "▾" : "▸"}</span>
        {head}
      </div>
      {on ? children : null}
    </div>
  );
}

/**
 * The three drones, and whichever one is being looked at.
 *
 * Hovering shows what the row cannot fit — the core, the slots, the five it
 * comes with — and a click holds that open so two of them can be read one
 * after the other without the pointer having to stay put. The row never buys
 * anything: the rack is the place the choice is *read*, and the offer that
 * spends credits is on the dock's own list, where every other price is.
 */
function Drones({
  hulls,
  onLook,
}: {
  hulls: TugModel["hulls"];
  onLook: (id: string | null) => void;
}): ReactElement {
  /* Hovering points the rack at a hull for as long as the pointer is on it;
     clicking holds it there, so two of them can be read one after the other
     without the pointer having to stay put. */
  const [held, setHeld] = useState<string | null>(null);
  const [look, setLook] = useState<string | null>(null);
  const shown = held ?? look;
  useEffect(
    function tellTheRack() {
      onLook(shown);
    },
    [shown],
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {hulls.map((hull) => {
        const open = shown === hull.id;
        return (
          <div
            key={hull.id}
            onMouseEnter={() => setLook(hull.id)}
            onMouseLeave={() => setLook(null)}
            onClick={() => setHeld(held === hull.id ? null : hull.id)}
            title={hull.on ? "the drone on the rails" : "look at this one in the rack above"}
            style={{
              padding: "6px 8px",
              cursor: "pointer",
              background: open ? "color-mix(in oklab, var(--sv-amber) 12%, transparent)" : "transparent",
              borderLeft: `2px solid ${hull.on ? "var(--sv-amber)" : open ? "var(--sv-rim)" : "var(--sv-line)"}`,
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
                  textTransform: "uppercase",
                  color: "var(--sv-soft)",
                }}
              >
                {hull.on ? "on the rails" : `${String(hull.price)} cr`}
              </span>
            </div>
            <div style={{ font: "var(--sv-body)", color: "var(--sv-soft)" }}>{hull.trait}</div>

            {open ? (
              <div style={{ marginTop: 5, display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Tag tone="amber">core {hull.core}</Tag>
                <Tag tone="neutral">{hull.slots} slots</Tag>
                {hull.speed === undefined ? null : <Tag tone="neutral">speed {hull.speed}</Tag>}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The readout: what the dock is, rather than what can be done about it.
 *
 * One housing with folds, because three panels down one side was three
 * headers, three borders and three sets of scanlines for one readout, and the
 * third was always below the fold. Picking a drone here does not buy it — it
 * points the rack above at that hull instead, so two racks can be compared
 * where the rack already is, rather than in a summary beside it.
 */
export function DockPreview({
  tug,
  onLook,
}: {
  tug: TugModel;
  onLook: (id: string | null) => void;
}): ReactElement {
  return (
    <Panel title="Dock" stencil="preview">
      <Fold head="account" open>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <Figure label="banked" value={tug.account.credits} big />
          <Figure label="carried" value={tug.account.loot} />
          <Figure label="keycards" value={tug.account.keys} />
          <Figure label="in the hold" value={tug.account.hold} />
          <Figure label="sortie" value={tug.account.sortie} />
        </div>
      </Fold>

      <Fold head="drones" open>
        <Drones hulls={tug.hulls} onLook={onLook} />
      </Fold>
    </Panel>
  );
}
