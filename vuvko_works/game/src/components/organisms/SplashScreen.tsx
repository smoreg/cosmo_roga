import "./Shell.css";

export interface SplashScreenProps {
  readonly onProceed: () => void;
}

/**
 * The one gesture the game needs before it can do anything.
 *
 * A browser refuses to let a page play audio, and throttles some loading,
 * until someone has interacted with it. Rather than have music mysteriously
 * fail to start, the game asks for a click up front and uses it.
 */
export function SplashScreen({ onProceed }: SplashScreenProps) {
  return (
    <div className="shell">
      <div className="shell__card" style={{ textAlign: "center" }}>
        <p className="shell__eyebrow">A derelict, and three hours of air</p>
        <h1 className="shell__display">Derelict Extraction</h1>
        <p className="shell__line" style={{ margin: "0 auto 24px" }}>
          Turn-based tactics aboard a ship that is still growing things.
        </p>
        <button
          type="button"
          className="shell__button shell__button--wide"
          onClick={onProceed}
          autoFocus
        >
          Click to proceed
        </button>
      </div>
    </div>
  );
}
