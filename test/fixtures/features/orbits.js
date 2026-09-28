// two orbits, each with its own reverb
setcpm(30);
stack(
  note("c4 e4").s("triangle").room(0.9).size(4).orbit(1),
  note("g3").s("sawtooth").lpf(900).room(0.5).size(0.5).orbit(2),
)
