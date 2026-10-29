// Pins the player's controller (positions, holds, travel, steps, modes, reduced motion, plan and
// renderAt) and, on a minimal fake DOM, the view's controls, transcript, caption and word highlight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const runtime = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(runtime, rel), 'utf8');
const story = JSON.parse(read('tests/fixtures/mini/story.json'));

function load(globals = {}) {
  const context = vm.createContext({ ...globals });
  vm.runInContext(read('sfx.js'), context, { filename: 'sfx.js' });
  vm.runInContext(read('player.js'), context, { filename: 'player.js' });
  return context;
}

const NX = load().NarratedExplainer;
// Values made inside the vm context have that realm's prototypes; compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));
const DUR = { 'intro-ball': 1.0, 'intro-track': 3.0, half: 0.5 };
const make = (durations = {}, options = { reduced: false }) => NX._createController(story, durations, options);
const ids = (list) => list.map((p) => p.id);
const where = (c) => {
  const s = c.snapshot();
  return plain({ kind: s.at.kind, index: s.at.index, id: s.at.id, t: s.t, playing: s.playing });
};
const at = (kind, index, id, t, playing) => ({ kind, index, id, t, playing });

// Plays from rest with no clips: intro-ball 0..2000, intro-track 2000..3000, start 3000..4000.
function leavingStart(speed) {
  const c = make({});
  c.setSpeed(speed);
  c.play(0);
  c.tick(2000);
  c.tick(3000);
  c.tick(4000);
  return c;
}

test('positions: intro steps first, then the mode\'s moments sorted by t', () => {
  const c = make();
  assert.deepEqual(plain(c.positions('smooth')), [
    { kind: 'intro', index: 0, id: 'intro-ball', t: 0, caption: 'This is the ball.' },
    { kind: 'intro', index: 1, id: 'intro-track', t: 0, caption: 'And this is its track.' },
    { kind: 'moment', index: 2, id: 'start', t: 0, caption: 'The ball starts to roll.' },
    { kind: 'moment', index: 3, id: 'half', t: 50, caption: 'Halfway there.' },
    { kind: 'moment', index: 4, id: 'finish', t: 90, caption: 'The ball reaches the flag.' },
  ]);
  assert.deepEqual(plain(ids(c.positions('bumpy'))), ['intro-ball', 'intro-track', 'start', 'half', 'bump', 'finish']);
});

test('a story without modes has the single mode main', () => {
  const bare = {
    timing: { end: 40, realMsPerUnit: 10, holdMs: 500 },
    moments: [{ id: 'b', t: 30, caption: 'B' }, { id: 'a', t: 10, caption: 'A' }],
  };
  const c = NX._createController(bare, {}, { reduced: false });
  assert.deepEqual(plain(c.modes()), ['main']);
  assert.deepEqual(plain(ids(c.positions('main'))), ['a', 'b']);
  assert.equal(c.snapshot().mode, 'main');
});

test('at rest: atRest mode, t and caption, motion 1, no cue, no playback on load', () => {
  const c = make(DUR);
  const s = c.snapshot();
  assert.deepEqual(plain({ mode: s.mode, t: s.t, at: s.at, caption: s.caption, playing: s.playing }), {
    mode: 'smooth', t: 100, at: { kind: 'rest', index: -1, id: null },
    caption: 'Press Play to watch the ball roll.', playing: false,
  });
  assert.equal(c.motion(5000, 400), 1);
  assert.equal(c.cue.seq, 0);
  c.tick(60000);
  assert.deepEqual(where(c), at('rest', -1, null, 100, false));
});

test('play from rest arrives at the first intro step with its clip and cue', () => {
  const c = make(DUR);
  c.play(0);
  assert.deepEqual(where(c), at('intro', 0, 'intro-ball', 0, true));
  assert.deepEqual(plain(c.cue), { seq: 1, id: 'intro-ball', clip: true, sfx: 'pop' });
  assert.equal(c.snapshot().caption, 'This is the ball.');
});

