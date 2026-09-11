/**
 * Types for the vendored hull generator.
 *
 * `geomorph-core.js` is a plain script with an export shim appended by
 * `scripts/sync-geomorph-core.mjs`. These declarations cover only the three
 * things the game calls; the rest of the module stays private on purpose.
 */
import type { HullPlan, PlanTile, TileTax } from "../core/mapgen/types";

export interface ManifestTile {
  readonly path: string;
  readonly set: string;
  readonly kind: string;
  readonly label: string;
  readonly w: number;
  readonly h: number;
  readonly px: readonly number[];
  readonly mirror?: boolean;
  readonly overlay?: boolean;
  readonly tons?: number;
}

export interface LayoutOptions {
  readonly seed: string;
  readonly hull: "profile" | "ship" | "deck";
  readonly profile?: string;
  readonly beam?: number;
  readonly rows?: number;
  readonly sets?: string;
  readonly family?: string;
  readonly rim?: string;
  readonly symmetric?: string | boolean;
  readonly q?: string;
  readonly spin?: boolean;
  readonly mega?: boolean;
  readonly vehic?: boolean;
}

/** Hands the generator its tile index. Returns how much of it was classified. */
export function setLibrary(
  tiles: readonly ManifestTile[],
  taxonomy: Readonly<Record<string, TileTax>>,
): { tiles: number; classified: number };

/** Rebuilds the pools a layout draws from. Call after `setLibrary`. */
export function buildPools(sets: string): void;

export function layout(options: LayoutOptions): HullPlan;

export function parseProfile(profile: string): unknown;

export type { PlanTile };
