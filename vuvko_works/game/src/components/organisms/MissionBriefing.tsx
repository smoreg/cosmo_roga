import type { MissionBrief } from "../../core/missions";
import { Tag } from "../atoms/Tag";
import "./MissionBriefing.css";

export interface MissionBriefingProps {
  readonly brief: MissionBrief | null;
  readonly onRoll: () => void;
  readonly onLaunch: () => void;
  /** Shown when a mission has just been finished. */
  readonly lastOutcome?: "win" | "loss" | null | undefined;
  /** True while the hull is being generated. */
  readonly busy?: boolean | undefined;
  /** Why the hull would not build, if it would not. */
  readonly error?: string | null | undefined;
}

/** The screen between missions: what was rolled, and whether to take it. */
export function MissionBriefing(props: MissionBriefingProps) {
  const { brief, onRoll, onLaunch, lastOutcome, busy = false, error } = props;
  return (
    <div className="briefing">
      <div className="briefing__sheet">
        <p className="briefing__eyebrow">Derelict Extraction</p>

        {lastOutcome == null ? null : (
          <p
            className="briefing__outcome"
            style={{ color: lastOutcome === "win" ? "var(--node)" : "var(--stamp)" }}
          >
            {lastOutcome === "win" ? "Last contract: secured." : "Last contract: both drones lost."}
          </p>
        )}

        {brief === null ? (
          <>
            <h1 className="briefing__title">No contract on the board</h1>
            <p className="briefing__line">Roll for one.</p>
          </>
        ) : (
          <>
            <h1 className="briefing__title">{brief.type.name}</h1>
            <p className="briefing__line">{brief.type.objective}</p>

            <dl className="briefing__facts">
              <dt>Hull</dt>
              <dd>
                {brief.profile.name} <Tag>{brief.profile.code}</Tag>
                <span className="briefing__shape">{brief.profile.shape}</span>
              </dd>
              <dt>Seed</dt>
              <dd className="briefing__seed">{brief.seed}</dd>
            </dl>

            <p className="briefing__how">{brief.type.victory}</p>
          </>
        )}

        {error == null ? null : (
          <p
            className="briefing__how"
            style={{ color: "var(--stamp)", borderColor: "var(--stamp)" }}
          >
            The hull would not build: {error}
          </p>
        )}

        {error == null ? null : (
          <p
            className="briefing__how"
            style={{ color: "var(--stamp)", borderColor: "var(--stamp)" }}
          >
            The hull would not build: {error}
          </p>
        )}

        <div className="briefing__actions">
          <button
            type="button"
            className="briefing__button briefing__button--ghost"
            onClick={onRoll}
            disabled={busy}
          >
            Roll again
          </button>
          <button
            type="button"
            className="briefing__button"
            onClick={onLaunch}
            disabled={brief === null || busy}
          >
            {busy ? "Building the hull…" : "Board it"}
          </button>
        </div>
      </div>
    </div>
  );
}
