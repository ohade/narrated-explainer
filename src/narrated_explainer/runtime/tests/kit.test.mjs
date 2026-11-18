// Tests for the drawing kit (runtime/kit.js), loaded the way the build tool loads it: through
// vm.runInContext, with a small fake DOM standing in for the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const KIT_PATH = fileURLToPath(new URL('../kit.js', import.meta.url));
const KIT_SRC = readFileSync(KIT_PATH, 'utf8');

function makeDoc() {
  const stats = { created: 0, writes: 0 };
  class FakeNode {
    constructor(tag) {
      this.tagName = tag;
      this.attrs = {};
      this.children = [];
      this.parentNode = null;
      this.text = '';
    }
    setAttribute(name, value) { stats.writes += 1; this.attrs[name] = String(value); }
    getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    get textContent() { return this.text + this.children.map((c) => c.textContent).join(''); }
    set textContent(value) { stats.writes += 1; this.children = []; this.text = String(value); }
  }
  const doc = { createElementNS(ns, tag) { stats.created += 1; return new FakeNode(tag); } };
  return { doc, stats, FakeNode };
}

function loadKit(withDocument = true) {
  const fake = makeDoc();
  const context = vm.createContext(withDocument ? { document: fake.doc } : {});
  vm.runInContext(KIT_SRC, context, { filename: 'kit.js' });
  return { kit: context.NarratedExplainer.kit, ...fake };
}

const nodes = (root) => [root, ...root.children.flatMap(nodes)];
const parts = (root, name) => nodes(root).filter((n) => n.attrs['data-part'] === name);
const part = (root, name) => {
  const found = parts(root, name);
  assert.equal(found.length, 1, 'expected one node with data-part="' + name + '"');
  return found[0];
};
const classes = (node) => (node.attrs.class || '').split(/\s+/).filter(Boolean);
const visible = (node) => node.attrs.visibility !== 'hidden';
const nums = (s) => (String(s).match(/-?\d+(\.\d+)?(e-?\d+)?/g) || []).map(Number);
const close = (actual, expected, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= eps, 'expected ' + expected + ', got ' + actual);
const closePoint = (actual, expected, eps = 1e-6) => {
  close(actual[0], expected[0], eps);
  close(actual[1], expected[1], eps);
};
// Clockwise degrees from twelve o'clock of the point (x, y) seen from (cx, cy).
const clockAngle = (cx, cy, x, y) => ((Math.atan2(x - cx, cy - y) * 180) / Math.PI + 360) % 360;

function stage() {
  const loaded = loadKit();
  const root = loaded.doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
  const svg = loaded.kit.svg(root, '0 0 1200 600', 'Test view');
  return { ...loaded, root, svg };
}

test('pure helpers load and work in Node without a document', () => {
  const { kit } = loadKit(false);
  close(kit.clamp01(-1), 0);
  close(kit.clamp01(0), 0);
  close(kit.clamp01(0.5), 0.5);
  close(kit.clamp01(1), 1);
  close(kit.clamp01(3), 1);
  close(kit.lerp(10, 20, 0), 10);
  close(kit.lerp(10, 20, 0.5), 15);
  close(kit.lerp(10, 20, 1), 20);
  close(kit.ramp(100, 100, 300), 0);
  close(kit.ramp(200, 100, 300), 0.5);
  close(kit.ramp(300, 100, 300), 1);
  close(kit.ramp(50, 100, 300), 0);
  close(kit.ramp(400, 100, 300), 1);
});

test('along walks a two-leg polyline by length', () => {
  const { kit } = loadKit(false);
  const path = [[0, 0], [30, 0], [30, 10]];
  closePoint(kit.along(path, 0), [0, 0]);
  closePoint(kit.along(path, 0.5), [20, 0]);
  closePoint(kit.along(path, 0.75), [30, 0]);
  closePoint(kit.along(path, 0.875), [30, 5]);
  closePoint(kit.along(path, 1), [30, 10]);
});

test('every ease maps 0 to 0 and 1 to 1, and inOut is symmetric', () => {
  const { kit } = loadKit(false);
  for (const name of ['inOut', 'out', 'in', 'outBack']) {
    close(kit.ease[name](0), 0);
    close(kit.ease[name](1), 1);
  }
  close(kit.ease.inOut(0.5), 0.5);
  assert.ok(kit.ease.out(0.5) > 0.5, 'ease.out is ahead at the middle');
  assert.ok(kit.ease.in(0.5) < 0.5, 'ease.in is behind at the middle');
  assert.ok(Math.max(...[0.6, 0.7, 0.8, 0.9].map(kit.ease.outBack)) > 1, 'outBack overshoots');
});

test('svg is responsive and labelled', () => {
  const { svg, root } = stage();
  assert.equal(svg.tagName, 'svg');
  assert.equal(svg.parentNode, root);
  assert.equal(svg.attrs.viewBox, '0 0 1200 600');
  assert.equal(svg.attrs.role, 'img');
  assert.equal(svg.attrs['aria-label'], 'Test view');
  assert.match(svg.attrs.style || '', /width:\s*100%/);
});

test('text picks a readable colour for the fill it sits on', () => {
  const { kit, svg } = stage();
  const plain = kit.text(svg, 10, 20, 'Hello');
  assert.equal(plain.textContent, 'Hello');
  assert.equal(plain.attrs['font-size'], '20');
  assert.ok(classes(plain).includes('nx-fill-ink-fg'));
  assert.ok(!classes(plain).includes('nx-halo'));
  const onStrong = kit.text(svg, 0, 0, 'a', { on: 'ok-fg' });
  assert.ok(classes(onStrong).includes('nx-fill-page'), 'page colour on a *-fg fill');
  assert.ok(!classes(onStrong).includes('nx-fill-ink-fg'));
  const onInk = kit.text(svg, 0, 0, 'a', { on: 'ink' });
  assert.ok(classes(onInk).includes('nx-fill-page'), 'page colour on the ink fill');
  const onSoft = kit.text(svg, 0, 0, 'b', { on: 'info-bg' });
  assert.ok(classes(onSoft).includes('nx-fill-ink-fg'), 'ink on a *-bg fill');
  const onSunken = kit.text(svg, 0, 0, 'c', { on: 'sunken', halo: true });
  assert.ok(classes(onSunken).includes('nx-fill-ink-fg'), 'ink on the sunken fill');
  assert.ok(classes(onSunken).includes('nx-halo'));
  const toned = kit.text(svg, 0, 0, 'd', { tone: 'stop', size: 24, anchor: 'middle' });
  assert.ok(classes(toned).includes('nx-fill-stop-fg'));
  assert.equal(toned.attrs['font-size'], '24');
  assert.equal(toned.attrs['text-anchor'], 'middle');
});

