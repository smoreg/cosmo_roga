/**
 * The graph world model, re-exported as one surface.
 *
 * Three names are aliased on the way out because the grid model already owns
 * them at the package entry point (`sim/ai/behaviors.ts`, `sim/mapgen`), and a
 * duplicate star export is an ambiguity, not an override. Inside the package
 * these files keep their plain names; anything added here should follow the
 * same rule and alias rather than shadow.
 */
export * from "./graph.js";
export * from "./paths.js";
export * from "./noise.js";
export * from "./sight.js";

export type { RoomKindSpec, RoomCard, CardContext, ShipSpec, ShipProblem } from "./types.js";

export {
  perform as performRoom,
  label as roomLabel,
  verb as roomVerb,
  readBreach,
  BREACH_TURNS,
  BREACH_NOISE,
  type RoomCommand,
} from "./actions.js";

export {
  takeAiTurn as takeRoomAiTurn,
  runNonPlayerTurns as runNonPlayerRoomTurns,
} from "./ai.js";

export {
  RoomGame,
  replayRooms,
  type RoomGameConfig,
  type ShipTravelSpec,
  type StoredShip,
} from "./game.js";

export {
  brute,
  desireDriven as roomDesireDriven,
  hunter as roomHunter,
  turret as roomTurret,
  passableFor,
  cachedMap,
  stagger,
  mapKey,
  lastKnownRoom,
  rememberRoom,
  BEHAVIOURS as ROOM_BEHAVIOURS,
  behaviourByName as roomBehaviourByName,
  type RoomWorld,
  type RoomIntent,
  type RoomDesire,
  type FollowRule,
  type Behaviour as RoomBehaviour,
  type BehaviourName as RoomBehaviourName,
} from "./behaviours.js";

export * from "./gen/index.js";
