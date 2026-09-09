import type { Vault } from "@jamrog/engine";

/**
 * Hand-drawn rooms stamped into the procedural level.
 *
 * Legend: '#' wall · '.' floor · '+' door · '>' stairs · '%' rubble
 *         '?' leave whatever is already there (ragged edges)
 *         any other letter is a marker returned to the spawner
 *         convention: 'm' monster · 'M' tough monster · 'i' item · 'X' loot
 *
 * Empty for now: SALVOR's storylets (Vault + zone/depth precondition + flag
 * effects, design-doc.md "Storylets") arrive in G7, stamped by the DeckBuilder.
 */
export const VAULTS: readonly Vault[] = [];