test('play without an intro starts at t = 0 and travels to the first moment', () => {
  const bare = {
    timing: { end: 40, realMsPerUnit: 10, holdMs: 500 },
    moments: [{ id: 'a', t: 10, caption: 'A' }, { id: 'b', t: 30, caption: 'B' }],
  };
  const c = NX._createController(bare, {}, { reduced: false });
  c.play(0);
  assert.deepEqual(where(c), at('between', -1, null, 0, true));
  c.tick(100);
  assert.deepEqual(where(c), at('moment', 0, 'a', 10, true));
});

test('hold release waits for both the hold time and the clip end', () => {
  const c = make(DUR);
  c.play(0); // intro-ball: hold 2000, clip 1.0 s
  c.clipEnded();
  c.tick(1000);
  c.tick(1999);
  assert.equal(c.snapshot().at.id, 'intro-ball');
  c.tick(2000); // intro-track: hold 1000, clip 3.0 s
  assert.deepEqual(where(c), at('intro', 1, 'intro-track', 0, true));
  c.tick(3000);
  c.tick(5000);
  assert.equal(c.snapshot().at.id, 'intro-track', 'hold time passed, clip still playing');
  c.clipEnded();
  c.tick(5200);
  assert.deepEqual(where(c), at('moment', 2, 'start', 0, true));
});

test('a clip that never ends releases after its duration plus 1500 ms', () => {
  const c = make(DUR);
  c.play(0);
  c.clipEnded();
  c.tick(2000); // intro-track arrives at 2000 with a 3.0 s clip
  c.tick(6499);
  assert.equal(c.snapshot().at.id, 'intro-track');
  c.tick(6500);
  assert.equal(c.snapshot().at.id, 'start');
});

test('a clip of unknown duration that never ends releases after 12000 ms', () => {
  const c = make({ start: null });
  c.play(0);
  c.tick(2000);
  c.tick(3000); // start arrives at 3000
  c.tick(14999);
  assert.equal(c.snapshot().at.id, 'start');
  c.tick(15000);
  assert.deepEqual(where(c), at('between', 2, null, 0, true));
});

test('with the voice off, holds use the hold time only', () => {
  const c = make(DUR);
  c.setVoice(false);
  c.play(0);
  assert.equal(c.cue.clip, false);
  c.tick(2000);
  c.tick(3000);
  assert.equal(c.snapshot().at.id, 'start');
});

test('travel at speed 1 advances speed / realMsPerUnit per ms and lands exactly on the next t', () => {
  const c = leavingStart(1);
  assert.deepEqual(where(c), at('between', 2, null, 0, true));
  c.tick(4400);
  assert.deepEqual(where(c), at('between', 2, null, 20, true));
  c.tick(5013);
  assert.deepEqual(where(c), at('moment', 3, 'half', 50, true));
});

test('travel at speed 0.5 takes twice as long and lands exactly on the next t', () => {
  const c = leavingStart(0.5);
  c.tick(5000);
  assert.deepEqual(where(c), at('between', 2, null, 25, true));
  c.tick(6005);
  assert.deepEqual(where(c), at('moment', 3, 'half', 50, true));
});

test('after the last moment time runs to timing.end and playback stops there', () => {
  const c = leavingStart(1);
  c.tick(5000); // half
  c.tick(6000);
  c.tick(6800); // finish at 90
  assert.equal(c.snapshot().at.id, 'finish');
  c.tick(7800);
  c.tick(7900);
  assert.deepEqual(where(c), at('between', 4, null, 95, true));
  c.tick(8100);
  assert.deepEqual(where(c), at('between', 4, null, 100, false));
  c.tick(20000);
  assert.deepEqual(where(c), at('between', 4, null, 100, false));
});

