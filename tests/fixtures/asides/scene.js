// A square-ish stage for the aside tests: the chip rail and the panel sit inside it.
NarratedExplainer.scene(function (story, kit) {
  return {
    stateAt: function (mode, t) { return { t: t }; },
    build: function (stage) {
      const svg = kit.svg(stage, '0 0 800 700', 'A stage under the asides');
      kit.text(svg, 20, 60, 'Asides fixture');
    },
    draw: function () {}
  };
});
