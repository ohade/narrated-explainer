// A stage far taller than wide: fitting it to any window makes its text small.
NarratedExplainer.scene(function (story, kit) {
  return {
    stateAt: function (mode, t) { return { t: t }; },
    build: function (stage) {
      const svg = kit.svg(stage, '0 0 400 2400', 'A tall column');
      kit.text(svg, 20, 60, 'Top of the column');
    },
    draw: function () {}
  };
});
