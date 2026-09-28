// oscillators implemented as AudioWorklets, and wavetables
setcpm(30);
stack(
  note("c3 e3").s("supersaw").gain(0.3),
  note("g3 c4").s("wt_digital").gain(0.3),
  note("c2").s("pulse").gain(0.3),
)
