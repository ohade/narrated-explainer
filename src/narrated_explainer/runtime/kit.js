// Narrated Explainer drawing kit: pure helpers plus small SVG builders that return handles.
// A scene builds its drawing once with these builders, then its draw(state, ctx) only calls the
// handles' setters, which change attributes. The kit keeps no clock and starts no timers: every
// motion comes from the 0..1 progress values the scene passes in. Colours come only from the
// tone classes in player.css, never from literal colour values.
(function (root) {
  'use strict';

  const NX = root.NarratedExplainer || (root.NarratedExplainer = {});
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ACCENTS = ['info', 'ok', 'warn', 'stop'];

  // ---- Pure helpers (no DOM; usable in Node) ----

  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const lerp = (a, b, p) => a + (b - a) * p;
  const ramp = (t, from, to) => (to === from ? (t >= to ? 1 : 0) : clamp01((t - from) / (to - from)));

  // The point at fraction p of the polyline's total length.
  function along(points, p) {
    const lengths = points.slice(1).map((pt, i) => Math.hypot(pt[0] - points[i][0], pt[1] - points[i][1]));
    let rest = clamp01(p) * lengths.reduce((a, b) => a + b, 0);
    for (let i = 0; i < lengths.length; i += 1) {
      if (rest <= lengths[i] || i === lengths.length - 1) {
        const f = lengths[i] === 0 ? 1 : Math.min(1, rest / lengths[i]);
        return [lerp(points[i][0], points[i + 1][0], f), lerp(points[i][1], points[i + 1][1], f)];
      }
      rest -= lengths[i];
    }
    return [points[0][0], points[0][1]];
  }

  const BACK = 1.70158;
  const ease = {
    in: (p) => Math.pow(clamp01(p), 3),
    out: (p) => 1 - Math.pow(1 - clamp01(p), 3),
    inOut: (p) => 0.5 - Math.cos(Math.PI * clamp01(p)) / 2,
    outBack: (p) => {
      const q = clamp01(p) - 1;
      return 1 + (BACK + 1) * q * q * q + BACK * q * q;
    },
  };

  // A sway that dies out: it swings about zero and is still again at p = 1.
  const wobble = (p, amp) => Math.sin(p * Math.PI * 7) * amp * (1 - p);
  // The point at progress p on the way from `from` to `to`, lifted by `lift` at the middle (up on screen).
  const arc = (from, to, p, lift) => [lerp(from[0], to[0], p), lerp(from[1], to[1], p) - lift * Math.sin(Math.PI * p)];
  // The height scale of a landing: it dips by `depth` halfway between `from` and 1, and is whole again at 1.
  const squash = (p, depth = 0.22, from = 0.8) => 1 - depth * Math.sin(Math.PI * ramp(p, from, 1));

  // ---- Tones ----
  // A fill tone is an accent (info, ok, warn, stop: its strong -fg colour), an explicit
  // '<tone>-fg' or '<tone>-bg', or a neutral: ink and ink-2 (strong), sunken (soft), page.
  // Each maps to a class player.css defines: ink -> nx-fill-ink-fg, sunken -> nx-fill-sunken-bg.

  const NEUTRAL_FILL = { ink: 'ink-fg', 'ink-2': 'ink-2-fg', sunken: 'sunken-bg' };
  const solid = (tone) => (ACCENTS.includes(tone) ? tone + '-fg' : NEUTRAL_FILL[tone] || tone);
  const fillClass = (tone) => 'nx-fill-' + solid(tone);
  const strokeClass = (tone) => 'nx-stroke-' + String(tone).replace(/-fg$/, '');
  // Page colour reads on strong fills, ink on soft ones.
  const readableOn = (fill) => (/-fg$/.test(solid(fill)) ? 'page' : 'ink');
  const textClass = (tone, on, halo) => fillClass(on ? readableOn(on) : tone) + (halo ? ' nx-halo' : '');

  // ---- DOM ----

  const num = (n) => Math.round(n * 1e4) / 1e4;
  const pt = (p) => num(p[0]) + ' ' + num(p[1]);
  const withDefaults = (opts, base) => {
    const out = Object.assign({}, base);
    Object.keys(opts || {}).forEach((key) => { if (opts[key] != null) out[key] = opts[key]; });
    return out;
  };

  function attrs(node, values) {
    Object.keys(values).forEach((key) => {
      const v = values[key];
      if (v != null) node.setAttribute(key, typeof v === 'number' ? num(v) : v);
    });
    return node;
  }

  function el(parent, tag, values) {
    const node = root.document.createElementNS(SVG_NS, tag);
    attrs(node, values || {});
    parent.appendChild(node);
    return node;
  }

  const show = (node, on) => node.setAttribute('visibility', on ? 'visible' : 'hidden');
  const scaleAbout = (c, s) => 'translate(' + pt(c) + ') scale(' + num(s) + ') translate(' + pt([-c[0], -c[1]]) + ')';
  // Approximate width of a label at 18 units, since nodes are not measured.
  const labelWidth = (s) => String(s).length * 10.5 + 24;
  const withUnit = (value, unit) => num(value) + (unit ? ' ' + unit : '');
  // Moves a group to (x, y); a scale is added when given, and a rotation about (x, y) when not zero.
  const place = (node, x, y, s, r) => node.setAttribute('transform', 'translate(' + pt([x, y]) + ')'
    + (s == null ? '' : ' scale(' + num(s) + ')') + (r ? ' rotate(' + num(r) + ')' : ''));
  // The class pair of a soft body: a pale fill with an accent outline.
  const bodyClass = (tone) => fillClass(tone + '-bg') + ' ' + strokeClass(tone);

  function svg(stage, viewBox, label) {
    return el(stage, 'svg', {
      viewBox, role: 'img', 'aria-label': label, class: 'nx-svg',
      style: 'display: block; width: 100%; height: auto',
    });
  }

  function text(parent, x, y, str, opts) {
    const o = withDefaults(opts, { size: 20, weight: 400, anchor: 'start', tone: 'ink', on: null, halo: false });
    const node = el(parent, 'text', {
      x, y, 'font-size': o.size, 'font-weight': o.weight, 'text-anchor': o.anchor,
      class: textClass(o.tone, o.on, o.halo),
    });
    node.textContent = str;
    return node;
  }

  // ---- Builders ----

  function box(parent, opts) {
    const o = withDefaults(opts, { label: '', sub: '', tone: null });
    const { x, y, w, h } = o;
    const g = el(parent, 'g', { 'data-part': 'box' });
    const rect = el(g, 'rect', { x, y, width: w, height: h, rx: 12, 'stroke-width': 2 });
    if (o.label) text(g, x + w / 2, y + 34, o.label, { size: 22, weight: 600, anchor: 'middle' });
    if (o.sub) text(g, x + w / 2, y + 60, o.sub, { size: 18, anchor: 'middle', tone: 'ink-2' });
    const status = text(g, x + w / 2, y + h - 18, '', { size: 18, weight: 600, anchor: 'middle' });
    attrs(status, { 'data-part': 'status', visibility: 'hidden' });
    function setTone(tone) {
      const fill = ACCENTS.includes(tone) ? tone + '-bg' : tone === 'sunken' ? 'sunken' : 'page';
      rect.setAttribute('class', fillClass(fill) + ' ' + strokeClass(tone || 'edge'));
    }
    setTone(o.tone);
    const edges = { left: (f) => [x, y + h * f], right: (f) => [x + w, y + h * f],
      top: (f) => [x + w * f, y], bottom: (f) => [x + w * f, y + h] };
    return {
      g,
      center: [x + w / 2, y + h / 2],
      edge: (side, f) => edges[side](f == null ? 0.5 : f),
      setTone,
      setStatus(str, tone) {
        status.textContent = str || '';
        status.setAttribute('class', textClass(tone || 'ink', null, false));
        show(status, Boolean(str));
      },
    };
  }

  function arrow(parent, opts) {
    const o = withDefaults(opts, { label: '', tone: 'ink', dashed: false, head: true });
    const [from, to] = [o.from, o.to];
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const angle = (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;
    const g = el(parent, 'g', { 'data-part': 'arrow' });
    const line = el(g, 'line', { x1: from[0], y1: from[1], x2: to[0], y2: to[1], 'stroke-width': 2.5, 'data-part': 'arrow-line' });
    const head = o.head ? el(g, 'path', { d: 'M0 0 L-14 -7 L-14 7 Z', 'data-part': 'arrow-head' }) : null;
    // The label sits beside the middle of the line, on its left-hand normal (above a rightward line).
    const nx = len ? (to[1] - from[1]) / len : 0;
    const ny = len ? -(to[0] - from[0]) / len : -1;
    const side = Math.abs(nx) > 0.5 ? (nx > 0 ? 'start' : 'end') : 'middle';
    const label = text(g, (from[0] + to[0]) / 2 + nx * 14, (from[1] + to[1]) / 2 + ny * 14 + (side === 'middle' ? 0 : 6),
      o.label, { size: 18, anchor: side, tone: 'ink-2', halo: true });
    label.setAttribute('data-part', 'arrow-label');
    let dashed = o.dashed;
    let progress = 1;

    // Dashes up to the shown length, then one gap as long as the line.
    function dashesUpTo(shown) {
      const out = [];
      for (let at = 0; at < shown; at += 14) out.push(num(Math.min(8, shown - at)), 6);
      out[out.length - 1] = len;
      return out.join(' ');
    }
    function apply() {
      const shown = len * progress;
      if (dashed) {
        line.setAttribute('stroke-dasharray', progress >= 1 ? '8 6' : progress <= 0 ? '0 ' + num(len) : dashesUpTo(shown));
        line.setAttribute('stroke-dashoffset', 0);
      } else {
        line.setAttribute('stroke-dasharray', num(len) + ' ' + num(len));
        line.setAttribute('stroke-dashoffset', num(len - shown));
      }
      show(label, progress > 0);
      if (!head) return;
      show(head, progress > 0);
      const tip = along([from, to], progress);
      head.setAttribute('transform', 'translate(' + pt(tip) + ') rotate(' + num(angle) + ') scale(' + num(Math.min(1, shown / 16)) + ')');
    }
    function setTone(tone) {
      line.setAttribute('class', strokeClass(tone));
      if (head) head.setAttribute('class', fillClass(tone));
    }
    setTone(o.tone);
    apply();
    return {
      show: (on) => show(g, on),
      setTone,
      setDashed(on) { dashed = Boolean(on); apply(); },
      draw(p) { progress = clamp01(p); apply(); },
      setLabel(str) { label.textContent = str; },
    };
  }

  function token(parent, opts) {
    const o = withDefaults(opts, { label: '', tone: 'info' });
    const g = el(parent, 'g', { 'data-part': 'token', transform: 'translate(0 0)' });
    const rect = el(g, 'rect', { y: -17, height: 34, rx: 8 });
    const label = text(g, 0, 6, '', { size: 18, weight: 600, anchor: 'middle' });
    function setLabel(str) {
      const w = Math.max(34, labelWidth(str));
      label.textContent = str;
      attrs(rect, { x: -w / 2, width: w });
    }
    function setTone(tone) {
      rect.setAttribute('class', fillClass(tone));
      label.setAttribute('class', textClass(null, tone, false));
    }
    setLabel(o.label);
    setTone(o.tone);
    return {
      moveTo: (xy) => g.setAttribute('transform', 'translate(' + pt(xy) + ')'),
      show: (on) => show(g, on),
      setTone,
      setLabel,
    };
  }

  function bubble(parent, opts) {
    const o = withDefaults(opts, { text: '', h: 44 });
    const { x, y, w, h } = o;
    const tip = o.tail || [x + w / 2, y + h + 24];
    const g = el(parent, 'g', { 'data-part': 'bubble' });
    el(g, 'rect', { x, y, width: w, height: h, rx: 10, class: 'nx-fill-sunken-bg nx-stroke-edge', 'stroke-width': 2 });
    // The tail starts just inside the side facing its tip, so its fill covers the body's border there.
    const awayFromCorners = (lo, hi, v) => Math.max(lo + 18, Math.min(hi - 18, v));
    let base;
    if (tip[1] > y + h) base = [[awayFromCorners(x, x + w, tip[0]) - 10, y + h - 1], [awayFromCorners(x, x + w, tip[0]) + 10, y + h - 1]];
    else if (tip[1] < y) base = [[awayFromCorners(x, x + w, tip[0]) - 10, y + 1], [awayFromCorners(x, x + w, tip[0]) + 10, y + 1]];
    else {
      const ex = tip[0] < x ? x + 1 : x + w - 1;
      base = [[ex, awayFromCorners(y, y + h, tip[1]) - 10], [ex, awayFromCorners(y, y + h, tip[1]) + 10]];
    }
    el(g, 'path', { d: 'M' + pt(base[0]) + ' L' + pt(tip) + ' L' + pt(base[1]), class: 'nx-fill-sunken-bg nx-stroke-edge',
      'stroke-width': 2, 'stroke-linejoin': 'round' });
    const label = text(g, x + w / 2, y + h / 2 + 6, o.text, { size: 18, weight: 700, anchor: 'middle', on: 'sunken' });
    // Scales about the tail tip with an ease-out, so it grows out of what it points at.
    const pop = (p) => g.setAttribute('transform', scaleAbout(tip, ease.out(p)));
    pop(1);
    return { show: (on) => show(g, on), pop, setText: (str) => { label.textContent = str; } };
  }

  function queue(parent, opts) {
    const o = withDefaults(opts, { slots: 4, slotW: 64, gap: 8, h: 56, title: '' });
    const g = el(parent, 'g', { 'data-part': 'queue' });
    if (o.title) text(g, o.x, o.y - 12, o.title, { size: 18, tone: 'ink-2' });
    const chips = [];
    for (let i = 0; i < o.slots; i += 1) {
      const sx = o.x + i * (o.slotW + o.gap);
      el(g, 'rect', { x: sx, y: o.y, width: o.slotW, height: o.h, rx: 6, fill: 'none', class: 'nx-stroke-hairline', 'stroke-width': 2 });
      const chip = el(g, 'g', { 'data-part': 'chip', 'data-slot': i, transform: 'translate(' + pt([sx, o.y]) + ')', visibility: 'hidden' });
      const rect = el(chip, 'rect', { x: 3, y: 3, width: o.slotW - 6, height: o.h - 6, rx: 4 });
      const label = text(chip, o.slotW / 2, o.h / 2 + 6, '', { size: 18, weight: 600, anchor: 'middle' });
      label.setAttribute('data-part', 'chip-label');
      chips.push({ chip, rect, label });
    }
    return {
      set(items) {
        chips.forEach((c, i) => {
          const item = items[i];
          show(c.chip, Boolean(item));
          if (!item) return;
          const tone = item.tone || 'ink-2';
          c.label.textContent = item.label || '';
          c.rect.setAttribute('class', fillClass(tone));
          c.label.setAttribute('class', textClass(null, tone, false));
        });
      },
    };
  }

  function readout(parent, opts) {
    const o = withDefaults(opts, { size: 34, anchor: 'start' });
    const node = text(parent, o.x, o.y, '', { size: o.size, weight: 700, anchor: o.anchor, halo: true });
    node.setAttribute('data-part', 'readout');
    return {
      set(str, tone) {
        node.textContent = str;
        node.setAttribute('class', textClass(tone || 'ink', null, true));
      },
    };
  }

  // A friendly figure, drawn around the point between its feet, facing left. Its arm is two
  // segments from the shoulder with the elbow bent downward, the way an arm hangs.
  const SHOULDER = [-11, -111];
  const UPPER_ARM = 32;
  const FOREARM = 28;

  function drawFigure(g, tone, prefix) {
    const limb = (d, w) => el(g, 'path', { d, fill: 'none', class: 'nx-stroke-ink-2', 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    limb('M-5 -64 L-7 -32 L-8 -4', 7);
    limb('M5 -64 L7 -32 L8 -4', 7);
    el(g, 'ellipse', { cx: -13, cy: 0, rx: 7, ry: 3.5, class: 'nx-fill-ink-fg' });
    el(g, 'ellipse', { cx: 13, cy: 0, rx: 7, ry: 3.5, class: 'nx-fill-ink-fg' });
    el(g, 'line', { x1: 11, y1: -111, x2: 19, y2: -86, class: strokeClass(tone), 'stroke-width': 7, 'stroke-linecap': 'round' });
    el(g, 'line', { x1: 19, y1: -86, x2: 14, y2: -65, class: strokeClass(tone), 'stroke-width': 6, 'stroke-linecap': 'round' });
    el(g, 'rect', { x: -3, y: -121, width: 6, height: 7, class: 'nx-fill-warn-bg' });
    el(g, 'path', { d: 'M-15 -108 Q-15 -116 -7 -116 L7 -116 Q15 -116 15 -108 L10 -61 L-10 -61 Z', class: fillClass(tone) });
    el(g, 'circle', { cx: 14, cy: -62, r: 4.5, class: 'nx-fill-warn-bg nx-stroke-ink', 'stroke-width': 1.5 });
    el(g, 'circle', { cx: 0, cy: -129, r: 10, class: 'nx-fill-warn-bg nx-stroke-ink', 'stroke-width': 2 });
    el(g, 'circle', { cx: -5, cy: -130, r: 1.6, class: 'nx-fill-ink-fg' });
    el(g, 'circle', { cx: 1.5, cy: -130, r: 1.6, class: 'nx-fill-ink-fg' });
    el(g, 'path', { d: 'M-6 -125 Q-2.5 -122 1 -125', fill: 'none', class: 'nx-stroke-ink', 'stroke-width': 1.5, 'stroke-linecap': 'round' });
    const upper = el(g, 'line', { x1: SHOULDER[0], y1: SHOULDER[1], class: strokeClass(tone), 'stroke-width': 7, 'stroke-linecap': 'round', 'data-part': prefix + '-upper-arm' });
    const fore = el(g, 'line', { class: strokeClass(tone), 'stroke-width': 6, 'stroke-linecap': 'round', 'data-part': prefix + '-forearm' });
    const hand = el(g, 'circle', { r: 5, class: 'nx-fill-warn-bg nx-stroke-ink', 'stroke-width': 1.5, 'data-part': prefix + '-hand-tip' });
    // Moves the hand to target (figure coordinates); bend wobbles the elbow, in radians.
    return function armTo(target, bend) {
      const dx = target[0] - SHOULDER[0];
      const dy = target[1] - SHOULDER[1];
      const reach = Math.max(FOREARM - UPPER_ARM + 0.5, Math.min(UPPER_ARM + FOREARM - 0.5, Math.hypot(dx, dy)));
      const cos = (UPPER_ARM * UPPER_ARM + reach * reach - FOREARM * FOREARM) / (2 * UPPER_ARM * reach);
      const base = Math.atan2(dy, dx);
      const offset = Math.acos(Math.max(-1, Math.min(1, cos)));
      const elbowY = (a) => SHOULDER[1] + UPPER_ARM * Math.sin(a);
      const a = (elbowY(base - offset) >= elbowY(base + offset) ? base - offset : base + offset) + (bend || 0);
      const elbow = [SHOULDER[0] + UPPER_ARM * Math.cos(a), SHOULDER[1] + UPPER_ARM * Math.sin(a)];
      const toward = Math.atan2(target[1] - elbow[1], target[0] - elbow[0]);
      const tip = [elbow[0] + FOREARM * Math.cos(toward), elbow[1] + FOREARM * Math.sin(toward)];
      attrs(upper, { x2: elbow[0], y2: elbow[1] });
      attrs(fore, { x1: elbow[0], y1: elbow[1], x2: tip[0], y2: tip[1] });
      attrs(hand, { cx: tip[0], cy: tip[1] });
    };
  }

  function figure(parent, opts) {
    const o = withDefaults(opts, { scale: 1, tone: 'info' });
    const g = el(parent, 'g', { 'data-part': 'figure', transform: 'translate(' + pt([o.x, o.y]) + ') scale(' + num(o.scale) + ')' });
    const armTo = drawFigure(g, o.tone, 'fig');
    armTo([SHOULDER[0] - 4, SHOULDER[1] + 52], 0);
    return {
      reach: (xy) => armTo([(xy[0] - o.x) / o.scale, (xy[1] - o.y) / o.scale], 0),
      wave: (p) => armTo([SHOULDER[0] - 22 + 12 * Math.sin(4 * Math.PI * clamp01(p)), SHOULDER[1] - 42], 0),
    };
  }

  // The stopwatch is drawn at radius 56 around (0, 0) and scaled to r. The dial sweeps 300 degrees
  // clockwise from twelve o'clock for 0..max, leaving a gap under the crown like a kitchen timer.
  const SWEEP = 300;
  const ARC_R = 39;
  const HAND_R = 34;
  const OPERATOR_AT = [75, 51]; // the operator's feet, beside the dial
  const CROWN_Y = -78;
  const CROWN_AXIS = [0, -71];
  const CROWN_GRIP = [20, -71]; // the hand holds the crown's end while winding
  const CROWN_TOP = [14, -83]; // and rests on its top after pressing it
  const WRIST_ARC = 0.22;
  const PRESS_DEPTH = 4;
  const KNURL_X = [-8, 0, 8];
  const KNURL_PITCH = 8;
  const dialPoint = (deg, r) => [r * Math.sin((deg * Math.PI) / 180), -r * Math.cos((deg * Math.PI) / 180)];
  const bounce = (q) => 1 + 0.06 * Math.sin(2 * Math.PI * q) * (1 - q);

  function stopwatch(parent, opts) {
    const o = withDefaults(opts, { r: 56, max: 60, segments: null, operator: false, unit: '' });
    const segments = o.segments || [{ to: o.max, tone: 'info' }];
    const deg = (v) => (Math.max(0, Math.min(o.max, v)) / o.max) * SWEEP;
    const arcD = (fromDeg, toDeg) => 'M' + pt(dialPoint(fromDeg, ARC_R)) + ' A' + ARC_R + ' ' + ARC_R + ' 0 '
      + (toDeg - fromDeg > 180 ? 1 : 0) + ' 1 ' + pt(dialPoint(toDeg, ARC_R));
    const outer = el(parent, 'g', { 'data-part': 'stopwatch', transform: 'translate(' + pt([o.cx, o.cy]) + ') scale(' + num(o.r / 56) + ')' });
    el(outer, 'ellipse', { cx: 4, cy: 57, rx: 52, ry: 4, class: 'nx-fill-ink-fg', opacity: 0.12 });
    el(outer, 'circle', { cx: 3, cy: 4, r: 56, class: 'nx-fill-ink-fg', opacity: 0.12 });
    if (o.operator) el(outer, 'ellipse', { cx: 75, cy: 56, rx: 26, ry: 3, class: 'nx-fill-ink-fg', opacity: 0.12 });
    const dial = el(outer, 'g', { 'data-part': 'sw-dial' });
    const stem = el(dial, 'rect', { x: -6, y: CROWN_Y + 13, width: 12, height: 11, rx: 2, class: 'nx-fill-ink-2-fg' });
    const crown = el(dial, 'rect', { x: -15, y: CROWN_Y, width: 30, height: 14, rx: 4, class: 'nx-fill-ink-2-fg' });
    const knurls = KNURL_X.map((x) => el(dial, 'line', { x1: x, y1: CROWN_Y + 3, x2: x, y2: CROWN_Y + 11, class: 'nx-stroke-page', 'stroke-width': 2 }));
    const rim = el(dial, 'circle', { r: 56, 'data-part': 'sw-rim' });
    el(dial, 'circle', { r: 50, class: 'nx-fill-sunken-bg' });
    const flash = el(dial, 'circle', { r: 50, class: 'nx-fill-stop-bg', opacity: 0, 'data-part': 'sw-flash' });
    el(dial, 'path', { d: 'M-10 -49 A50 50 0 0 0 -48 -16', fill: 'none', class: 'nx-stroke-page', opacity: 0.35, 'stroke-width': 3, 'stroke-linecap': 'round' });
    for (let i = 0; i <= 6; i += 1) {
      const [a, b] = [dialPoint((i * SWEEP) / 6, 44), dialPoint((i * SWEEP) / 6, 49)];
      el(dial, 'line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'nx-stroke-ink', 'stroke-width': 3, 'stroke-linecap': 'round' });
    }
    el(dial, 'path', { d: arcD(0, SWEEP), fill: 'none', class: 'nx-stroke-hairline', 'stroke-width': 7 });
    const arcs = segments.map((s, i) => el(dial, 'path', { fill: 'none', class: strokeClass(s.tone || 'info'), 'stroke-width': 7, 'data-part': 'sw-arc-' + i }));
    const hand = el(dial, 'line', { x1: 0, y1: 0, class: 'nx-stroke-ink', 'stroke-width': 3, 'stroke-linecap': 'round', 'data-part': 'sw-hand' });
    el(dial, 'circle', { r: 5, class: 'nx-fill-ink-fg' });
    // Drawn over the hand with a halo, so the hand never hides it.
    const total = text(dial, 0, 22, '', { size: 18, weight: 600, anchor: 'middle', on: 'sunken', halo: true });
    total.setAttribute('data-part', 'sw-total');
    const legendX = o.operator ? 132 : 76;
    const legends = segments.map((s, i) => {
      if (!s.label) return null;
      const g = el(outer, 'g', { 'data-part': 'sw-legend-' + i });
      const y = -31 + i * 34;
      el(g, 'line', { x1: legendX, y1: y, x2: legendX + 20, y2: y, class: strokeClass(s.tone || 'info'), 'stroke-width': 8, 'stroke-linecap': 'round' });
      text(g, legendX + 30, y + 7, s.label, { tone: s.tone || 'info', weight: 700, halo: true });
      return g;
    });
    let armTo = null;
    if (o.operator) armTo = drawFigure(el(outer, 'g', { transform: 'translate(' + pt(OPERATOR_AT) + ')' }), 'info', 'sw');
    const reachDial = (xy, bend) => armTo && armTo([xy[0] - OPERATOR_AT[0], xy[1] - OPERATOR_AT[1]], bend);
    const scales = { click: 1, press: 1 };
    const applyScale = () => dial.setAttribute('transform', 'scale(' + num(scales.click * scales.press) + ')');
    function setKnurls(shift) {
      knurls.forEach((line, i) => {
        const x = KNURL_X[0] - 6 + ((KNURL_X[i] - KNURL_X[0] + 6 + shift) % (3 * KNURL_PITCH));
        attrs(line, { x1: x, x2: x });
      });
    }
    function setCrown(depth) {
      attrs(crown, { y: CROWN_Y + depth });
      attrs(stem, { y: CROWN_Y + 13 + depth, height: 11 - depth });
    }

    // value: where the hand points (0..max). total: the label in the dial, a number (shown with
    // the unit) or text; 0 or empty hides it. flash: 0..1 stop-colour flash. click: 0..1 bounce.
    // rim: the rim's tone (default ink-2), for example 'stop' when the time has run out.
    function set(state) {
      const s = state || {};
      const value = s.value || 0;
      const tip = dialPoint(deg(value), HAND_R);
      attrs(hand, { x2: tip[0], y2: tip[1] });
      let start = 0;
      segments.forEach((seg, i) => {
        const [a, b] = [deg(start), deg(Math.min(value, seg.to))];
        show(arcs[i], b - a > 0.05);
        if (b - a > 0.05) arcs[i].setAttribute('d', arcD(a, b));
        if (legends[i]) show(legends[i], value > start);
        start = seg.to;
      });
      const label = typeof s.total === 'number' ? withUnit(s.total, o.unit) : s.total || '';
      total.textContent = label;
      show(total, Boolean(s.total));
      rim.setAttribute('class', fillClass(s.rim || 'ink-2'));
      attrs(flash, { opacity: clamp01(s.flash || 0) * 0.9 });
      scales.click = bounce(clamp01(s.click || 0));
      applyScale();
    }

    // Winding: the hand grips the crown's end and turns it in a small wrist arc; the knurls turn
    // and the elbow wobbles, settling at the end.
    function wind(p) {
      const q = clamp01(p);
      const swing = Math.sin(Math.PI * q);
      const turn = q * 4 * Math.PI;
      setKnurls((q * 3 * KNURL_PITCH) % KNURL_PITCH);
      setCrown(0);
      scales.press = 1;
      applyScale();
      const a = WRIST_ARC * swing * Math.sin(turn);
      const radius = CROWN_GRIP[0] - CROWN_AXIS[0];
      reachDial([CROWN_AXIS[0] + radius * Math.cos(a), CROWN_AXIS[1] + radius * Math.sin(a)], 0.12 * swing * Math.sin(3 * turn));
    }

    // Pressing: the hand moves from the crown's end onto its top and pushes it down, then the dial
    // clicks with a short bounce. Afterwards the hand rests on the crown.
    function press(p) {
      const q = clamp01(p);
      const onTop = ease.inOut(clamp01(q / 0.3));
      const depth = PRESS_DEPTH * Math.sin(Math.PI * clamp01((q - 0.3) / 0.3));
      setKnurls(0);
      setCrown(depth);
      scales.press = bounce(clamp01((q - 0.45) / 0.5));
      applyScale();
      reachDial([lerp(CROWN_GRIP[0], CROWN_TOP[0], onTop), lerp(CROWN_GRIP[1], CROWN_TOP[1], onTop) + depth], 0);
    }

    set({ value: 0 });
    press(1);
    return { set, wind, press };
  }

  function axis(parent, opts) {
    const o = withDefaults(opts, { ticks: 4, unit: '' });
    const x = (t) => o.x0 + ((t - o.t0) / (o.t1 - o.t0)) * (o.x1 - o.x0);
    const g = el(parent, 'g', { 'data-part': 'axis' });
    el(g, 'line', { x1: o.x0, y1: o.y, x2: o.x1, y2: o.y, class: 'nx-stroke-ink-2', 'stroke-width': 2 });
    const values = Array.isArray(o.ticks) ? o.ticks
      : Array.from({ length: o.ticks + 1 }, (_, i) => o.t0 + ((o.t1 - o.t0) * i) / o.ticks);
    values.forEach((t) => {
      el(g, 'line', { x1: x(t), y1: o.y, x2: x(t), y2: o.y + 8, class: 'nx-stroke-ink-2', 'stroke-width': 2 });
      text(g, x(t), o.y + 30, withUnit(t, o.unit), { size: 18, anchor: 'middle', tone: 'ink-2' });
    });
    return { x };
  }

  function meter(parent, opts) {
    const o = withDefaults(opts, { tone: 'info' });
    const rx = Math.min(6, o.h / 2);
    const g = el(parent, 'g', { 'data-part': 'meter' });
    el(g, 'rect', { x: o.x, y: o.y, width: o.w, height: o.h, rx, class: 'nx-fill-sunken-bg nx-stroke-hairline', 'stroke-width': 1.5 });
    const fill = el(g, 'rect', { x: o.x, y: o.y, width: 0, height: o.h, rx, 'data-part': 'meter-fill' });
    const setTone = (tone) => fill.setAttribute('class', fillClass(tone));
    setTone(o.tone);
    return { set: (p) => attrs(fill, { width: o.w * clamp01(p) }), setTone };
  }

  function stamp(parent, opts) {
    const o = withDefaults(opts, { kind: 'ok', size: 48 });
    const r = o.size / 2;
    const tone = o.kind === 'stop' ? 'stop' : 'ok';
    const g = el(parent, 'g', { 'data-part': 'stamp' });
    el(g, 'circle', { cx: o.x, cy: o.y, r, class: fillClass(tone + '-bg') + ' ' + strokeClass(tone), 'stroke-width': 3 });
    const at = (dx, dy) => pt([o.x + dx * r, o.y + dy * r]);
    const d = tone === 'ok'
      ? 'M' + at(-0.45, 0) + ' L' + at(-0.12, 0.32) + ' L' + at(0.45, -0.35)
      : 'M' + at(-0.35, -0.35) + ' L' + at(0.35, 0.35) + ' M' + at(0.35, -0.35) + ' L' + at(-0.35, 0.35);
    el(g, 'path', { d, fill: 'none', class: strokeClass(tone), 'stroke-width': Math.max(3, o.size / 10), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    // Pops in with a small overshoot.
    const pop = (p) => g.setAttribute('transform', scaleAbout([o.x, o.y], ease.outBack(p)));
    pop(1);
    return { show: (on) => show(g, on), pop };
  }

  // ---- Characters ----

  // What each mood draws: which eyes, whether the brows show, and the mouth (open mouths are filled).
  const MOODS = {
    calm: { eyes: 'open', mouth: 'M-14 14 Q0 24 14 14', open: false },
    busy: { eyes: 'open', mouth: 'M-7 12 Q0 4 7 12 Q0 24 -7 12 Z', open: true },
    worried: { eyes: 'open', brows: true, mouth: 'M-14 20 Q-7 11 0 20 Q7 29 14 20', open: false },
    stopped: { eyes: 'x', mouth: 'M-14 22 Q0 8 14 22', open: false },
    happy: { eyes: 'happy', mouth: 'M-16 10 Q0 30 16 10 Z', open: true },
  };

  // A face drawn around (x, y), about 60 units wide at scale 1. set(mood): calm, busy, worried, stopped, happy.
  function face(parent, opts) {
    const o = withDefaults(opts, { x: 0, y: 0, scale: 1 });
    const g = el(parent, 'g', { 'data-part': 'face' });
    place(g, o.x, o.y, o.scale);
    const eyes = el(g, 'g', { 'data-part': 'face-eyes' });
    [-20, 20].forEach((ex) => {
      el(eyes, 'circle', { cx: ex, cy: -6, r: 10, class: 'nx-fill-page nx-stroke-ink', 'stroke-width': 2 });
      el(eyes, 'circle', { cx: ex + 2, cy: -5, r: 4.5, class: 'nx-fill-ink-fg' });
    });
    const stroke = { fill: 'none', class: 'nx-stroke-ink', 'stroke-linecap': 'round' };
    const cross = el(g, 'path', Object.assign({ d: 'M-27 -13 L-13 1 M-13 -13 L-27 1 M13 -13 L27 1 M27 -13 L13 1', 'stroke-width': 3, 'data-part': 'face-cross' }, stroke));
    const glad = el(g, 'path', Object.assign({ d: 'M-28 -2 Q-20 -16 -12 -2 M12 -2 Q20 -16 28 -2', 'stroke-width': 3.5, 'data-part': 'face-glad' }, stroke));
    const brows = el(g, 'path', Object.assign({ d: 'M-30 -19 L-12 -25 M30 -19 L12 -25', 'stroke-width': 3, 'data-part': 'face-brows' }, stroke));
    const mouth = el(g, 'path', { fill: 'none', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'data-part': 'face-mouth' });
    return {
      g,
      set(mood) {
        const look = MOODS[mood];
        show(eyes, look.eyes === 'open');
        show(cross, look.eyes === 'x');
        show(glad, look.eyes === 'happy');
        show(brows, Boolean(look.brows));
        mouth.setAttribute('d', look.mouth);
        mouth.setAttribute('class', look.open ? 'nx-fill-ink-fg nx-stroke-ink' : 'nx-stroke-ink');
      },
    };
  }

  // A small server (130 x 70) with two lights: set({tone, mood, lights}) tints its body, picks its
  // face and lights one lamp (lights true) or the other.
  function serverParts(g) {
    [-38, 38].forEach((lx) => el(g, 'rect', { x: lx - 8, y: 30, width: 16, height: 10, rx: 3, class: 'nx-fill-ink-2-fg' }));
    const body = el(g, 'rect', { x: -65, y: -35, width: 130, height: 70, rx: 14, 'stroke-width': 3, 'data-part': 'character-body' });
    const lamps = [48, 32].map((cx, i) => el(g, 'circle', { cx, cy: -20, r: 5, 'data-part': 'character-led-' + i }));
    el(g, 'line', { x1: -50, y1: -21, x2: -26, y2: -21, class: 'nx-stroke-hairline', 'stroke-width': 4, 'stroke-linecap': 'round' });
    const f = face(g, { x: -8, y: 6, scale: 0.8 });
    return (s) => {
      body.setAttribute('class', bodyClass(s.tone));
      f.set(s.mood);
      lamps[0].setAttribute('class', fillClass((s.lights ? s.tone : 'ink-2') + '-fg'));
      lamps[1].setAttribute('class', fillClass((s.lights ? 'ink-2' : s.tone) + '-fg'));
    };
  }

  // A small screen (140 x 80) with an antenna bulb in the tone and a sweat drop when worried:
  // set({tone, mood}).
  function screenParts(g) {
    const antenna = el(g, 'g', {});
    el(antenna, 'line', { x1: 0, y1: -40, x2: 0, y2: -62, class: 'nx-stroke-ink-2', 'stroke-width': 4, 'stroke-linecap': 'round' });
    const bulb = el(antenna, 'circle', { cy: -68, r: 8, 'data-part': 'character-bulb' });
    [-74, 74].forEach((ex) => el(g, 'rect', { x: ex - 5, y: -14, width: 10, height: 28, rx: 4, class: 'nx-fill-ink-2-fg' }));
    const body = el(g, 'rect', { x: -70, y: -40, width: 140, height: 80, rx: 18, 'stroke-width': 3, 'data-part': 'character-body' });
    el(g, 'rect', { x: -56, y: -30, width: 112, height: 60, rx: 12, class: 'nx-fill-page', opacity: 0.55 });
    const f = face(g, { x: 0, y: 3, scale: 0.95 });
    const sweat = el(g, 'path', { d: 'M52 -34 Q60 -20 52 -14 Q44 -20 52 -34 Z', class: 'nx-fill-info-bg nx-stroke-info', 'stroke-width': 2, 'data-part': 'character-sweat' });
    return (s) => {
      f.set(s.mood);
      body.setAttribute('class', bodyClass(s.tone));
      bulb.setAttribute('class', fillClass(s.tone + '-fg'));
      show(sweat, s.mood === 'worried');
    };
  }

  const CHARACTERS = { server: serverParts, screen: screenParts };

  // A character with a face, standing at (x, y): kind 'server' or 'screen'. move({hop, shake, slide})
  // lifts it by hop, shifts it sideways by slide and tilts it by shake degrees, all from its stand.
  function character(parent, opts) {
    const o = withDefaults(opts, { kind: 'server', x: 0, y: 0 });
    const g = el(parent, 'g', { 'data-part': 'character', 'data-kind': o.kind });
    const set = CHARACTERS[o.kind](g);
    place(g, o.x, o.y);
    return {
      g,
      set,
      move({ hop = 0, shake = 0, slide = 0 }) { place(g, o.x + slide, o.y - hop, 1, shake); },
    };
  }

  // ---- Ring timer ----
  // A ring that drains, drawn around (x, y) at radius r with its number inside. It can hold, with a
  // pause badge by its rim, release the hold with a lift and a pulse, and shake. `badge` is the
  // badge's offset from the centre and `flash` where the pulse appears (the centre by default).

  function ring(parent, opts) {
    const o = withDefaults(opts, { r: 34 });
    const [cx, cy] = [o.x, o.y];
    const badgeAt = o.badge || [o.r * 0.7, -o.r * 0.7];
    const flashAt = o.flash || [cx, cy];
    const circumference = 2 * Math.PI * o.r;
    const g = el(parent, 'g', { 'data-part': 'ring' });
    el(g, 'circle', { cx, cy, r: o.r, fill: 'none', class: 'nx-stroke-hairline', 'stroke-width': 9 });
    const sweep = el(g, 'circle', { cx, cy, r: o.r, fill: 'none', 'stroke-width': 9, transform: 'rotate(-90 ' + pt([cx, cy]) + ')', 'data-part': 'ring-sweep' });
    const label = text(g, cx, cy + 6, '', { size: 18, weight: 700, anchor: 'middle' });
    label.setAttribute('data-part', 'ring-label');
    const badge = el(g, 'g', { 'data-part': 'hold-badge', visibility: 'hidden' });
    el(badge, 'circle', { r: 15, class: 'nx-fill-warn-fg nx-stroke-page', 'stroke-width': 3 });
    [-6, 2].forEach((bx) => el(badge, 'rect', { x: bx, y: -8, width: 4, height: 16, rx: 1.5, class: 'nx-fill-page' }));
    const flash = el(g, 'circle', { cx: flashAt[0], cy: flashAt[1], r: 10, fill: 'none', class: 'nx-stroke-ok', 'stroke-width': 4, 'data-part': 'ring-flash', visibility: 'hidden' });
    return {
      g,
      set({ frac, tone, label: str }) {
        sweep.setAttribute('stroke-dasharray', num(circumference * clamp01(frac)) + ' ' + num(circumference));
        sweep.setAttribute('class', strokeClass(tone));
        label.textContent = str;
        label.setAttribute('class', fillClass(tone === 'ink-2' ? 'ink-2' : 'ink'));
      },
      // The badge shows while `on`, popping in as p runs 0..1. Call it before release().
      hold(on, p = 1) {
        show(badge, on);
        place(badge, cx + badgeAt[0], cy + badgeAt[1], Math.max(0.01, ease.outBack(p)));
        badge.setAttribute('opacity', 1);
      },
      // While p < 1 the badge rises and fades and a pulse spreads; at p = 1 the pulse is gone.
      release(p) {
        show(flash, p < 1);
        if (p >= 1) return;
        show(badge, true);
        place(badge, cx + badgeAt[0], cy + badgeAt[1] - 46 * ease.out(p), 1 - 0.5 * p);
        attrs(badge, { opacity: 1 - p });
        attrs(flash, { r: 10 + 34 * ease.out(p), opacity: 1 - p });
      },
      shake(p, amp = 7) {
        const w = wobble(p, amp);
        g.setAttribute('transform', 'translate(' + pt([cx + w, cy]) + ') rotate(' + num(w) + ') translate(' + pt([-cx, -cy]) + ')');
      },
    };
  }

  // ---- Timeline lanes ----
  // A time axis with rows of bars under it: lanes(parent, {x0, x1, t0, t1, y, top, ticks, unit, h, panel,
  // rows: [{y, label}]}). x0..x1 is the axis on screen for times t0..t1 at height y; top is where
  // the deadline and the playhead start. Each row is a lane of height h. The builders create their
  // parts when called, so the caller picks the drawing order; each handle then sets times.

  const BAR_DASH = '6 5';
  const accentOf = (tone) => String(tone).replace(/-(bg|fg)$/, '');
  // A bar tone is '<accent>-bg' (pale, accent text), '<accent>-fg' (strong, page text) or 'outline'.
  function barLook(tone) {
    if (tone === 'outline') return { rect: 'nx-stroke-edge', label: fillClass('ink-2') };
    return {
      rect: fillClass(tone) + ' ' + strokeClass(accentOf(tone)),
      label: /-fg$/.test(tone) ? fillClass('page') : fillClass(accentOf(tone)),
    };
  }

  function laneBar(parent, lane, dashed) {
    const rect = el(parent, 'rect', { y: lane.y, height: lane.h, rx: 6, 'stroke-width': 2, 'stroke-dasharray': dashed ? BAR_DASH : null, 'data-part': 'lane-bar' });
    const label = text(parent, 0, lane.y + lane.h - 9, '', { size: 18, weight: 600, anchor: 'middle' });
    label.setAttribute('data-part', 'lane-bar-label');
    return {
      // The bar spans from..to in time; its label shows only if it fits (about 9.6 units a letter).
      set(from, to, str, tone) {
        const width = lane.x(to) - lane.x(from);
        const look = barLook(tone);
        attrs(rect, { x: lane.x(from), width: Math.max(0, width), class: look.rect, fill: tone === 'outline' ? 'none' : null });
        show(rect, width > 0.5);
        label.textContent = str;
        attrs(label, { x: lane.x(from) + width / 2, class: look.label });
        show(label, width > String(str).length * 9.6 + 16);
      },
      hide() { show(rect, false); show(label, false); },
    };
  }

  // The dashed outline of the whole time a lane may use.
  function laneBudget(parent, lane) {
    const rect = el(parent, 'rect', { x: lane.x(lane.t0), y: lane.y, width: 0, height: lane.h, rx: 6, fill: 'none', class: 'nx-stroke-hairline', 'stroke-width': 2, 'stroke-dasharray': BAR_DASH, 'data-part': 'lane-budget' });
    return {
      set(from, to) { attrs(rect, { x: lane.x(from), width: Math.max(0, lane.x(to) - lane.x(from)) }); },
      show: (on) => show(rect, on),
    };
  }

  // A vertical line over every lane with a label above it; solid or dashed, in a tone.
  function laneDeadline(parent, axisLane) {
    const line = el(parent, 'line', { y1: axisLane.top, y2: axisLane.axisY, 'stroke-width': 3, 'data-part': 'lane-deadline' });
    const label = text(parent, 0, axisLane.top - 8, '', { size: 18, weight: 700, anchor: 'middle', halo: true });
    label.setAttribute('data-part', 'lane-deadline-label');
    return {
      set(t, str, tone, solid) {
        const x = axisLane.x(t);
        attrs(line, { x1: x, x2: x, class: strokeClass(tone), 'stroke-dasharray': solid ? '1 0' : '7 6' });
        attrs(label, { x, class: textClass(tone, null, true) });
        label.textContent = str;
      },
      show(on) { show(line, on); show(label, on); },
    };
  }

  // A tick (shape 'line', from y1 to y2) or a dot (shape 'dot', at y) at a time, with a label beside it:
  // on the `side` 'left' (text ends at the mark) or 'right', `gap` units away.
  function laneMark(parent, axisLane, opts) {
    const o = withDefaults(opts, { shape: 'line', side: 'left', gap: 10, width: 4 });
    const dot = o.shape === 'dot';
    const left = o.side === 'left';
    const mark = dot
      ? el(parent, 'circle', { cy: o.y, r: 9, 'stroke-width': 2, 'data-part': 'lane-mark' })
      : el(parent, 'line', { y1: o.y1, y2: o.y2, 'stroke-width': o.width, 'stroke-linecap': 'round', 'data-part': 'lane-mark' });
    const label = text(parent, 0, o.labelY, '', { size: 18, weight: 600, anchor: left ? 'end' : 'start', halo: true });
    label.setAttribute('data-part', 'lane-mark-label');
    return {
      set(t, str, tone) {
        const x = axisLane.x(t);
        if (dot) attrs(mark, { cx: x, class: fillClass(tone) + ' nx-stroke-page' });
        else attrs(mark, { x1: x, x2: x, class: strokeClass(tone) });
        label.textContent = str;
        attrs(label, { x: x + (left ? -o.gap : o.gap), class: textClass(tone, null, true) });
      },
      show(on) { show(mark, on); show(label, on); },
    };
  }

  function lanePlayhead(parent, axisLane) {
    const line = el(parent, 'line', { y1: axisLane.top, y2: axisLane.axisY, class: 'nx-stroke-ink', 'stroke-width': 3, opacity: 0.55, 'data-part': 'playhead' });
    return {
      set(t) { const x = axisLane.x(t); attrs(line, { x1: x, x2: x }); },
      show: (on) => show(line, on),
    };
  }

  function lanes(parent, opts) {
    const o = withDefaults(opts, { ticks: 4, unit: '', h: 32, labelX: 28 });
    if (o.panel) el(parent, 'rect', { x: o.panel.x, y: o.panel.y, width: o.panel.w, height: o.panel.h, rx: 14, class: 'nx-fill-page nx-stroke-hairline', 'stroke-width': 2 });
    const ruler = axis(parent, { x0: o.x0, x1: o.x1, y: o.y, t0: o.t0, t1: o.t1, ticks: o.ticks, unit: o.unit });
    const labels = o.rows.map((row) => {
      const node = text(parent, o.labelX, row.y + 24, row.label || '', { size: 20, weight: 700 });
      node.setAttribute('data-part', 'lane-label');
      return node;
    });
    const lane = (i) => ({ x: ruler.x, t0: o.t0, y: o.rows[i].y, h: o.h });
    const axisLane = { x: ruler.x, top: o.top, axisY: o.y };
    return {
      x: ruler.x,
      setLabel(i, str) { labels[i].textContent = str; },
      bar: (i, barOpts) => laneBar(parent, lane(i), Boolean(barOpts && barOpts.dashed)),
      budget: (i) => laneBudget(parent, lane(i)),
      deadline: () => laneDeadline(parent, axisLane),
      mark: (markOpts) => laneMark(parent, axisLane, markOpts),
      playhead: () => lanePlayhead(parent, axisLane),
    };
  }

  // ---- Card ----
  // A titled block of text lines: card(parent, {x, y, w, h, tone, lines: [{y, weight, tone}], tag: {text, w, tone}}).
  // setLines takes one string, or {text, tone}, per line; lines left out are emptied.

  function cardTag(parent, o) {
    const t = withDefaults(o.tag, { w: labelWidth(o.tag.text), tone: 'warn' });
    const g = el(parent, 'g', { 'data-part': 'card-tag', visibility: 'hidden' });
    const x = o.x + o.w - o.pad - t.w;
    el(g, 'rect', { x, y: o.y + 12, width: t.w, height: 30, rx: 15, class: bodyClass(t.tone), 'stroke-width': 2 });
    text(g, x + t.w / 2, o.y + 33, t.text, { size: 18, weight: 700, anchor: 'middle', tone: t.tone });
    return g;
  }

  function card(parent, opts) {
    const o = withDefaults(opts, { tone: 'info', lines: [], pad: 20 });
    const g = el(parent, 'g', { 'data-part': 'card' });
    const frame = el(g, 'rect', { x: o.x, y: o.y, width: o.w, height: o.h, rx: 12, 'stroke-width': 3, 'data-part': 'card-box' });
    const title = text(g, o.x + o.pad, o.y + 32, '', { size: 22, weight: 800 });
    title.setAttribute('data-part', 'card-title');
    const rows = o.lines.map((line) => {
      const node = text(g, o.x + o.pad, line.y, '', { size: 18, weight: line.weight || 400, tone: line.tone || 'ink' });
      node.setAttribute('data-part', 'card-line');
      return node;
    });
    const tagNode = o.tag ? cardTag(g, o) : null;
    function setTone(tone) {
      frame.setAttribute('class', fillClass('page') + ' ' + strokeClass(tone));
      title.setAttribute('class', fillClass(tone));
    }
    setTone(o.tone);
    return {
      g,
      setTitle(str) { title.textContent = str; },
      setLines(list) {
        rows.forEach((node, i) => {
          const item = list[i];
          const detail = item !== null && typeof item === 'object' ? item : { text: item };
          node.textContent = detail.text == null ? '' : detail.text;
          node.setAttribute('class', textClass(detail.tone || o.lines[i].tone || 'ink'));
        });
      },
      setTone,
      setDashed(on) { frame.setAttribute('stroke-dasharray', on ? '12 7' : 'none'); },
      tag: (on) => show(tagNode, on),
      fade(p) { attrs(g, { opacity: p }); },
      show: (on) => show(g, on),
    };
  }

  // ---- Bursts ----

  const CONFETTI_TONES = ['ok', 'info', 'warn', 'stop'];

  // Paper bits flung from `at` in an upward fan, then falling; burst(p) draws progress p and hides them at 1.
  function confetti(parent, opts) {
    const o = withDefaults(opts, { count: 16, radius: 90, fall: 120 });
    const g = el(parent, 'g', { 'data-part': 'confetti' });
    const bits = Array.from({ length: o.count }, (_, i) => el(g, 'rect', {
      width: 9, height: 14, rx: 2, class: fillClass(CONFETTI_TONES[i % CONFETTI_TONES.length]), 'data-part': 'confetti-bit',
    }));
    return {
      g,
      burst(p) {
        bits.forEach((bit, i) => {
          show(bit, p < 1);
          const angle = (i / o.count) * Math.PI - Math.PI;
          const reach = (o.radius + (i % 3) * 30) * ease.out(p);
          place(bit, o.at[0] + Math.cos(angle) * reach, o.at[1] + Math.sin(angle) * reach + o.fall * p * p, 1, i * 47 + p * 360);
        });
      },
    };
  }

  // Eight rays; burst(p, at) grows them from 0.8 to 1.2 times their size as p runs 0..1 and hides them at 1.
  function spark(parent, opts) {
    const o = withDefaults(opts, { x: 0, y: 0 });
    const g = el(parent, 'g', { 'data-part': 'spark' });
    for (let i = 0; i < 8; i += 1) {
      const a = (i * Math.PI) / 4;
      el(g, 'line', { x1: Math.cos(a) * 8, y1: Math.sin(a) * 8, x2: Math.cos(a) * 20, y2: Math.sin(a) * 20, class: 'nx-stroke-warn', 'stroke-width': 3.5, 'stroke-linecap': 'round' });
    }
    return {
      g,
      burst(p, at) {
        show(g, p < 1);
        place(g, at ? at[0] : o.x, at ? at[1] : o.y, 0.8 + 0.4 * p);
      },
    };
  }

  NX.kit = {
    clamp01, lerp, ramp, along, ease, wobble, arc, squash,
    svg, el, text, box, arrow, token, bubble, queue, readout, stopwatch, figure, axis, meter, stamp,
    face, character, ring, lanes, card, confetti, spark,
  };
})(typeof window !== 'undefined' ? window : globalThis);
