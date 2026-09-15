import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { MenuSheet, Rail } from "../chrome/Panel.js";
import { LogStrip } from "../action/Log.js";
import { linesOf, reveal } from "../reveal.js";
import * as FX from "../../fx/derelict-fx.js";
import { FRAME_MS, type Motion } from "../settings.js";

/**
 * The main menu, which is the game with its own menu open.
 *
 * Not a screen of its own. The rail is where it always is, the log is along
 * the bottom where it always is, and the system drawer stands open over the
 * middle — exactly what a player sees after pressing the hamburger mid-run.
 * So there is one chrome and not two, and arriving at the game and opening its
 * menu are the same picture rather than two designs that have to be kept in
 * step.
 */
export type MenuPage = "root" | "settings" | "credits" | "about";

export interface MenuSettings {
  volume: number;
  motion: Motion;
}

const STENCIL = {
  font: "var(--sv-stencil)",
  letterSpacing: "var(--sv-stencil-track)",
  textTransform: "uppercase",
} as const;

/** One row of the menu. Greyed where it has nothing to do. */
function Row({
  label,
  on = true,
  onPick,
}: {
  label: string;
  on?: boolean;
  onPick?: () => void;
}): ReactElement {
  return (
    <div
      onClick={on ? onPick : undefined}
      onMouseEnter={(e) => {
        if (on) e.currentTarget.style.background = "color-mix(in oklab, var(--sv-amber) 16%, transparent)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
      style={{
        padding: "11px 12px",
        cursor: on ? "pointer" : "not-allowed",
        opacity: on ? 1 : 0.4,
        font: "var(--sv-title)",
        letterSpacing: "var(--sv-title-track)",
        textTransform: "uppercase",
        color: "var(--sv-ink)",
      }}
    >
      <span data-sc>{label}</span>
    </div>
  );
}

/** A setting that is one of a few, drawn as the few. */
function Pick<T extends string>({
  value,
  of,
  onPick,
}: {
  value: T;
  of: readonly T[];
  onPick: (next: T) => void;
}): ReactElement {
  return (
    <div style={{ display: "flex", gap: 3 }}>
      {of.map((one) => (
        <span
          key={one}
          onClick={() => onPick(one)}
          style={{
            flex: 1,
            textAlign: "center",
            padding: "6px 0",
            cursor: "pointer",
            ...STENCIL,
            background: one === value ? "var(--sv-amber)" : "transparent",
            border: one === value ? "none" : "1px solid var(--sv-line)",
            color: one === value ? "var(--sv-knock)" : "var(--sv-soft)",
          }}
        >
          {one}
        </span>
      ))}
    </div>
  );
}

function Line({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return (
    <div style={{ marginBottom: 14 }}>
      <div data-sc style={{ ...STENCIL, color: "var(--sv-soft)", marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

export function Menu({
  page,
  canContinue,
  settings,
  onPage,
  onContinue,
  onNewGame,
  onSettings,
  foot,
}: {
  page: MenuPage;
  canContinue: boolean;
  settings: MenuSettings;
  onPage: (page: MenuPage) => void;
  onContinue: () => void;
  onNewGame: () => void;
  onSettings: (next: MenuSettings) => void;
  /** The build line, which is the only text the root menu carries. */
  foot: string;
}): ReactElement {
  const [log] = useState<never[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(
    function resolve() {
      if (ref.current === null) return;
      return reveal(linesOf(ref.current), FX.PRESETS.sheet);
    },
    [page],
  );

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "grid",
        gridTemplateColumns: "46px minmax(0,1fr) 420px",
        gridTemplateRows: "minmax(0,1fr) auto",
        background: "var(--sv-deep)",
        overflow: "hidden",
        userSelect: "none",
      }}
    >
      <Rail
        style={{ gridColumn: 1, gridRow: 1, zIndex: 90 }}
        active="sys"
        items={[{ id: "sys", glyph: "≡", title: "menu" }]}
      />

      <div
        style={{
          gridColumn: "2 / -1",
          gridRow: 1,
          position: "relative",
          background:
            "radial-gradient(ellipse 66% 60% at 46% 48%, var(--sv-deck) 0%, var(--sv-deep) 78%)",
        }}
      >
        <div ref={ref} style={{ position: "absolute", left: 0, top: 0, bottom: 0, display: "flex" }}>
          {page === "root" ? (
            <MenuSheet title="Derelict Rogue" width={360}>
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <Row label="Continue" on={canContinue} onPick={onContinue} />
                <Row label="New game" onPick={onNewGame} />
                <Row label="Settings" onPick={() => onPage("settings")} />
                <Row label="Credits" onPick={() => onPage("credits")} />
                <Row label="About" onPick={() => onPage("about")} />
              </div>
              <div
                data-sc
                style={{
                  marginTop: "auto",
                  paddingTop: 14,
                  ...STENCIL,
                  color: "var(--sv-line)",
                }}
              >
                {foot}
              </div>
            </MenuSheet>
          ) : null}

          {page === "settings" ? (
            <SettingsSheet settings={settings} onSettings={onSettings} onBack={() => onPage("root")} />
          ) : null}
          {page === "credits" ? (
            <MenuSheet title="Credits" width={400} onBack={() => onPage("root")}>
              <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                {[
                  ["music", "Eric Matyas · soundimage.org"],
                  ["menu music", "3D63 — Analog Hack"],
                  ["icons", "game-icons.net — Lorc, Delapouite, Lord Berandas, DarkZaitzev"],
                  ["deck plating", "RPG Mobius Geomorphs — Pearce & Smith"],
                  ["typefaces", "Barlow Condensed · IBM Plex Mono"],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 10,
                      paddingTop: 9,
                      borderTop: "1px solid var(--sv-line)",
                    }}
                  >
                    <span data-sc style={{ ...STENCIL, color: "var(--sv-soft)", flex: "none" }}>
                      {k}
                    </span>
                    <span
                      data-sc
                      style={{
                        marginLeft: "auto",
                        font: "var(--sv-body)",
                        color: "var(--sv-ink)",
                        textAlign: "right",
                      }}
                    >
                      {v}
                    </span>
                  </div>
                ))}
              </div>
            </MenuSheet>
          ) : null}

          {page === "about" ? <AboutSheet onBack={() => onPage("root")} /> : null}
        </div>
      </div>

      {/* The log is where it always is, with nothing in it yet. The menu is the
          game's own chrome rather than a screen of its own, so the parts that
          have nothing to say are still where a player will later find them. */}
      <LogStrip entries={log} style={{ gridColumn: "1 / -1", gridRow: 2, zIndex: 100 }} />
    </div>
  );
}

/**
 * Settings, wherever they are opened from.
 *
 * The menu opens them as a page of itself and the rail opens them over a run,
 * and they are the same sheet both times: a setting that looked different
 * depending on where you reached it would be two settings to keep in step.
 * `onBack` is the menu's way out and `onClose` is the rail's — a page goes
 * back to the page above it, a sheet over a run simply goes.
 */
export function SettingsSheet({
  settings,
  onSettings,
  onBack,
  onClose,
}: {
  settings: MenuSettings;
  onSettings: (next: MenuSettings) => void;
  onBack?: () => void;
  onClose?: () => void;
}): ReactElement {
  return (
    <MenuSheet title="Settings" width={380} onBack={onBack} onClose={onClose}>
      <Line label="volume">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(settings.volume * 100)}
            onChange={(e) => onSettings({ ...settings, volume: Number(e.target.value) / 100 })}
            style={{ flex: 1, accentColor: "var(--sv-amber)" }}
          />
          <span style={{ width: 44, textAlign: "right", ...STENCIL, color: "var(--sv-ink)" }}>
            {Math.round(settings.volume * 100)}
          </span>
        </div>
      </Line>

      <Line label="motion">
        <Pick
          value={settings.motion}
          of={["instant", "faster", "normal"] as const}
          onPick={(motion) => onSettings({ ...settings, motion })}
        />
      </Line>

      <div style={{ ...STENCIL, color: "var(--sv-line)" }}>
        {FRAME_MS[settings.motion] === 0
          ? "no frames"
          : `${String(FRAME_MS[settings.motion])}ms a frame`}
      </div>
    </MenuSheet>
  );
}

/** What the game is, in two sentences. The same sheet from the menu or the rail. */
export function AboutSheet({
  onBack,
  onClose,
}: {
  onBack?: () => void;
  onClose?: () => void;
}): ReactElement {
  return (
    <MenuSheet title="About" width={400} onBack={onBack} onClose={onClose}>
      <div data-sc style={{ font: "var(--sv-body)", color: "var(--sv-fg)" }}>
        A turn-based salvage game. One drone into a hulk, three systems started,
        and back out with whatever it was carrying.
      </div>
      <div data-sc style={{ marginTop: 12, font: "var(--sv-body)", color: "var(--sv-soft)" }}>
        Made for roguetemple&apos;s Fortnight 2.
      </div>
    </MenuSheet>
  );
}
