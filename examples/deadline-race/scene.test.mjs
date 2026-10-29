// Tests for the deadline-race demo scene: the pure model stateAt(mode, t) and the drawing rules
// (build once, draw only changes attributes, no broken attribute values, only the allowed texts,
// text at least 18 units, the playhead hidden at rest). Loaded like the build tool loads it:
// kit.js and scene.js through vm.runInContext, with a small fake DOM standing in for the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const KIT_SRC = readFileSync(here('../../src/narrated_explainer/runtime/kit.js'), 'utf8');
const SCENE_SRC = readFileSync(here('./scene.js'), 'utf8');
const STORY = JSON.parse(readFileSync(here('./story.json'), 'utf8'));
const MODES = ['before', 'after'];
const BROKEN = /NaN|undefined|Infinity/;

function makeDoc() {
  const stats = { created: 0, writes: 0, broken: [] };
  class FakeNode {
    constructor(tag) {
      this.tagName = tag;
      this.attrs = {};
      this.children = [];
      this.text = '';
    }
    setAttribute(name, value) {
      stats.writes += 1;
      if (BROKEN.test(String(value))) stats.broken.push(this.tagName + ' ' + name + '=' + value);
      this.attrs[name] = String(value);
    }
    getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }
    appendChild(child) { this.children.push(child); return child; }
    get textContent() { return this.text + this.children.map((c) => c.textContent).join(''); }
    set textContent(value) {
      stats.writes += 1;
      if (BROKEN.test(String(value))) stats.broken.push(this.tagName + ' text=' + value);
      this.children = [];
      this.text = String(value);
    }
  }
  return { doc: { createElementNS(ns, tag) { stats.created += 1; return new FakeNode(tag); } }, stats };
}

function loadScene() {
  const { doc, stats } = makeDoc();
  const context = vm.createContext({ document: doc });
  vm.runInContext(KIT_SRC, context, { filename: 'kit.js' });
  let factory = null;
  context.NarratedExplainer.scene = (f) => { factory = f; };
  vm.runInContext(SCENE_SRC, context, { filename: 'scene.js' });
  assert.equal(typeof factory, 'function', 'scene.js registers a factory');
  const scene = factory(STORY, context.NarratedExplainer.kit);
  return { scene, doc, stats, context };
}

const { scene: MODEL } = loadScene();
const at = (mode, t) => MODEL.stateAt(mode, t);
const nodes = (root) => [root, ...root.children.flatMap(nodes)];

// ---- The model ----

test('countdown runs from 300 to 0 and rounds up', () => {
  for (const mode of MODES) {
    assert.equal(at(mode, 0).countdown, 300);
    assert.equal(at(mode, 200).countdown, 100);
    assert.equal(at(mode, 299.5).countdown, 1);
    assert.equal(at(mode, 300).countdown, 0);
  }
});

test('each service gets 200 ms before and 80 ms after', () => {
  assert.equal(at('before', 250).serviceBudget, 200);
  assert.equal(at('after', 250).serviceBudget, 80);
});

test('the requests ahead leave the queue at 50, 100 and 150', () => {
  for (const mode of MODES) {
    assert.deepEqual([0, 49, 50, 150, 199].map((t) => at(mode, t).ahead), [3, 3, 2, 0, 0]);
    assert.equal(at(mode, 0).queueFill, 0);
    assert.equal(at(mode, 100).queueFill, 0.5);
    assert.equal(at(mode, 200).queueFill, 1);
  }
});

test('our request waits in the queue until 200, then is worked on', () => {
  for (const mode of MODES) {
    assert.equal(at(mode, 199).requestAt, 'queue');
    assert.equal(at(mode, 200).requestAt, 'work');
  }
});

test('A is asked at 200 and answers at 220; its reply is lost before and used after', () => {
  for (const mode of MODES) {
    assert.equal(at(mode, 199).aStatus, 'idle');
    assert.equal(at(mode, 219).aStatus, 'asked');
    assert.equal(at(mode, 220).aStatus, 'waiting');
  }
  assert.equal(at('before', 299).aStatus, 'waiting');
  assert.equal(at('before', 300).aStatus, 'lost');
  assert.equal(at('after', 295).aStatus, 'waiting');
  assert.equal(at('after', 296).aStatus, 'used');
});

