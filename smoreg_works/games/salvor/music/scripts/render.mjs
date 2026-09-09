// Render the Strudel patterns in ../src/stingers to .ogg one-shots in assets/audio/sfx.
//
//   node games/salvor/music/scripts/render.mjs --setup   # once: fetch Strudel
//   node games/salvor/music/scripts/render.mjs           # everything
//   node games/salvor/music/scripts/render.mjs --only dead
//   node games/salvor/music/scripts/render.mjs --keep-wav   # leave the PCM behind
//
// This rendered the game's five music loops too, until the owner wrote a track
// for it and one file replaced all five (../README.md). What is left is the
// three stingers — a system raised, a drone lost, a hull sold — which are music
// the sfx player fires off a log line rather than anything the music player
// knows about.
//
// Strudel itself is never a dependency of this repository. It is installed into
// STRUDEL_HOME (default ~/.cache/salvor-strudel) and loaded from there, because
// the game ships rendered files and has no business carrying a live-coding
// runtime into `npm install` for everyone who only wants to play it.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SAMPLE_RATE, renderEvent, reverb, seedNoise } from "./synth.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MUSIC = resolve(HERE, "..");
const REPO = resolve(MUSIC, "../../..");
/** Beside the effects, not beside the music: a stinger is a one-shot `sfx.ts` fires. */
const OUT_STINGERS = join(REPO, "assets/audio/sfx");

const STRUDEL_HOME = process.env.STRUDEL_HOME ?? join(homedir(), ".cache/salvor-strudel");
const STRUDEL_PACKAGES = ["core", "mini", "tonal", "transpiler"];
/** Pinned: a render has to give the same bytes next month as it does today. */
const STRUDEL_VERSION = "1.2.6";

/**
 * The tempo the stingers were written at, and nothing else's business.
 *
 * It used to have to agree with `GRID` in src/ui/music.ts, because the loops
 * rendered here were the music the player scheduled against. They are not any
 * more — the game plays one track at 74.9 bpm that this script did not make —
 * and these numbers now only decide how fast a stinger's own notes fall. Change
 * one and the three committed one-shots come out different; nothing else moves.
 */
const GRID = { bpm: 84, beatsPerBar: 4, barsPerPhrase: 4 };
const CYCLES_PER_SECOND = GRID.bpm / 60 / GRID.beatsPerBar;
/** Cycles the renderer wraps event times to, when it is asked to be periodic. */
const LOOP_CYCLES = GRID.barsPerPhrase;

/** Room enough for the longest release plus its reverb tail. */
const TAIL_SECONDS = 4;
/** A stinger is an accent, not a cue: anything longer steps on the music. */
const MAX_STINGER_SECONDS = 2.2;
/** One master trim for every state, so `tug` stays quieter than `hunter`. */
const MASTER = 0.7;
/** How much of an orbit's reverb send comes back into the mix. */
const WET = 0.55;

const STINGERS = ["system", "dead", "sold"];

// ------------------------------------------------------------------- setup

function setup() {
  mkdirSync(STRUDEL_HOME, { recursive: true });
  writeFileSync(
    join(STRUDEL_HOME, "package.json"),
    `${JSON.stringify(
      {
        name: "salvor-strudel-host",
        private: true,
        type: "module",
        dependencies: Object.fromEntries(
          STRUDEL_PACKAGES.map((p) => [`@strudel/${p}`, STRUDEL_VERSION]),
        ),
      },
      null,
      2,
    )}\n`,
  );
  execFileSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: STRUDEL_HOME, stdio: "inherit" });

  // @strudel/core pulls in @kabelsalat/web, which assumes a browser and throws
  // on import in Node. Synthesis here is ours, so a stub is all it has to be.
  const kabelsalat = join(STRUDEL_HOME, "node_modules/@kabelsalat/web/dist/index.js");
  if (existsSync(kabelsalat)) {
    writeFileSync(kabelsalat, "export class SalatRepl { evaluate() {} stop() {} }\nexport default { SalatRepl };\n");
  }
  console.log(`Strudel ${STRUDEL_VERSION} ready in ${STRUDEL_HOME}`);
}

