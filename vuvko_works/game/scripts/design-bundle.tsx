/**
 * Renders the real components to static HTML previews for Claude Design.
 *
 * The previews come from the components themselves rather than being written
 * by hand, so a card cannot quietly drift from the code it documents.
 */
import { REFERENCE_HEX_FEET } from "../src/core/roster";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { HitPointsBar } from "../src/components/atoms/HitPointsBar";
import { OddsBar } from "../src/components/atoms/OddsBar";
import { Tag } from "../src/components/atoms/Tag";
import { ForecastPanel } from "../src/components/molecules/ForecastPanel";
import { UnitCard } from "../src/components/molecules/UnitCard";
import { DeckView } from "../src/components/organisms/DeckView";
import { GameScreen } from "../src/components/organisms/GameScreen";
import { MissionLog } from "../src/components/organisms/MissionLog";
import { reachableHexes } from "../src/core/intent";
import { scene } from "../src/stories/fixtures";
import { makeUnit } from "../src/core/mission";
import { ROSTER } from "../src/core/roster";
import type { UnitType, Weapon } from "../src/core/types";

/* Run from the project root: `npm run design:bundle`. */
const root = resolve(process.cwd());
const outDir = resolve(root, "design-bundle");
const tokens = [
  readFileSync(join(root, "src/index.css"), "utf8"),
  readFileSync(join(root, "src/components/organisms/GameScreen.css"), "utf8"),
].join("\n");

const FONT_LINK =
  '<link href="https://fonts.googleapis.com/css2?family=B612:wght@400;700&family=B612+Mono:wght@400;700&display=swap" rel="stylesheet">';

interface Variant {
  readonly label: string;
  readonly note?: string;
  readonly node: React.ReactNode;
}

interface Card {
  readonly path: string;
  readonly name: string;
  readonly group: string;
  readonly subtitle: string;
  readonly blurb: string;
  readonly width: number;
  readonly variants: readonly Variant[];
}

function page(card: Card): string {
  const body = card.variants
    .map(function renderVariant(variant, index): string {
      const note = variant.note === undefined ? "" : `<p class="note">${variant.note}</p>`;
      /* Each variant is its own render pass, so useId would hand every one of
         them the same identifiers — and a repeated SVG filter id makes the
         second element silently borrow the first one's filter. */
      const markup = renderToStaticMarkup(variant.node as React.ReactElement, {
        identifierPrefix: `v${String(index)}-`,
      });
      return `<section class="variant">
  <h2>${variant.label}</h2>
  ${note}
  <div class="stage">${markup}</div>
</section>`;
    })
    .join("\n");

  return `<!-- @dsCard group="${card.group}" -->
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${card.name}</title>
${FONT_LINK}
<style>
${tokens}
body { padding: 28px; background: var(--void); }
h1 { font: 700 18px/1.3 var(--font-body); margin: 0 0 4px; }
.blurb { font: 400 13px/1.6 var(--font-body); color: var(--dim); margin: 0 0 26px; max-width: 62ch; }
.variant { margin-bottom: 26px; }
.variant h2 { font: 700 10px/1 var(--font-mono); letter-spacing: .09em; text-transform: uppercase;
  color: var(--dim); margin: 0 0 8px; }
.note { font: 400 12px/1.5 var(--font-body); color: var(--dim); margin: 0 0 8px; max-width: 62ch; }
.stage { background: var(--panel); border: 1px solid var(--rule); padding: 14px; }
</style>
</head>
<body>
<h1>${card.name}</h1>
<p class="blurb">${card.blurb}</p>
${body}
</body>
</html>`;
}

/** The roster is data; if a weapon is missing, the bundle should say so loudly. */
function weaponOf(type: UnitType, name: string): Weapon {
  const found = ROSTER[type].weapons.find(function byName(weapon): boolean {
    return weapon.name === name;
  });
  if (found === undefined) throw new Error(`no weapon "${name}" on ${type}`);
  return found;
}

const welder = weaponOf("drone", "welder");
const emitter = weaponOf("drone", "emitter");
const claw = weaponOf("scout", "claw");
const ram = weaponOf("sentinel", "ram");

const underway = scene(4);
const droneOnMap = underway.state.units.find(function firstDrone(unit) {
  return unit.side === "drone";
});
const reach =
  droneOnMap === undefined
    ? new Set<string>()
    : new Set(reachableHexes(underway.deck, underway.state, droneOnMap).keys());

/** A fixed frame, so a screen is judged at the size it will really be. */
function Frame({
  width,
  height,
  children,
}: {
  width: number;
  height: number;
  children: React.ReactNode;
}) {
  return (
    <div style={{ width, height, overflow: "hidden", border: "1px solid var(--rule)" }}>
      {children}
    </div>
  );
}

