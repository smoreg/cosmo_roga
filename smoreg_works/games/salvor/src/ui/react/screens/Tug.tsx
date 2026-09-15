import { useEffect, useRef } from "react";
import type { ReactElement, RefObject } from "react";
import * as FX from "../../fx/derelict-fx.js";
import { linesOf, reveal } from "../reveal.js";
import { DroneIcon } from "../board/Icon.js";
import { Panel, Tag } from "../chrome/Panel.js";
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
const STENCIL = {
  font: "var(--sv-stencil)",
  letterSpacing: "var(--sv-stencil-track)",
  textTransform: "uppercase",
} as const;

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
  const ref = useLines([tug.callsign, tug.derelict.name, tug.account.credits]);
  return (
    <div
      ref={ref}
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
          <div style={{ display: "flex", gap: 18, alignItems: "stretch" }}>
            {/* What the tug has. The account is the tug's, so it is under the
                tug's name, and nothing about the hull alongside is mixed into
                it — a credit and an alarm are not two readings of one thing. */}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
              <Figure label="banked" value={tug.account.credits} big />
              <Figure label="carried" value={tug.account.loot} />
              <Figure label="keycards" value={tug.account.keys} />
              <Figure label="in the hold" value={tug.account.hold} />
              <Figure label="sortie" value={tug.account.sortie} />
            </div>

            {/* And what it is tied to, while that is still a question. A hull
                under tow is finished — what its alarm stood at and how many of
                its systems were up are the history of a decision already made,
                and a screen that keeps printing them is asking the player to
                re-read an answer.

                The alarm went with them. It was the hull's own, as the last
                drone left it, and it is also what the next sortie re-enters
                at — so if the tug ever needs to say "this one will be harder
                than last time", this is the line it goes back on. */}
            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                gap: 7,
                paddingLeft: 18,
                borderLeft: "1px solid var(--sv-line)",
              }}
            >
              <div
                style={{
                  font: "var(--sv-stencil)",
                  letterSpacing: "var(--sv-stencil-track)",
                  textTransform: "uppercase",
                  color: "var(--sv-soft)",
                }}
              >
                alongside
              </div>
              <div
                style={{
                  font: "var(--sv-display)",
                  fontSize: 24,
                  letterSpacing: "var(--sv-display-track)",
                  color: tug.derelict.sold ? "var(--sv-soft)" : "var(--sv-ink)",
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

        {/* One panel per group, and the groups are the engine's own: where to
            fly, what to fly, and what is bolted to it (`ui/actions.ts`,
            `TUG_ROWS`). They were one list with headings in it, which is right
            for ten numbered lines on a terminal and wrong here — three things
            a player does at the tug should be three things on the screen.

            Opened into a group, the panels give way to it: a sublist is one
            question and the rest of the dock is not an answer to it. */}
        {level !== null ? (
          <Panel title={level} stencil="dock" fill>
            <OfferList offers={offers} level={level} onPick={onPick} onLevel={onLevel} />
          </Panel>
        ) : (
          grouped(offers).map((group) => (
            <Panel key={group.title} title={group.title} stencil="dock">
              <OfferList offers={group.offers} level={null} onPick={onPick} onLevel={onLevel} />
            </Panel>
          ))
        )}

    </div>
  );
}

/**
 * Resolve every line of a panel, the way the record resolves when it opens.
 *
 * `PRESETS.all` rather than a stagger: the tug is not news arriving, it is a
 * readout already written, and a readout that types itself out row by row is a
 * readout you wait through. Every line scrambles, all of them at once, and the
 * whole thing settles in three held frames.
 *
 * Every leaf that holds text is taken rather than hand-marked with `data-sc`,
 * so a panel that grows a row does not need remembering to — the same rule the
 * design system's own `MenuSheet` falls back on.
 */
function useLines(deps: readonly unknown[]): RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null as unknown as HTMLDivElement);
  useEffect(
    function resolve() {
      const host: HTMLDivElement | null = ref.current;
      if (host === null) return;
      return reveal(linesOf(host), FX.PRESETS.all);
    },
    deps,
  );
  return ref;
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
/**
 * The list, cut where the engine cut it.
 *
 * An offer carries a heading only on the line that opens its group, so the
 * groups are already in the order and already named — this walks them out.
 * Anything before the first heading belongs to the group it is printed under,
 * which at the tug is the voyage: casting off is a thing you do about where
 * you are going.
 */
function grouped(offers: readonly Offer[]): Array<{ title: string; offers: Offer[] }> {
  const out: Array<{ title: string; offers: Offer[] }> = [];
  for (const offer of offers) {
    if (offer.head !== undefined || out.length === 0) {
      out.push({ title: offer.head ?? "Orders", offers: [] });
    }
    /*
     * The heading comes off the line once the group has taken it.
     *
     * A heading travels *on* the offer that opens its group, because the
     * engine's list is one flat list with headings in it — which is right for
     * a numbered terminal list and wrong here, where each group is already a
     * panel with a title across the top. Left on, every group printed its own
     * name twice: VOYAGE over VOYAGE, RACK over RACK.
     */
    const { head: _taken, ...line } = offer;
    (out[out.length - 1] as { offers: Offer[] }).offers.push(line);
  }
  return out;
}

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
    return reveal(linesOf(ref.current), FX.PRESETS.all);
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
 * The drone the tug has, and nothing about the ones it could buy.
 *
 * This side of the screen is the readout: what is here. It listed all three
 * classes for a while, which made it a shelf — and a shelf belongs with the
 * other things that are bought, on the orders side. A voyage owns one drone at
 * a time (`Voyage.hull`), so this is that one, or it is the gap where it
 * should be.
 */
export function DockPreview({ tug }: { tug: TugModel }): ReactElement {
  const d = tug.drone;
  return (
    <Panel title="Dock" stencil={d === undefined ? "empty" : "on the rails"}>
      {d === undefined ? (
        <div style={{ font: "var(--sv-body)", color: "var(--sv-soft)" }}>
          No drone on the rails. Buying one is the first order.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <DroneIcon who={d.who} size={30} />
            <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
              <span
                style={{
                  font: "var(--sv-title)",
                  letterSpacing: "var(--sv-title-track)",
                  textTransform: "uppercase",
                  color: "var(--sv-ink)",
                  whiteSpace: "nowrap",
                }}
              >
                {d.name}
              </span>
              <span style={{ ...STENCIL, color: "var(--sv-soft)" }}>{d.hull}</span>
            </div>
          </div>

          <div style={{ font: "var(--sv-body)", color: "var(--sv-soft)" }}>{d.trait}</div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Tag tone="amber">core {d.core}</Tag>
            <Tag tone="neutral">{d.slots} slots</Tag>
            {d.speed === undefined ? null : <Tag tone="neutral">speed {d.speed}</Tag>}
          </div>

          <div
            style={{
              display: "flex",
              gap: 5,
              flexWrap: "wrap",
              paddingTop: 9,
              borderTop: "1px solid var(--sv-line)",
            }}
          >
            {d.modules.map((m, i) => (
              <Tag key={`${m}-${String(i)}`} tone="neutral">
                {m}
              </Tag>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
