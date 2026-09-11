import "./Shell.css";

/** TODO: the owner has not named the jam yet. Set this before any release. */
export const JAM_NAME = "«jam not yet named»";

export interface CreditsScreenProps {
  readonly onBack: () => void;
}

interface Credit {
  readonly what: string;
  readonly who: string;
  readonly where: string;
  readonly terms: string;
}

/* Kept in step with public/audio/ATTRIBUTION.md, public/geomorphs/LICENCE.md
   and ../ATTRIBUTION.md. If a line here and a line there disagree, the file on
   disk is the one that matters. */
const CREDITS: readonly Credit[] = [
  {
    what: "Deck plan artwork",
    who: "Robert Pearce · screen colouring by Eric B. Smith",
    where: "rpgmobius.com/geomorphs",
    terms: "Starship Geomorphs, CC BY-NC 4.0. Used downscaled; not otherwise changed.",
  },
  {
    what: "Mission music",
    who: "Eric Matyas",
    where: "soundimage.org",
    terms:
      "The Creeping Blob · Factory On Mercury · Eerie Cyber World · Dizzybot · Trouble on Mercury",
  },
  {
    what: "Menu music",
    who: "3D63 — “Analog Hack”",
    where: "3d63.itch.io/analog-hack",
    terms: "Used with the artist's permission, given on condition of credit.",
  },
];

export function CreditsScreen({ onBack }: CreditsScreenProps) {
  return (
    <div className="shell">
      <div className="shell__card">
        <p className="shell__eyebrow">Credits</p>
        <h1 className="shell__title">Everything here is someone's work</h1>

        <dl style={{ margin: "0 0 20px", display: "grid", gap: 16 }}>
          {CREDITS.map(function entry(credit) {
            return (
              <div key={credit.what}>
                <dt
                  style={{
                    font: "700 var(--font-xs)/1 var(--font-mono)",
                    letterSpacing: "var(--tracking-label)",
                    textTransform: "uppercase",
                    color: "var(--dim)",
                    marginBottom: 4,
                  }}
                >
                  {credit.what}
                </dt>
                <dd style={{ margin: 0 }}>
                  <div style={{ font: "400 var(--font-md)/var(--line-md) var(--font-body)" }}>
                    {credit.who}
                  </div>
                  <div
                    style={{
                      font: "400 var(--font-sm)/var(--line-sm) var(--font-mono)",
                      color: "var(--door)",
                    }}
                  >
                    {credit.where}
                  </div>
                  <div
                    style={{
                      font: "400 var(--font-sm)/var(--line-sm) var(--font-body)",
                      color: "var(--dim)",
                      marginTop: 2,
                    }}
                  >
                    {credit.terms}
                  </div>
                </dd>
              </div>
            );
          })}
        </dl>

        <p
          style={{
            font: "400 var(--font-sm)/var(--line-sm) var(--font-body)",
            color: "var(--dim)",
            borderTop: "1px solid var(--rule)",
            paddingTop: 14,
            margin: "0 0 20px",
          }}
        >
          This game is non-commercial, and must stay that way: the deck artwork is licensed for
          non-commercial use only.
        </p>

        <p
          style={{
            font: "700 var(--font-md)/var(--line-md) var(--font-body)",
            margin: "0 0 22px",
          }}
        >
          Created for {JAM_NAME}
        </p>

        <div className="shell__actions">
          <button type="button" className="shell__button" onClick={onBack}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