test('B times out at 280 after, and never before', () => {
  assert.equal(at('after', 199).bStatus, 'idle');
  assert.equal(at('after', 279).bStatus, 'waiting');
  assert.equal(at('after', 279).bLine, 'open');
  assert.equal(at('after', 280).bStatus, 'timed-out');
  assert.equal(at('after', 280).bLine, 'timed-out');
  assert.equal(at('before', 320).bStatus, 'waiting');
  assert.equal(at('before', 320).bLine, 'open');
});

test('the call is cancelled at 300 before, and stays open after', () => {
  assert.equal(at('before', 299).callStatus, 'open');
  assert.equal(at('before', 300).callStatus, 'cancelled');
  assert.equal(at('after', 320).callStatus, 'open');
});

test('the App stops at 300 before and receives the answer at 296 after', () => {
  assert.equal(at('before', 299).appStatus, 'waiting');
  assert.equal(at('before', 300).appStatus, 'stopped');
  assert.equal(at('after', 295).appStatus, 'waiting');
  assert.equal(at('after', 296).appStatus, 'received');
  assert.equal(at('after', 320).appStatus, 'received');
});

test('the answer is built 280..290, carried 290..296 and reaches the App at 296', () => {
  assert.equal(at('after', 280).answerBuild, 0);
  assert.equal(at('after', 285).answerBuild, 0.5);
  assert.equal(at('after', 290).answerBuild, 1);
  assert.deepEqual([289, 290, 295, 296].map((t) => at('after', t).answerAt), ['none', 'call', 'call', 'app']);
  for (const t of [289, 290, 296, 320]) {
    assert.equal(at('before', t).answerAt, 'none');
    assert.equal(at('before', t).answerBuild, 0);
  }
});

test('the readout shows the time left, or the time to spare once answered', () => {
  for (const mode of MODES) {
    assert.equal(at(mode, 0).readout, 'Time left: 300 ms');
    assert.equal(at(mode, 295).readout, 'Time left: 5 ms');
  }
  assert.equal(at('before', 320).readout, 'Time left: 0 ms');
  assert.equal(at('after', 320).readout, 'Answered with 4 ms to spare');
});

const none = { bubble: null, timing: null, tone: null };
const ask = (n) => 'You have ' + n + ' ms to answer. Hurry!';
const answered = { bubble: null, timing: 'Answered in 20 ms ✓', tone: 'ok' };
const waitingB = (n, ms) => ({ bubble: ask(n), timing: 'Waiting… ' + ms + ' ms', tone: 'ink' });

test('line labels before', () => {
  const L = (t) => JSON.parse(JSON.stringify(at('before', t).lineLabels));
  assert.deepEqual(L(199), { a: none, b: none });
  assert.deepEqual(L(200), { a: { bubble: ask(200), timing: null, tone: null }, b: waitingB(200, 0) });
  assert.deepEqual(L(219), { a: { bubble: ask(200), timing: null, tone: null }, b: waitingB(200, 19) });
  assert.deepEqual(L(220), { a: answered, b: waitingB(200, 20) });
  assert.deepEqual(L(250), { a: answered, b: waitingB(200, 50) });
  assert.deepEqual(L(279), { a: answered, b: waitingB(200, 79) });
  assert.deepEqual(L(280), { a: answered, b: waitingB(200, 80) });
  assert.deepEqual(L(300), { a: answered, b: { bubble: null, timing: 'No answer after 100 ms. Call cancelled.', tone: 'stop' } });
});

