import { create } from "zustand";

/** Everything the player can turn down, and nothing they cannot. */
export interface SettingsStore {
  /** 0 to 1. Half by default: loud enough to hear, quiet enough to forgive. */
  volume: number;
  muted: boolean;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  /** What audio should actually play at. */
  effectiveVolume: () => number;
}

const STORAGE_KEY = "derelict:settings";
export const DEFAULT_VOLUME = 0.5;

interface Stored {
  volume?: number | undefined;
  muted?: boolean | undefined;
}

/* localStorage is absent in a private window, in some embeds, and in jsdom. */
function readStorage(): string | null {
  const store = (globalThis as { localStorage?: Storage }).localStorage;
  return store === undefined ? null : store.getItem(STORAGE_KEY);
}

function writeStorage(value: string): void {
  const store = (globalThis as { localStorage?: Storage }).localStorage;
  if (store !== undefined) store.setItem(STORAGE_KEY, value);
}

function read(): Stored {
  try {
    const raw = readStorage();
    if (raw == null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const fields = parsed as Record<string, unknown>;
    const volume = typeof fields.volume === "number" ? fields.volume : undefined;
    const muted = typeof fields.muted === "boolean" ? fields.muted : undefined;
    return { volume, muted };
  } catch {
    /* A private window, or storage switched off. Defaults are fine. */
    return {};
  }
}

function write(settings: Stored): void {
  try {
    writeStorage(JSON.stringify(settings));
  } catch {
    /* Not being able to remember the volume is not worth an error. */
  }
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, value));
}

export const useSettingsStore = create<SettingsStore>(function createSettings(set, get) {
  const stored = read();
  return {
    volume: stored.volume === undefined ? DEFAULT_VOLUME : clamp(stored.volume),
    muted: stored.muted ?? false,

    setVolume(volume) {
      const next = clamp(volume);
      set({ volume: next });
      write({ volume: next, muted: get().muted });
    },

    setMuted(muted) {
      set({ muted });
      write({ volume: get().volume, muted });
    },

    effectiveVolume() {
      const { volume, muted } = get();
      return muted ? 0 : volume;
    },
  };
});

/** Whether sound is off, as a named selector so two callers share one lambda. */
export function pickMuted(store: SettingsStore): boolean {
  return store.muted;
}
