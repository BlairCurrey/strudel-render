// reference: General MIDI soundfonts, including .distort(). No reverb.
setcpm(30);
stack(
  note("<[d3,f3,a3] [eb3,g3,bb3] [d3,f3,ab3] [c#3,e3,g3,bb3]>").s("gm_church_organ").gain(0.4),
  note("<[d2,a2] [eb2,bb2] [d2,ab2] [c#2,g2]>").struct("x ~ x x x ~ x x")
    .s("gm_distortion_guitar").clip(0.25).distort(1.5).gain(0.25),
  note("<d5 ~ ab4 ~>").s("gm_tubular_bells").release(3).gain(0.4),
)