test('line labels after', () => {
  const L = (t) => JSON.parse(JSON.stringify(at('after', t).lineLabels));
  const timedOut = { bubble: null, timing: 'No answer in 80 ms: timed out', tone: 'ink-2' };
  assert.deepEqual(L(199), { a: none, b: none });
  assert.deepEqual(L(200), { a: { bubble: ask(80), timing: null, tone: null }, b: waitingB(80, 0) });
  assert.deepEqual(L(219), { a: { bubble: ask(80), timing: null, tone: null }, b: waitingB(80, 19) });
  assert.deepEqual(L(220), { a: answered, b: waitingB(80, 20) });
  assert.deepEqual(L(250), { a: answered, b: waitingB(80, 50) });
  assert.deepEqual(L(279), { a: answered, b: waitingB(80, 79) });
  assert.deepEqual(L(280), { a: answered, b: timedOut });
  assert.deepEqual(L(300), { a: answered, b: timedOut });
});

const sampleTimes = () => {
  const ts = new Set([0, STORY.timing.end, STORY.atRest.t]);
  for (const m of STORY.moments) [m.t, m.t + 0.5, m.t + 3.7].forEach((t) => ts.add(Math.min(t, STORY.timing.end)));
  for (let t = 0; t <= STORY.timing.end; t += STORY.timing.end / 64) ts.add(t);
  return [...ts].sort((a, b) => a - b);
};

test('stateAt is pure: same output twice, no DOM, no clock, no randomness', () => {
  const { scene, stats, context } = loadScene();
  vm.runInContext('Math.random = () => { throw new Error("random in stateAt"); };'
    + 'Date.now = () => { throw new Error("clock in stateAt"); };'
    + 'performance = { now() { throw new Error("clock in stateAt"); } };', context);
  const before = { ...stats, broken: stats.broken.length };
  const run = () => MODES.flatMap((mode) => sampleTimes().map((t) => JSON.stringify(scene.stateAt(mode, t))));
  const first = run();
  assert.deepEqual(run(), first);
  assert.deepEqual({ ...stats, broken: stats.broken.length }, before, 'stateAt touched the DOM');
  assert.ok(new Set(first).size > 20, 'state changes over time');
});

// ---- The drawing ----

const ALLOWED = new Set([
  // System view
  'App', 'Gateway', 'Queue', 'Working on it', 'Service A', 'Service B', 'call', 'Fan-out', 'request',
  'reply', "A's reply + B timed out", 'waiting', '✕ gave up', "✓ got A's reply", '✕ cancelled at 300 ms',
  'timed out', 'Grey: other requests ahead in line', 'Our request',
  'In this example both services get the same timeout.', 'Answered with 4 ms to spare',
  // Stopwatch
  'budget 200 ms', 'buffer +100 ms',
  // Bubbles and line labels
  'You have 200 ms to answer. Hurry!', 'You have 80 ms to answer. Hurry!', 'Answered in 20 ms ✓',
  'No answer after 100 ms. Call cancelled.', 'No answer in 80 ms: timed out',
  // Timeline
  'waits until 300 ms', 'answers after 20 ms', 'never answers', 'Deadline · 300 ms',
  'Waiting in queue (Gateway busy)', 'Fan-out · 100 ms left', "A's reply", "A's reply waits for B",
  "A's reply lost", "B's timeout: full 200 ms, would end at 400 ms", "B's timeout: 80 ms", '20 ms reserve',
  "One answer: A's reply + B timed out", '✕ stopped waiting, no answer', '✓ answer received in time',
]);
// Texts with a number computed from the model: the readout, the stopwatch total and axis ticks, B's wait.
const COMPUTED = [/^Time left: \d+ ms$/, /^\d+ ms$/, /^Waiting… \d+ ms$/];
const TICKS = ['0 ms', '100 ms', '200 ms', '300 ms', '400 ms'];

function positions(mode) {
  const moments = STORY.moments.filter((m) => !m.modes || m.modes.includes(mode)).sort((a, b) => a.t - b.t);
  return [
    ...STORY.intro.map((s, index) => ({ t: 0, at: { kind: 'intro', index, id: s.id } })),
    ...moments.map((m, i) => ({ t: m.t, at: { kind: 'moment', index: STORY.intro.length + i, id: m.id } })),
  ];
}