const CARDS: readonly Card[] = [
  {
    path: "foundations/tokens.html",
    name: "Foundations",
    group: "Foundations",
    subtitle: "Palette and type, carried from the deck plans",
    blurb:
      "The palette comes from hexmap.html, so a mission and the deck plan drawn under it read as one drawing. B612 is the typeface — it was designed for cockpit displays, which is the right register for a page you read while deciding something.",
    width: 720,
    variants: [
      {
        label: "Palette",
        node: (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            {[
              ["void", "--void"],
              ["deck", "--deck"],
              ["panel", "--panel"],
              ["rule", "--rule"],
              ["ink", "--ink"],
              ["dim", "--dim"],
              ["stamp", "--stamp"],
              ["door", "--door"],
              ["drone", "--drone"],
              ["ship", "--ship"],
              ["node", "--node"],
              ["spawn", "--spawn"],
            ].map(function swatch([name, token]) {
              return (
                <div key={name}>
                  <div
                    style={{
                      height: 44,
                      background: `var(${token})`,
                      border: "1px solid var(--rule)",
                    }}
                  />
                  <div style={{ font: "400 11px/1.6 var(--font-mono)", color: "var(--dim)" }}>
                    {name}
                  </div>
                </div>
              );
            })}
          </div>
        ),
      },
      {
        label: "Type",
        node: (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ font: "700 18px/1.3 var(--font-body)" }}>Hollow Compass — Cutter</div>
            <div style={{ font: "400 14px/1.5 var(--font-body)" }}>
              Body copy. Two drones go into a dead ship you have never seen from the inside.
            </div>
            <div style={{ font: "400 12px/1.55 var(--font-mono)", color: "var(--dim)" }}>
              mono · turn 4 · pool 12 · spawn zones 3 · nodes 7
            </div>
          </div>
        ),
      },
    ],
  },
  {
    path: "atoms/hit-points-bar.html",
    name: "HitPointsBar",
    group: "Atoms",
    subtitle: "Full / hurt / critical / destroyed",
    blurb:
      "Health as a single bar that changes colour at two thirds and one third. It carries a meter role and the real values, so it is legible to a screen reader and not only to an eye.",
    width: 420,
    variants: [
      { label: "Full", node: <HitPointsBar current={12} max={12} showNumbers /> },
      { label: "Hurt", node: <HitPointsBar current={7} max={12} showNumbers /> },
      { label: "Critical", node: <HitPointsBar current={2} max={12} showNumbers /> },
      { label: "Destroyed", node: <HitPointsBar current={0} max={12} showNumbers /> },
      { label: "Without numbers", node: <HitPointsBar current={4} max={4} /> },
    ],
  },
  {
    path: "atoms/tag.html",
    name: "Tag",
    group: "Atoms",
    subtitle: "Room roles, weapon classes, hazards",
    blurb:
      "A small uppercase label. Room roles come straight out of the deck export — command, drive, quarters — so the tag is usually reporting something the artwork already said.",
    width: 420,
    variants: [
      {
        label: "Room roles",
        node: (
          <div>
            <Tag>command</Tag>
            <Tag>weapon</Tag>
            <Tag>quarters</Tag>
            <Tag>service</Tag>
            <Tag>drive</Tag>
          </div>
        ),
      },
      { label: "Hazard", node: <Tag tone="warn">plasma leak</Tag> },
      { label: "Boarding point", node: <Tag tone="good">boarding point</Tag> },
    ],
  },
  {
    path: "atoms/odds-bar.html",
    name: "OddsBar",
    group: "Atoms",
    subtitle: "One row of the attack forecast",
    blurb:
      "The percentage is always written out beside the bar. Showing real odds before an attack is what stops a fair fight from feeling rigged, and a bar alone does not tell you whether 70% or 80% is on offer.",
    width: 460,
    variants: [
      { label: "Even", node: <OddsBar chance={0.5625} label="kills it" /> },
      { label: "Certain", node: <OddsBar chance={1} label="kills it" /> },
      { label: "Risk", node: <OddsBar chance={0.31} label="you die" tone="bad" /> },
      { label: "None", node: <OddsBar chance={0} label="you die" tone="bad" /> },
    ],
  },
  {
    path: "molecules/forecast-panel.html",
    name: "ForecastPanel",
    group: "Molecules",
    subtitle: "The bet, stated before it is taken",
    blurb:
      "Where the design's central asymmetry becomes visible. A defender answers only with a weapon of the attacker's class, so the emitter against a scout costs nothing at all — and the panel says so in as many words rather than leaving it to be inferred from two numbers.",
    width: 460,
    variants: [
      {
        label: "Welder into a scout",
        note: "Answered: a scout has a melee weapon.",
        node: <ForecastPanel weapon={welder} answering={claw} attackerHp={12} targetHp={4} />,
      },
      {
        label: "Emitter into a scout",
        note: "Unanswered: a scout has no ranged weapon at all. This is why the emitter is worth a slot.",
        node: <ForecastPanel weapon={emitter} answering={null} attackerHp={12} targetHp={4} />,
      },
      {
        label: "Welder into a sentinel",
        note: "A bad trade: the sentinel hits back harder than the welder hits.",
        node: <ForecastPanel weapon={welder} answering={ram} attackerHp={12} targetHp={8} />,
      },
      {
        label: "Wounded, against a sentinel",
        note: "The odds are the whole point of the panel.",
        node: <ForecastPanel weapon={welder} answering={ram} attackerHp={3} targetHp={8} />,
      },
    ],
  },
  {
    path: "molecules/unit-card.html",
    name: "UnitCard",
    group: "Molecules",
    subtitle: "Drone and the three hostiles",
    blurb:
      "Name, health, movement and what it is carrying. The accent colour is the side: drones read cold, the ship reads red.",
    width: 480,
    variants: [
      {
        label: "Drone",
        node: (
          <UnitCard unit={makeUnit("drone", 0, { q: 0, r: 0 }, REFERENCE_HEX_FEET, "Drone 1")} />
        ),
      },
      {
        label: "Drone, hurt and nearly spent",
        node: (
          <UnitCard
            unit={{
              ...makeUnit("drone", 0, { q: 0, r: 0 }, REFERENCE_HEX_FEET, "Drone 1"),
              hp: 5,
              movement: 1,
            }}
          />
        ),
      },
      {
        label: "Held in a zone of control",
        node: (
          <UnitCard
            unit={{
              ...makeUnit("drone", 1, { q: 0, r: 0 }, REFERENCE_HEX_FEET, "Drone 2"),
              movement: 0,
              hasAttacked: true,
            }}
            heldInPlace
          />
        ),
      },
      {
        label: "Scout",
        node: <UnitCard unit={makeUnit("scout", 9, { q: 0, r: 0 }, REFERENCE_HEX_FEET)} />,
      },
      {
        label: "Sentinel",
        node: <UnitCard unit={makeUnit("sentinel", 9, { q: 0, r: 0 }, REFERENCE_HEX_FEET)} />,
      },
      {
        label: "Hunter",
        node: <UnitCard unit={makeUnit("hunter", 9, { q: 0, r: 0 }, REFERENCE_HEX_FEET)} />,
      },
    ],
  },
  {
    path: "organisms/mission-log.html",
    name: "MissionLog",
    group: "Organisms",
    subtitle: "Events, rendered as prose",
    blurb:
      "The rules emit events; this renders them. Keeping the wording out of the core is what lets one event drive a log line, an animation and a test assertion without any of them agreeing on prose.",
    width: 640,
    variants: [
      {
        label: "A turn",
        node: (
          <MissionLog
            lines={[
              { tone: "plain", channel: "turn", text: "Turn 3 — drones." },
              { tone: "plain", channel: "move", text: "Drone 1 crosses into Dropship Bay." },
              {
                tone: "loud",
                channel: "door",
                text: "Drone 2 forces door d8 open into Staterooms — that is the whole move.",
              },
              {
                tone: "bad",
                channel: "fight",
                text: "Drone 1 attacks Scout 4 with emitter (2-2, ranged). Scout 4 has no ranged weapon and cannot answer.",
              },
              { tone: "quiet", channel: "strike", text: "  Drone 1 hits for 2 (2 left)" },
              { tone: "quiet", channel: "strike", text: "  Drone 1 misses" },
              { tone: "bad", channel: "kill", text: "Scout 4 destroyed." },
              { tone: "plain", channel: "econ", text: "Nodes pay 7. Pool 13." },
              {
                tone: "loud",
                channel: "spawn",
                text: "A Hunter is built for 15. Pool 0.",
              },
              {
                tone: "good",
                channel: "kill",
                text: "Bridge spawner destroyed. 2 spawn zone(s) left.",
              },
            ]}
          />
        ),
      },
      {
        label: "The end of it",
        node: (
          <MissionLog
            lines={[
              {
                tone: "loud",
                channel: "zoc",
                text: "Drone 2 is halted by Sentinel 7's zone of control.",
              },
              { tone: "bad", channel: "kill", text: "Drone 2 destroyed." },
              {
                tone: "bad",
                channel: "over",
                text: "Both drones are gone. Nothing is coming back to the tug.",
              },
            ]}
          />
        ),
      },
    ],
  },
  {
    path: "organisms/deck-view.html",
    name: "DeckView",
    group: "Organisms",
    subtitle: "The ship, blurred, under the hex lattice",
    blurb:
      "The map. The ship underneath is deliberately out of focus \u2014 it says what kind of place this is, where the compartments are and where the structure is dense, without competing with the grid you actually play on. The rooms are the map; the hexagons are guidance. Doors sit on the edge two hexes share, because a door is a property of a move rather than an object standing in a hex.",
    width: 620,
    variants: [
      {
        label: "The lattice over the plan",
        note: "35 ft hexes: adjacency is a believable engagement distance, which is what lets attacks stay adjacent-only.",
        node: (
          <Frame width={520} height={700}>
            <DeckView deck={underway.deck} state={underway.state} />
          </Frame>
        ),
      },
      {
        label: "A drone selected",
        note: "Everywhere it could still walk this turn. The tint stops at bulkheads and at zones of control.",
        node: (
          <Frame width={520} height={700}>
            <DeckView
              deck={underway.deck}
              state={underway.state}
              selected={droneOnMap?.at ?? null}
              reachable={reach}
            />
          </Frame>
        ),
      },
    ],
  },
  {
    path: "screens/desktop-720p.html",
    name: "Game screen — desktop",
    group: "Screens",
    subtitle: "1280x720",
    blurb:
      "The whole screen at 720p. The map keeps the room and the squad sits in a column beside it; the log runs full width underneath because a line of it is long and reads badly in a narrow column.",
    width: 1320,
    variants: [
      {
        label: "1280 x 720",
        node: (
          <Frame width={1280} height={720}>
            <GameScreen
              deck={underway.deck}
              state={underway.state}
              lines={underway.lines}
              unreachableRooms={underway.unreachableRooms}
            />
          </Frame>
        ),
      },
    ],
  },
  {
    path: "screens/mobile.html",
    name: "Game screen — mobile",
    group: "Screens",
    subtitle: "390x844 and 844x390",
    blurb:
      "The same component. Below 860px of container width the squad column becomes a strip you swipe sideways and the map keeps the space, because the map is the thing you are actually reading. It is a container query rather than a media query, so the screen responds to the room it is given rather than to the browser window \u2014 which is also why it lays out correctly inside this card.",
    width: 900,
    variants: [
      {
        label: "390 x 844 — portrait",
        node: (
          <Frame width={390} height={844}>
            <GameScreen
              deck={underway.deck}
              state={underway.state}
              lines={underway.lines}
              unreachableRooms={underway.unreachableRooms}
            />
          </Frame>
        ),
      },
      {
        label: "844 x 390 — landscape",
        note: "Turned sideways, a phone gets the desktop arrangement back.",
        node: (
          <Frame width={844} height={390}>
            <GameScreen
              deck={underway.deck}
              state={underway.state}
              lines={underway.lines}
              unreachableRooms={underway.unreachableRooms}
            />
          </Frame>
        ),
      },
    ],
  },
];