test('el creates a child with attributes', () => {
  const { kit, svg } = stage();
  const node = kit.el(svg, 'circle', { cx: 5, cy: 6, r: 7 });
  assert.equal(node.tagName, 'circle');
  assert.equal(node.parentNode, svg);
  assert.deepEqual([node.attrs.cx, node.attrs.cy, node.attrs.r], ['5', '6', '7']);
});

test('box exposes its centre and edges and updates its status', () => {
  const { kit, svg } = stage();
  const b = kit.box(svg, { x: 100, y: 50, w: 200, h: 100, label: 'Shop' });
  closePoint(Array.from(b.center), [200, 100]);
  closePoint(Array.from(b.edge('left')), [100, 100]);
  closePoint(Array.from(b.edge('right')), [300, 100]);
  closePoint(Array.from(b.edge('top')), [200, 50]);
  closePoint(Array.from(b.edge('bottom')), [200, 150]);
  b.setStatus('Open', 'ok');
  const status = part(b.g, 'status');
  assert.equal(status.textContent, 'Open');
  assert.ok(classes(status).includes('nx-fill-ok-fg'));
});

test('arrow.draw reveals the line from its start with dash values', () => {
  const { kit, svg } = stage();
  const a = kit.arrow(svg, { from: [0, 0], to: [30, 40], label: 'go' });
  const line = part(svg, 'arrow-line');
  a.draw(0.5);
  assert.deepEqual(nums(line.attrs['stroke-dasharray']), [50, 50]);
  close(Number(line.attrs['stroke-dashoffset']), 25);
  a.draw(0);
  close(Number(line.attrs['stroke-dashoffset']), 50);
  a.draw(1);
  close(Number(line.attrs['stroke-dashoffset']), 0);
  a.setTone('stop');
  assert.ok(classes(line).includes('nx-stroke-stop'));
  a.setLabel('stop');
  assert.equal(part(svg, 'arrow-label').textContent, 'stop');
});

test('bubble.pop scales about the tail tip and never exceeds 1', () => {
  const { kit, svg } = stage();
  const b = kit.bubble(svg, { x: 100, y: 50, w: 200, text: 'Hi', tail: [150, 140] });
  const g = part(svg, 'bubble');
  const pattern = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)\s*scale\(([-\d.]+)\)\s*translate\(([-\d.]+)[ ,]+([-\d.]+)\)/;
  let last = -1;
  for (let i = 0; i <= 20; i += 1) {
    b.pop(i / 20);
    const m = g.attrs.transform.match(pattern);
    assert.ok(m, 'transform has the anchored scale form: ' + g.attrs.transform);
    const [tx, ty, s, bx, by] = m.slice(1).map(Number);
    closePoint([tx, ty], [150, 140]);
    closePoint([bx, by], [-150, -140]);
    assert.ok(s <= 1 + 1e-9, 'scale ' + s + ' at p=' + i / 20 + ' exceeds 1');
    assert.ok(s >= last - 1e-9, 'scale never shrinks while popping');
    last = s;
  }
  close(last, 1);
  b.pop(0);
  close(Number(g.attrs.transform.match(pattern)[3]), 0);
  b.setText('Bye');
  assert.ok(nodes(g).some((n) => n.tagName === 'text' && n.textContent === 'Bye'));
});

test('queue.set fills slots left to right and empties null slots', () => {
  const { kit, svg } = stage();
  const q = kit.queue(svg, { x: 0, y: 0, slots: 4, slotW: 50, gap: 10 });
  const chips = parts(svg, 'chip');
  assert.equal(chips.length, 4);
  q.set([{ label: 'a', tone: 'info' }, null, { label: 'c' }]);
  assert.deepEqual(chips.map(visible), [true, false, true, false]);
  assert.equal(part(chips[0], 'chip-label').textContent, 'a');
  assert.equal(part(chips[2], 'chip-label').textContent, 'c');
  assert.ok(nodes(chips[0]).some((n) => classes(n).includes('nx-fill-info-fg')));
  const xs = chips.map((c) => nums(c.attrs.transform)[0]);
  assert.deepEqual(xs, [...xs].sort((p, q2) => p - q2), 'slots run left to right');
  close(xs[1] - xs[0], 60);
  q.set([]);
  assert.deepEqual(chips.map(visible), [false, false, false, false]);
});

test('token moves, relabels and recolours', () => {
  const { kit, svg } = stage();
  const t = kit.token(svg, { label: 'box', tone: 'info' });
  t.moveTo([120, 80]);
  const g = part(svg, 'token');
  closePoint(nums(g.attrs.transform), [120, 80]);
  t.setLabel('parcel');
  assert.ok(nodes(g).some((n) => n.tagName === 'text' && n.textContent === 'parcel'));
  t.setTone('ok');
  assert.ok(nodes(g).some((n) => classes(n).includes('nx-fill-ok-fg')));
  t.show(false);
  assert.equal(visible(g), false);
});

