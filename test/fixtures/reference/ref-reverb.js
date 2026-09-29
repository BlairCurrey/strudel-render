// reference: reverb at two sizes on one orbit. strudel.cc's reverb impulse
// is random noise, so this one is compared by loudness envelope only.
setcpm(30);
stack(
  note("c4 ~ e4 ~").s("triangle").room(0.9).size(0.95),
  note("~ g3 ~ c4").s("square").lpf(1200).room(0.9).size(0.9).gain(0.4),
  s("bd ~ ~ ~").room(0.5),
)
