import type { MissionBrief } from "../../core/missions";
import { Tag } from "../atoms/Tag";
import "./MissionBriefing.css";

export interface MissionBriefingProps {
  readonly brief: MissionBrief | null;
  readonly onRoll: () => void;
  readonly onLaunch: () => void;
  /** Shown when a mission has just been finished. */
  readonly lastOutcome?: "win" | "loss" | null | undefined;
}

/** The screen between missions: what was rolled, and whether to take it. */
export function MissionBriefing({ brief, onRoll, onLaunch, lastOutcome }: MissionBriefingProps) {
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

        <div className="briefing__actions">
          <button
            type="button"
            className="briefing__button briefing__button--ghost"
            onClick={onRoll}
          >
            Roll again
          </button>
          <button
            type="button"
            className="briefing__button"
            onClick={onLaunch}
            disabled={brief === null}
          >
            Board it
          </button>
        </div>
      </div>
    </div>
  );
}
