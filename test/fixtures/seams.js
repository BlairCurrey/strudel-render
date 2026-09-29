// For the join test: busy, long-ringing, and free of noise sources, so a
// chunked render should match a single-chunk render sample for sample.
// 174 BPM, where one bar is not a whole number of samples.
setcpm(174 / 4);
const drums = stack(
  s("bd ~ ~ ~ ~ ~ ~ ~ ~ ~ bd ~ ~ ~ ~ ~"),
  s("~ ~ ~ ~ sd ~ ~ ~ ~ ~ ~ ~ sd ~ ~ ~").room(0.4),
  s("hh*16").gain("[.4 .15 .25 .15]*4"),
  s("<cr ~ ~ ~>").gain(0.4),
).bank("RolandTR909");
const pad = note("<[d3,f3,a3] [eb3,g3,bb3]>").slow(2).s("gm_church_organ").gain(0.35).room(0.9).size(0.95);
const bass = note("<d1 eb1 d1 c#1>").struct("x ~ ~ ~ x ~ ~ ~ x ~ x ~ ~ ~ ~ ~").s("sine").clip(0.95).gain(0.6);
const lead = note("<[a4 g4 a4 ~] ~ [g4 f4 e4 d4] [c#4 ~ d4 ~]>").s("sawtooth").lpf(2400)
  .delay(0.3).delaytime(3 / 16).delayfeedback(0.45).gain(0.3);
const gtr = note("<[d2,a2] [eb2,bb2]>").struct("x ~ x x x ~ x x x ~ x x x ~ x x")
  .s("gm_distortion_guitar").clip(0.25).distort(1.5).gain(0.2);
const bell = note("<d5 ~ ~ ~ ab4 ~ ~ ~>").s("gm_tubular_bells").release(5).gain(0.4).room(0.95).size(0.95);
arrange(
  [8, stack(pad, bell, lead)],
  [8, stack(drums, bass, gtr, lead, bell)],
)
