// reference: oscillators, envelopes, filters, delay. No reverb, no noise.
setcpm(30);
stack(
  note("<c3 a2 f2 g2>").s("sawtooth").lpf(900).lpq(6).attack(0.02).release(0.3),
  note("c4 e4 g4 [b4 c5]").s("square").lpf(3000).decay(0.15).sustain(0.3).gain(0.3)
    .delay(0.3).delaytime(0.1875).delayfeedback(0.4),
  note("c5*8").s("triangle").gain(0.2).pan(sine.slow(2)),
)
