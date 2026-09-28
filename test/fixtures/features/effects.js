// the common effect controls, one per voice
setcpm(30);
stack(
  note("c3*4").s("sawtooth").lpf(sine.range(400, 2000)).hpf(80),
  note("e4*4").s("square").delay(0.4).delaytime(0.125).delayfeedback(0.5).gain(0.3),
  note("g4").s("triangle").room(0.8).size(2),
  note("c5*2").s("square").crush(4).gain(0.2),
  note("c2*2").s("sawtooth").coarse(8).gain(0.3),
  note("e2*2").s("sawtooth").shape(0.6).gain(0.3),
  note("g2*2").s("sawtooth").distort(2).gain(0.3),
  note("c4").s("sawtooth").vowel("a").pan(sine).gain(0.3),
  note("e3*2").s("triangle").tremolo(8).phaser(4).gain(0.3),
)
