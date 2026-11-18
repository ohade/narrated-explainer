// A small stage with three modes, for pinning the control bar's layout.
NarratedExplainer.scene(function (story, kit) {
  return {
    stateAt: function (mode, t) { return { t: t }; },
    build: function (stage) {
      const svg = kit.svg(stage, '0 0 800 300', 'A stage under the control bar');
      kit.text(svg, 20, 60, 'Control bar fixture');
    },
    draw: function () {}
  };
});
