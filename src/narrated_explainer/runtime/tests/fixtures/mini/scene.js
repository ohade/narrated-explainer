// Fixture scene for the player tests and the dev page: a ball rolls along a track.
// It draws with plain SVG nodes because the drawing kit is not part of this unit.
NarratedExplainer.scene(function (story) {
  const SVG = 'http://www.w3.org/2000/svg';
  const END = story.timing.end;
  const LEFT = 100;
  const RIGHT = 1000;
  const GROUND = 220;
  const BUMP_T = 70;

  const xAt = (t) => LEFT + (RIGHT - LEFT) * (t / END);

  // Pure: same input, same output.
  function stateAt(mode, t) {
    const bumpy = mode === 'bumpy';
    const lift = bumpy ? Math.max(0, 1 - Math.abs(t - BUMP_T) / 6) : 0;
    return { t, x: xAt(t), y: GROUND - 24 - 50 * lift, bumpy, done: t >= END };
  }

  function node(parent, tag, attrs) {
    const el = parent.ownerDocument.createElementNS(SVG, tag);
    Object.keys(attrs).forEach((k) => el.setAttribute(k, String(attrs[k])));
    parent.appendChild(el);
    return el;
  }

  let parts;

  return {
    stateAt,
    build(stage) {
      const svg = node(stage, 'svg', { viewBox: '0 0 1100 300', role: 'img', 'aria-label': 'A ball on a track' });
      const track = node(svg, 'line', { x1: LEFT, y1: GROUND, x2: RIGHT, y2: GROUND, class: 'nx-stroke-ink-2', 'stroke-width': 4 });
      const bump = node(svg, 'path', {
        d: 'M' + (xAt(BUMP_T) - 30) + ' ' + GROUND + ' Q' + xAt(BUMP_T) + ' ' + (GROUND - 40) + ' ' + (xAt(BUMP_T) + 30) + ' ' + GROUND,
        class: 'nx-fill-warn-bg nx-stroke-warn', 'stroke-width': 3,
      });
      node(svg, 'line', { x1: RIGHT, y1: GROUND, x2: RIGHT, y2: GROUND - 110, class: 'nx-stroke-ink', 'stroke-width': 4 });
      const flag = node(svg, 'path', { d: 'M' + RIGHT + ' ' + (GROUND - 110) + ' l60 20 l-60 20 z', class: 'nx-fill-ink-2-fg' });
      const ring = node(svg, 'circle', { cx: LEFT, cy: GROUND - 24, r: 24, fill: 'none', class: 'nx-stroke-info', 'stroke-width': 4 });
      const ball = node(svg, 'circle', { cx: LEFT, cy: GROUND - 24, r: 24, class: 'nx-fill-info-fg' });
      const label = node(svg, 'text', { x: 550, y: 280, 'font-size': 22, 'text-anchor': 'middle', class: 'nx-fill-ink-fg nx-halo' });
      parts = { track, bump, flag, ring, ball, label };
    },
    draw(state, ctx) {
      const intro = ctx.at.kind === 'intro';
      const pulse = Math.sin(Math.PI * ctx.motion(900));
      parts.ball.setAttribute('cx', state.x);
      parts.ball.setAttribute('cy', state.y);
      parts.ball.setAttribute('r', intro && ctx.at.index === 0 ? 24 + 10 * pulse : 24);
      parts.track.setAttribute('stroke-width', intro && ctx.at.index === 1 ? 4 + 6 * pulse : 4);
      parts.bump.style.display = state.bumpy ? '' : 'none';
      parts.ring.setAttribute('cx', state.x);
      parts.ring.setAttribute('cy', state.y);
      parts.ring.setAttribute('r', 24 + 30 * ctx.motion(700));
      parts.ring.setAttribute('opacity', ctx.at.kind === 'moment' ? 1 - ctx.motion(700) : 0);
      parts.flag.setAttribute('class', state.done ? 'nx-fill-ok-fg' : 'nx-fill-ink-2-fg');
      parts.label.textContent = intro ? 'Meet the cast' : 'Position ' + Math.round(state.t) + ' of ' + END;
      if (state.done) ctx.sfx('ding');
    },
  };
});
