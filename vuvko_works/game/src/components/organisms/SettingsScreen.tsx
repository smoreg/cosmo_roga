import "./Shell.css";

export interface SettingsScreenProps {
  readonly volume: number;
  readonly muted: boolean;
  readonly onVolume: (volume: number) => void;
  readonly onMuted: (muted: boolean) => void;
  readonly onBack: () => void;
}

export function SettingsScreen(props: SettingsScreenProps) {
  const { volume, muted, onVolume, onMuted, onBack } = props;
  const percent = Math.round(volume * 100);

  return (
    <div className="shell">
      <div className="shell__card">
        <p className="shell__eyebrow">Settings</p>
        <h1 className="shell__title">Sound</h1>

        <label
          htmlFor="volume"
          style={{
            display: "flex",
            justifyContent: "space-between",
            font: "400 var(--font-sm)/var(--line-sm) var(--font-mono)",
            color: "var(--dim)",
            marginBottom: 6,
          }}
        >
          <span>Music volume</span>
          <span className="tabular" style={{ color: "var(--ink-text)" }}>
            {muted ? "muted" : `${String(percent)}%`}
          </span>
        </label>

        <input
          id="volume"
          type="range"
          min={0}
          max={100}
          step={1}
          value={percent}
          disabled={muted}
          onChange={function change(event) {
            onVolume(Number(event.target.value) / 100);
          }}
          style={{ width: "100%", accentColor: "var(--drone)", minHeight: 32 }}
        />

        <label
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            margin: "14px 0 24px",
            minHeight: "var(--tap-target)",
            font: "400 var(--font-md)/1 var(--font-body)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={muted}
            onChange={function toggle(event) {
              onMuted(event.target.checked);
            }}
            style={{ accentColor: "var(--stamp)", width: 18, height: 18 }}
          />
          Mute everything
        </label>

        <div className="shell__actions">
          <button type="button" className="shell__button" onClick={onBack}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
