/**
 * What is in a compartment, in words — the name the React view asks for it by.
 *
 * The answers are not here. `ui/schematic-input.ts` has held them since before
 * this view existed and has moved on since: a compartment is `BLOWN` rather
 * than "vented", a hazard the drone has been told about shows among the things,
 * and a wreck says its integrity. This file arrived on the React branch
 * carrying an older copy of all three, which would have drawn a crate one way
 * on the honeycomb and another on the schematic — two games, by the layer rule
 * in .claude/CLAUDE.md.
 *
 * So it re-exports and has no opinions. It stays a module rather than being
 * folded away because the React tree and its tests ask for the shape by this
 * name, and because the name says what the caller wants — the contents of a
 * compartment — where `schematic-input` says where the answer happens to live.
 */
export {
  BUCKET_GLYPH,
  CONTENT_KEYS,
  ONLINE_GLYPH,
  VENTED_GLYPH,
  bucketName,
  machinesIn,
  thingsIn,
  type RoomThing,
} from "./schematic-input.js";
