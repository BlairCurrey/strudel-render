// editor-only calls: visuals and sliders must not stop the render
setcpm(30);
note("c3 e3 g3").s("square")
  .lpf(slider(1200, 200, 4000))
  ._pianoroll().scope().punchcard()