/** Import a package out of STRUDEL_HOME without making it a dependency here. */
async function loadStrudel(name) {
  const root = join(STRUDEL_HOME, "node_modules/@strudel", name);
  if (!existsSync(root)) {
    throw new Error(`Strudel is not installed. Run: node ${"scripts/render.mjs"} --setup`);
  }
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const entry = pkg.module ?? pkg.exports?.["."]?.import ?? pkg.exports?.["."] ?? pkg.main;
  return import(pathToFileURL(join(root, typeof entry === "string" ? entry : "dist/index.mjs")).href);
}

// ----------------------------------------------------------------- patterns

/**
 * Evaluate one pattern file and hand back its `$:` layers.
 *
 * The same trick the composing-music scripts use: `$:` compiles to `.p(id)`, so
 * overriding `p` collects every layer in source order instead of registering it
 * with a scheduler that does not exist outside a browser.
 */
async function layersOf(file, strudel) {
  const { core, mini, tonal, transpiler } = strudel;
  const collected = [];
  core.Pattern.prototype.p = function collect() {
    collected.push(this);
    return this;
  };
  for (const browserOnly of ["pianoroll", "punchcard", "spiral", "scope", "draw", "animate"]) {
    core.Pattern.prototype[browserOnly] = function passthrough() {
      return this;
    };
  }

  const scope = {
    ...core,
    ...core.controls,
    ...mini,
    ...tonal,
    setcpm: () => {},
    setcps: () => {},
    samples: () => {},
    hush: () => {},
  };
  const { output } = transpiler.transpiler(readFileSync(file, "utf8"), { wrapAsync: true, addReturn: true });
  const names = Object.keys(scope);
  const result = await new Function(...names, `return ${output}`)(...names.map((n) => scope[n]));
  return collected.length > 0 ? collected : [core.reify(result)];
}

// ------------------------------------------------------------------ mixdown

/**
 * Query `cycles` of the pattern and mix it into a buffer `seconds` long.
 *
 * Voices that ring past the end are kept: the buffer is allocated with a tail
 * and the caller decides what to do with it.
 */
function mix(layers, cycles, seconds, loopSeconds = Infinity) {
  const length = Math.ceil((seconds + TAIL_SECONDS) * SAMPLE_RATE);
  const loopSamples = Math.round(loopSeconds * SAMPLE_RATE);
  const dry = new Float32Array(length);
  const sends = new Map(); // orbit -> wet bus

  for (const layer of layers) {
    for (const hap of layer.queryArc(0, cycles)) {
      if (!hap.hasOnset()) continue;
      const beginsAt = hap.whole.begin.valueOf();
      const start = Math.round((beginsAt / CYCLES_PER_SECOND) * SAMPLE_RATE);
      // Oscillator phase is taken from where the event sits *inside* the loop,
      // not from the start of the render. Absolute time would keep consecutive
      // notes continuous but leave iteration three out of phase with iteration
      // two, and it is loop-periodicity, not render-continuity, that the file
      // has to have. Within one loop the two are the same thing.
      const startSeconds =
        (Number.isFinite(loopSeconds) ? beginsAt % LOOP_CYCLES : beginsAt) / CYCLES_PER_SECOND;
      const held = (hap.whole.end.valueOf() - hap.whole.begin.valueOf()) / CYCLES_PER_SECOND;
      // A layer that holds for the whole loop is a bed, not a note: it must not
      // be re-attacked every time round. See `renderEvent`.
      const sustained = held >= loopSeconds - 1e-6;
      // Noise is seeded by where the event falls *within* the loop, not by how
      // many events came before it, so the same hi-hat comes out of the same
      // dice every time round. That is what makes the rendered signal exactly
      // periodic, and an exactly periodic signal has no seam to hide.
      seedNoise(noiseSeed(start, loopSamples, hap.value));
      const voice = renderEvent(hap.value, held, { startSeconds, sustained, loopSeconds });

      let wet;
      if (voice.room > 0) {
        const orbit = hap.value.orbit ?? 1;
        wet = sends.get(orbit);
        if (!wet) {
          wet = new Float32Array(length);
          sends.set(orbit, wet);
        }
      }
      for (let i = 0; i < voice.samples.length; i++) {
        const at = start + i;
        if (at < 0 || at >= length) continue;
        const sample = voice.samples[i] * voice.gain;
        dry[at] += sample;
        if (wet) wet[at] += sample * voice.room;
      }
    }
  }

  for (const wet of sends.values()) {
    const tail = reverb(wet);
    for (let i = 0; i < length; i++) dry[i] += tail[i] * WET;
  }
  return dry;
}