test('stopwatch.set places the hand and arc end at the value, coloured per segment', () => {
  const { kit, svg } = stage();
  const sw = kit.stopwatch(svg, {
    cx: 200, cy: 200, r: 56, max: 300,
    segments: [{ to: 200, tone: 'info', label: 'plan' }, { to: 300, tone: 'warn', label: 'spare' }],
  });
  const hand = part(svg, 'sw-hand');
  const arcs = [part(svg, 'sw-arc-0'), part(svg, 'sw-arc-1')];
  const centre = () => [Number(hand.attrs.x1), Number(hand.attrs.y1)];
  const handAngle = () => clockAngle(...centre(), Number(hand.attrs.x2), Number(hand.attrs.y2));
  const arcEnd = (arc) => {
    const n = nums(arc.attrs.d);
    return clockAngle(...centre(), n[n.length - 2], n[n.length - 1]);
  };
  // The dial sweeps 300 degrees from twelve o'clock for the full max.
  sw.set({ value: 150 });
  close(handAngle(), 150, 1e-3);
  assert.equal(visible(arcs[0]), true);
  assert.equal(visible(arcs[1]), false);
  close(arcEnd(arcs[0]), 150, 0.02);
  assert.ok(classes(arcs[0]).includes('nx-stroke-info'));
  assert.ok(classes(arcs[1]).includes('nx-stroke-warn'));
  sw.set({ value: 250 });
  close(handAngle(), 250, 1e-3);
  close(arcEnd(arcs[0]), 200, 0.02);
  assert.equal(visible(arcs[1]), true);
  close(arcEnd(arcs[1]), 250, 0.02);
  sw.set({ value: 0 });
  close(handAngle(), 0, 1e-3);
  assert.deepEqual(arcs.map(visible), [false, false]);
  const flash = part(svg, 'sw-flash');
  sw.set({ value: 300, flash: 1 });
  assert.ok(Number(flash.attrs.opacity) > 0);
  sw.set({ value: 300, flash: 0 });
  close(Number(flash.attrs.opacity), 0);
});

test('stopwatch shows its total and runs wind and press with an operator', () => {
  const { kit, svg } = stage();
  const sw = kit.stopwatch(svg, { cx: 200, cy: 200, max: 48, segments: [{ to: 48, tone: 'ok' }], operator: true, unit: 'h' });
  sw.set({ value: 48, total: 48 });
  const total = part(svg, 'sw-total');
  assert.equal(total.textContent, '48 h');
  assert.equal(visible(total), true);
  const tip = part(svg, 'sw-hand-tip');
  sw.wind(0.25);
  const winding = [tip.attrs.cx, tip.attrs.cy].map(Number);
  sw.press(1);
  const pressed = [tip.attrs.cx, tip.attrs.cy].map(Number);
  assert.ok(Math.hypot(winding[0] - pressed[0], winding[1] - pressed[1]) > 1, 'the hand moves between wind and press');
});

test('figure reaches a point with a two-segment arm and waves above its head', () => {
  for (const [scale, target] of [[1, [250, 200]], [1.4, [320, 180]]]) {
    const { kit, svg } = stage();
    const f = kit.figure(svg, { x: 300, y: 300, scale });
    const upper = part(svg, 'fig-upper-arm');
    const fore = part(svg, 'fig-forearm');
    const tip = part(svg, 'fig-hand-tip');
    // The figure's own coordinates map to the page as (x + u * scale, y + v * scale).
    const onPage = (u, v) => [300 + Number(u) * scale, 300 + Number(v) * scale];
    f.reach(target);
    closePoint(onPage(tip.attrs.cx, tip.attrs.cy), target, 1e-3);
    closePoint(onPage(fore.attrs.x2, fore.attrs.y2), target, 1e-3);
    assert.equal(upper.attrs.x2, fore.attrs.x1, 'the elbow joins both segments');
    assert.equal(upper.attrs.y2, fore.attrs.y1);
    f.wave(0.5);
    const raised = onPage(tip.attrs.cx, tip.attrs.cy);
    const head = nodes(svg).find((n) => n.tagName === 'circle' && Number(n.attrs.r) === 10);
    const headTop = onPage(head.attrs.cx, Number(head.attrs.cy) - Number(head.attrs.r));
    assert.ok(raised[1] < headTop[1], 'wave(0.5) lifts the hand above the head: ' + raised[1] + ' vs ' + headTop[1]);
    assert.ok(Math.hypot(raised[0] - target[0], raised[1] - target[1]) > 10, 'wave moves the hand away from the reach');
    assert.equal(upper.attrs.x2, fore.attrs.x1, 'the elbow still joins both segments while waving');
  }
});

test('axis maps both ends and labels ticks with the unit', () => {
  const { kit, svg } = stage();
  const ax = kit.axis(svg, { x0: 100, x1: 500, y: 50, t0: 0, t1: 400, ticks: 4, unit: 'ms' });
  close(ax.x(0), 100);
  close(ax.x(400), 500);
  close(ax.x(200), 300);
  const labels = nodes(svg).filter((n) => n.tagName === 'text').map((n) => n.textContent);
  for (const label of ['0 ms', '100 ms', '200 ms', '300 ms', '400 ms']) assert.ok(labels.includes(label), label);
});

test('meter.set fills a clamped share of its width', () => {
  const { kit, svg } = stage();
  const m = kit.meter(svg, { x: 10, y: 10, w: 200, h: 20, tone: 'ok' });
  const fill = part(svg, 'meter-fill');
  m.set(0.25);
  close(Number(fill.attrs.width), 50);
  m.set(2);
  close(Number(fill.attrs.width), 200);
  m.set(-1);
  close(Number(fill.attrs.width), 0);
  m.setTone('stop');
  assert.ok(classes(fill).includes('nx-fill-stop-fg'));
});

test('readout and stamp update their nodes', () => {
  const { kit, svg } = stage();
  const r = kit.readout(svg, { x: 10, y: 50 });
  r.set('12 h left', 'warn');
  const node = part(svg, 'readout');
  assert.equal(node.textContent, '12 h left');
  assert.ok(classes(node).includes('nx-fill-warn-fg'));
  assert.ok(Number(node.attrs['font-size']) >= 18);
  const s = kit.stamp(svg, { x: 50, y: 50, kind: 'stop' });
  s.pop(1);
  assert.match(part(svg, 'stamp').attrs.transform, /scale\(1(\.0+)?\)/);
});

