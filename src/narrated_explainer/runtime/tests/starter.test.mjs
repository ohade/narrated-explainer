// Tests for the starter story (templates/starter): its story.json follows the contract, and its
// scene.js keeps stateAt pure, builds once and only changes attributes while drawing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const KIT_SRC = readFileSync(here('../kit.js'), 'utf8');
const SCENE_SRC = readFileSync(here('../../templates/starter/scene.js'), 'utf8');
const STORY = JSON.parse(readFileSync(here('../../templates/starter/story.json'), 'utf8'));
const CUES = ['click', 'pop', 'whoosh', 'tick', 'ding', 'success', 'fail', 'alarm', 'wind', 'thud'];
const ID = /^[a-z0-9][a-z0-9-]*$/;

function makeDoc() {
  const stats = { created: 0, writes: 0 };
  class FakeNode {
    constructor(tag) {
      this.tagName = tag;
      this.attrs = {};
      this.children = [];
      this.text = '';
    }
    setAttribute(name, value) { stats.writes += 1; this.attrs[name] = String(value); }
    getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }
    appendChild(child) { this.children.push(child); return child; }
    get textContent() { return this.text + this.children.map((c) => c.textContent).join(''); }
    set textContent(value) { stats.writes += 1; this.children = []; this.text = String(value); }
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

const MODE = 'main';
const allSteps = () => [...STORY.intro, ...STORY.moments];
const sampleTimes = () => {
  const ts = new Set([0, STORY.timing.end, STORY.atRest.t]);
  for (const m of STORY.moments) [m.t, m.t + 0.5, m.t + 3.7].forEach((t) => ts.add(Math.min(t, STORY.timing.end)));
  for (let t = 0; t <= STORY.timing.end; t += STORY.timing.end / 23) ts.add(t);
  return [...ts].sort((a, b) => a - b);
};

test('story.json has one mode, a two-step intro and four to six moments', () => {
  assert.ok(!STORY.modes || STORY.modes.length === 1, 'one mode');
  assert.equal(STORY.intro.length, 2);
  assert.ok(STORY.moments.length >= 4 && STORY.moments.length <= 6, 'four to six moments');
  assert.ok(STORY.atRest && typeof STORY.atRest.caption === 'string');
});

test('ids are unique and well formed across intro and moments', () => {
  const ids = allSteps().map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids: ' + ids.join(', '));
  for (const id of ids) assert.match(id, ID);
  assert.match(STORY.id, ID);
});

test('every moment t lies in 0..timing.end and intro steps have no t', () => {
  for (const m of STORY.moments) {
    assert.equal(typeof m.t, 'number', m.id);
    assert.ok(m.t >= 0 && m.t <= STORY.timing.end, m.id + ' t=' + m.t);
  }
  for (const s of STORY.intro) assert.equal(s.t, undefined, s.id);
  assert.ok(STORY.atRest.t >= 0 && STORY.atRest.t <= STORY.timing.end);
});

test('captions are short and sound cues exist', () => {
  for (const s of allSteps()) {
    assert.ok(s.caption.split(/\s+/).length < 25, s.id + ' caption under 25 words');
    if (s.sfx !== undefined) assert.ok(CUES.includes(s.sfx), s.id + ' sfx ' + s.sfx);
  }
});

test('scene.js stays under 150 lines', () => {
  assert.ok(SCENE_SRC.split('\n').length < 150, 'lines: ' + SCENE_SRC.split('\n').length);
});

test('stateAt is pure: same output twice, no DOM, no clock, no randomness', () => {
  const { scene, stats, context } = loadScene();
  vm.runInContext('Math.random = () => { throw new Error("random in stateAt"); };'
    + 'Date.now = () => { throw new Error("clock in stateAt"); };', context);
  // Any DOM global read from stateAt throws, so a stateAt that reaches for the page fails here.
  for (const name of ['document', 'window', 'navigator', 'performance', 'requestAnimationFrame']) {
    Object.defineProperty(context, name, {
      configurable: true,
      get() { throw new Error(name + ' read in stateAt'); },
    });
  }
  const before = { ...stats };
  const first = sampleTimes().map((t) => JSON.stringify(scene.stateAt(MODE, t)));
  const second = sampleTimes().map((t) => JSON.stringify(scene.stateAt(MODE, t)));
  assert.deepEqual(second, first);
  assert.deepEqual({ ...stats }, before, 'stateAt touched the DOM');
  assert.ok(new Set(first).size > 3, 'state changes over time');
});

test('build runs once and draw only changes attributes at every position', () => {
  const { scene, doc, stats } = loadScene();
  const stage = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
  scene.build(stage);
  const created = stats.created;
  assert.ok(created > 20, 'build creates the drawing');
  const cues = [];
  const ctxFor = (t, at, motion) => ({
    mode: MODE, t, at, playing: true, reduced: false,
    motion: () => motion, sfx: (name) => cues.push(name),
  });
  for (const motion of [0, 0.3, 0.7, 1]) {
    STORY.intro.forEach((s, index) => scene.draw(scene.stateAt(MODE, 0), ctxFor(0, { kind: 'intro', index, id: s.id }, motion)));
    STORY.moments.forEach((m, index) => scene.draw(scene.stateAt(MODE, m.t), ctxFor(m.t, { kind: 'moment', index, id: m.id }, motion)));
  }
  for (const t of sampleTimes()) scene.draw(scene.stateAt(MODE, t), ctxFor(t, { kind: 'between', index: 0, id: null }, 1));
  scene.draw(scene.stateAt(STORY.atRest.mode || MODE, STORY.atRest.t), ctxFor(STORY.atRest.t, { kind: 'rest', index: 0, id: null }, 1));
  assert.equal(stats.created, created, 'draw created nodes');
  for (const cue of cues) assert.ok(CUES.includes(cue), 'ctx.sfx cue ' + cue);
});