function drawn() {
  const loaded = loadScene();
  const stage = loaded.doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
  loaded.scene.build(stage);
  const cues = [];
  const draw = (mode, t, at, motion) => loaded.scene.draw(loaded.scene.stateAt(mode, t), {
    mode, t, at, playing: at.kind !== 'rest', reduced: false, motion: () => motion, sfx: (name) => cues.push(name),
  });
  return { ...loaded, stage, cues, draw };
}

// SVG visibility is inherited, and a child's own value overrides its parent's.
function visibleTexts(stage) {
  const walk = (n, inherited) => {
    const own = n.attrs.visibility || inherited;
    const out = n.tagName === 'text' && own !== 'hidden' ? [n] : [];
    n.children.forEach((c) => out.push(...walk(c, own)));
    return out;
  };
  return walk(stage, 'visible');
}

test('build creates the drawing once; draw creates no nodes and writes no broken values', () => {
  const { stage, stats, cues, draw } = drawn();
  const created = stats.created;
  assert.ok(created > 80, 'build creates the drawing: ' + created);
  for (const mode of MODES) {
    for (const motion of [0, 0.5, 1]) for (const p of positions(mode)) draw(mode, p.t, p.at, motion);
    for (const t of sampleTimes()) draw(mode, t, { kind: 'between', index: 0, id: null }, 1);
  }
  draw(STORY.atRest.mode, STORY.atRest.t, { kind: 'rest', index: 0, id: null }, 1);
  assert.equal(stats.created, created, 'draw created nodes');
  assert.deepEqual(stats.broken, []);
  assert.deepEqual(cues, [], 'the scene never calls ctx.sfx: story.json already cues the click on intro-start');
});

test('the press lands within the first 600 ms of the intro-start hold, with the story click', () => {
  const loaded = loadScene();
  const stage = loaded.doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
  loaded.scene.build(stage);
  const asked = [];
  const at = { kind: 'intro', index: 2, id: 'intro-start' };
  loaded.scene.draw(loaded.scene.stateAt('before', 0), {
    mode: 'before', t: 0, at, playing: true, reduced: false, motion: (ms) => { asked.push(ms); return 0.5; }, sfx: () => {},
  });
  assert.ok(asked.length > 0, 'the press is timed with ctx.motion');
  for (const ms of asked) assert.ok(ms > 0 && ms <= 600, 'press motion runs over ' + ms + ' ms');
});

// Every class the scene leaves on a node must be styled by player.css. The svg roots carry kit.svg's
// own hook class, which the scene does not set.
const CSS_CLASSES = new Set(readFileSync(here('../../src/narrated_explainer/runtime/player.css'), 'utf8').match(/\.nx-[a-z0-9-]+/g)
  .map((sel) => sel.slice(1)));

test('every nx- class the scene sets is defined in player.css', () => {
  const { stage, draw } = drawn();
  const missing = new Set();
  const collect = (where) => {
    for (const n of nodes(stage)) {
      if (n.tagName === 'svg') continue;
      for (const cls of String(n.attrs.class || '').split(/\s+/)) {
        if (/^nx-/.test(cls) && !CSS_CLASSES.has(cls)) missing.add(cls + ' (' + n.tagName + ', ' + where + ')');
      }
    }
  };
  collect('build');
  for (const mode of MODES) {
    for (const motion of [0, 0.5, 1]) {
      for (const p of positions(mode)) { draw(mode, p.t, p.at, motion); collect(mode + ' ' + p.at.id + ' m' + motion); }
    }
    for (const t of sampleTimes()) { draw(mode, t, { kind: 'between', index: 0, id: null }, 1); collect(mode + ' t' + t); }
  }
  assert.deepEqual([...missing], []);
});

