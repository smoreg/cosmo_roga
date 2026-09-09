// SALVOR stinger — a ship system answers to the drone. One bar, then silence.
//
// The theme's home note and the fifth it falls to in the tune, played the other
// way round and upward: the one moment in the run where something goes right.

// 84 bpm in 4/4: one Strudel cycle is one bar, and the loop is four of them.
setcpm(84 / 4)

$: note("[d3 a3]").s("square").lpf(2600).dec(0.5).gain(0.6).shape(0.2).room(0.3).orbit(2)
$: note("d2").s("sawtooth").lpf(400).dec(0.7).gain(0.5).room(0.2).orbit(2)
$: s("bd").bank("tr909").dec(0.5).gain(0.6).orbit(1)
