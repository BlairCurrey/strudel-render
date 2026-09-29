// reference: default samples, a drum machine, and strudel.cc's Dirt-Samples
// subset. No reverb.
setcpm(30);
stack(
  s("bd ~ bd ~, ~ sd ~ sd, hh*8"),
  s("~ cp ~ [cp cp]").bank("RolandTR909"),
  s("jazz*4").n("<0 1 2 3>").gain(0.7),
  s("~ metal").n("<0 5>").gain(0.5),
)
