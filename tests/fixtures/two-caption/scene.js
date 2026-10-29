// A minimal drawing for Python/runtime integration acceptance.
NarratedExplainer.scene(function (story, kit) {
  return {
    stateAt: function (mode, t) { return { t: t }; },
    build: function (stage) { kit.svg(stage, '0 0 1200 600', 'Request path'); },
    draw: function () {}
  };
});