test('Next after playback finished at timing.end does nothing; Previous still goes back', () => {
  const c = leavingStart(1);
  for (const now of [5000, 6000, 6800, 7800, 8100]) c.tick(now);
  assert.deepEqual(where(c), at('between', 4, null, 100, false));
  c.step(1, 8200);
  assert.deepEqual(where(c), at('between', 4, null, 100, false));
  assert.equal(c.snapshot().finished, true);
  c.step(-1, 8300);
  assert.deepEqual(where(c), at('moment', 4, 'finish', 90, false));
});

test('restart() goes back to the first intro step and plays, from travel or from pause', () => {
  const c = leavingStart(1);
  c.tick(4400);
  const seq = c.cue.seq;
  c.restart(4500);
  assert.deepEqual(where(c), at('intro', 0, 'intro-ball', 0, true));
  assert.deepEqual(plain(c.cue), { seq: seq + 1, id: 'intro-ball', clip: false, sfx: 'pop' });
  assert.equal(c.motion(4750, 500), 0.5);
  c.pause(4800);
  c.restart(5000);
  assert.deepEqual(where(c), at('intro', 0, 'intro-ball', 0, true));
});

test('Play after the end restarts from the beginning', () => {
  const c = leavingStart(1);
  for (const now of [5000, 6000, 6800, 7800, 8100]) c.tick(now);
  assert.equal(c.snapshot().finished, true);
  c.play(9000);
  assert.deepEqual(where(c), at('intro', 0, 'intro-ball', 0, true));
  assert.equal(c.snapshot().finished, false);
  assert.equal(c.snapshot().caption, 'This is the ball.');
});

test('a late clipEnded() for an earlier arrival does not release a later hold', () => {
  const c = make(DUR);
  c.play(0); // intro-ball, clip 1.0 s
  const first = c.cue.seq;
  c.clipEnded(first);
  c.tick(2000); // intro-track: hold 1000, clip 3.0 s
  assert.equal(c.snapshot().at.id, 'intro-track');
  c.clipEnded(first); // the earlier clip's end arrives late
  c.tick(3000);
  assert.equal(c.snapshot().at.id, 'intro-track', 'still waiting for its own clip');
  c.clipEnded(c.cue.seq);
  c.tick(3001);
  assert.equal(c.snapshot().at.id, 'start');
});

test('step buttons move one position across the intro boundary, paused, with motion 1', () => {
  const c = make(DUR);
  const seen = [];
  const record = () => {
    const s = c.snapshot();
    seen.push(plain({ kind: s.at.kind, id: s.at.id, playing: s.playing, motion: c.motion(0, 500), cue: c.cue }));
  };
  c.step(1, 0);
  record();
  c.step(1, 0);
  record();
  c.step(1, 0);
  record();
  c.step(-1, 0);
  record();
  assert.deepEqual(seen, [
    { kind: 'intro', id: 'intro-ball', playing: false, motion: 1, cue: { seq: 1, id: 'intro-ball', clip: true, sfx: null } },
    { kind: 'intro', id: 'intro-track', playing: false, motion: 1, cue: { seq: 2, id: 'intro-track', clip: true, sfx: null } },
    { kind: 'moment', id: 'start', playing: false, motion: 1, cue: { seq: 3, id: 'start', clip: false, sfx: null } },
    { kind: 'intro', id: 'intro-track', playing: false, motion: 1, cue: { seq: 4, id: 'intro-track', clip: true, sfx: null } },
  ]);
  c.step(-1, 0);
  c.step(-1, 0);
  assert.equal(c.snapshot().at.id, 'intro-ball');
});

test('a step stops playback, and Previous from rest goes to the last position', () => {
  const c = make({});
  c.play(0);
  c.step(1, 100);
  assert.deepEqual(where(c), at('intro', 1, 'intro-track', 0, false));
  const d = make({});
  d.step(-1, 0);
  assert.deepEqual(where(d), at('moment', 4, 'finish', 90, false));
});

