// SALVOR stinger — the tug takes the derelict under tow. The run paid off.
//
// The only warm sound in the game: the theme's two pillars, d and a, climbing
// instead of falling, on a triangle with no distortion anywhere near it.

// 84 bpm in 4/4: one Strudel cycle is one bar, and the loop is four of them.
setcpm(84 / 4)

$: note("[d2 a2 d3 a3]").s("triangle").lpf(2200).attack(0.02).dec(0.4).release(0.5).gain(0.55).room(0.45).orbit(2)
$: note("d1").s("sine").dec(1.4).gain(0.5).lpf(120).room(0.3).orbit(3)
$: s("~ ~ hh oh").bank("tr909").dec(0.3).hpf(5000).gain(0.3).room(0.2).orbit(1)
