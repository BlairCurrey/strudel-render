// oscillators, envelopes, filters
setcpm(30);
note("c3 e3 g3 c4").s("<sine square triangle sawtooth>")
  .attack(0.01).decay(0.1).sustain(0.5).release(0.2)
  .lpf(1800).lpq(4)
