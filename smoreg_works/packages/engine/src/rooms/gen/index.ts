/**
 * Ship generation, as one surface: the generator, the invariants it is judged
 * by, and the layout both it and the schematic share.
 */
export {
  MAX_SHIP_ATTEMPTS,
  NO_CARD_STATE,
  buildShip,
  cardEligible,
  cardWeight,
  generateShip,
  type GeneratedShip,
  type PlacedCard,
} from "./shipgen.js";

export {
  DEEP_DEPTH,
  KEY_MARK,
  LOCK_ENTRY,
  reachableWithKeys,
  validateShip,
  type KeyReach,
} from "./validate.js";

export {
  MAX_COLUMN,
  layoutFaults,
  layoutShip,
  parentDoor,
  portsOf,
  treeDoors,
  type Port,
  type PortUse,
} from "./layout.js";

export {
  HEX_DIRS,
  HEX_SPACING,
  MASK_FLOOR,
  hexAdjacent,
  hexFit,
  hexKey,
  hexLayout,
  hexThickness,
  type HexCell,
  type HexLayout,
  type HexLayoutOptions,
} from "./hexlayout.js";
