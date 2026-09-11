/**
 * Which build this is, in the corner of every screen.
 *
 * A bug report that names a commit is worth ten that do not, and while the
 * game is unfinished the stamp says so as well.
 */
export function BuildStamp() {
  const hash = typeof __BUILD_HASH__ === "string" ? __BUILD_HASH__ : "dev";
  return (
    <p
      style={{
        position: "fixed",
        left: 10,
        bottom: 8,
        margin: 0,
        zIndex: 60,
        pointerEvents: "none",
        font: "400 var(--font-xs)/1 var(--font-mono)",
        letterSpacing: "var(--tracking-tight)",
        color: "var(--rule)",
      }}
    >
      (WIP:build {hash})
    </p>
  );
}
