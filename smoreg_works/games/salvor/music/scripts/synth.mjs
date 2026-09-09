// A small offline synthesiser: Strudel events in, mono PCM out.
//
// Strudel is a browser instrument and has no way to write a file, so the export
// path splits in two (see ../README.md): @strudel/core evaluates the pattern in
// Node and hands over the events it would have played, and this file is what
// plays them. Nothing here talks to Strudel — the input is plain objects with
// the control names Strudel emits (`s`, `note`, `cutoff`, `decay`, …).
//
// Deliberately not a sampler. Sample banks would be another 30 MB in a repo
// whose whole audio budget is 2 MB, and every drum here is a shape a TR-909
// makes with an oscillator and a noise burst anyway. What this costs is
// honesty about timbre: the loops are the patterns' structure rendered with
// this synth's voices, not with strudel.cc's.

export const SAMPLE_RATE = 44100;

/** Percussion voices, and how long each rings when the pattern does not say. */
const DRUMS = {
  bd: 0.5,
  sd: 0.2,
  hh: 0.06,
  oh: 0.35,
  rim: 0.04,
  cp: 0.25,
  lt: 0.35,
  mt: 0.3,
  ht: 0.25,
};

const OSCILLATORS = new Set(["sine", "sawtooth", "square", "triangle"]);
const NOISES = new Set(["white", "pink", "brown"]);

const SEMITONES = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/**
 * Noise comes off a seeded generator rather than `Math.random`, so re-rendering
 * a loop produces the same bytes. Without it every export would be a diff, and
 * "the seam is silent" would be a claim about one lucky run rather than about
 * the file in the repository.
 */
let noiseState = 0x5a1f0000;

export function seedNoise(seed) {
  noiseState = (seed >>> 0) || 1;
}

/** xorshift32, bipolar. */
function rnd() {
  noiseState ^= noiseState << 13;
  noiseState ^= noiseState >>> 17;
  noiseState ^= noiseState << 5;
  noiseState >>>= 0;
  return (noiseState / 0xffffffff) * 2 - 1;
}

/**
 * "eb3", "a1", "c#4" → Hz. Also passes numbers through as MIDI notes, which is
 * what `n()` and `note(60)` produce.
 */
export function noteToFreq(note) {
  if (typeof note === "number") return midiToFreq(note);
  const m = /^([a-gA-G])([#bs]*)(-?\d+)?$/.exec(String(note).trim());
  if (!m) return 220;
  let semitone = SEMITONES[m[1].toLowerCase()];
  for (const accidental of m[2]) semitone += accidental === "b" ? -1 : 1;
  const octave = m[3] === undefined ? 3 : Number(m[3]);
  return midiToFreq(12 * (octave + 1) + semitone);
}

function midiToFreq(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

// ------------------------------------------------------------------ voices

/**
 * One event, rendered on its own: `{ samples, gain, room }`.
 *
 * Returned rather than mixed in place because a voice goes to two places — the
 * orbit's dry bus and, scaled by `room`, its reverb send — and re-rendering it
 * for the second would not give the same noise burst.
 *
 * A voice is free to ring for longer than its event lasts. The caller
 * allocates a tail for exactly that and folds it back round, which is what
 * makes a loop seamless rather than merely short.
 */
export function renderEvent(value, seconds, opts = {}) {
  const source = typeof value.s === "string" ? value.s : "triangle";
  const gain = (value.gain ?? 0.8) ** 2; // Strudel's gain is exponential

  let samples;
  if (source in DRUMS) samples = drum(source, value);
  else if (NOISES.has(source)) samples = noise(source, value, seconds, opts);
  else if (OSCILLATORS.has(source) || value.note !== undefined) {
    samples = tone(OSCILLATORS.has(source) ? source : "triangle", value, seconds, opts);
  } else throw new Error(`synth: no voice for s("${source}") — see DRUMS/OSCILLATORS/NOISES`);

  finish(samples, value);
  return { samples, gain, room: value.room ?? 0 };
}

function drum(name, value) {
  const decay = value.decay ?? DRUMS[name];
  const n = Math.ceil(decay * SAMPLE_RATE) + 64;
  const out = new Float32Array(n);

  switch (name) {
    case "bd": {
      // Pitch drops 120 → 45 Hz in 50 ms: the whole character of a 909 kick.
      let phase = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const freq = 45 + 75 * Math.exp(-t / 0.018);
        phase += (2 * Math.PI * freq) / SAMPLE_RATE;
        const click = i < 40 ? (1 - i / 40) * rnd() * 0.35 : 0;
        out[i] = (Math.sin(phase) + click) * Math.exp(-t / (decay * 0.35));
      }
      break;
    }
    case "sd": {
      let phase1 = 0;
      let phase2 = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        phase1 += (2 * Math.PI * 180) / SAMPLE_RATE;
        phase2 += (2 * Math.PI * 330) / SAMPLE_RATE;
        const body = (Math.sin(phase1) * 0.6 + Math.sin(phase2) * 0.4) * Math.exp(-t / 0.05);
        const snares = rnd() * Math.exp(-t / (decay * 0.5));
        out[i] = body * 0.55 + snares * 0.65;
      }
      highpass(out, 900);
      break;
    }
    case "hh":
    case "oh": {
      for (let i = 0; i < n; i++) {
        out[i] = rnd() * Math.exp(-(i / SAMPLE_RATE) / (decay * 0.45));
      }
      highpass(out, name === "hh" ? 7000 : 5500);
      break;
    }
    case "rim": {
      let phase = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        phase += (2 * Math.PI * 1700) / SAMPLE_RATE;
        out[i] = (Math.sin(phase) * 0.6 + rnd() * 0.4) * Math.exp(-t / 0.012);
      }
      highpass(out, 1200);
      break;
    }
    case "cp": {
      // Three bursts and a tail: a handclap is four claps that missed.
      for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const burst = t < 0.03 ? (t % 0.01 < 0.005 ? 1 : 0.3) : Math.exp(-(t - 0.03) / (decay * 0.4));
        out[i] = rnd() * burst;
      }
      highpass(out, 1000);
      break;
    }
    default: {
      // lt / mt / ht: a tom is a sine that falls a fourth and gives up.
      const base = name === "lt" ? 90 : name === "mt" ? 160 : 250;
      let phase = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const freq = base * (1 + 0.35 * Math.exp(-t / 0.04));
        phase += (2 * Math.PI * freq) / SAMPLE_RATE;
        out[i] = Math.sin(phase) * Math.exp(-t / (decay * 0.4));
      }
    }
  }

  return out;
}