test('handles only change attributes: no nodes are created after build', () => {
  const { kit, svg, stats } = stage();
  const handles = {
    box: kit.box(svg, { x: 0, y: 0, w: 100, h: 80, label: 'A', sub: 'b' }),
    arrow: kit.arrow(svg, { from: [0, 0], to: [100, 0], label: 'x', dashed: true }),
    token: kit.token(svg, { label: 't' }),
    bubble: kit.bubble(svg, { x: 0, y: 0, w: 120, text: 'hi' }),
    queue: kit.queue(svg, { x: 0, y: 200, slots: 3 }),
    readout: kit.readout(svg, { x: 0, y: 0 }),
    stopwatch: kit.stopwatch(svg, { cx: 100, cy: 100, max: 10, segments: [{ to: 10, tone: 'info', label: 'all' }], operator: true }),
    figure: kit.figure(svg, { x: 400, y: 400 }),
    meter: kit.meter(svg, { x: 0, y: 0, w: 50, h: 10 }),
    stamp: kit.stamp(svg, { x: 0, y: 0, kind: 'ok' }),
  };
  const created = stats.created;
  for (let i = 0; i <= 10; i += 1) {
    const p = i / 10;
    handles.box.setStatus('s' + i, 'ok');
    handles.box.setTone(i % 2 ? 'warn' : 'info');
    handles.arrow.draw(p);
    handles.arrow.setDashed(i % 2 === 0);
    handles.arrow.setLabel('l' + i);
    handles.token.moveTo([p * 100, 0]);
    handles.token.setLabel('t' + i);
    handles.bubble.pop(p);
    handles.bubble.setText('b' + i);
    handles.queue.set([{ label: 'q' }, null, { label: 'r', tone: 'ok' }]);
    handles.readout.set(String(i), 'ink');
    handles.stopwatch.set({ value: i, total: 10, flash: p, click: p });
    handles.stopwatch.wind(p);
    handles.stopwatch.press(p);
    handles.figure.reach([380, 300]);
    handles.figure.wave(p);
    handles.meter.set(p);
    handles.stamp.pop(p);
  }
  assert.equal(stats.created, created);
});

test('every tone class the kit emits is defined in player.css', () => {
  const css = readFileSync(fileURLToPath(new URL('../player.css', import.meta.url)), 'utf8');
  const defined = new Set([...css.matchAll(/\.(nx-[a-z0-9-]+)/g)].map((m) => m[1]));
  const { kit, svg, FakeNode } = stage();
  const emitted = new Set();
  const setAttribute = FakeNode.prototype.setAttribute;
  FakeNode.prototype.setAttribute = function (name, value) {
    if (name === 'class') String(value).split(/\s+/).filter(Boolean).forEach((c) => emitted.add(c));
    return setAttribute.call(this, name, value);
  };
  const tones = ['ink', 'ink-2', 'info', 'ok', 'warn', 'stop', 'sunken'];
  const fills = [...tones, 'info-fg', 'ok-fg', 'warn-fg', 'stop-fg', 'info-bg', 'ok-bg', 'warn-bg', 'stop-bg'];
  for (const on of fills) kit.text(svg, 0, 0, 'on', { on, halo: true });
  kit.box(svg, { x: 0, y: 0, w: 100, h: 80, label: 'A', sub: 'b' });
  kit.bubble(svg, { x: 0, y: 0, w: 120, text: 'hi' });
  kit.axis(svg, { x0: 0, x1: 100, y: 0, t0: 0, t1: 10, unit: 's' });
  kit.readout(svg, { x: 0, y: 0 }).set('r');
  kit.queue(svg, { x: 0, y: 0, slots: 2, title: 'q' }).set([{ label: 'q' }, null]);
  for (const kind of ['ok', 'stop']) kit.stamp(svg, { x: 0, y: 0, kind }).pop(0.5);
  for (const tone of tones) {
    kit.text(svg, 0, 0, tone, { tone });
    const b = kit.box(svg, { x: 0, y: 0, w: 100, h: 80, label: 'A', sub: 'b', tone });
    b.setTone(tone);
    b.setStatus('s', tone);
    for (const dashed of [false, true]) {
      const a = kit.arrow(svg, { from: [0, 0], to: [100, 0], label: 'x', tone, dashed });
      a.setTone(tone);
      a.draw(0.5);
    }
    kit.token(svg, { label: 't', tone }).setTone(tone);
    kit.queue(svg, { x: 0, y: 0, slots: 2 }).set([{ label: 'q', tone }, null]);
    kit.readout(svg, { x: 0, y: 0 }).set('r', tone);
    const sw = kit.stopwatch(svg, { cx: 100, cy: 100, max: 10, segments: [{ to: 5, tone, label: 'a' }, { to: 10 }], operator: true });
    sw.set({ value: 8, total: 10, flash: 1, click: 0.5, rim: tone });
    sw.wind(0.5);
    sw.press(0.5);
    const f = kit.figure(svg, { x: 400, y: 400, tone });
    f.reach([380, 300]);
    f.wave(0.5);
    const m = kit.meter(svg, { x: 0, y: 0, w: 50, h: 10, tone });
    m.setTone(tone);
    m.set(0.5);
  }
  FakeNode.prototype.setAttribute = setAttribute;
  const toneClasses = [...emitted].filter((c) => /^nx-(fill|stroke)-|^nx-halo$/.test(c));
  assert.ok(toneClasses.length > 10, 'the kit emitted tone classes: ' + toneClasses.join(' '));
  const missing = toneClasses.filter((c) => !defined.has(c)).sort();
  assert.deepEqual(missing, [], 'classes missing from player.css: ' + missing.join(' '));
});