test('mode switch keeps t and playback continues in the new mode', () => {
  const c = leavingStart(1);
  c.tick(5000); // half
  c.tick(6000);
  c.tick(6200);
  assert.deepEqual(where(c), at('between', 3, null, 60, true));
  c.setMode('bumpy', 6200);
  assert.equal(c.snapshot().mode, 'bumpy');
  assert.deepEqual(where(c), at('between', 3, null, 60, true));
  c.tick(6400);
  assert.deepEqual(where(c), at('moment', 4, 'bump', 70, true));
});

test('mode switch during a hold keeps the position and stops waiting for its clip', () => {
  const c = make(DUR);
  c.setVoice(false);
  c.play(0);
  c.tick(2000);
  c.tick(3000);
  c.tick(4000);
  c.setVoice(true);
  c.tick(5000); // half, clip 0.5 s pending
  assert.equal(c.cue.clip, true);
  c.setMode('bumpy', 5100);
  assert.deepEqual(where(c), at('moment', 3, 'half', 50, true));
  c.tick(6000);
  assert.deepEqual(where(c), at('between', 3, null, 50, true));
});

test('mode switch while paused keeps t', () => {
  const c = make({});
  c.step(-1, 0); // finish, t 90
  c.setMode('bumpy', 0);
  assert.deepEqual(plain({ mode: c.snapshot().mode, t: c.snapshot().t }), { mode: 'bumpy', t: 90 });
});

test('reduced motion moves every 2500 ms, or at the clip end when later, with no travel', () => {
  const c = make(DUR, { reduced: true });
  c.play(0);
  c.clipEnded();
  c.tick(1000);
  c.tick(2499);
  assert.equal(c.snapshot().at.id, 'intro-ball');
  c.tick(2500);
  assert.equal(c.snapshot().at.id, 'intro-track');
  c.tick(5000);
  assert.equal(c.snapshot().at.id, 'intro-track', 'its 3.0 s clip is still playing');
  c.clipEnded();
  c.tick(5500);
  assert.deepEqual(where(c), at('moment', 2, 'start', 0, true));
  assert.equal(c.motion(5600, 1000), 1);
  c.tick(7999);
  assert.equal(c.snapshot().at.id, 'start');
  c.tick(8000);
  assert.deepEqual(where(c), at('moment', 3, 'half', 50, true));
  c.clipEnded();
  c.tick(10500);
  assert.deepEqual(where(c), at('moment', 4, 'finish', 90, true));
  c.tick(13000);
  assert.deepEqual(where(c), at('between', 4, null, 100, false));
});

test('motion() is clock progress while playing and 1 when paused, stepped, reduced or at rest', () => {
  const c = make({});
  assert.equal(c.motion(0, 500), 1, 'at rest');
  c.play(1000);
  assert.equal(c.motion(1250, 500), 0.5);
  assert.equal(c.motion(1600, 500), 1);
  c.pause(1300);
  assert.equal(c.motion(1300, 500), 1, 'paused');
  c.play(2000);
  assert.equal(c.motion(2100, 400), 0.25, 'resuming re-arrives at the position');
  c.step(1, 2200);
  assert.equal(c.motion(2200, 400), 1, 'stepped');
  const r = make({}, { reduced: true });
  r.play(0);
  assert.equal(r.motion(100, 400), 1, 'reduced');
});

test('sfxOnce plays a cue once per arrival and never while paused', () => {
  const c = make({});
  assert.equal(c.sfxOnce('pop'), false);
  c.play(0);
  assert.deepEqual([c.sfxOnce('pop'), c.sfxOnce('pop'), c.sfxOnce('ding')], [true, false, true]);
  c.tick(2000);
  assert.equal(c.sfxOnce('pop'), true);
});