function noise(colour, value, seconds, opts = {}) {
  const n = opts.sustained
    ? Math.round(seconds * SAMPLE_RATE)
    : Math.ceil((seconds + (value.release ?? 0.08)) * SAMPLE_RATE);
  const out = new Float32Array(n);
  let brown = 0;
  const pink = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const white = rnd();
    if (colour === "white") out[i] = white;
    else if (colour === "brown") {
      brown = (brown + white * 0.02) / 1.02;
      out[i] = brown * 4;
    } else {
      // Paul Kellet's three-pole pink approximation: cheap and flat enough.
      pink[0] = 0.99886 * pink[0] + white * 0.0555179;
      pink[1] = 0.99332 * pink[1] + white * 0.0750759;
      pink[2] = 0.969 * pink[2] + white * 0.153852;
      out[i] = (pink[0] + pink[1] + pink[2] + white * 0.3104856) * 0.25;
    }
  }
  if (!opts.sustained) envelope(out, value, seconds);
  return out;
}

function tone(shape, value, seconds, opts = {}) {
  let freq = noteToFreq(value.note ?? value.n ?? "d3");
  // A bed has to close its own circle: snapped to a whole number of cycles per
  // loop, it arrives back at phase zero exactly where the file wraps. The shift
  // is at most half of the loop's fundamental — under three cents down here,
  // which is well below what anyone hears and far below what a click costs.
  if (opts.sustained && Number.isFinite(opts.loopSeconds)) {
    freq = Math.max(1, Math.round(freq * opts.loopSeconds)) / opts.loopSeconds;
  }
  const n = opts.sustained
    ? Math.round(seconds * SAMPLE_RATE)
    : Math.ceil((seconds + (value.release ?? 0.08) + (value.decay ?? 0)) * SAMPLE_RATE);
  const out = new Float32Array(n);
  const step = freq / SAMPLE_RATE;
  // Phase comes off absolute time, so two consecutive events on the same note
  // meet without a jump — which is the whole reason a four-bar drone rendered
  // as two four-bar events does not click in the middle.
  let phase = opts.sustained ? 0 : (((freq * (opts.startSeconds ?? 0)) % 1) + 1) % 1;
  for (let i = 0; i < n; i++) {
    phase = (phase + step) % 1;
    out[i] = wave(shape, phase);
  }
  if (!opts.sustained) envelope(out, value, seconds);
  return out;
}