test('kit has no clock, timers or literal colours', () => {
  assert.doesNotMatch(KIT_SRC, /setTimeout|setInterval|requestAnimationFrame|Date\.now|performance\.now|new Date/);
  assert.doesNotMatch(KIT_SRC, /#[0-9a-fA-F]{3,8}\b|rgb\(/);
  assert.doesNotMatch(KIT_SRC, /\beval\(|new Function|fetch\(|XMLHttpRequest/);
});

// ---- Pieces taken from the Part 2 explainer: motion helpers, face, character, ring, lanes, card, confetti, spark ----

const lastNum = (str, at) => nums(str)[at];
const transformOf = (node) => String(node.attrs.transform || '');

test('wobble, arc and squash are pure and shaped as documented', () => {
  const { kit } = loadKit(false);
  for (const name of ['wobble', 'arc', 'squash']) assert.equal(typeof kit[name], 'function', name + ' is exported');
  close(kit.wobble(0, 6), 0);
  close(kit.wobble(1, 6), 0);
  close(kit.wobble(0.5, 6), -3);
  close(kit.wobble(0.3, 8), 2 * kit.wobble(0.3, 4));
  closePoint(kit.arc([0, 0], [100, 0], 0, 70), [0, 0]);
  closePoint(kit.arc([0, 0], [100, 0], 1, 70), [100, 0]);
  closePoint(kit.arc([0, 0], [100, 40], 0.5, 70), [50, 20 - 70]);
  closePoint(kit.arc([10, 10], [30, 50], 0.25, 0), [15, 20]);
  close(kit.squash(0), 1);
  close(kit.squash(0.8), 1);
  close(kit.squash(0.9), 0.78);
  close(kit.squash(1), 1);
  close(kit.squash(0.75, 0.5, 0.5), 0.5);
  assert.ok(kit.squash(0.95) < 1 && kit.squash(0.85) < 1, 'it dips between 0.8 and 1');
});

test('face shows the eyes, brows and mouth that match each mood', () => {
  const { kit, svg } = stage();
  assert.equal(typeof kit.face, 'function');
  const f = kit.face(svg, { x: 10, y: 20, scale: 0.8 });
  assert.equal(f.g.attrs.transform, 'translate(10 20) scale(0.8)');
  const eyes = part(svg, 'face-eyes');
  const cross = part(svg, 'face-cross');
  const glad = part(svg, 'face-glad');
  const brows = part(svg, 'face-brows');
  const mouth = part(svg, 'face-mouth');
  const shown = () => [eyes, cross, glad, brows].map(visible);
  const looks = {
    calm: [true, false, false, false],
    busy: [true, false, false, false],
    worried: [true, false, false, true],
    stopped: [false, true, false, false],
    happy: [false, false, true, false],
  };
  const paths = new Set();
  for (const [mood, expected] of Object.entries(looks)) {
    f.set(mood);
    assert.deepEqual(shown(), expected, mood + ': eyes, cross, glad, brows');
    paths.add(mouth.attrs.d);
    const filled = mood === 'busy' || mood === 'happy';
    assert.equal(classes(mouth).includes('nx-fill-ink-fg'), filled, mood + ': an open mouth is filled');
    assert.ok(classes(mouth).includes('nx-stroke-ink'));
  }
  assert.equal(paths.size, 5, 'each mood has its own mouth');
});

test('character stands at a place, takes a tone, mood and lights, and moves', () => {
  assert.equal(typeof loadKit().kit.character, 'function');
  const { kit, svg } = stage();
  const server = kit.character(svg, { kind: 'server', x: 300, y: 200 });
  assert.equal(server.g.attrs.transform, 'translate(300 200)');
  server.set({ tone: 'warn', mood: 'busy', lights: true });
  assert.ok(classes(part(server.g, 'character-body')).includes('nx-fill-warn-bg'));
  assert.ok(classes(part(server.g, 'character-body')).includes('nx-stroke-warn'));
  assert.ok(classes(part(server.g, 'character-led-0')).includes('nx-fill-warn-fg'));
  assert.ok(classes(part(server.g, 'character-led-1')).includes('nx-fill-ink-2-fg'));
  assert.equal(visible(part(server.g, 'face-brows')), false);
  server.set({ tone: 'stop', mood: 'worried', lights: false });
  assert.ok(classes(part(server.g, 'character-led-0')).includes('nx-fill-ink-2-fg'));
  assert.ok(classes(part(server.g, 'character-led-1')).includes('nx-fill-stop-fg'));
  assert.equal(visible(part(server.g, 'face-brows')), true, 'the face follows the mood');
  server.move({ hop: 10, shake: 5, slide: 5 });
  assert.equal(server.g.attrs.transform, 'translate(305 190) scale(1) rotate(5)');
  server.move({});
  assert.equal(server.g.attrs.transform, 'translate(300 200) scale(1)');

  const screen = kit.character(svg, { kind: 'screen', x: 110, y: 386 });
  assert.equal(screen.g.attrs.transform, 'translate(110 386)');
  screen.set({ tone: 'info', mood: 'calm' });
  assert.ok(classes(part(screen.g, 'character-body')).includes('nx-fill-info-bg'));
  assert.ok(classes(part(screen.g, 'character-bulb')).includes('nx-fill-info-fg'));
  assert.equal(visible(part(screen.g, 'character-sweat')), false);
  screen.set({ tone: 'warn', mood: 'worried' });
  assert.equal(visible(part(screen.g, 'character-sweat')), true, 'a worried screen sweats');
  assert.ok(classes(part(screen.g, 'character-bulb')).includes('nx-fill-warn-fg'));
  screen.move({ hop: 14, shake: 6 });
  assert.equal(screen.g.attrs.transform, 'translate(110 372) scale(1) rotate(6)');
});

test('ring sets its arc and label, holds with a badge, releases with a pulse, and shakes', () => {
  assert.equal(typeof loadKit().kit.ring, 'function');
  const { kit, svg } = stage();
  const r = kit.ring(svg, { x: 100, y: 100, r: 30, badge: [24, -24], flash: [40, 100] });
  const sweep = part(r.g, 'ring-sweep');
  const label = part(r.g, 'ring-label');
  const circ = 2 * Math.PI * 30;
  r.set({ frac: 0.5, tone: 'info', label: '90' });
  assert.deepEqual(nums(sweep.attrs['stroke-dasharray']), [Math.round(circ * 0.5e4) / 1e4, Math.round(circ * 1e4) / 1e4]);
  assert.ok(classes(sweep).includes('nx-stroke-info'));
  assert.equal(label.textContent, '90');
  assert.ok(classes(label).includes('nx-fill-ink-fg'));
  r.set({ frac: 2, tone: 'ink-2', label: '0' });
  close(lastNum(sweep.attrs['stroke-dasharray'], 0), circ, 1e-3);
  assert.ok(classes(label).includes('nx-fill-ink-2-fg'));
  r.set({ frac: -1, tone: 'stop', label: '0' });
  close(lastNum(sweep.attrs['stroke-dasharray'], 0), 0);

  const badge = part(r.g, 'hold-badge');
  const flash = part(r.g, 'ring-flash');
  assert.equal(visible(badge), false, 'the badge starts hidden');
  r.hold(true, 1);
  assert.equal(visible(badge), true);
  assert.equal(badge.attrs.transform, 'translate(124 76) scale(1)');
  r.hold(true, 0);
  assert.match(badge.attrs.transform, /scale\(0\.01\)/, 'it pops in from almost nothing');
  r.hold(false, 1);
  assert.equal(visible(badge), false);
  r.hold(false, 1);
  r.release(0.5);
  assert.equal(visible(badge), true, 'the badge rides up while it is released');
  assert.equal(visible(flash), true);
  const lifted = nums(badge.attrs.transform);
  assert.ok(lifted[1] < 76, 'the badge has risen: ' + badge.attrs.transform);
  assert.ok(lifted[2] < 1 && lifted[2] > 0.5, 'and shrunk');
  close(Number(badge.attrs.opacity), 0.5);
  close(Number(flash.attrs.r), 10 + 34 * kit.ease.out(0.5), 1e-3);
  close(Number(flash.attrs.opacity), 0.5);
  assert.deepEqual([flash.attrs.cx, flash.attrs.cy], ['40', '100'], 'the pulse runs where the caller says');
  r.hold(false, 1);
  r.release(1);
  assert.equal(visible(flash), false);
  assert.equal(visible(badge), false, 'a finished release leaves the badge to hold()');

  r.shake(0.5);
  assert.match(r.g.attrs.transform, /rotate\(-3\.5\)/);
  r.shake(1, 4);
  assert.match(r.g.attrs.transform, /rotate\(0\)/);
});

test('lanes maps time to x, with bars that hide their label when it does not fit', () => {
  assert.equal(typeof loadKit().kit.lanes, 'function');
  const { kit, svg } = stage();
  const tl = kit.lanes(svg, {
    x0: 230, x1: 1150, t0: 0, t1: 400, y: 184, top: 50, ticks: 4, unit: 'ms',
    panel: { x: 10, y: 10, w: 1180, h: 216 }, rows: [{ y: 62, label: 'TRC waits' }, { y: 136, label: '' }],
  });
  close(tl.x(0), 230);
  close(tl.x(400), 1150);
  close(tl.x(200), 690);
  const labels = nodes(svg).filter((n) => n.tagName === 'text').map((n) => n.textContent);
  for (const wanted of ['0 ms', '400 ms', 'TRC waits']) assert.ok(labels.includes(wanted), wanted);
  tl.setLabel(1, 'BidSwitch');
  assert.equal(parts(svg, 'lane-label')[1].textContent, 'BidSwitch');

  const bar = tl.bar(0);
  const [rect, text] = [part(svg, 'lane-bar'), part(svg, 'lane-bar-label')];
  bar.set(0, 100, 'waiting', 'info-bg');
  assert.deepEqual([rect.attrs.x, rect.attrs.y, rect.attrs.width, rect.attrs.height], ['230', '62', '230', '32']);
  assert.ok(['nx-fill-info-bg', 'nx-stroke-info'].every((c) => classes(rect).includes(c)));
  assert.ok(classes(text).includes('nx-fill-info-fg'), 'soft fill: the accent colour reads on it');
  assert.equal(text.textContent, 'waiting');
  close(Number(text.attrs.x), 345);
  assert.equal(visible(rect) && visible(text), true);
  bar.set(0, 20, 'waiting for the answer', 'info-bg');
  assert.equal(visible(rect), true, 'a narrow bar is still drawn');
  assert.equal(visible(text), false, 'but its label does not fit');
  bar.set(0, 0, 'none', 'info-bg');
  assert.equal(visible(rect), false, 'an empty bar is hidden');
  bar.set(100, 200, '80 ms timer', 'info-fg');
  assert.ok(classes(rect).includes('nx-fill-info-fg'));
  assert.ok(classes(text).includes('nx-fill-page'), 'strong fill: the page colour reads on it');
  bar.set(100, 200, 'was 180', 'outline');
  assert.ok(classes(rect).includes('nx-stroke-edge'));
  assert.ok(!classes(rect).some((c) => c.startsWith('nx-fill-')), 'an outline has no fill class');
  assert.ok(classes(text).includes('nx-fill-ink-2-fg'));
  bar.hide();
  assert.deepEqual([visible(rect), visible(text)], [false, false]);
  bar.set(100, 200, 'back', 'ok-bg');
  assert.deepEqual([visible(rect), visible(text)], [true, true]);
  tl.bar(1, { dashed: true });
  assert.equal(parts(svg, 'lane-bar')[1].attrs['stroke-dasharray'], '6 5');
});

test('lanes draws a budget, a deadline, marks and a playhead at times on the axis', () => {
  const { kit, svg } = stage();
  assert.equal(typeof kit.lanes, 'function');
  const tl = kit.lanes(svg, { x0: 230, x1: 1150, t0: 0, t1: 400, y: 184, top: 50, rows: [{ y: 62 }, { y: 136 }] });
  const budget = tl.budget(0);
  const ghost = part(svg, 'lane-budget');
  budget.set(0, 300);
  assert.deepEqual([ghost.attrs.x, ghost.attrs.width, ghost.attrs.y], ['230', '690', '62']);
  assert.equal(ghost.attrs['stroke-dasharray'], '6 5');
  budget.show(false);
  assert.equal(visible(ghost), false);

  const deadline = tl.deadline();
  const [line, note] = [part(svg, 'lane-deadline'), part(svg, 'lane-deadline-label')];
  deadline.set(300, 'TRC waits 300 ms', 'ink-2', false);
  assert.deepEqual([line.attrs.x1, line.attrs.x2, line.attrs.y1, line.attrs.y2], ['920', '920', '50', '184']);
  assert.equal(line.attrs['stroke-dasharray'], '7 6');
  assert.ok(classes(line).includes('nx-stroke-ink-2'));
  assert.equal(note.textContent, 'TRC waits 300 ms');
  assert.equal(note.attrs['text-anchor'], 'middle');
  assert.ok(classes(note).includes('nx-fill-ink-2-fg') && classes(note).includes('nx-halo'));
  deadline.set(303, 'stopped', 'stop', true);
  assert.equal(line.attrs['stroke-dasharray'], '1 0');
  assert.ok(classes(line).includes('nx-stroke-stop'));
  deadline.show(false);
  assert.deepEqual([visible(line), visible(note)], [false, false]);

  const start = tl.mark({ y1: 100, y2: 128, labelY: 120, side: 'left', gap: 10 });
  const end = tl.mark({ y1: 100, y2: 128, labelY: 120, side: 'right', gap: 14, width: 5 });
  const dot = tl.mark({ shape: 'dot', y: 113, labelY: 120, side: 'left', gap: 16 });
  const [marks, notes] = [parts(svg, 'lane-mark'), parts(svg, 'lane-mark-label')];
  start.set(145, 'timer starts · 145', 'ok');
  assert.deepEqual([marks[0].attrs.x1, marks[0].attrs.x2], ['563.5', '563.5']);
  assert.ok(classes(marks[0]).includes('nx-stroke-ok'));
  assert.equal(marks[0].attrs['stroke-width'], '4');
  assert.equal(notes[0].attrs['text-anchor'], 'end');
  close(Number(notes[0].attrs.x), 553.5);
  assert.equal(notes[0].textContent, 'timer starts · 145');
  end.set(200, 'cut off', 'stop');
  assert.equal(marks[1].attrs['stroke-width'], '5');
  assert.equal(notes[1].attrs['text-anchor'], 'start');
  close(Number(notes[1].attrs.x), 690 + 14);
  dot.set(60, "A's bid · 60", 'info');
  assert.equal(marks[2].tagName, 'circle');
  close(Number(marks[2].attrs.cx), 368);
  assert.ok(classes(marks[2]).includes('nx-fill-info-fg') && classes(marks[2]).includes('nx-stroke-page'));
  close(Number(notes[2].attrs.x), 368 - 16);
  start.show(false);
  assert.deepEqual([visible(marks[0]), visible(notes[0])], [false, false]);

  const head = tl.playhead();
  const headLine = part(svg, 'playhead');
  head.set(100);
  assert.deepEqual([headLine.attrs.x1, headLine.attrs.x2], ['460', '460']);
  head.set(200);
  assert.ok(Number(headLine.attrs.x1) > 460, 'the playhead moves right with time');
  head.show(false);
  assert.equal(visible(headLine), false);
});

test('card holds a title, lines, a tag and a tone, and fades as one', () => {
  assert.equal(typeof loadKit().kit.card, 'function');
  const { kit, svg } = stage();
  const c = kit.card(svg, {
    x: 810, y: 250, w: 370, h: 176, tone: 'info',
    lines: [{ y: 312 }, { y: 338 }, { y: 384, weight: 700 }],
    tag: { text: 'proposal', w: 114 },
  });
  const box = part(c.g, 'card-box');
  assert.deepEqual([box.attrs.x, box.attrs.y, box.attrs.width, box.attrs.height], ['810', '250', '370', '176']);
  assert.ok(['nx-fill-page', 'nx-stroke-info'].every((k) => classes(box).includes(k)));
  c.setTitle("Alex's rule");
  const title = part(c.g, 'card-title');
  assert.equal(title.textContent, "Alex's rule");
  assert.deepEqual([title.attrs.x, title.attrs.y, title.attrs['font-size'], title.attrs['font-weight']], ['830', '282', '22', '800']);
  assert.ok(classes(title).includes('nx-fill-info-fg'));
  c.setLines(['one', 'two', { text: 'three', tone: 'ok' }]);
  const lines = parts(c.g, 'card-line');
  assert.deepEqual(lines.map((n) => n.textContent), ['one', 'two', 'three']);
  assert.deepEqual(lines.map((n) => n.attrs.y), ['312', '338', '384']);
  assert.equal(lines[2].attrs['font-weight'], '700');
  assert.ok(classes(lines[2]).includes('nx-fill-ok-fg'));
  c.setLines(['only']);
  assert.deepEqual(lines.map((n) => n.textContent), ['only', '', ''], 'lines left out are emptied');
  c.setTone('stop');
  assert.ok(classes(box).includes('nx-stroke-stop') && !classes(box).includes('nx-stroke-info'));
  assert.ok(classes(title).includes('nx-fill-stop-fg'));
  c.setDashed(true);
  assert.equal(box.attrs['stroke-dasharray'], '12 7');
  c.setDashed(false);
  assert.equal(box.attrs['stroke-dasharray'], 'none');
  const tag = part(c.g, 'card-tag');
  c.tag(true);
  assert.equal(visible(tag), true);
  c.tag(false);
  assert.equal(visible(tag), false);
  const tagBox = nodes(tag).find((n) => n.tagName === 'rect');
  assert.deepEqual([tagBox.attrs.x, tagBox.attrs.width], ['1046', '114'], 'the tag sits at the right edge of the card');
  assert.ok(nodes(tag).some((n) => n.tagName === 'text' && n.textContent === 'proposal'));
  c.fade(0.5);
  assert.equal(c.g.attrs.opacity, '0.5');
  c.show(false);
  assert.equal(visible(c.g), false);
});

test('confetti scatters from a point as progress runs, and is hidden when done', () => {
  assert.equal(typeof loadKit().kit.confetti, 'function');
  const { kit, svg } = stage();
  const c = kit.confetti(svg, { at: [110, 316], count: 16 });
  const bits = parts(c.g, 'confetti-bit');
  assert.equal(bits.length, 16);
  c.burst(0);
  assert.deepEqual(bits.map(visible), Array(16).fill(true));
  assert.equal(bits[0].attrs.transform, 'translate(110 316) scale(1)');
  assert.match(bits[1].attrs.transform, /^translate\(110 316\) scale\(1\) rotate\(47\)$/);
  c.burst(0.5);
  const moved = bits.map((b) => nums(b.attrs.transform));
  assert.ok(moved.every(([x, y]) => Math.hypot(x - 110, y - 316 - 120 * 0.25) > 20), 'every bit has left the origin');
  assert.ok(new Set(moved.map(([x]) => x)).size > 8, 'they fan out');
  const first = bits.map((b) => b.attrs.transform);
  c.burst(0.2);
  c.burst(0.5);
  assert.deepEqual(bits.map((b) => b.attrs.transform), first, 'the same progress draws the same frame');
  const toneOf = (b) => classes(b).find((k) => k.startsWith('nx-fill-'));
  assert.deepEqual(bits.slice(0, 5).map(toneOf), ['nx-fill-ok-fg', 'nx-fill-info-fg', 'nx-fill-warn-fg', 'nx-fill-stop-fg', 'nx-fill-ok-fg']);
  c.burst(1);
  assert.deepEqual(bits.map(visible), Array(16).fill(false));
});

test('spark flashes at a point, growing with progress, and hides when done', () => {
  assert.equal(typeof loadKit().kit.spark, 'function');
  const { kit, svg } = stage();
  const s = kit.spark(svg, { x: 50, y: 60 });
  assert.equal(nodes(s.g).filter((n) => n.tagName === 'line').length, 8);
  s.burst(0);
  assert.equal(visible(s.g), true);
  assert.equal(s.g.attrs.transform, 'translate(50 60) scale(0.8)');
  s.burst(0.5);
  assert.equal(s.g.attrs.transform, 'translate(50 60) scale(1)');
  s.burst(0.75, [70, 80]);
  assert.equal(s.g.attrs.transform, 'translate(70 80) scale(1.1)');
  s.burst(1);
  assert.equal(visible(s.g), false);
});

test('the new pieces only change attributes after build, and emit tone classes player.css defines', () => {
  const { kit, svg, stats, FakeNode } = stage();
  for (const name of ['face', 'character', 'ring', 'lanes', 'card', 'confetti', 'spark']) assert.equal(typeof kit[name], 'function', name);
  const css = readFileSync(fileURLToPath(new URL('../player.css', import.meta.url)), 'utf8');
  const defined = new Set([...css.matchAll(/\.(nx-[a-z0-9-]+)/g)].map((m) => m[1]));
  const emitted = new Set();
  const setAttribute = FakeNode.prototype.setAttribute;
  FakeNode.prototype.setAttribute = function (name, value) {
    if (name === 'class') String(value).split(/\s+/).filter(Boolean).forEach((c) => emitted.add(c));
    return setAttribute.call(this, name, value);
  };
  const tl = kit.lanes(svg, { x0: 0, x1: 400, t0: 0, t1: 400, y: 100, top: 10, rows: [{ y: 20, label: 'a' }] });
  const handles = {
    face: kit.face(svg, { x: 0, y: 0, scale: 1 }),
    server: kit.character(svg, { kind: 'server', x: 50, y: 50 }),
    screen: kit.character(svg, { kind: 'screen', x: 150, y: 50 }),
    ring: kit.ring(svg, { x: 100, y: 100, r: 30 }),
    bar: tl.bar(0),
    budget: tl.budget(0),
    deadline: tl.deadline(),
    mark: tl.mark({ y1: 0, y2: 10, labelY: 5, side: 'left', gap: 10 }),
    dot: tl.mark({ shape: 'dot', y: 5, labelY: 5, side: 'right', gap: 10 }),
    head: tl.playhead(),
    card: kit.card(svg, { x: 0, y: 0, w: 100, h: 100, lines: [{ y: 30 }], tag: { text: 'tag' } }),
    confetti: kit.confetti(svg, { at: [0, 0] }),
    spark: kit.spark(svg, { x: 0, y: 0 }),
  };
  const created = stats.created;
  const tones = ['ink', 'ink-2', 'info', 'ok', 'warn', 'stop', 'sunken'];
  for (const tone of tones) {
    for (const mood of ['calm', 'busy', 'worried', 'stopped', 'happy']) {
      handles.face.set(mood);
      handles.server.set({ tone, mood, lights: mood === 'busy' });
      if (tone !== 'sunken' && tone !== 'ink' && tone !== 'ink-2') handles.screen.set({ tone, mood });
    }
    handles.ring.set({ frac: 0.4, tone, label: '7' });
    handles.bar.set(10, 200, 'a label that fits', tone === 'sunken' || tone === 'ink' || tone === 'ink-2' ? 'outline' : tone + '-bg');
    handles.bar.set(10, 200, 'strong', tone === 'sunken' || tone === 'ink' || tone === 'ink-2' ? 'info-fg' : tone + '-fg');
    handles.deadline.set(100, 'd', tone, false);
    handles.mark.set(50, 'm', tone);
    if (tone !== 'sunken' && tone !== 'ink' && tone !== 'ink-2') handles.dot.set(60, 'm', tone);
    handles.card.setTone(tone);
    handles.card.setTitle('t');
    handles.card.setLines(['x', { text: 'y', tone }]);
  }
  for (let i = 0; i <= 10; i += 1) {
    const p = i / 10;
    handles.ring.hold(i % 2 === 0, p);
    handles.ring.release(p);
    handles.ring.shake(p);
    handles.budget.set(0, 100 * p);
    handles.head.set(p * 400);
    handles.card.fade(p);
    handles.card.tag(i % 2 === 0);
    handles.card.setDashed(i % 2 === 0);
    handles.confetti.burst(p);
    handles.spark.burst(p, [p * 10, 5]);
    handles.server.move({ hop: p, shake: p, slide: p });
    handles.screen.move({ hop: p, shake: p });
  }
  FakeNode.prototype.setAttribute = setAttribute;
  assert.equal(stats.created, created, 'draw created nodes');
  const toneClasses = [...emitted].filter((c) => /^nx-(fill|stroke)-|^nx-halo$/.test(c));
  assert.ok(toneClasses.length > 10, 'the pieces emitted tone classes: ' + toneClasses.join(' '));
  const missing = toneClasses.filter((c) => !defined.has(c)).sort();
  assert.deepEqual(missing, [], 'classes missing from player.css: ' + missing.join(' '));
});