const SMOOTH_PLAN = {
  duration: 10300,
  segments: [
    { kind: 'hold', start: 0, end: 2000, at: { kind: 'intro', index: 0, id: 'intro-ball' }, clipId: 'intro-ball', sfx: 'pop' },
    { kind: 'hold', start: 2000, end: 5300, at: { kind: 'intro', index: 1, id: 'intro-track' }, clipId: 'intro-track', sfx: 'whoosh' },
    { kind: 'hold', start: 5300, end: 6300, at: { kind: 'moment', index: 2, id: 'start' }, clipId: null, sfx: 'click' },
    { kind: 'travel', start: 6300, end: 7300, tFrom: 0, tTo: 50 },
    { kind: 'hold', start: 7300, end: 8300, at: { kind: 'moment', index: 3, id: 'half' }, clipId: 'half', sfx: 'tick' },
    { kind: 'travel', start: 8300, end: 9100, tFrom: 50, tTo: 90 },
    { kind: 'hold', start: 9100, end: 10100, at: { kind: 'moment', index: 4, id: 'finish' }, clipId: null, sfx: 'success' },
    { kind: 'travel', start: 10100, end: 10300, tFrom: 90, tTo: 100 },
  ],
};

test('plan(): holds last max(holdMs, clip duration + 300), travel at speed 1, voice on', () => {
  const c = make(DUR, { reduced: true });
  c.setSpeed(0.5);
  c.setVoice(false);
  assert.deepEqual(plain(c.plan('smooth')), SMOOTH_PLAN);
  const bumpy = plain(c.plan('bumpy'));
  assert.deepEqual(bumpy.segments.filter((s) => s.kind === 'hold').map((s) => s.at.id),
    ['intro-ball', 'intro-track', 'start', 'half', 'bump', 'finish']);
  assert.equal(bumpy.duration, 11300);
});

test('renderAt(): hold start, mid-hold, mid-travel and the end, on the plan timeline', () => {
  const c = make(DUR);
  const frame = (ms, motionMs) => {
    const f = c.renderAt('smooth', ms);
    return plain({ kind: f.at.kind, id: f.at.id, t: f.t, caption: f.caption, playing: f.playing, motion: f.motion(motionMs) });
  };
  assert.deepEqual(frame(0, 500), { kind: 'intro', id: 'intro-ball', t: 0, caption: 'This is the ball.', playing: true, motion: 0 });
  assert.deepEqual(frame(1000, 2000), { kind: 'intro', id: 'intro-ball', t: 0, caption: 'This is the ball.', playing: true, motion: 0.5 });
  assert.deepEqual(frame(5300, 1000), { kind: 'moment', id: 'start', t: 0, caption: 'The ball starts to roll.', playing: true, motion: 0 });
  assert.deepEqual(frame(6800, 1000), { kind: 'between', id: null, t: 25, caption: 'The ball starts to roll.', playing: true, motion: 1 });
  assert.deepEqual(frame(10300, 100), { kind: 'between', id: null, t: 100, caption: 'The ball reaches the flag.', playing: false, motion: 1 });
  assert.deepEqual(frame(99999, 100), frame(10300, 100));
  for (const seg of SMOOTH_PLAN.segments.filter((s) => s.kind === 'hold')) {
    assert.deepEqual(plain(c.renderAt('smooth', seg.start).at), seg.at);
  }
  assert.equal(c.snapshot().at.kind, 'rest', 'renderAt does not move the live player');
});

test('word index at a clip time is the last word that has started', () => {
  const words = [[0, 0.3], [0.3, 0.7], [0.9, 1.2]];
  assert.deepEqual([-0.1, 0, 0.5, 0.8, 1.0, 5].map((t) => NX._wordIndexAt(words, t)), [-1, 0, 1, 1, 2, 2]);
  assert.equal(NX._wordIndexAt([], 1), -1);
});

