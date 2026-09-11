import "./Shell.css";

export interface TitleScreenProps {
  readonly onNewGame: () => void;
  readonly onSettings: () => void;
  readonly onCredits: () => void;
}

export function TitleScreen({ onNewGame, onSettings, onCredits }: TitleScreenProps) {
  return (
    <div className="shell">
      <div className="shell__card">
        <p className="shell__eyebrow">Salvage, under contract</p>
        <h1 className="shell__display">Derelict Extraction</h1>
        <p className="shell__line">
          Two drones, a dead ship, and something aboard that is still being built.
        </p>

        <div style={{ display: "grid", gap: 10 }}>
          <button
            type="button"
            className="shell__button shell__button--wide"
            onClick={onNewGame}
            autoFocus
          >
            New game
          </button>
          <button
            type="button"
            className="shell__button shell__button--ghost shell__button--wide"
            onClick={onSettings}
          >
            Settings
          </button>
          <button
            type="button"
            className="shell__button shell__button--ghost shell__button--wide"
            onClick={onCredits}
          >
            Credits
          </button>
        </div>
      </div>
    </div>
  );
}
