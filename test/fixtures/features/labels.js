// several labelled patterns, one muted
setcpm(30);
$: s("bd*4")
$: note("c3 e3").s("sawtooth").lpf(800)
_$: note("c6*16").s("square")
