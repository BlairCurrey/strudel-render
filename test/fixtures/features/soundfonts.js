// General MIDI soundfonts, including a distorted guitar
setcpm(30);
stack(
  note("<[d3,f3,a3] [eb3,g3,bb3]>").s("gm_church_organ"),
  note("d2*8").s("gm_distortion_guitar").distort(1.5).clip(0.3),
)
