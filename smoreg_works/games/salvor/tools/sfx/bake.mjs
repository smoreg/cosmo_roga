/**
 * The seven sound effects, encoded for the web.
 *
 *   node tools/sfx/bake.mjs [folder of .wav files]
 *
 * The originals are WAV and one of them is six hundred kilobytes, which is a
 * third of the whole JavaScript bundle for a noise that lasts under a second.
 * Vorbis at 96k mono takes them to a few tens of kilobytes each and nobody can
 * hear the difference on a laser.
 *
 * Trimmed, too: a hand-recorded sample carries silence at both ends, and
 * silence at the front of an effect is latency the player reads as the game
 * being slow to answer. `silenceremove` takes it off the head.
 *
 * Everything is resampled to 44.1k first. Two of these were recorded at 96 kHz
 * in 24 bit, and libvorbis simply refuses that combination — the encoder fails
 * to open and ffmpeg writes a zero-byte file rather than an error anybody
 * notices.
 *
 * What is committed is this script. What it writes — `public/audio/sfx` — is
 * gitignored, the same arrangement the music and the deck art have, and a tree
 * without it builds and runs silent.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const salvor = join(here, "..", "..");

/** The file each effect is cut from, by the id the game asks for it under. */
const CUTS = {
  click: "switch20.wav",
  step: "close.wav",
  melee: "melee.wav",
  blade: "beam.wav",
  laser: "shoot.wav",
  emitter: "noised_laser.wav",
  incoming: "shoot_alt.wav",
};

const from = process.argv[2] ?? join(process.env.HOME ?? "", "Downloads", "Telegram Desktop");
const missing = Object.values(CUTS).filter((f) => !existsSync(join(from, f)));
if (missing.length > 0) {
  console.error(`missing in ${from}: ${missing.join(", ")}`);
  console.error("usage: node tools/sfx/bake.mjs [folder of .wav files]");
  process.exit(1);
}

const to = join(salvor, "public", "audio", "sfx");
mkdirSync(to, { recursive: true });

let bytes = 0;
for (const [id, file] of Object.entries(CUTS)) {
  const out = join(to, `${id}.ogg`);
  execFileSync(
    "ffmpeg",
    [
      "-y", "-loglevel", "error",
      "-i", join(from, file),
      "-ac", "1", "-ar", "44100",
      "-af", "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.01,afade=t=out:st=0:d=0",
      "-c:a", "libvorbis", "-b:a", "96k",
      out,
    ],
    { stdio: "inherit" },
  );
  bytes += statSync(out).size;
}

console.log(`  ${to} — ${Object.keys(CUTS).length} effects, ${(bytes / 1024).toFixed(0)} KB`);
console.log("  gitignored: re-run this after a clone");
