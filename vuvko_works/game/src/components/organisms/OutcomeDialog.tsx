import type { Outcome } from "../../core/types";

export interface OutcomeDialogProps {
  readonly outcome: Outcome;
  readonly turn: number;
  /** How it was won: cleared out, or starved of anything to build with. */
  readonly detail: string;
  readonly onContinue: () => void;
}

/** Shown over the map when the mission ends, before the next briefing. */
export function OutcomeDialog({ outcome, turn, detail, onContinue }: OutcomeDialogProps) {
  const won = outcome === "win";
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={won ? "Mission complete" : "Mission lost"}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(8,10,12,.6)",
        display: "grid",
        placeItems: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "min(380px, 100%)",
          background: "var(--panel)",
          border: "1px solid var(--rule)",
          borderTop: `3px solid ${won ? "var(--node)" : "var(--stamp)"}`,
          boxShadow: "0 14px 40px rgba(0,0,0,.65)",
          padding: "20px 22px 18px",
          display: "grid",
          gap: 12,
        }}
      >
        <p
          style={{
            font: "700 var(--font-xs)/1 var(--font-mono)",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: won ? "var(--node)" : "var(--stamp)",
            margin: 0,
          }}
        >
          {won ? "Ship secured" : "Contract lost"}
        </p>

        <h2 style={{ font: "700 var(--font-lg)/var(--line-lg) var(--font-body)", margin: 0 }}>
          {won ? "Nothing left aboard" : "Both drones gone"}
        </h2>

        <p
          style={{
            color: "var(--dim)",
            margin: 0,
            font: "400 var(--font-sm)/var(--line-sm) var(--font-body)",
          }}
        >
          {detail}
        </p>

        <p
          style={{ font: "400 var(--font-sm)/1 var(--font-mono)", color: "var(--dim)", margin: 0 }}
        >
          {turn} turns aboard
        </p>

        <button
          type="button"
          onClick={onContinue}
          style={{
            justifySelf: "end",
            font: "700 var(--font-sm)/1 var(--font-body)",
            padding: "10px 18px",
            background: "var(--ink)",
            color: "var(--void)",
            border: "1px solid var(--ink)",
            cursor: "pointer",
          }}
        >
          Next contract
        </button>
      </div>
    </div>
  );
}
