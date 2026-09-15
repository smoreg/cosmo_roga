import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The audio the game ships, checked as files rather than as sound.
 *
 * Three things can be wrong with the soundtrack without anybody noticing until
 * a voter has already closed the tab: a file can be missing, it can be
 * enormous, or the track can be a different length from the grid the game
 * believes it is — which puts every flash timed to the beat a little further
 * out on every loop. All three are arithmetic, so none of them needs a browser
 * or an ear.
 *
 * Nothing here runs a renderer. `npm run sfx` and `npm run music` produce the
 * one-shots, one of them needs a network and an API key, and a test suite is no
 * place for either; `main.ogg` is not rendered by this repository at all
 * (games/salvor/music/README.md). The outputs are committed, so what this
 * checks is the repository, not the toolchain.
 */

const asset = (path: string): string => fileURLToPath(new URL(`../../../assets/audio/${path}`, import.meta.url));

/** The music: one track, played at whatever level the run's state asks for. */
const TRACK = "main";

/**
 * Every one-shot. The first three are rendered from music/src/stingers; the ten
 * after them come out of ElevenLabs; the last two are synthesised by
 * music/scripts/synth-sfx.sh with sox. `SfxId` in src/ui/sfx.ts is this list,
 * and the build fails outright if one is missing — an id there is a static
 * import.
 */
const ONE_SHOTS = [
  "system",
  "dead",
  "sold",
  "burn",
  "hit",
  "salvage",
  "pulse",
  "emp",
  "weld",
  "alert",
  "door",
  "emitter",
  "machine",
  "explode",
  "fuse",
  "purge",
];

/** games/salvor/music/README.md, "Правила экспорта". */
const MUSIC_BUDGET = 1.5 * 1024 * 1024;
const SFX_BUDGET = 0.5 * 1024 * 1024;

const files = [
  { name: TRACK, path: asset(`music/${TRACK}.ogg`), kind: "music" as const },
  ...ONE_SHOTS.map((name) => ({ name, path: asset(`sfx/${name}.ogg`), kind: "sfx" as const })),
];

const missing = files.filter((file) => !existsSync(file.path)).map((file) => file.name);
const reason =
  missing.length === 0
    ? ""
    : ` — SKIPPED: ${missing.length} file(s) not generated (${missing.join(", ")}); ` +
      "run `npm run music` and `npm run sfx` (the latter needs ELEVENLABS_API_KEY)";
const whenGenerated = it.skipIf(missing.length > 0);

// A skipped suite prints as a count and nothing else, and "6 skipped" is not a
// thing anybody investigates. Say it out loud instead: silent audio that nobody
// was told about is the failure mode this whole file exists to prevent.
if (missing.length > 0) console.warn(`audio-assets${reason}`);

// ------------------------------------------------------------- ogg headers

/** Sample rate, off the Vorbis identification header. No decoder needed. */
function sampleRateOf(buf: Buffer): number {
  const at = buf.indexOf(Buffer.from([0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73])); // \x01vorbis
  if (at < 0) throw new Error("not a Vorbis stream");
  return buf.readUInt32LE(at + 12);
}

function channelsOf(buf: Buffer): number {
  const at = buf.indexOf(Buffer.from([0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]));
  if (at < 0) throw new Error("not a Vorbis stream");
  return buf.readUInt8(at + 11);
}

/**
 * Length in seconds: the granule position on the last Ogg page is the sample
 * count of the whole stream, which is the one number a container carries that
 * a lapped codec's frame count cannot be trusted to reproduce.
 */
function secondsOf(buf: Buffer): number {
  const marker = Buffer.from("OggS");
  let last = -1;
  for (let at = buf.indexOf(marker); at >= 0; at = buf.indexOf(marker, at + 1)) last = at;
  if (last < 0) throw new Error("not an Ogg container");
  return Number(buf.readBigUInt64LE(last + 6)) / sampleRateOf(buf);
}

// -------------------------------------------------------------------- tests

describe(`the audio the game ships${reason}`, () => {
  whenGenerated("has every loop and every one-shot on disk", () => {
    expect(missing).toEqual([]);
  });

  whenGenerated("keeps the whole soundtrack inside the jam's download budget", () => {
    const music = statSync(asset(`music/${TRACK}.ogg`)).size;
    const sfx = ONE_SHOTS.reduce((sum, name) => sum + statSync(asset(`sfx/${name}.ogg`)).size, 0);
    expect(music, `music is ${(music / 1024).toFixed(0)} KB`).toBeLessThanOrEqual(MUSIC_BUDGET);
    expect(sfx, `sfx is ${(sfx / 1024).toFixed(0)} KB`).toBeLessThanOrEqual(SFX_BUDGET);
  });

  /**
   * The one-shots are mono because that is what the budget above buys and
   * because a stinger is an accent rather than a place. The track is not: it is
   * the owner's own stereo master, and folding it down would spend the width
   * the piece was written with to save 300 KB the budget does not need.
   */
  whenGenerated("keeps every one-shot mono, and leaves the track its stereo", () => {
    for (const name of ONE_SHOTS) {
      expect(channelsOf(readFileSync(asset(`sfx/${name}.ogg`))), name).toBe(1);
    }
    expect(channelsOf(readFileSync(asset(`music/${TRACK}.ogg`)))).toBe(2);
  });

  /**
   * The loop is 16 bars of `GRID` in src/ui/music.ts: 64 beats at 74.9 bpm,
   * 51.27 s. That is the whole reason the grid can be trusted across the loop
   * point — the file was cut on a downbeat at both ends — and the screen reads
   * the beat off the playhead to flash in time with it (`ui/pulse.ts`). A file
   * of some other length would put the flash further out on every wrap.
   *
   * Ten milliseconds of slack, which is an eightieth of a beat: the cut was
   * made with a real waveform and a real transient, not with a calculator.
   */
  whenGenerated("makes the loop exactly sixteen bars of the grid it is played on", () => {
    const phrase = (60 / 74.9) * 4 * 16;
    const seconds = secondsOf(readFileSync(asset(`music/${TRACK}.ogg`)));
    const drift = Math.abs(seconds - phrase);
    expect(drift, `${TRACK} is ${seconds.toFixed(4)}s, the grid says ${phrase.toFixed(4)}s`).toBeLessThan(0.01);
  });

  whenGenerated("keeps every one-shot short enough to be an accent", () => {
    for (const name of ONE_SHOTS) {
      const seconds = secondsOf(readFileSync(asset(`sfx/${name}.ogg`)));
      expect(seconds, `${name} is ${seconds.toFixed(2)}s`).toBeLessThanOrEqual(2.5);
      expect(seconds, `${name} is ${seconds.toFixed(2)}s`).toBeGreaterThan(0.2);
    }
  });
});
