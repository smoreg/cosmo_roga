#!/usr/bin/env bash
# Synthesise the generated one-shots with sox alone, no model and no
# network (ffprobe, when it is there, only reports on the result): a low
# explosion for a compartment (or the ship) going up, and a fuse ticking for a
# charge being set and counting down.
#
#   games/salvor/music/scripts/synth-sfx.sh            # both
#   games/salvor/music/scripts/synth-sfx.sh explode    # one
#
# Output: assets/audio/sfx/{explode,fuse}.ogg — mono Vorbis, under 2.5 s, the
# same rules tests/audio-assets.test.ts holds every one-shot to. The .wav
# intermediates live in a temp dir and are not kept. Deterministic apart from
# sox's noise generators, which are seeded by the clock; the shape is the
# script's, so re-running gives the same sound and a different grain.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/../../../../assets/audio/sfx"
RATE=44100
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

command -v sox >/dev/null || { echo "sox is not installed (brew install sox)"; exit 1; }

encode() { # wav -> ogg, mono Vorbis at quality 3 (~64 kbit/s); sox carries its own encoder
  sox "$1" -c 1 -C 3 "$2"
}

# The explosion: a brown-noise body with a low sine thump under it, both
# swept down and faded out over 1.6 s, then a little overdrive for the crack
# and a low-pass so it stays a thing felt more than heard.
explode() {
  sox -n -r $RATE -c 1 "$TMP/body.wav" synth 1.6 brownnoise fade p 0.005 1.6 1.4 lowpass 220 gain -2
  sox -n -r $RATE -c 1 "$TMP/thump.wav" synth 1.6 sine 95:28 fade q 0.002 1.6 1.3 gain -1
  sox -n -r $RATE -c 1 "$TMP/crack.wav" synth 0.12 whitenoise fade p 0.001 0.12 0.11 bandpass 1800 400 gain -8
  sox -m "$TMP/body.wav" "$TMP/thump.wav" "$TMP/crack.wav" "$TMP/explode.wav" overdrive 12 lowpass 900 norm -1
  encode "$TMP/explode.wav" "$OUT/explode.ogg"
}

# The fuse: four dry ticks (a very short 2.4 kHz sine with a click of noise)
# at a rising pace, over a faint hiss — half a second, gone before the next
# key. Ticks are laid out with pad so the spacing is exact.
fuse() {
  sox -n -r $RATE -c 1 "$TMP/tick.wav" synth 0.018 sine 2400 fade q 0.001 0.018 0.012 gain -4
  sox -n -r $RATE -c 1 "$TMP/click.wav" synth 0.006 whitenoise fade p 0.0005 0.006 0.004 highpass 3000 gain -10
  sox -m "$TMP/tick.wav" "$TMP/click.wav" "$TMP/one.wav"
  sox "$TMP/one.wav" "$TMP/t1.wav" pad 0.00 0.60
  sox "$TMP/one.wav" "$TMP/t2.wav" pad 0.16 0.44
  sox "$TMP/one.wav" "$TMP/t3.wav" pad 0.30 0.30
  sox "$TMP/one.wav" "$TMP/t4.wav" pad 0.42 0.18
  sox -n -r $RATE -c 1 "$TMP/hiss.wav" synth 0.62 pinknoise fade p 0.05 0.62 0.2 bandpass 5000 2000 gain -26
  sox -m "$TMP/t1.wav" "$TMP/t2.wav" "$TMP/t3.wav" "$TMP/t4.wav" "$TMP/hiss.wav" "$TMP/fuse.wav" norm -3
  encode "$TMP/fuse.wav" "$OUT/fuse.ogg"
}

# The purge: a virus combed out of a module by hand, with no torch in it. Three
# quick descending square blips over a band of noise swept upward; 0.7 s and
# quiet, because it plays on every turn of a six-turn job.
purge() {
  sox -n -r $RATE -c 1 "$TMP/b1.wav" synth 0.05 square 1320 fade q 0.002 0.05 0.02 gain -14
  sox -n -r $RATE -c 1 "$TMP/b2.wav" synth 0.05 square 990 fade q 0.002 0.05 0.02 gain -14
  sox -n -r $RATE -c 1 "$TMP/b3.wav" synth 0.05 square 740 fade q 0.002 0.05 0.02 gain -14
  sox "$TMP/b1.wav" "$TMP/p1.wav" pad 0.00 0.65
  sox "$TMP/b2.wav" "$TMP/p2.wav" pad 0.08 0.57
  sox "$TMP/b3.wav" "$TMP/p3.wav" pad 0.16 0.49
  sox -n -r $RATE -c 1 "$TMP/comb.wav" synth 0.7 pinknoise fade q 0.05 0.7 0.3 sinc 600-4000 gain -20
  sox -n -r $RATE -c 1 "$TMP/sweep.wav" synth 0.7 sine 300:1800 fade q 0.02 0.7 0.4 gain -24
  sox -m "$TMP/p1.wav" "$TMP/p2.wav" "$TMP/p3.wav" "$TMP/comb.wav" "$TMP/sweep.wav" "$TMP/purge.wav" lowpass 5000 norm -6
  encode "$TMP/purge.wav" "$OUT/purge.ogg"
}

case "${1:-all}" in
  explode) explode ;;
  fuse) fuse ;;
  purge) purge ;;
  all) explode; fuse; purge ;;
  *) echo "usage: $0 [explode|fuse|purge]"; exit 2 ;;
esac
ls -l "$OUT"/explode.ogg "$OUT"/fuse.ogg "$OUT"/purge.ogg
if command -v ffprobe >/dev/null; then
  for f in explode fuse purge; do
    ffprobe -v error -show_entries stream=codec_name,channels,duration -of compact "$OUT/$f.ogg"
  done
fi
