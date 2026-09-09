// SALVOR stinger — core breach. The drone goes dark.
//
// The theme's arc taken to its end: d3 down two octaves in three steps, with
// the filter closing on every one of them. Nothing resolves, because nothing
// does.

// 84 bpm in 4/4: one Strudel cycle is one bar, and the loop is four of them.
setcpm(84 / 4)

$: note("[d3 eb2 d1]").s("sawtooth").lpf("[2000 700 180]").lpq(6).dec(0.6).gain(0.6).room(0.5).orbit(2)
$: s("white").dec(1.2).hpf(400).lpf(3000).gain(0.35).room(0.6).orbit(3)
$: s("bd").bank("tr909").dec(0.9).gain(0.7).orbit(1)