// ---- Layout: estimated boxes in viewBox units ----
// Text width from rough per-character widths of a sans-serif face, in em; bold is 5% wider.
const CHAR_EM = [[/[ijlI.,:;'!|·]/, 0.28], [/[ ()\[\]ftr]/, 0.34], [/[mwMW]/, 0.86], [/[✕✓…]/, 0.9], [/[A-Z]/, 0.68]];
const charEm = (c) => (CHAR_EM.find(([re]) => re.test(c)) || [null, 0.56])[1];
const TOKEN_PARTS = new Set(['token', 'chip', 'our-request', 'answer', 'reply-chip']);

const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
function parseTransform(str) {
  let m = [1, 0, 0, 1, 0, 0];
  for (const [, op, args] of String(str || '').matchAll(/(translate|scale|rotate)\(([^)]*)\)/g)) {
    const v = args.trim().split(/[\s,]+/).map(Number);
    if (op === 'translate') m = mul(m, [1, 0, 0, 1, v[0], v[1] || 0]);
    if (op === 'scale') m = mul(m, [v[0], 0, 0, v.length > 1 ? v[1] : v[0], 0, 0]);
    if (op === 'rotate') {
      const r = (v[0] * Math.PI) / 180;
      m = mul(m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);
    }
  }
  return m;
}
function boxOf(m, x0, y0, x1, y1) {
  const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
function textBox(n, m) {
  const size = Number(n.attrs['font-size']);
  const w = [...n.textContent].reduce((sum, c) => sum + charEm(c), 0) * size * (Number(n.attrs['font-weight']) >= 600 ? 1.05 : 1);
  const x = Number(n.attrs.x || 0);
  const y = Number(n.attrs.y || 0);
  const left = { start: x, middle: x - w / 2, end: x - w }[n.attrs['text-anchor'] || 'start'];
  return boxOf(mul(m, parseTransform(n.attrs.transform)), left, y - 0.75 * size, left + w, y + 0.25 * size);
}

// The visible texts and tokens (visibility inherited and overridable, opacity 0 hides a subtree).
function layout(stage) {
  const texts = [];
  const tokens = [];
  const walk = (n, m, vis, faded, token) => {
    const own = n.attrs.visibility || vis;
    const gone = faded || n.attrs.opacity === '0';
    const here = mul(m, n.tagName === 'text' ? [1, 0, 0, 1, 0, 0] : parseTransform(n.attrs.transform));
    let mine = token;
    if (n.tagName === 'g' && TOKEN_PARTS.has(n.attrs['data-part'])) {
      const rect = n.children.find((c) => c.tagName === 'rect');
      const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => Number(rect.attrs[k] || 0));
      mine = { box: boxOf(here, x, y, x + w, y + h), part: n.attrs['data-part'] };
      if (own !== 'hidden' && !gone && (rect.attrs.visibility || own) !== 'hidden') tokens.push(mine);
    }
    if (n.tagName === 'text' && own !== 'hidden' && !gone && n.textContent !== '') {
      texts.push({ str: n.textContent, box: textBox(n, m), token: mine });
    }
    n.children.forEach((c) => walk(c, here, own, gone, mine));
  };
  walk(stage, [1, 0, 0, 1, 0, 0], 'visible', false, null);
  return { texts, tokens };
}
const overlaps = (a, b) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 0 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 0;
const inside = (a, b) => a[0] >= b[0] - 1 && a[1] >= b[1] - 1 && a[2] <= b[2] + 1 && a[3] <= b[3] + 1;
const fmt = (b) => '[' + b.map((v) => Math.round(v)).join(' ') + ']';

// Each view is its own svg with its own coordinates, so boxes are compared within one view.
function layoutProblems(stage, where) {
  return nodes(stage).filter((n) => n.tagName === 'svg').flatMap((view) => viewProblems(view, where));
}

function viewProblems(view, where) {
  const { texts, tokens } = layout(view);
  const out = [];
  texts.forEach((a, i) => {
    texts.slice(i + 1).forEach((b) => {
      if (overlaps(a.box, b.box)) out.push(where + ': "' + a.str + '" ' + fmt(a.box) + ' overlaps "' + b.str + '" ' + fmt(b.box));
    });
    tokens.forEach((tk) => {
      if (tk !== a.token && overlaps(a.box, tk.box)) out.push(where + ': "' + a.str + '" ' + fmt(a.box) + ' overlaps a ' + tk.part + ' ' + fmt(tk.box));
    });
    if (a.token && !inside(a.box, a.token.box)) out.push(where + ': "' + a.str + '" ' + fmt(a.box) + ' spills out of its ' + a.token.part + ' ' + fmt(a.token.box));
  });
  return out;
}

test('no text overlaps another text or a token, at rest, in motion and between moments', () => {
  const { stage, draw } = drawn();
  const problems = [];
  const IN_MOTION = ['send', 'fan-out', 'a-answers'];
  for (const mode of MODES) {
    for (const p of positions(mode)) {
      const motions = IN_MOTION.includes(p.at.id) ? [0, 0.25, 0.5, 0.75, 1] : [1];
      for (const motion of motions) {
        draw(mode, p.t, p.at, motion);
        problems.push(...layoutProblems(stage, mode + ' ' + p.at.id + ' m' + motion));
      }
    }
    // 280..300 every unit: the answer is built, then rises through the Gateway lane.
    const answerTimes = Array.from({ length: 21 }, (_, i) => 280 + i);
    for (const t of [230, 285, 293, ...answerTimes, ...sampleTimes()]) {
      draw(mode, t, { kind: 'between', index: 0, id: null }, 1);
      problems.push(...layoutProblems(stage, mode + ' t' + t));
    }
  }
  draw(STORY.atRest.mode, STORY.atRest.t, { kind: 'rest', index: 0, id: null }, 1);
  problems.push(...layoutProblems(stage, 'rest'));
  assert.deepEqual([...new Set(problems)], []);
});

// A visible line of the view crosses the box when a point along it falls inside.
function crossedLines(view, box) {
  const out = [];
  const walk = (n, vis) => {
    const own = n.attrs.visibility || vis;
    if (own === 'hidden') return;
    if (n.tagName === 'line' && n.attrs['data-part'] !== 'playhead') {
      const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((k) => Number(n.attrs[k]));
      for (let i = 0; i <= 100; i += 1) {
        const [x, y] = [x1 + ((x2 - x1) * i) / 100, y1 + ((y2 - y1) * i) / 100];
        if (x > box[0] && x < box[2] && y > box[1] && y < box[3]) { out.push(fmt([x1, y1, x2, y2])); break; }
      }
    }
    n.children.forEach((c) => walk(c, own));
  };
  walk(view, 'visible');
  return out;
}

test("A's reply waiting in the Gateway row stays clear of the fan-out arrows and the deadline line", () => {
  const { stage, draw } = drawn();
  const timeline = nodes(stage).filter((n) => n.tagName === 'svg')[1];
  for (const mode of MODES) {
    for (const t of [230, 250, 279, 299, 300, 320]) {
      draw(mode, t, { kind: 'between', index: 0, id: null }, 1);
      const reply = layout(timeline).texts.find((x) => /^A's reply (waits for B|lost)$/.test(x.str));
      if (!reply) continue;
      assert.ok(reply.token, mode + ' t' + t + ': ' + reply.str + ' sits in a chip');
      assert.deepEqual(crossedLines(timeline, reply.token.box), [], mode + ' t' + t + ': ' + reply.str + ' ' + fmt(reply.token.box));
    }
  }
});

test('our request reads horizontally while it is worked on', () => {
  const { stage, draw } = drawn();
  const system = nodes(stage).filter((n) => n.tagName === 'svg')[0];
  const check = (where) => {
    const req = layout(system).texts.find((x) => x.str === 'Our request');
    assert.ok(req, where + ': our request is drawn');
    assert.ok(req.box[2] - req.box[0] > req.box[3] - req.box[1], where + ': our request is rotated ' + fmt(req.box));
  };
  for (const mode of MODES) {
    for (const t of [200, 250, 300, 320]) { draw(mode, t, { kind: 'between', index: 0, id: null }, 1); check(mode + ' t' + t); }
    const fanOut = positions(mode).find((p) => p.at.id === 'fan-out');
    draw(mode, fanOut.t, fanOut.at, 1);
    check(mode + ' fan-out');
  }
});

test('every text node holds an allowed string, at least 18 units tall', () => {
  const { stage, draw } = drawn();
  const seen = new Set();
  const check = (where) => {
    for (const n of nodes(stage).filter((x) => x.tagName === 'text')) {
      const str = n.textContent;
      if (str !== '') {
        assert.ok(ALLOWED.has(str) || COMPUTED.some((re) => re.test(str)), where + ': text not allowed: ' + str);
        seen.add(str);
      }
      assert.ok(Number(n.attrs['font-size']) >= 18, where + ': text under 18 units: ' + str);
    }
  };
  for (const mode of MODES) {
    for (const motion of [0, 0.5, 1]) {
      for (const p of positions(mode)) { draw(mode, p.t, p.at, motion); check(mode + ' ' + p.at.id + ' m' + motion); }
    }
    for (const t of sampleTimes()) { draw(mode, t, { kind: 'between', index: 0, id: null }, 1); check(mode + ' t' + t); }
  }
  draw(STORY.atRest.mode, STORY.atRest.t, { kind: 'rest', index: 0, id: null }, 1);
  check('rest');
  for (const str of [...ALLOWED, ...TICKS]) assert.ok(seen.has(str), 'never drawn: ' + str);
});

test('the playhead is hidden at rest and shown while the story plays', () => {
  const { stage, draw } = drawn();
  const playhead = nodes(stage).find((n) => n.attrs['data-part'] === 'playhead');
  assert.ok(playhead, 'a node with data-part="playhead"');
  draw('before', 320, { kind: 'rest', index: 0, id: null }, 1);
  assert.equal(playhead.attrs.visibility, 'hidden');
  draw('before', 100, { kind: 'moment', index: 4, id: 'queue' }, 1);
  assert.equal(playhead.attrs.visibility, 'visible');
  assert.equal(playhead.attrs.x1, String(260 + 2.2 * 100));
});

test('the visible texts match the story at key positions', () => {
  const { stage, draw } = drawn();
  const texts = () => visibleTexts(stage).map((n) => n.textContent).filter(Boolean);
  draw('before', 320, { kind: 'rest', index: 0, id: null }, 1);
  let shown = texts();
  for (const str of ['Time left: 0 ms', '✕ gave up', '✕ cancelled at 300 ms', "A's reply lost",
    'No answer after 100 ms. Call cancelled.', '✕ stopped waiting, no answer', "B's timeout: full 200 ms, would end at 400 ms"]) {
    assert.ok(shown.includes(str), 'rest shows ' + str);
  }
  for (const str of ['Answered with 4 ms to spare', '20 ms reserve', 'timed out']) assert.ok(!shown.includes(str), 'rest hides ' + str);
  draw('after', 296, { kind: 'moment', index: 9, id: 'answer-arrives' }, 1);
  shown = texts();
  for (const str of ['Answered with 4 ms to spare', "✓ got A's reply", "A's reply + B timed out", '20 ms reserve',
    "B's timeout: 80 ms", 'timed out', 'No answer in 80 ms: timed out', '✓ answer received in time']) {
    assert.ok(shown.includes(str), 'answer-arrives shows ' + str);
  }
  for (const str of ['✕ cancelled at 300 ms', '✕ gave up', "B's timeout: full 200 ms, would end at 400 ms"]) {
    assert.ok(!shown.includes(str), 'answer-arrives hides ' + str);
  }
  draw('before', 0, { kind: 'intro', index: 0, id: 'intro-budget' }, 0);
  shown = texts();
  assert.ok(!shown.some((s) => /^Time left/.test(s)), 'the readout waits for the start');
  assert.ok(!shown.includes('Our request'), 'the request is not drawn before the press');
  const total = nodes(stage).find((n) => n.attrs['data-part'] === 'sw-total');
  assert.equal(total.attrs.visibility, 'hidden', 'no total before the stopwatch is wound');
  draw('before', 0, { kind: 'intro', index: 2, id: 'intro-start' }, 1);
  assert.ok(texts().includes('Our request'), 'the request waits at the App at the press');
  assert.equal(total.textContent, '300 ms', 'the stopwatch shows its set total');
  assert.equal(total.attrs.visibility, 'visible');
});
