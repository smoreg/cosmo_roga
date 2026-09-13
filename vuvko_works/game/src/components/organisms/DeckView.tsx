import { useId, useMemo } from "react";
import { usePanZoom } from "../../hooks/usePanZoom";
import { hexKey } from "../../core/hex";
import type { Axial, Point } from "../../core/hex";
import { ROSTER } from "../../core/roster";
import type { DeckMap, GameState } from "../../core/types";
import { doorSegments, layoutDeck, pointsToPath } from "../../render/layout";
import { doorStroke, roomFill } from "../../render/palette";

export interface ArrowStep {
  readonly from: Axial;
  readonly to: Axial;
  readonly kind: "move" | "attack" | "blocked";
}

export interface DeckViewProps {
  readonly deck: DeckMap;
  readonly state: GameState;
  /** The ship's own artwork, drawn by `renderBlueprint`. Without it the map
   *  falls back to a schematic built from the deck's own shapes. */
  readonly backdropUrl?: string | undefined;
  readonly selected?: Axial | null | undefined;
  readonly reachable?: ReadonlySet<string> | undefined;
  /** Reachable only by forcing a shut door; shown in the door's own colour. */
  readonly forceable?: ReadonlySet<string> | undefined;
  readonly onPick?: ((point: Point) => void) | undefined;
  readonly onHover?: ((point: Point | null) => void) | undefined;
  /** The route the selected drone would take, one arrow per step. */
  readonly arrows?: readonly ArrowStep[] | undefined;
  readonly showLabels?: boolean | undefined;
  /** How far out of focus the ship sits, in feet of ship. */
  readonly backdropBlur?: number | undefined;
}

/** A tile's declared footprint in feet, from the `[WxH]` in its own name. */
function tileFootprint(path: string): [number, number] | null {
  const found = /\[(\d+)x(\d+)\]/.exec(path);
  if (found === null) return null;
  return [Number(found[1]), Number(found[2])];
}

/**
 * How far out of focus the ship sits — in feet of ship, not in hexes.
 *
 * Blur has to be measured against the thing being blurred. A bulkhead is about
 * a foot thick and a console rather less, so a radius tied to the hex instead
 * scaled the smear to thirty-five feet and wiped out every line the plan is
 * worth having: the ship came back as a few dim clouds and read as missing
 * rather than as background. Two thirds of a foot softens the artwork's own
 * antialiasing without touching anything you would want to recognise.
 */
const BACKDROP_BLUR_FEET = 0.7;
/** Blobs the size of rooms, so this one genuinely does scale with the hex. */
const SCHEMATIC_BLUR = 0.22;
/**
 * Under the lattice, not behind it.
 *
 * The plan's own ink covers under a fifth of the canvas — thin lines on empty
 * deck — so what reaches the eye is that fraction again through this. It can
 * afford to be high; it is the blur that was hiding the ship, not the opacity.
 */
const BACKDROP_OPACITY = 0.72;
/**
 * How firmly the lattice sits on top of the ship.
 *
 * The two are in tension and both are needed: the rooms are the map, but the
 * hexagons are what you actually move on, and a grid you have to look for is
 * a grid you will misjudge a move on. Once the plan underneath became legible
 * the old lattice stopped holding its own against it — so the edges gain
 * weight and colour rather than the fills gaining opacity, because it is the
 * edges that say where a hex begins and the fills that would bury the ship.
 * The fill still goes up, but only enough to keep the room colours reading
 * through the artwork.
 */
const HEX_FILL_OPACITY = 0.75;
const HEX_EDGE = "#46606f";
/** In hex widths, so the lattice keeps its weight at any scale. */
const HEX_EDGE_WIDTH = 0.019;

/**
 * The map: the ship underneath and the hex lattice over it.
 *
 * The backdrop is held back by opacity, not by blur. It should read as a
 * detailed plan — bulkheads, consoles, the shape of a hangar — because that
 * detail is what makes it worth having; it just must not compete with the
 * lattice you actually play on. The rooms are the map; the hexagons are
 * guidance.
 */
