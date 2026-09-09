// Generate the game's sound effects with ElevenLabs text-to-sound-effects.
//
//   export ELEVENLABS_API_KEY=...
//   npm run sfx              # only what is missing
//   npm run sfx -- --force   # regenerate everything
//   npm run sfx -- --only burn
//
// The key is read from the environment and nowhere else: never printed, never
// written to a file, never a command-line argument (which would put it in the
// shell history and in `ps`). If it is not set, the script says what is missing
// and stops without touching anything already generated.
//
// The prompts below are the source of truth for what each effect is. They are
// the only description of these files that exists — the .ogg next to them is
// the output of a model and cannot be edited back into something else — so they
// are written to be re-run, not to be read once.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../../..");
const OUT = join(REPO, "assets/audio/sfx");

const ENDPOINT = "https://api.elevenlabs.io/v1/sound-generation";
/** Three tries and then a line in the report. A rate limit is not a puzzle. */
const ATTEMPTS = 3;
/** Every effect is an event in a turn-based game: heard, then gone. */
const MAX_SECONDS = 1.5;

/**
 * The ten effects, and what each one is.
 *
 * Every id here is an `SfxId` in ../../src/ui/sfx.ts and is reached from a log
 * line — nothing is generated that the game has no way to play. Three more ids
 * (`system`, `dead`, `sold`) are musical stingers and come out of render.mjs
 * instead: those are about the run turning, not about something happening in a
 * compartment, and a synthesised chord says that better than a sound does.
 */
const EFFECTS = {
  burn: {
    duration: 1.2,
    prompt:
      "An electrical component burning out inside a machine: one sharp capacitor pop, " +
      "a short crackle of arcing current, then dead silence. Close-miked, dry, no music.",
  },
  hit: {
    duration: 1.0,
    prompt:
      "A heavy blunt impact on the armoured hull of a small drone: one deep metallic clang " +
      "with a brief ringing tail. Dry, industrial, no reverb tail beyond the metal itself.",
  },
  salvage: {
    duration: 1.5,
    prompt:
      "Prying a metal component out of a wrecked machine: metal scraping on metal, " +
      "a short servo whine, and a clunk as the part comes free onto a steel deck.",
  },
  pulse: {
    duration: 1.2,
    prompt:
      "A cold synthetic sensor ping sweeping upward in pitch, like sonar aboard a ship, " +
      "with a short metallic tail. Clean, electronic, no music.",
  },
  emp: {
    duration: 1.4,
    prompt:
      "An electromagnetic pulse discharging from a coil: a deep sub-bass thump followed by " +
      "a rush of crackling static that collapses quickly into silence.",
  },
  weld: {
    duration: 1.5,
    prompt:
      "An arc welder striking steel: a burst of hissing electrical crackle with spitting sparks, " +
      "close-miked and dry. Continuous, no start-up or shut-down.",
  },
  alert: {
    duration: 1.5,
    prompt:
      "A derelict spacecraft waking up: a single low industrial klaxon rising once in pitch, " +
      "distant and muffled as if heard through thick steel bulkheads. Ominous, no music.",
  },
  door: {
    duration: 1.5,
    prompt:
      "A heavy steel bulkhead door unsealing and sliding open: a pneumatic hiss of pressure " +
      "releasing, then the grinding slide of metal on metal, ending with a solid stop.",
  },
  emitter: {
    duration: 1.0,
    prompt:
      "A short energy weapon discharge: a tight electrical whipcrack with a synthetic " +
      "descending tail. Sharp attack, fast decay, science fiction.",
  },
  machine: {
    duration: 1.5,
    prompt:
      "A small walking machine collapsing: a servo whining down, metal limbs folding, " +
      "and a final clatter of scrap onto a steel deck.",
  },
};

/**
 * One generation. Returns the mp3 bytes, or throws with what the API said.
 *
 * The key goes into a header and into nothing else. Nothing in this function
 * puts it into a message, and the error path deliberately reports the status
 * and the body — which never contains the key — rather than the request.
 */
async function generate(key, prompt, duration) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      text: prompt,
      duration_seconds: Math.min(duration, MAX_SECONDS),
      prompt_influence: 0.45,
    }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * mp3 to mono Ogg Vorbis, trimmed and topped and tailed.
 *
 * The fades are not cosmetic: a generated clip can start or end mid-waveform,
 * and in a game that fires it on a keypress that edge is a click every time.
 */
function convert(mp3, ogg) {
  execFileSync(
    "sox",
    [mp3, "-c", "1", "-r", "44100", "-C", "4", ogg,
     "trim", "0", String(MAX_SECONDS),
     "gain", "-n", "-3",
     "fade", "t", "0.005", String(MAX_SECONDS), "0.04"],
    { stdio: "pipe" },
  );
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;

  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    console.error(
      "ELEVENLABS_API_KEY is not set.\n" +
        "Export it in this shell and re-run; it must never be committed or passed as an argument.",
    );
    process.exit(1);
  }

  mkdirSync(OUT, { recursive: true });
  const wanted = Object.entries(EFFECTS).filter(([id]) => only === undefined || id === only);
  if (wanted.length === 0) throw new Error(`no effect named '${only}' — see EFFECTS`);

  const failed = [];
  let total = 0;

  for (const [id, spec] of wanted) {
    const ogg = join(OUT, `${id}.ogg`);
    if (existsSync(ogg) && !force) {
      total += statSync(ogg).size;
      console.log(`${id.padEnd(9)} kept (${(statSync(ogg).size / 1024).toFixed(1)} KB)`);
      continue;
    }

    let bytes;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        bytes = await generate(key, spec.prompt, spec.duration);
        break;
      } catch (error) {
        if (attempt === ATTEMPTS) {
          failed.push(`${id}: ${error.message}`);
        } else {
          await new Promise((done) => setTimeout(done, attempt * 2000));
        }
      }
    }
    if (!bytes) continue;

    // The mp3 is scratch: it is what the API returns, and only the .ogg ships.
    const mp3 = join(OUT, `${id}.mp3`);
    writeFileSync(mp3, bytes);
    convert(mp3, ogg);
    execFileSync("rm", [mp3]);
    total += statSync(ogg).size;
    console.log(`${id.padEnd(9)} ${(statSync(ogg).size / 1024).toFixed(1)} KB`);
  }

  console.log(`\ntotal ${(total / 1024).toFixed(1)} KB in ${OUT}`);
  if (failed.length > 0) {
    console.error(`\n${failed.length} failed:\n  ${failed.join("\n  ")}`);
    process.exit(1);
  }
}

await main();
