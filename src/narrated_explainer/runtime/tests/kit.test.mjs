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
