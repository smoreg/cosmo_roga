import type { StepProgress } from "../../hooks/useLoader";
import "./Shell.css";

export interface LoadingScreenProps {
  readonly steps: readonly StepProgress[];
  readonly fraction: number;
  readonly done: boolean;
  readonly onContinue: () => void;
}

function mark(state: StepProgress["state"]): string {
  if (state === "done") return "ok";
  if (state === "working") return "…";
  if (state === "failed") return "—";
  return "";
}

function tone(state: StepProgress["state"]): string {
  if (state === "done") return "var(--node)";
  if (state === "failed") return "var(--door)";
  if (state === "working") return "var(--ink-text)";
  return "var(--rule)";
}

/** What is being fetched, one line each. Every line is real work. */
export function LoadingScreen({ steps, fraction, done, onContinue }: LoadingScreenProps) {
  return (
    <div className="shell">
      <div className="shell__card">
        <p className="shell__eyebrow">Bringing the tug alongside</p>

        <ul
          style={{
            listStyle: "none",
            margin: "0 0 18px",
            padding: 0,
            display: "grid",
            gap: 6,
            font: "400 var(--font-sm)/var(--line-sm) var(--font-mono)",
          }}
        >
          {steps.map(function line(step) {
            return (
              <li key={step.id} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                <span style={{ color: tone(step.state), width: "2ch", flex: "none" }}>
                  {mark(step.state)}
                </span>
                <span
                  style={{ color: step.state === "waiting" ? "var(--dim)" : "var(--ink-text)" }}
                >
                  {step.label}
                </span>
                {step.note === null ? null : (
                  <span style={{ color: "var(--door)", fontSize: "var(--font-xs)" }}>
                    {step.note}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        <div
          role="progressbar"
          aria-valuenow={Math.round(fraction * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="loading"
          style={{
            height: 4,
            background: "var(--deck)",
            border: "1px solid var(--rule)",
            marginBottom: 18,
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${String(Math.round(fraction * 100))}%`,
              background: "var(--drone)",
              transition: "width 160ms linear",
            }}
          />
        </div>

        <div className="shell__actions">
          <button type="button" className="shell__button" onClick={onContinue} disabled={!done}>
            {done ? "Continue" : "Loading…"}
          </button>
        </div>
      </div>
    </div>
  );
}
