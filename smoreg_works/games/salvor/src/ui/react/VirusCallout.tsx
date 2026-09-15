import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { linesOf, reveal } from "./reveal.js";
import * as FX from "./../fx/derelict-fx.js";
import type { Strain } from "./model.js";

/**
 * The strain, as a thing the player can act on.
 *
 * The rack could say a module was infected — a red frame and the strain's name
 * on its bay — and nothing else: not what a beat costs, not how long until the
 * next one, and not one of the three ways out. So the one mechanic in this
 * game whose whole design is *where the risk sits* was, once the risk landed,
 * a red rectangle.
 *
 * Four periods, and a period is not something a player can act on: the card
 * counts *down*. The three prices are drawn together because that is the
 * decision — they are in three different currencies on purpose (turns and
 * noise, a good module, credits), so which is right depends on where the alert
 * is and how far the airlock is rather than on which is cheapest.
 *
 * It arrives the way every panel in this system arrives: assembled out of
 * noise, top to bottom, on the frame clock.
 */
const STENCIL = {
  font: "var(--sv-stencil)",
  letterSpacing: "var(--sv-stencil-track)",
  textTransform: "uppercase",
} as const;

/** One way out, with its price where a price always goes. */
function Way({
  label,
  note,
  onPick,
}: {
  label: string;
  note?: string;
  onPick?: () => void;
}): ReactElement {
  return (
    <div
      onClick={onPick}
      onMouseEnter={(e) => {
        if (onPick !== undefined)
          e.currentTarget.style.background = "color-mix(in oklab, var(--sv-amber) 14%, transparent)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 9,
        padding: "4px 8px",
        cursor: onPick === undefined ? "default" : "pointer",
      }}
    >
      <span style={{ ...STENCIL, fontSize: 14, letterSpacing: ".1em", color: "var(--sv-amber)" }}>
        ▸
      </span>
      <span data-sc style={{ font: "var(--sv-body)", color: "var(--sv-ink)", whiteSpace: "nowrap" }}>
        {label}
      </span>
      {note === undefined ? null : (
        <span
          data-sc
          style={{
            marginLeft: "auto",
            flex: "none",
            ...STENCIL,
            fontSize: 14,
            letterSpacing: ".1em",
            color: "var(--sv-soft)",
            whiteSpace: "nowrap",
          }}
        >
          {note}
        </span>
      )}
    </div>
  );
}

export function VirusCallout({
  strain,
  onPurge,
  onClose,
  style,
}: {
  strain: Strain;
  /** Spend a turn of welding. Undefined where the drone cannot right now. */
  onPurge?: () => void;
  onClose: () => void;
  style?: React.CSSProperties;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(
    function assemble() {
      if (ref.current === null) return;
      return reveal(linesOf(ref.current), FX.PRESETS.panel);
    },
    [strain.name, strain.slot],
  );

  const purging = strain.purging !== undefined;
  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      style={{
        width: 330,
        background: "var(--sv-knock)",
        border: "2px solid var(--sv-bad)",
        boxShadow: "var(--sv-cast)",
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "5px 10px",
          background: "var(--sv-bad)",
        }}
      >
        <span
          data-sc
          style={{
            font: "var(--sv-title)",
            letterSpacing: "var(--sv-title-track)",
            textTransform: "uppercase",
            color: "var(--sv-knock)",
          }}
        >
          {strain.name}
        </span>
        <span
          onClick={onClose}
          style={{
            marginLeft: "auto",
            ...STENCIL,
            fontSize: 14,
            letterSpacing: ".14em",
            color: "var(--sv-knock)",
            cursor: "pointer",
            padding: "2px 4px",
          }}
        >
          close
        </span>
      </div>

      <div style={{ padding: "9px 10px", backgroundImage: "var(--sv-scan)" }}>
        <div data-sc style={{ font: "var(--sv-body)", color: "var(--sv-ink)" }}>
          {strain.beat}
        </div>

        {/* The countdown. Pips rather than a number alone, because the decision
            is "is there time to do something else first" and nobody reads that
            off an integer as fast as off a length. */}
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 9 }}>
          <div data-sc style={{ ...STENCIL, fontSize: 14, color: "var(--sv-soft)" }}>
            next beat
          </div>
          <div style={{ display: "flex", gap: 2 }}>
            {Array.from({ length: strain.period }).map((_, i) => (
              <div
                key={i}
                style={{
                  width: 5,
                  height: 11,
                  background: i < strain.next ? "var(--sv-bad)" : "var(--sv-plate-lit)",
                }}
              />
            ))}
          </div>
          <div
            style={{
              marginLeft: "auto",
              font: "var(--sv-value)",
              fontSize: 16,
              color: strain.next <= 1 ? "var(--sv-bad)" : "var(--sv-ink)",
            }}
          >
            {strain.next}
          </div>
        </div>

        <div style={{ marginTop: 10, paddingTop: 9, borderTop: "1px solid var(--sv-line)" }}>
          {purging ? (
            <>
              {/* A purge is turns in a row and can be broken off, so what it
                  needs is a progress the player can be knocked out of. */}
              <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 8px 7px" }}>
                <div style={{ ...STENCIL, fontSize: 14, color: "var(--sv-warn)" }}>welding</div>
                <div style={{ display: "flex", gap: 3 }}>
                  {Array.from({ length: strain.purgeTurns }).map((_, i) => (
                    <div
                      key={i}
                      style={{
                        width: 18,
                        height: 11,
                        background:
                          i < strain.purgeTurns - (strain.purging ?? 0)
                            ? "var(--sv-warn)"
                            : "var(--sv-plate-lit)",
                      }}
                    />
                  ))}
                </div>
                <div style={{ marginLeft: "auto", ...STENCIL, fontSize: 14, color: "var(--sv-soft)" }}>
                  {strain.purging} to go
                </div>
              </div>
              <Way label="hold the weld" note="1 turn" {...(onPurge === undefined ? {} : { onPick: onPurge })} />
            </>
          ) : (
            <Way
              label="purge it"
              note={`${String(strain.purgeTurns)} turns`}
              {...(onPurge === undefined ? {} : { onPick: onPurge })}
            />
          )}
          {/* Neither of these is a key to press. Letting a module burn is a
              thing you allow rather than do, and the bench is a sortie away —
              they are here because the decision is the comparison, and a card
              that showed only the affordable one would not be a decision. */}
          <Way label="let it burn" note="the module" />
          <Way label="clean it at the bench" note={`${String(strain.benchPrice)} cr a point`} />
        </div>
      </div>
    </div>
  );
}