/** A stable seed per (position in loop, voice): see the call site. */
function noiseSeed(start, loopSamples, value) {
  let hash = Number.isFinite(loopSamples) ? (((start % loopSamples) + loopSamples) % loopSamples) : start;
  for (const ch of `${value.s ?? ""}|${value.note ?? ""}|${value.orbit ?? ""}`) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return (hash * 2654435761) >>> 0 || 1;
}

/** Master trim, and a soft knee for whatever still pokes through. */
function master(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    samples[i] *= MASTER;
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  if (peak > 1) for (let i = 0; i < samples.length; i++) samples[i] = Math.tanh(samples[i]);
  return peak;
}

function fadeOut(samples, seconds) {
  const n = Math.min(samples.length, Math.round(seconds * SAMPLE_RATE));
  for (let i = 0; i < n; i++) samples[samples.length - n + i] *= 1 - i / n;
}

// --------------------------------------------------------------------- files

function writeWav(path, samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
}

/**
 * WAV to Ogg Vorbis, mono. sox rather than ffmpeg on purpose: this ffmpeg build
 * has only the experimental native vorbis encoder, and its output at these
 * bitrates is audibly worse than sox's libvorbis.
 */
function encode(wav, ogg, quality) {
  execFileSync("sox", [wav, "-C", String(quality), ogg], { stdio: "pipe" });
}

// ---------------------------------------------------------------------- main

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--setup")) {
    setup();
    return;
  }
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
  // The intermediate PCM, for checking a seam or a level without Vorbis in the
  // way. Never committed — .wav is ignored under assets/audio.
  const keepWav = args.includes("--keep-wav");

  const strudel = {
    core: await loadStrudel("core"),
    mini: await loadStrudel("mini"),
    tonal: await loadStrudel("tonal"),
    transpiler: await loadStrudel("transpiler"),
  };
  await strudel.core.evalScope(strudel.core, strudel.core.controls, strudel.mini, strudel.tonal);

  mkdirSync(OUT_STINGERS, { recursive: true });
  const jobs = STINGERS.map((name) => ({
    name,
    file: join(MUSIC, "src/stingers", `${name}.js`),
  })).filter((job) => only === undefined || job.name === only);

  if (jobs.length === 0) throw new Error(`nothing named '${only}' in src/stingers/`);

  let total = 0;
  for (const job of jobs) {
    const layers = await layersOf(job.file, strudel);

    const buf = mix(layers, 1, 1 / CYCLES_PER_SECOND);
    const samples = buf.subarray(0, Math.round(MAX_STINGER_SECONDS * SAMPLE_RATE));
    fadeOut(samples, 0.25);
    const quality = 4;

    const peak = master(samples);
    const wav = join(OUT_STINGERS, `${job.name}.wav`);
    const ogg = join(OUT_STINGERS, `${job.name}.ogg`);
    writeWav(wav, samples);
    encode(wav, ogg, quality);
    const bytes = statSync(ogg).size;
    total += bytes;
    console.log(
      `${job.name.padEnd(8)} ${layers.length} layers  ${(samples.length / SAMPLE_RATE).toFixed(2)}s  ` +
        `peak ${peak.toFixed(2)}  ${(bytes / 1024).toFixed(1)} KB`,
    );
  }

  // The .wav files are scratch: only the .ogg ships, and only it is committed.
  if (!keepWav) {
    for (const file of readdirSync(OUT_STINGERS)) {
      if (file.endsWith(".wav")) rmSync(join(OUT_STINGERS, file));
    }
  }
  console.log(`\ntotal ${(total / 1024).toFixed(1)} KB of stingers`);
}

await main();