function wave(shape, phase) {
  switch (shape) {
    case "sine":
      return Math.sin(2 * Math.PI * phase);
    case "square":
      return phase < 0.5 ? 0.7 : -0.7;
    case "triangle":
      return 4 * Math.abs(phase - 0.5) - 1;
    default:
      return 2 * phase - 1; // sawtooth
  }
}

/**
 * ADSR, with the one default that matters: a note with no `decay` holds for as
 * long as the event lasts and then releases, which is what makes a sustained
 * `slow(4)` drone a drone rather than a very long pluck.
 *
 * Skipped entirely for a bed that spans the whole loop (`opts.sustained`): an
 * attack and a release there would notch the amplitude to zero at the loop
 * point, which is a click no amount of cross-fading hides.
 */
function envelope(out, value, seconds) {
  const attack = Math.max(value.attack ?? 0.005, 1 / SAMPLE_RATE);
  const decay = value.decay;
  const sustain = value.sustain ?? (decay === undefined ? 1 : 0);
  const release = value.release ?? 0.08;
  const held = Math.round(seconds * SAMPLE_RATE);

  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    let amp;
    if (t < attack) amp = t / attack;
    else if (decay !== undefined) amp = sustain + (1 - sustain) * Math.exp(-(t - attack) / (decay * 0.4));
    else amp = 1;
    if (i >= held) amp *= Math.exp(-((i - held) / SAMPLE_RATE) / (release * 0.4));
    out[i] *= amp;
  }
}

/** Filters and drive: the chain every voice shares, applied in Strudel's order. */
function finish(out, value) {
  if (value.cutoff !== undefined) lowpass(out, value.cutoff, value.resonance ?? 1);
  if (value.hcutoff !== undefined) highpass(out, value.hcutoff);
  if (value.shape) waveshape(out, value.shape);
  if (value.crush) bitcrush(out, value.crush);
}

// ----------------------------------------------------------------- filters

/** Chamberlin state-variable lowpass. `q` is Strudel's `resonance`. */
export function lowpass(buf, cutoff, q = 1) {
  const f = 2 * Math.sin((Math.PI * Math.min(cutoff, SAMPLE_RATE / 2.5)) / SAMPLE_RATE);
  const damp = Math.min(1, 1 / Math.max(0.5, q));
  let low = 0;
  let band = 0;
  for (let i = 0; i < buf.length; i++) {
    const high = buf[i] - low - damp * band;
    band += f * high;
    low += f * band;
    buf[i] = low;
  }
}

/** One-pole highpass. Nothing in the score needs resonance on the way up. */
export function highpass(buf, cutoff) {
  const rc = 1 / (2 * Math.PI * cutoff);
  const alpha = rc / (rc + 1 / SAMPLE_RATE);
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    prevOut = alpha * (prevOut + x - prevIn);
    prevIn = x;
    buf[i] = prevOut;
  }
}

function waveshape(buf, amount) {
  const k = (2 * amount) / Math.max(1e-6, 1 - amount);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = ((1 + k) * buf[i]) / (1 + k * Math.abs(buf[i]));
  }
}

function bitcrush(buf, bits) {
  const steps = 2 ** Math.max(1, bits);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.round(buf[i] * steps) / steps;
}

// ------------------------------------------------------------------ reverb

const COMBS = [1557, 1617, 1491, 1422];
const ALLPASS = [225, 556];

/**
 * Schroeder reverb, one instance per orbit.
 *
 * Per orbit rather than per layer on purpose: three instruments each with their
 * own tail is the mush the skill warns about, and grouping is the whole reason
 * `orbit` is in the patterns at all — 1 percussion, 2 melody, 3 air.
 */
export function reverb(buf, size = 0.72) {
  const out = new Float32Array(buf.length);
  const feedback = 0.7 + 0.28 * Math.min(1, size);

  for (const length of COMBS) {
    const line = new Float32Array(length);
    let at = 0;
    let store = 0;
    for (let i = 0; i < buf.length; i++) {
      const delayed = line[at];
      out[i] += delayed * 0.25;
      store = delayed * 0.2 + store * 0.8; // one pole of damping in the loop
      line[at] = buf[i] + store * feedback;
      at = (at + 1) % length;
    }
  }

  for (const length of ALLPASS) {
    const line = new Float32Array(length);
    let at = 0;
    for (let i = 0; i < buf.length; i++) {
      const delayed = line[at];
      const x = out[i];
      out[i] = delayed - x * 0.5;
      line[at] = x + delayed * 0.5;
      at = (at + 1) % length;
    }
  }

  return out;
}