test('keyboard map', () => {
  const keys = [' ', 'k', 'K', 'ArrowLeft', 'ArrowRight', 'r', 'R', 'v', 's', 't', 'f', '1', '9'];
  assert.deepEqual(keys.map((key) => NX._keyAction({ key })),
    ['toggle', 'toggle', 'toggle', 'prev', 'next', 'restart', 'restart', 'voice', 'sound', 'transcript', 'fullscreen', 'mode:0', 'mode:8']);
  assert.deepEqual(['x', '0', 'Enter'].map((key) => NX._keyAction({ key })), [null, null, null]);
  assert.equal(NX._keyAction({ key: 'r', ctrlKey: true }), null);
  assert.equal(NX._keyAction({ key: 'f', metaKey: true }), null);
});

test('loading the runtime makes no audio context and registers the scene factory', () => {
  let made = 0;
  function Counting() { made += 1; }
  const context = load({ AudioContext: Counting, OfflineAudioContext: Counting });
  assert.equal(made, 0);
  assert.ok(Array.isArray(context.NarratedExplainer.players));
  assert.equal(typeof context.NarratedExplainer.mount, 'function');
  vm.runInContext(read('tests/fixtures/mini/scene.js'), context, { filename: 'scene.js' });
  assert.equal(typeof context.NarratedExplainer._scene, 'function');
  assert.equal(context.NarratedExplainer.players.length, 0, 'loading mounts no player');
  assert.equal(made, 0);
});

test('runtime scripts use no eval, network or timers', () => {
  for (const file of ['player.js', 'sfx.js']) {
    const src = read(file);
    for (const banned of ['eval(', 'new Function', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'import(', 'http:', 'https:', 'setInterval', 'setTimeout']) {
      assert.equal(src.includes(banned), false, file + ' contains ' + banned);
    }
  }
});

