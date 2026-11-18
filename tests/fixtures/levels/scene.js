// A small stage for the dive-level tests: the start menu and the Depth chip sit over and above it.
NarratedExplainer.scene(function (story, kit) {
  return {
    stateAt: function (mode, t) { return { t: t }; },
    build: function (stage) {
      const svg = kit.svg(stage, '0 0 800 400', 'A stage under the start menu');
      kit.text(svg, 20, 60, 'Levels fixture');
    },
    draw: function () {}
  };
});