mkdirSync(outDir, { recursive: true });
for (const card of CARDS) {
  const target = join(outDir, card.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, page(card), "utf8");
  process.stdout.write(`${card.path}\n`);
}
/* The Design System pane indexes from _ds_manifest.json. It is normally
   compiled by the app's own self-check, which does not run on a plain upload —
   so a card can be present in the project and still invisible. Emitting it here
   keeps the index and the cards in step by construction. The namespace is the
   project's own and must match it. */
const NAMESPACE = "DerelictExtractionDesignSystem_df5b79";

writeFileSync(
  join(outDir, "_ds_manifest.json"),
  JSON.stringify(
    {
      namespace: NAMESPACE,
      components: [],
      startingPoints: [],
      cards: [...CARDS]
        .sort(function byPath(a, b) {
          return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
        })
        .map(function toCardEntry(card) {
          return { path: card.path, group: card.group };
        }),
      templates: [],
      hasThumbnailHtml: false,
      globalCssPaths: [],
      tokens: [],
      themes: [],
      fonts: [],
      brandFonts: [],
      source: "spa",
    },
    null,
    2,
  ),
  "utf8",
);
process.stdout.write("_ds_manifest.json\n");

writeFileSync(
  join(outDir, "index.json"),
  JSON.stringify(
    CARDS.map(function summarise(card) {
      return {
        path: card.path,
        name: card.name,
        group: card.group,
        subtitle: card.subtitle,
        width: card.width,
      };
    }),
    null,
    2,
  ),
  "utf8",
);
process.stdout.write("index.json\n");