export function DeckView(props: DeckViewProps) {
  const { deck, state, backdropUrl, selected, reachable, forceable, arrows } = props;
  /* Every hex the plan passes through, and the one it ends on. */
  const onPath = new Set((arrows ?? []).map((step) => hexKey(step.to)));
  const endOfPath = ((last) => (last === undefined ? null : hexKey(last)))(
    (arrows ?? []).at(-1)?.to,
  );
  const { onPick, onHover, showLabels = false, backdropBlur = BACKDROP_BLUR_FEET } = props;

  const layout = useMemo(
    function computeLayout() {
      return layoutDeck(deck);
    },
    [deck],
  );

  const doors = useMemo(
    function computeDoors() {
      return doorSegments(deck, layout, state.doorStates);
    },
    [deck, layout, state.doorStates],
  );

  const {
    attach: attachSvg,
    transform: viewTransform,
    dragging,
    wasDragged,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    reset: resetView,
    zoomBy,
    toContent,
  } = usePanZoom(layout.bounds.width, layout.bounds.height, layout.bounds.x, layout.bounds.y);
  const { bounds, geometry } = layout;
  const unit = geometry.feetAcross;
  /* Unique per instance: more than one map can share a page, and a repeated
     filter id would silently make the second borrow the first one's blur. */
  const blurId = `deck-blur-${useId().replace(/:/g, "")}`;
  const selectedKey = selected == null ? null : hexKey(selected);

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>): void {
    onPointerMove(event);
    if (onHover === undefined) return;
    onHover(toContent(event.clientX, event.clientY));
  }

  function handlePointerLeave(event: React.PointerEvent<SVGSVGElement>): void {
    onPointerUp(event);
    if (onHover !== undefined) onHover(null);
  }

  function zoomIn(): void {
    zoomBy(1.35);
  }
  function zoomOut(): void {
    zoomBy(1 / 1.35);
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <svg
        ref={attachSvg}
        viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
        width="100%"
        height="100%"
        role="img"
        aria-label={`Deck plan of ${deck.name}`}
        onPointerDown={onPointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={resetView}
        style={{
          display: "block",
          background: "var(--void)",
          cursor: dragging ? "grabbing" : "grab",
          touchAction: "none",
        }}
      >
        <defs>
          {/* Enough to push the plan behind the glass without dissolving it:
            the detail is the point, it just must not compete with the
            lattice. The schematic is hex-shaped blobs and needs more, and
            those really are hex-sized, so that one stays a fraction of a
            hex. */}
          <filter id={blurId} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur
              stdDeviation={backdropUrl === undefined ? unit * SCHEMATIC_BLUR : backdropBlur}
            />
          </filter>
        </defs>

        <g transform={viewTransform}>
          {backdropUrl === undefined ? (
            <g aria-hidden="true">
              <g filter={`url(#${blurId})`} opacity={0.7}>
                {layout.rooms.map(function drawRoom(room) {
                  return (
                    <g key={room.zone.id} fill={roomFill(room.zone.kind)}>
                      {room.points.map(function drawPatch(points, index) {
                        return <polygon key={index} points={pointsToPath(points)} />;
                      })}
                    </g>
                  );
                })}
              </g>
              {/* The tiles the plan was built from, left sharp. Without the
                artwork this is the only real structure we have, and a plan with
                no structure in it is just a stain. */}
              <g
                stroke="#7ab0d6"
                strokeWidth={unit * 0.02}
                fill="none"
                opacity={0.3}
                pointerEvents="none"
              >
                {deck.plan.map(function drawTile(placement, index) {
                  const turned = placement.rotation % 180 !== 0;
                  const size = tileFootprint(placement.path);
                  if (size === null) return null;
                  const width = turned ? size[1] : size[0];
                  const height = turned ? size[0] : size[1];
                  return (
                    <rect
                      key={index}
                      x={placement.x}
                      y={placement.y}
                      width={width}
                      height={height}
                    />
                  );
                })}
              </g>
            </g>
          ) : (
            /* The ship itself, held back by opacity rather than by blur. */
            <image
              href={backdropUrl}
              x={0}
              y={0}
              width={deck.sizeFeet[0]}
              height={deck.sizeFeet[1]}
              preserveAspectRatio="none"
              opacity={BACKDROP_OPACITY}
              filter={`url(#${blurId})`}
              aria-hidden="true"
            />
          )}

          {/* The lattice. */}
          <g>
            {layout.hexes.map(function drawHex(shape) {
              const key = hexKey(shape.at);
              return (
                <polygon
                  key={key}
                  className="hex"
                  points={pointsToPath(shape.points)}
                  fill={roomFill(deck.zones.get(shape.zoneId)?.kind ?? "")}
                  fillOpacity={HEX_FILL_OPACITY}
                  stroke={HEX_EDGE}
                  strokeWidth={unit * HEX_EDGE_WIDTH}
                  style={onPick === undefined ? undefined : { cursor: "pointer" }}
                  onClick={
                    onPick === undefined
                      ? undefined
                      : function pick(event) {
                          /* A pan is not a click, and the click's own position
                             is what picks the hex — a touch may never have
                             hovered anything first. */
                          if (wasDragged()) return;
                          onPick(toContent(event.clientX, event.clientY));
                        }
                  }
                />
              );
            })}
          </g>

          {/* Where the selected drone could still walk, over the room colour —
              and, in the door's own colour, where it could get to only by
              shouldering one open. */}
          <g pointerEvents="none">
            {layout.hexes.map(function tintReach(shape) {
              const key = hexKey(shape.at);
              const walkable = reachable?.has(key) === true;
              const throughDoor = !walkable && forceable?.has(key) === true;
              if (!walkable && !throughDoor) return null;
              return (
                <polygon
                  key={key}
                  points={pointsToPath(shape.points)}
                  fill={walkable ? "var(--drone)" : "var(--door)"}
                  opacity={walkable ? 0.2 : 0.16}
                />
              );
            })}
          </g>

          {/* The route the plan would actually take, outlined rather than
              arrowed.

              The kit draws a path by thickening the border of every hex on it
              in the drone's own colour and the hovered one in near-white — no
              arrowheads, no second symbol language over a board that is already
              hexagons and glyphs. It also reads at a glance as *ground you are
              committing to* rather than as an instruction. */}
          {onPath.size === 0 ? null : (
            <g pointerEvents="none" fill="none" strokeLinejoin="round">
              {layout.hexes.map(function outlineStep(shape) {
                const key = hexKey(shape.at);
                if (!onPath.has(key)) return null;
                const last = key === endOfPath;
                return (
                  <polygon
                    key={`path-${key}`}
                    points={pointsToPath(shape.points)}
                    stroke={last ? "#d7f0fc" : "var(--drone)"}
                    strokeOpacity={last ? 0.98 : 0.8}
                    strokeWidth={unit * (last ? 0.07 : 0.055)}
                  />
                );
              })}
            </g>
          )}

          {/* Hull and bulkheads: the edges that make this a graph of chokepoints. */}
          <g strokeLinecap="round" pointerEvents="none">
            {layout.walls.map(function drawWall(wall, index) {
              return (
                <line
                  key={index}
                  x1={wall.from.x}
                  y1={wall.from.y}
                  x2={wall.to.x}
                  y2={wall.to.y}
                  stroke={wall.kind === "hull" ? "#4a565f" : "#5b6a74"}
                  strokeWidth={unit * (wall.kind === "hull" ? 0.05 : 0.055)}
                />
              );
            })}
          </g>

          {/* Doors sit on the edge two hexes share. */}
          <g strokeLinecap="round" pointerEvents="none">
            {doors.map(function drawDoor(door) {
              return (
                <g key={door.doorId}>
                  {door.leaves.map(function drawLeaf(leaf, index) {
                    return (
                      <line
                        key={index}
                        x1={leaf[0].x}
                        y1={leaf[0].y}
                        x2={leaf[1].x}
                        y2={leaf[1].y}
                        stroke={doorStroke(door.state)}
                        strokeWidth={unit * (door.state === "broken" ? 0.055 : 0.075)}
                      />
                    );
                  })}
                </g>
              );
            })}
          </g>

          {/* Machinery. */}
          <g pointerEvents="none">
            {state.objects.map(function drawObject(object) {
              if (object.hp <= 0) return null;
              const shape = layout.hexes.find(function atSameHex(candidate) {
                return hexKey(candidate.at) === hexKey(object.at);
              });
              if (shape === undefined) return null;
              const radius = unit * 0.26;
              const { x, y } = shape.centre;
              return (
                <g key={`object-${object.id}`}>
                  {object.kind === "spawner" ? (
                    <polygon
                      points={`${x},${y - radius} ${x + radius},${y} ${x},${y + radius} ${x - radius},${y}`}
                      fill="var(--spawn)"
                      stroke="#1a0f0d"
                      strokeWidth={unit * 0.02}
                    />
                  ) : (
                    <rect
                      x={x - radius * 0.8}
                      y={y - radius * 0.8}
                      width={radius * 1.6}
                      height={radius * 1.6}
                      fill="var(--node)"
                      stroke="#0d1a15"
                      strokeWidth={unit * 0.02}
                    />
                  )}
                  <text
                    x={x}
                    y={y + radius * 1.95}
                    textAnchor="middle"
                    fill="var(--dim)"
                    fontSize={unit * 0.19}
                    fontFamily="var(--font-mono)"
                  >
                    {object.hp}/{object.maxHp}
                  </text>
                </g>
              );
            })}
          </g>

          {/* Units. */}
          <g pointerEvents="none">
            {state.units.map(function drawUnit(unitOnMap) {
              if (unitOnMap.hp <= 0) return null;
              const shape = layout.hexes.find(function atSameHex(candidate) {
                return hexKey(candidate.at) === hexKey(unitOnMap.at);
              });
              if (shape === undefined) return null;
              const radius = unit * 0.3;
              const { x, y } = shape.centre;
              const colour = unitOnMap.side === "drone" ? "var(--drone)" : "var(--ship)";
              const glyph =
                unitOnMap.side === "drone"
                  ? `D${unitOnMap.id + 1}`
                  : ROSTER[unitOnMap.type].label.slice(0, 1).toUpperCase();
              return (
                /* `data-unit` is how an effect finds this token without a ref
                   through thirteen layers of SVG, and without React owning the
                   attribute an effect writes. See design/ui-kit/motion.md. */
                <g key={`unit-${unitOnMap.id}`} data-unit={unitOnMap.id}>
                  <circle
                    cx={x}
                    cy={y}
                    r={radius}
                    fill={colour}
                    opacity={unitOnMap.hasAttacked ? 0.45 : 1}
                    stroke="#0b0e10"
                    strokeWidth={unit * 0.025}
                  />
                  <text
                    x={x}
                    y={y + unit * 0.08}
                    textAnchor="middle"
                    fill="#0b0e10"
                    fontSize={unit * 0.26}
                    fontWeight={700}
                    fontFamily="var(--font-mono)"
                  >
                    {glyph}
                  </text>
                  <text
                    x={x}
                    y={y - radius * 1.3}
                    textAnchor="middle"
                    fill="var(--ink)"
                    fontSize={unit * 0.19}
                    fontFamily="var(--font-mono)"
                  >
                    {unitOnMap.hp}/{unitOnMap.maxHp}
                  </text>
                </g>
              );
            })}
          </g>

          {/* Selection. */}
          {selectedKey === null ? null : (
            <g pointerEvents="none">
              {layout.hexes
                .filter(function isSelected(shape) {
                  return hexKey(shape.at) === selectedKey;
                })
                .map(function drawRing(shape) {
                  return (
                    <polygon
                      key="selection"
                      points={pointsToPath(shape.points)}
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth={unit * 0.05}
                    />
                  );
                })}
            </g>
          )}

          {/* The arrows the route used to be drawn with are gone; the outlined
              hexes above say the same thing without a second symbol language
              over a board that is already hexagons and glyphs. */}

          {showLabels ? (
            <g pointerEvents="none">
              {layout.rooms.map(function label(room) {
                const first = room.points[0];
                if (first === undefined) return null;
                const anchor = first[0];
                if (anchor === undefined) return null;
                return (
                  <text
                    key={`label-${room.zone.id}`}
                    x={anchor.x}
                    y={anchor.y}
                    fill="var(--dim)"
                    fontSize={unit * 0.2}
                    fontFamily="var(--font-mono)"
                  >
                    {room.zone.name}
                  </text>
                );
              })}
            </g>
          ) : null}
        </g>
      </svg>

      {/* Bottom left, where the kit puts them and where nothing else wants to
          be: the two things you press to commit are bottom right, and putting
          the view controls beside them makes a misclick a lost turn. */}
      <div
        style={{
          position: "absolute",
          left: 58,
          bottom: 12,
          display: "flex",
          gap: 6,
          font: "700 var(--font-sm)/1 var(--font-mono)",
        }}
      >
        <ViewButton label="−" title="Zoom out" onPress={zoomOut} />
        <ViewButton label="+" title="Zoom in" onPress={zoomIn} />
        <ViewButton
          label="fit"
          title="Reset the view (or double-click the map)"
          onPress={resetView}
        />
      </div>
    </div>
  );
}

interface ViewButtonProps {
  readonly label: string;
  readonly title: string;
  readonly onPress: () => void;
}

function ViewButton({ label, title, onPress }: ViewButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onPress}
      style={{
        minWidth: 30,
        padding: "6px 8px",
        background: "var(--panel)",
        color: "var(--ink)",
        border: "1px solid var(--rule)",
        cursor: "pointer",
        font: "inherit",
      }}
    >
      {label}
    </button>
  );
}