test('player.css: .nx selectors, palette-only hex, both palettes, 44 px buttons, 16 px text', () => {
  const css = read('player.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [];
  const declarations = [];
  for (const block of css.split('}')) {
    const open = block.lastIndexOf('{');
    if (open === -1) continue;
    const head = block.slice(0, open).replace(/@media[^{]*\{/g, '').trim();
    if (head) selectors.push(...head.split(','));
    declarations.push(...block.slice(open + 1).split(';').map((d) => d.trim()).filter(Boolean));
  }
  assert.ok(selectors.length > 0);
  for (const sel of selectors) assert.ok(sel.trim().startsWith('.nx'), 'selector ' + sel.trim());
  for (const decl of declarations.filter((d) => /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(d))) {
    assert.ok(decl.startsWith('--nx-'), 'colour literal outside the palette: ' + decl);
  }
  const tones = ['ink', 'ink-2', 'page', 'sunken', 'hairline', 'edge'];
  for (const tone of ['info', 'ok', 'warn', 'stop']) tones.push(tone + '-fg', tone + '-bg');
  const dark = css.slice(css.indexOf('prefers-color-scheme: dark'));
  assert.ok(css.includes('prefers-color-scheme: dark'));
  for (const tone of tones) {
    assert.ok(new RegExp('--nx-' + tone + ':\\s*#').test(css), 'light ' + tone);
    assert.ok(new RegExp('--nx-' + tone + ':\\s*#').test(dark), 'dark ' + tone);
  }
  for (const tone of ['info', 'ok', 'warn', 'stop']) {
    for (const cls of ['nx-fill-' + tone + '-fg', 'nx-fill-' + tone + '-bg', 'nx-stroke-' + tone]) {
      assert.ok(css.includes('.' + cls), cls);
    }
  }
  assert.ok(css.includes('.nx-halo'));
  assert.ok(/top:\s*var\(--nx-sticky-top/.test(css));
  assert.ok(/min-height:\s*44px/.test(css));
  for (const m of css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) assert.ok(Number(m[1]) >= 16, 'font-size ' + m[1]);
});

test('the dev page embeds the fixture story unchanged', () => {
  const html = read('dev/index.html');
  const m = html.match(/<script type="application\/json" id="nx-story">([\s\S]*?)<\/script>/);
  assert.ok(m, 'story JSON tag');
  assert.deepEqual(JSON.parse(m[1]), story);
});

// ---------------------------------------------------------------------------------------------
// View pins on a minimal fake DOM: enough of document, elements and Audio for mount().
class FakeClassList {
  constructor() { this.names = new Set(); }
  add(name) { this.names.add(name); }
  remove(name) { this.names.delete(name); }
  contains(name) { return this.names.has(name); }
  toggle(name, force) {
    const on = force === undefined ? !this.names.has(name) : Boolean(force);
    if (on) this.names.add(name);
    else this.names.delete(name);
    return on;
  }
}

class FakeNode {
  constructor(doc, tag) {
    this.ownerDocument = doc;
    this.tagName = tag ? tag.toUpperCase() : null;
    this.children = [];
    this.attributes = {};
    this.classList = new FakeClassList();
    this.listeners = {};
    this.style = {};
    this.hidden = false;
    this.parentNode = null;
    this.data = '';
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  setAttribute(name, value) {
    if (name === 'class') this.classList.names = new Set(String(value).split(/\s+/).filter(Boolean));
    this.attributes[name] = String(value);
  }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  dispatch(type, extra = {}) {
    const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
    for (const fn of this.listeners[type] || []) fn(event);
  }
  click() { this.dispatch('click'); }
  contains(node) { for (let n = node; n; n = n.parentNode) if (n === this) return true; return false; }
  get textContent() { return this.tagName ? this.children.map((c) => c.textContent).join('') : this.data; }
  set textContent(value) {
    if (!this.tagName) { this.data = String(value); return; }
    this.children = [];
    if (value !== '') this.appendChild(this.ownerDocument.createTextNode(value));
  }
}

function fakeDocument() {
  const doc = {
    listeners: {},
    createElement: (tag) => new FakeNode(doc, tag),
    createElementNS: (ns, tag) => new FakeNode(doc, tag),
    createTextNode: (text) => { const n = new FakeNode(doc, null); n.data = String(text); return n; },
    addEventListener() {},
  };
  return doc;
}

const all = (node, test) => {
  const found = [];
  const walk = (n) => { if (n.tagName && test(n)) found.push(n); n.children.forEach(walk); };
  walk(node);
  return found;
};
const byClass = (node, cls) => all(node, (n) => n.classList.contains(cls));

// Word timings for the caption words of each clip.
const NARRATION = {
  label: 'Test voice',
  clips: {
    'intro-ball': { src: 'data:audio/wav;base64,AAAA', duration: 1.0, words: [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.9]] },
    'intro-track': { src: 'data:audio/wav;base64,AAAA', duration: 3.0, words: [[0, 0.5], [0.5, 1], [1, 1.5], [1.5, 2], [2, 2.5]] },
    half: { src: 'data:audio/wav;base64,AAAA', duration: 0.5, words: [[0, 0.2], [0.2, 0.4]] },
  },
};

function mountFake(narration = NARRATION) {
  const audios = [];
  class FakeAudio {
    constructor() {
      this.listeners = {};
      this.src = '';
      this.currentTime = 0;
      this.plays = 0;
      this.pauses = 0;
      audios.push(this);
    }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    play() { this.plays += 1; }
    pause() { this.pauses += 1; }
  }
  const clock = { now: 0 };
  const context = load({
    performance: { now: () => clock.now },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    Audio: FakeAudio,
  });
  vm.runInContext(read('tests/fixtures/mini/scene.js'), context, { filename: 'scene.js' });
  const doc = fakeDocument();
  const figure = doc.createElement('figure');
  const player = context.NarratedExplainer.mount(figure, { story, narration });
  return { player, figure, audios, clock };
}

// What a reader sees in the controls, the caption and the transcript.
function seen(figure) {
  const markers = byClass(figure, 'nx-marker');
  return {
    pressedMode: byClass(figure, 'nx-mode').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent),
    play: byClass(figure, 'nx-play')[0].textContent,
    markers: markers.length,
    passed: markers.filter((b) => b.classList.contains('nx-passed')).length,
    current: markers.findIndex((b) => b.getAttribute('aria-current') === 'step'),
    transcript: byClass(figure, 'nx-transcript-item').map((b) => b.textContent),
    caption: byClass(figure, 'nx-caption')[0].textContent,
    word: byClass(figure, 'nx-word').findIndex((w) => w.classList.contains('nx-word-on')),
  };
}

test('renderAt() on a player at rest shows that frame\'s mode, markers, transcript, label and word', () => {
  const { player, figure, audios } = mountFake();
  assert.deepEqual(plain(seen(figure)), {
    pressedMode: ['Smooth'], play: 'Play', markers: 5, passed: 0, current: -1,
    transcript: ['This is the ball.', 'And this is its track.', 'The ball starts to roll.', 'Halfway there.', 'The ball reaches the flag.'],
    caption: 'Press Play to watch the ball roll.', word: -1,
  });
  const bumpyCaptions = ['This is the ball.', 'And this is its track.', 'The ball starts to roll.', 'Halfway there.', 'It hits a bump.', 'The ball reaches the flag.'];
  player.renderAt('bumpy', 500); // intro-ball hold, 0.5 s into its clip
  assert.deepEqual(plain(seen(figure)), {
    pressedMode: ['Bumpy'], play: 'Pause', markers: 6, passed: 1, current: 0,
    transcript: bumpyCaptions, caption: 'This is the ball.', word: 2,
  });
  player.renderAt('bumpy', 7400); // half hold, 0.1 s into its 0.5 s clip
  assert.deepEqual(plain(seen(figure)), {
    pressedMode: ['Bumpy'], play: 'Pause', markers: 6, passed: 4, current: 3,
    transcript: bumpyCaptions, caption: 'Halfway there.', word: 0,
  });
  player.renderAt('bumpy', 7900); // same hold, after its clip ended
  assert.equal(seen(figure).word, -1);
  player.renderAt('bumpy', 11300); // the end
  assert.deepEqual(plain(seen(figure)), {
    pressedMode: ['Bumpy'], play: 'Play', markers: 6, passed: 6, current: -1,
    transcript: bumpyCaptions, caption: 'The ball reaches the flag.', word: -1,
  });
  assert.equal(audios.length, 0, 'renderAt plays no audio');
});

test('the player renders no description; the page shell owns it', () => {
  const { figure } = mountFake();
  assert.equal(byClass(figure, 'nx-description').length, 0);
  assert.equal(all(figure, (n) => n.tagName === 'P').length, 0);
  assert.equal(read('player.css').includes('nx-description'), false);
});

test('the figcaption is the figure\'s last child, after the transcript', () => {
  const { figure } = mountFake();
  const tags = figure.children.map((n) => n.tagName + (n.getAttribute('class') ? '.' + n.getAttribute('class') : ''));
  assert.equal(tags[tags.length - 1], 'FIGCAPTION.nx-caption');
  assert.ok(tags.indexOf('DIV.nx-transcript') !== -1 && tags.indexOf('DIV.nx-transcript') < tags.length - 1, tags.join(' '));
});

test('selecting the active mode by button or digit key keeps the narration clip playing', () => {
  const { figure, audios } = mountFake();
  byClass(figure, 'nx-play')[0].click();
  assert.equal(audios.length, 1);
  const audio = audios[0];
  assert.equal(audio.plays, 1);
  const pauses = audio.pauses;
  byClass(figure, 'nx-mode').find((b) => b.textContent === 'Smooth').click();
  figure.dispatch('keydown', { key: '1' });
  assert.equal(audio.pauses, pauses, 'the clip was not stopped');
  assert.equal(seen(figure).play, 'Pause');
  byClass(figure, 'nx-mode').find((b) => b.textContent === 'Bumpy').click();
  assert.equal(audio.pauses, pauses + 1, 'a real mode change stops the clip');
});
