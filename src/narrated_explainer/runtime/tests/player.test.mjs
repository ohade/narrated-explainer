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

// Speed above 1x: holds, the clip-release failsafe, motion and the voice run at `pace`; travel keeps
// scaling with the speed itself, and speeds up to 1x leave holds and motion alone.
const HOLD_STORY = {
  timing: { end: 40, realMsPerUnit: 10, holdMs: 1600 },
  moments: [{ id: 'a', t: 0, caption: 'A' }, { id: 'b', t: 30, caption: 'B' }],
};
function holding(speed, durations = {}) {
  const c = NX._createController(HOLD_STORY, durations, { reduced: false });
  c.setSpeed(speed, 0);
  c.play(0);
  return c;
}

test('at 2x a 1600 ms hold with no clip leaves at 800 ms', () => {
  const c = holding(2);
  assert.equal(c.nextEventAt(), 800);
  c.tick(799);
  assert.equal(c.snapshot().at.id, 'a');
  c.tick(800);
  assert.deepEqual(where(c), at('between', 0, null, 0, true));
});

test('at 2x a clip hold and its clip-release failsafe halve', () => {
  const clip = { a: 1.0 };
  assert.equal(holding(1, clip).nextEventAt(), 2500);
  const c = holding(2, clip);
  assert.equal(c.nextEventAt(), 1250);
  c.tick(1249);
  assert.equal(c.snapshot().at.id, 'a', 'the clip has not ended: waiting for it');
  c.tick(1250);
  assert.equal(c.snapshot().at.kind, 'between');
  assert.equal(holding(2, { a: null }).nextEventAt(), 6000, 'unknown clip length: 12000 ms halved');
});

test('motion over 1000 ms reaches 1 at 500 ms at 2x', () => {
  const c = holding(2);
  assert.equal(c.motion(250, 1000), 0.5);
  assert.equal(c.motion(500, 1000), 1);
  assert.equal(holding(1).motion(500, 1000), 0.5);
});

test('at 0.5x holds, the clip failsafe and motion are those of 1x; travel takes twice as long', () => {
  const c = holding(0.5, { a: 1.0 });
  assert.equal(c.nextEventAt(), 2500);
  assert.equal(c.motion(500, 1000), 0.5);
  const d = holding(0.5);
  assert.equal(d.nextEventAt(), 1600);
  d.tick(1600);
  assert.equal(d.nextEventAt(), 1600 + 30 * 10 / 0.5);
  const e = holding(2);
  e.tick(800);
  assert.equal(e.nextEventAt(), 800 + 30 * 10 / 2, 'travel scales with the speed itself');
});

test('a speed change mid-hold rescales the rest of that hold', () => {
  const up = holding(1);
  up.tick(800);
  up.setSpeed(2, 800);
  assert.equal(up.nextEventAt(), 1200);
  up.tick(1199);
  assert.equal(up.snapshot().at.id, 'a');
  up.tick(1200);
  assert.equal(up.snapshot().at.kind, 'between');
  const down = holding(2);
  down.tick(400);
  down.setSpeed(1, 400);
  assert.equal(down.nextEventAt(), 1200);
  const clip = holding(1, { a: 1.0 });
  clip.setSpeed(2, 1000);
  assert.equal(clip.nextEventAt(), 1750, 'the clip failsafe rescales too: 1000 + 1500 / 2');
});

test('a speed change mid-motion keeps the motion where it was', () => {
  const c = holding(1);
  assert.equal(c.motion(400, 1000), 0.4);
  c.setSpeed(2, 400);
  assert.equal(c.motion(400, 1000), 0.4);
  assert.equal(c.motion(700, 1000), 1);
});

test('plan() and renderAt() give the same result at every speed', () => {
  const results = [0.5, 1, 2].map((speed) => {
    const c = make(DUR);
    c.setSpeed(speed, 0);
    const frame = c.renderAt('smooth', 6800);
    return plain({
      plan: c.plan('smooth'),
      frame: { at: frame.at, t: frame.t, caption: frame.caption, playing: frame.playing, clipTime: frame.clipTime, motion: frame.motion(1000) },
    });
  });
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[2], results[1]);
  assert.deepEqual(results[1].plan, SMOOTH_PLAN);
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
  // One palette: every tone is light-dark(light, dark), and each colour value is written once.
  assert.ok(/color-scheme:\s*light dark/.test(css));
  for (const tone of tones) {
    assert.ok(new RegExp('--nx-' + tone + ':\\s*light-dark\\(#[0-9a-f]{6},\\s*#[0-9a-f]{6}\\)').test(css), 'light and dark ' + tone);
  }
  assert.equal((css.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length, tones.length * 2, 'each colour value written once');
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
  focus() { this.ownerDocument.focused = this; }
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
    addEventListener(type, fn) { (doc.listeners[type] = doc.listeners[type] || []).push(fn); },
    // Runs the page-level listeners for an event, as the browser does for one that bubbles to the document.
    dispatch(type, extra = {}) {
      for (const fn of doc.listeners[type] || []) fn({ type, defaultPrevented: false, preventDefault() {}, ...extra });
    },
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

function mountFake(narration = NARRATION, { storyOverride = story, fullscreen = false, drawLog = null, globals = {} } = {}) {
  const audios = [];
  const frames = [];
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
    requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelAnimationFrame() {},
    Audio: FakeAudio,
    ...globals,
  });
  vm.runInContext(read('tests/fixtures/mini/scene.js'), context, { filename: 'scene.js' });
  if (drawLog) {
    // Records the context the player hands to every draw call.
    const factory = context.NarratedExplainer._scene;
    context.NarratedExplainer._scene = (sceneStory, kit) => {
      const scene = factory(sceneStory, kit);
      const draw = scene.draw;
      scene.draw = (state, ctx) => { drawLog.push({ level: ctx.level, depth: ctx.depth }); return draw(state, ctx); };
      return scene;
    };
  }
  const doc = fakeDocument();
  const figure = doc.createElement('figure');
  if (fullscreen) figure.requestFullscreen = () => {};
  const player = context.NarratedExplainer.mount(figure, { story: storyOverride, narration });
  // Runs the queued animation frames, 500 ms apart, until playback stops or `limitMs` has passed.
  const runFrames = (limitMs = 100000) => {
    for (let at = clock.now + 500; frames.length && at <= limitMs; at += 500) { clock.now = at; frames.shift()(at); }
  };
  return { player, figure, audios, clock, doc, runFrames };
}

// What a reader sees in the controls, the caption and the transcript.
function seen(figure) {
  const markers = byClass(figure, 'nx-marker');
  return {
    pressedMode: byClass(figure, 'nx-mode').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent),
    play: byClass(figure, 'nx-play')[0].getAttribute('aria-label'),
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
    pressedMode: ['Bumpy'], play: 'Replay', markers: 6, passed: 6, current: -1,
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

function mountThemed(localStorage) {
  const context = load({ performance: { now: () => 0 }, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, localStorage });
  vm.runInContext(read('tests/fixtures/mini/scene.js'), context, { filename: 'scene.js' });
  const figure = fakeDocument().createElement('figure');
  context.NarratedExplainer.mount(figure, { story, narration: null });
  return figure;
}

test('the Theme control cycles Auto, Light, Dark, stores the choice and applies a stored one on load', () => {
  const store = {};
  const storage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const figure = mountThemed(storage);
  const theme = byClass(figure, 'nx-theme')[0];
  assert.ok(theme, 'the player has a Theme control');
  const state = () => [theme.textContent, figure.getAttribute('data-nx-theme'), Object.values(store).join()];
  assert.deepEqual(state(), ['Theme: Auto', null, '']);
  theme.click();
  assert.deepEqual(state(), ['Theme: Light', 'light', 'light']);
  theme.click();
  assert.deepEqual(state(), ['Theme: Dark', 'dark', 'dark']);
  theme.click();
  assert.deepEqual(state(), ['Theme: Auto', null, 'auto']);
  theme.click();
  theme.click();
  const again = mountThemed(storage);
  assert.equal(again.getAttribute('data-nx-theme'), 'dark');
  assert.equal(byClass(again, 'nx-theme')[0].textContent, 'Theme: Dark');
});

test('the Theme control still works when storage throws', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const figure = mountThemed(broken);
  const theme = byClass(figure, 'nx-theme')[0];
  assert.ok(theme, 'the player has a Theme control');
  theme.click();
  assert.equal(figure.getAttribute('data-nx-theme'), 'light');
  assert.equal(byClass(figure, 'nx-play')[0].getAttribute('aria-label'), 'Play');
});

const speedSelect = (figure) => byClass(figure, 'nx-speed')[0];

test('Speed is one native drop-down with six fixed options, 1x selected', () => {
  const { figure } = mountFake();
  assert.equal(byClass(figure, 'nx-speed').length, 1);
  const select = speedSelect(figure);
  assert.equal(select.tagName, 'SELECT');
  const options = select.children.map((o) => [o.tagName, o.getAttribute('value'), o.textContent]);
  assert.deepEqual(options, [
    ['OPTION', '0.5', '0.5x'], ['OPTION', '0.75', '0.75x'], ['OPTION', '1', '1x'],
    ['OPTION', '1.25', '1.25x'], ['OPTION', '1.5', '1.5x'], ['OPTION', '2', '2x'],
  ], 'the fixture story lists timing.speeds [0.5, 1]; the player ignores it');
  assert.equal(select.value, '1');
  assert.equal(select.getAttribute('aria-label'), 'Speed');
});

test('choosing a speed sets the narration playbackRate to max(1, speed)', () => {
  const { figure, audios } = mountFake();
  byClass(figure, 'nx-play')[0].click();
  const audio = audios[0];
  const choose = (value) => { speedSelect(figure).value = value; speedSelect(figure).dispatch('change'); };
  choose('2');
  assert.equal(audio.playbackRate, 2);
  choose('0.5');
  assert.equal(audio.playbackRate, 1);
  choose('1.5');
  assert.equal(audio.playbackRate, 1.5);
  byClass(figure, 'nx-next')[0].click(); // a new clip keeps the rate
  assert.equal(audio.playbackRate, 1.5);
});

test('keyboard shortcuts do not fire while the speed select has focus', () => {
  const { figure } = mountFake();
  const voice = byClass(figure, 'nx-voice')[0];
  figure.dispatch('keydown', { key: 'v', target: speedSelect(figure) });
  assert.equal(voice.textContent, 'Voice: on');
  figure.dispatch('keydown', { key: 'v' });
  assert.equal(voice.textContent, 'Voice: off');
});

// ---------------------------------------------------------------------------------------------
// The control bar: icon buttons, the More menu and Replay.
const labelOf = (node) => node.getAttribute('aria-label');
const iconOf = (node) => node.getAttribute('data-icon');
const required = (node, what) => { assert.ok(node, 'the bar has ' + what); return node; };
const moreOf = (figure) => required(byClass(figure, 'nx-more')[0], 'a More menu');
const menuOf = (figure) => required(byClass(figure, 'nx-menu')[0], 'a menu panel');
const menuItem = (figure, cls) => required(byClass(figure, cls)[0], 'a ' + cls + ' control');
// Presses `key` with focus on `target`: the keydown bubbles to the figure. Returns what the handler did with it.
const press = (figure, target, key) => {
  let prevented = false;
  figure.dispatch('keydown', { key, target, preventDefault() { prevented = true; } });
  return { defaultPrevented: prevented };
};

test('the icon buttons carry a glyph, an accessible name and a title from the labels', () => {
  const { figure } = mountFake(NARRATION, { fullscreen: true });
  const summary = required(moreOf(figure).children[0], 'a summary');
  const icons = [
    [byClass(figure, 'nx-play')[0], 'Play', 'play'], [byClass(figure, 'nx-prev')[0], 'Previous', 'prev'],
    [byClass(figure, 'nx-next')[0], 'Next', 'next'], [byClass(figure, 'nx-fullscreen')[0], 'Fullscreen', 'fullscreen'],
    [summary, 'More', 'more'],
  ];
  for (const [node, label, icon] of icons) {
    assert.equal(labelOf(node), label);
    assert.equal(node.getAttribute('title'), label);
    assert.equal(iconOf(node), icon);
    assert.match(node.innerHTML, /^<svg [^>]*viewBox="0 0 24 24"/, label + ' holds an inline svg');
    assert.match(node.innerHTML, /currentColor/, label + ' follows the text colour');
    assert.equal(node.textContent, '', label + ' shows no text');
  }
  assert.equal(summary.tagName, 'SUMMARY');
  assert.equal(moreOf(figure).tagName, 'DETAILS');
});

test('the Play icon follows the state: play, then pause once playing', () => {
  const { figure } = mountFake();
  const play = byClass(figure, 'nx-play')[0];
  assert.deepEqual([labelOf(play), iconOf(play)], ['Play', 'play']);
  play.click();
  assert.deepEqual([labelOf(play), iconOf(play)], ['Pause', 'pause']);
  play.click();
  assert.deepEqual([labelOf(play), iconOf(play)], ['Play', 'play']);
});

test('the bar order is modes, Play, Previous, Next, Speed, Fullscreen, More', () => {
  const { figure } = mountFake(NARRATION, { fullscreen: true });
  const controls = byClass(figure, 'nx-controls')[0];
  const names = controls.children.map((n) => (n.getAttribute('class') || n.tagName).split(' ')[0]);
  assert.deepEqual(names, ['nx-group', 'nx-play', 'nx-prev', 'nx-next', 'nx-speed', 'nx-fullscreen', 'nx-more']);
});

test('More holds Restart, Voice with its name, Sound, Transcript and Theme, in that order', () => {
  const { figure } = mountFake();
  const names = menuOf(figure).children.map((n) => n.getAttribute('class').split(' ')[0]);
  assert.deepEqual(names, ['nx-restart', 'nx-menu-voice', 'nx-sound', 'nx-transcript-toggle', 'nx-theme']);
  const voice = menuItem(menuOf(figure), 'nx-menu-voice');
  assert.deepEqual(voice.children.map((n) => n.getAttribute('class').split(' ')[0]), ['nx-voice', 'nx-voice-name']);
  assert.equal(byClass(figure, 'nx-voice-name')[0].textContent, 'Test voice');
  for (const cls of ['nx-restart', 'nx-voice', 'nx-sound', 'nx-transcript-toggle', 'nx-theme']) {
    assert.notEqual(menuItem(menuOf(figure), cls).textContent, '', cls + ' keeps its text');
  }
  assert.equal(moreOf(figure).open === true, false, 'the menu starts closed');
});

test('without narration the Voice item and its name are hidden', () => {
  const { figure } = mountFake(null);
  assert.equal(menuItem(figure, 'nx-voice').hidden, true);
  assert.equal(menuItem(figure, 'nx-voice-name').hidden, true);
  assert.equal(menuItem(figure, 'nx-menu-voice').hidden, true);
});

test('Escape closes the open menu, returns focus to its summary and does nothing else', () => {
  const { figure, doc } = mountFake();
  const more = moreOf(figure);
  const play = byClass(figure, 'nx-play')[0];
  more.open = true;
  const event = press(figure, menuItem(figure, 'nx-sound'), 'Escape');
  assert.equal(more.open, false);
  assert.equal(event.defaultPrevented, true);
  assert.equal(doc.focused, more.children[0]);
  assert.equal(labelOf(play), 'Play', 'nothing started');
  assert.equal(press(figure, figure, 'Escape').defaultPrevented, false, 'with the menu closed Escape is left alone');
});

test('keyboard shortcuts do not fire while focus is in the open menu or on its summary', () => {
  const { figure } = mountFake();
  const more = moreOf(figure);
  const voice = byClass(figure, 'nx-voice')[0];
  more.open = true;
  assert.equal(press(figure, menuItem(figure, 'nx-sound'), 'v').defaultPrevented, false);
  assert.equal(voice.textContent, 'Voice: on');
  more.open = false;
  assert.equal(press(figure, more.children[0], ' ').defaultPrevented, false, 'Space on the summary opens the menu natively');
  assert.equal(labelOf(byClass(figure, 'nx-play')[0]), 'Play');
  press(figure, figure, 'v');
  assert.equal(voice.textContent, 'Voice: off', 'a shortcut elsewhere still works');
});

test('a click outside the menu closes it; a click inside does not', () => {
  const { figure, doc } = mountFake();
  const more = moreOf(figure);
  more.open = true;
  doc.dispatch('click', { target: menuItem(figure, 'nx-sound') });
  assert.equal(more.open, true);
  doc.dispatch('click', { target: more.children[0] });
  assert.equal(more.open, true, 'the summary toggles the menu itself');
  doc.dispatch('click', { target: byClass(figure, 'nx-caption')[0] });
  assert.equal(more.open, false);
  doc.dispatch('click', { target: byClass(figure, 'nx-caption')[0] });
  assert.equal(more.open, false);
});

test('Restart closes the menu; Voice, Sound, Transcript and Theme leave it open', () => {
  const { figure } = mountFake();
  const more = moreOf(figure);
  for (const cls of ['nx-voice', 'nx-sound', 'nx-transcript-toggle', 'nx-theme']) {
    more.open = true;
    menuItem(figure, cls).click();
    assert.equal(more.open, true, cls + ' keeps the menu open');
  }
  menuItem(figure, 'nx-restart').click();
  assert.equal(more.open, false);
});

test('when the story has finished Play becomes Replay, and clicking it plays again from the start', () => {
  const { figure, clock, runFrames } = mountFake(null);
  const play = byClass(figure, 'nx-play')[0];
  play.click();
  runFrames();
  assert.deepEqual([labelOf(play), iconOf(play), play.getAttribute('title')], ['Replay', 'replay', 'Replay']);
  assert.equal(byClass(figure, 'nx-caption')[0].textContent, 'The ball reaches the flag.');
  play.click();
  assert.deepEqual([labelOf(play), iconOf(play)], ['Pause', 'pause']);
  assert.equal(byClass(figure, 'nx-caption')[0].textContent, 'This is the ball.', 'it began again at the first step');
  assert.ok(clock.now > 0);
});

test('a story can override the More and Replay labels', () => {
  const labels = { more: 'Mehr', replay: 'Nochmal' };
  const { figure, runFrames } = mountFake(null, { storyOverride: { ...story, labels } });
  assert.equal(labelOf(moreOf(figure).children[0]), 'Mehr');
  byClass(figure, 'nx-play')[0].click();
  runFrames();
  assert.equal(labelOf(byClass(figure, 'nx-play')[0]), 'Nochmal');
});

// ---------------------------------------------------------------------------------------------
// Dive levels: a subset of the steps per level, a start menu, the Depth chip and an end card.
const LEVELS = [
  { id: 'glance', label: 'Glance', blurb: 'Just the idea.' },
  { id: 'tour', label: 'Tour', blurb: 'The main steps.' },
  { id: 'deep', label: 'Deep', blurb: 'Every step.' },
];
const LEVEL_TAGS = { 'intro-track': ['tour', 'deep'], bump: ['deep'], half: ['tour', 'deep'] };
const tagged = (list) => list.map((e) => (LEVEL_TAGS[e.id] ? { ...e, levels: LEVEL_TAGS[e.id] } : e));
const levelsStory = { ...story, levels: LEVELS, intro: tagged(story.intro), moments: tagged(story.moments) };
const makeLevels = (durations = {}, options = { reduced: false }) => NX._createController(levelsStory, durations, options);
const levelIds = (c, mode, level) => plain(ids(c.positions(mode, level)));
const mountLevels = (options = {}) => mountFake(null, { storyOverride: levelsStory, ...options });
const card = (figure, label) => required(byClass(figure, 'nx-depth-card').find((b) => b.textContent.includes(label)), 'a ' + label + ' card');
const chipOf = (figure) => required(byClass(figure, 'nx-depth')[0], 'a Depth chip');
const menuPanel = (figure) => required(byClass(figure, 'nx-depth-menu')[0], 'a start menu');
const endCard = (figure) => required(byClass(figure, 'nx-depth-end')[0], 'an end card');
const isPlaying = (figure) => labelOf(byClass(figure, 'nx-play')[0]) === 'Pause';

test('levels: positions are built per mode and level, intro steps included', () => {
  const c = makeLevels();
  assert.deepEqual(levelIds(c, 'smooth', 'glance'), ['intro-ball', 'start', 'finish']);
  assert.deepEqual(levelIds(c, 'smooth', 'tour'), ['intro-ball', 'intro-track', 'start', 'half', 'finish']);
  assert.deepEqual(levelIds(c, 'bumpy', 'tour'), ['intro-ball', 'intro-track', 'start', 'half', 'finish']);
  assert.deepEqual(levelIds(c, 'bumpy', 'deep'), ['intro-ball', 'intro-track', 'start', 'half', 'bump', 'finish']);
  assert.deepEqual(plain(c.positions('smooth', 'glance').map((p) => p.index)), [0, 1, 2]);
  assert.deepEqual(levelIds(c, 'smooth'), levelIds(c, 'smooth', 'deep'), 'with no level the deepest one is used');
  assert.deepEqual(plain(c.levels()), ['glance', 'tour', 'deep']);
});

test('intro steps honour their modes, and a story without levels has no levels', () => {
  const modal = { ...story, intro: [{ ...story.intro[0], modes: ['bumpy'] }, story.intro[1]] };
  const c = NX._createController(modal, {}, { reduced: false });
  assert.deepEqual(plain(ids(c.positions('smooth'))), ['intro-track', 'start', 'half', 'finish']);
  assert.deepEqual(plain(ids(c.positions('bumpy'))), ['intro-ball', 'intro-track', 'start', 'half', 'bump', 'finish']);
  assert.deepEqual(plain(make().levels()), []);
  assert.equal(make().snapshot().level, null);
  assert.equal(make().snapshot().depth, null);
});

test('a level switch keeps the place by id, else by story time', () => {
  const c = makeLevels();
  assert.equal(c.snapshot().level, 'deep');
  assert.equal(c.snapshot().depth, 2);
  c.jump(3, 0); // half in the deep list
  c.setLevel('glance', 10);
  assert.deepEqual([c.snapshot().level, c.snapshot().depth], ['glance', 0]);
  assert.deepEqual(where(c), at('between', 1, null, 50, false), 'half is not in Glance: the last step passed by time');
  c.setLevel('deep', 20);
  assert.deepEqual(where(c), at('between', 2, null, 50, false));
  c.jump(4, 30); // finish
  c.setLevel('glance', 40);
  assert.deepEqual(where(c), at('moment', 2, 'finish', 90, false), 'found by id');
  c.setLevel('tour', 50);
  c.jump(2, 60); // start in Tour
  c.setLevel('glance', 70);
  assert.deepEqual(where(c), at('moment', 1, 'start', 0, false), 'a same-index lookup would land on finish');
  c.setLevel('nope', 80);
  assert.equal(c.snapshot().level, 'glance');
});

test('a mode switch finds an intro step by id, not by index', () => {
  const modal = { ...story, intro: [{ ...story.intro[0], modes: ['bumpy'] }, story.intro[1]] };
  const c = NX._createController(modal, {}, { reduced: false });
  c.setMode('bumpy', 0);
  c.jump(1, 0); // intro-track is second in bumpy
  c.setMode('smooth', 10);
  assert.deepEqual(where(c), at('intro', 0, 'intro-track', 0, false));
});

test('plan() of the shallowest level is shorter than the deepest, and the default is the deepest', () => {
  const c = makeLevels();
  const glance = plain(c.plan('smooth', 'glance'));
  const deep = plain(c.plan('smooth', 'deep'));
  assert.deepEqual(glance.segments.filter((s) => s.kind === 'hold').map((s) => s.at.id), ['intro-ball', 'start', 'finish']);
  assert.equal(glance.duration, 6000);
  assert.equal(deep.duration, 8000);
  assert.deepEqual(plain(c.plan('smooth')), deep);
  assert.ok(glance.duration < plain(c.plan('smooth', 'tour')).duration);
});

test('renderAt() and the live snapshot carry the level', () => {
  const c = makeLevels();
  const glance = c.renderAt('smooth', 2500, 'glance');
  assert.deepEqual(plain([glance.at.id, glance.level, glance.depth]), ['start', 'glance', 0]);
  const deep = c.renderAt('smooth', 2500, 'deep');
  assert.deepEqual(plain([deep.at.id, deep.level, deep.depth]), ['intro-track', 'deep', 2]);
  assert.equal(c.renderAt('smooth', 2500).level, 'deep');
});

test('the keyboard map has m for the menu', () => {
  assert.deepEqual(['m', 'M'].map((key) => NX._keyAction({ key })), ['menu', 'menu']);
});

test('a story with levels opens on a start menu: one card per level with its step count and minutes', () => {
  const { figure } = mountLevels();
  assert.equal(menuPanel(figure).hidden, false);
  assert.equal(endCard(figure).hidden, true);
  const cards = byClass(figure, 'nx-depth-card');
  assert.deepEqual(plain(cards.map((b) => b.tagName)), ['BUTTON', 'BUTTON', 'BUTTON']);
  assert.deepEqual(byClass(figure, 'nx-depth-label').map((n) => n.textContent), ['Glance', 'Tour', 'Deep']);
  assert.deepEqual(byClass(figure, 'nx-depth-blurb').map((n) => n.textContent), ['Just the idea.', 'The main steps.', 'Every step.']);
  assert.deepEqual(byClass(figure, 'nx-depth-meta').map((n) => n.textContent),
    ['3 steps, about 1 min', '5 steps, about 1 min', '5 steps, about 1 min']);
  assert.equal(byClass(figure, 'nx-depth-title')[0].textContent, 'Choose how deep to go');
  assert.equal(byClass(figure, 'nx-depth-restart')[0].hidden, true, 'nothing to start over yet');
  assert.equal(seen(figure).play, 'Play', 'nothing autoplays');
});

test('the minutes are rounded up and follow the mode', () => {
  const slow = { ...levelsStory, timing: { ...levelsStory.timing, holdMs: 30000 } };
  const { figure } = mountFake(null, { storyOverride: slow });
  assert.deepEqual(byClass(figure, 'nx-depth-meta').map((n) => n.textContent),
    ['3 steps, about 2 min', '5 steps, about 3 min', '5 steps, about 3 min']);
  byClass(figure, 'nx-mode').find((b) => b.textContent === 'Bumpy').click();
  assert.deepEqual(byClass(figure, 'nx-depth-meta').map((n) => n.textContent),
    ['3 steps, about 2 min', '5 steps, about 3 min', '6 steps, about 3 min']);
});

test('a story without levels has no menu, no Depth chip and no end card', () => {
  const { figure, runFrames } = mountFake(null);
  for (const cls of ['nx-depth-menu', 'nx-depth', 'nx-depth-end', 'nx-depth-card']) assert.equal(byClass(figure, cls).length, 0, cls);
  figure.dispatch('keydown', { key: 'm' });
  byClass(figure, 'nx-play')[0].click();
  runFrames();
  assert.equal(seen(figure).play, 'Replay');
  assert.equal(byClass(figure, 'nx-depth-end').length, 0);
});

test('clicking a card sets the level and starts playing it', () => {
  const { figure } = mountLevels();
  card(figure, 'Glance').click();
  assert.equal(menuPanel(figure).hidden, true);
  assert.equal(isPlaying(figure), true);
  const view = seen(figure);
  assert.deepEqual(plain([view.markers, view.transcript.length, view.caption]), [3, 3, 'This is the ball.']);
  assert.equal(chipOf(figure).textContent, 'Glance');
  assert.equal(card(figure, 'Glance').getAttribute('aria-pressed'), 'true');
  assert.equal(card(figure, 'Deep').getAttribute('aria-pressed'), 'false');
});

test('the Depth chip sits after the mode tabs and shows the current level', () => {
  const { figure } = mountLevels();
  const names = byClass(figure, 'nx-controls')[0].children.map((n) => (n.getAttribute('class') || n.tagName).split(' ')[0]);
  assert.deepEqual(names, ['nx-group', 'nx-depth', 'nx-play', 'nx-prev', 'nx-next', 'nx-speed', 'nx-fullscreen', 'nx-more']);
  assert.equal(chipOf(figure).textContent, 'Deep', 'the deepest level until one is chosen');
  assert.equal(chipOf(figure).getAttribute('aria-label'), 'Depth: Deep');
});

test('the Depth chip and the m key reopen the menu and pause; choosing resumes from the kept place', () => {
  const { figure, doc } = mountLevels();
  card(figure, 'Glance').click();
  byClass(figure, 'nx-next')[0].click(); // start, stepped
  assert.equal(seen(figure).caption, 'The ball starts to roll.');
  chipOf(figure).click();
  assert.equal(menuPanel(figure).hidden, false);
  assert.equal(seen(figure).play, 'Play');
  assert.equal(chipOf(figure).getAttribute('aria-expanded'), 'true');
  assert.equal(doc.focused, card(figure, 'Glance'), 'focus goes to the current level');
  assert.equal(byClass(figure, 'nx-depth-restart')[0].hidden, false);
  card(figure, 'Tour').click();
  assert.equal(menuPanel(figure).hidden, true);
  assert.equal(isPlaying(figure), true);
  assert.equal(seen(figure).caption, 'The ball starts to roll.', 'the same step, found by id');
  assert.equal(seen(figure).markers, 5);
  figure.dispatch('keydown', { key: 'm' });
  assert.equal(menuPanel(figure).hidden, false);
  assert.equal(seen(figure).play, 'Play');
  card(figure, 'Tour').click();
  assert.equal(isPlaying(figure), true);
});

test('Escape closes the menu opened mid-story and returns focus to the chip', () => {
  const { figure, doc } = mountLevels();
  card(figure, 'Tour').click();
  chipOf(figure).click();
  const event = press(figure, card(figure, 'Tour'), 'Escape');
  assert.equal(menuPanel(figure).hidden, true);
  assert.equal(event.defaultPrevented, true);
  assert.equal(doc.focused, chipOf(figure));
  assert.equal(seen(figure).play, 'Play', 'still paused');
});

test('Start over in the menu restarts the current level from its first step', () => {
  const { figure } = mountLevels();
  card(figure, 'Glance').click();
  byClass(figure, 'nx-next')[0].click();
  chipOf(figure).click();
  byClass(figure, 'nx-depth-restart')[0].click();
  assert.equal(menuPanel(figure).hidden, true);
  assert.equal(isPlaying(figure), true);
  assert.equal(seen(figure).caption, 'This is the ball.');
  assert.equal(seen(figure).markers, 3);
});

test('shortcuts do not fire while focus is on a menu card', () => {
  const { figure } = mountFake(NARRATION, { storyOverride: levelsStory });
  const voice = byClass(figure, 'nx-voice')[0];
  assert.equal(press(figure, card(figure, 'Tour'), 'v').defaultPrevented, false);
  assert.equal(press(figure, card(figure, 'Tour'), 'r').defaultPrevented, false);
  assert.equal(voice.textContent, 'Voice: on');
  assert.equal(seen(figure).play, 'Play');
  press(figure, figure, 'v');
  assert.equal(voice.textContent, 'Voice: off');
});

test('the end card offers Go deeper, Replay and Change depth, and Go deeper is hidden at the deepest level', () => {
  const { figure, runFrames } = mountLevels();
  card(figure, 'Glance').click();
  runFrames();
  assert.equal(endCard(figure).hidden, false);
  assert.equal(seen(figure).play, 'Replay');
  const deeper = byClass(figure, 'nx-depth-deeper')[0];
  const names = endCard(figure).children.map((n) => n.getAttribute('class').split(' ')[0]);
  assert.deepEqual(names, ['nx-depth-deeper', 'nx-depth-replay', 'nx-depth-change']);
  assert.deepEqual(endCard(figure).children.map((n) => n.textContent), ['Go deeper', 'Replay', 'Change depth']);
  assert.equal(deeper.hidden, false);
  deeper.click();
  assert.equal(chipOf(figure).textContent, 'Tour');
  assert.equal(endCard(figure).hidden, true);
  assert.equal(isPlaying(figure), true);
  assert.equal(seen(figure).caption, 'This is the ball.');
  runFrames();
  assert.equal(endCard(figure).hidden, false);
  byClass(figure, 'nx-depth-deeper')[0].click();
  assert.equal(chipOf(figure).textContent, 'Deep');
  runFrames();
  assert.equal(endCard(figure).hidden, false);
  assert.equal(byClass(figure, 'nx-depth-deeper')[0].hidden, true, 'nothing deeper than the deepest');
});

test('the end card Replay plays the level again; Change depth opens the menu', () => {
  const { figure, runFrames } = mountLevels();
  card(figure, 'Deep').click();
  runFrames();
  byClass(figure, 'nx-depth-replay')[0].click();
  assert.equal(endCard(figure).hidden, true);
  assert.equal(isPlaying(figure), true);
  assert.equal(seen(figure).caption, 'This is the ball.');
  runFrames();
  byClass(figure, 'nx-depth-change')[0].click();
  assert.equal(endCard(figure).hidden, true);
  assert.equal(menuPanel(figure).hidden, false);
  assert.equal(seen(figure).play, 'Replay', 'the story stays finished until a level is chosen');
  card(figure, 'Glance').click();
  assert.equal(isPlaying(figure), true);
  assert.equal(seen(figure).markers, 3);
});

test('draw receives the level id and depth; without levels both are null', () => {
  const log = [];
  const { figure } = mountLevels({ drawLog: log });
  card(figure, 'Tour').click();
  assert.deepEqual(plain(log[log.length - 1]), { level: 'tour', depth: 1 });
  const plainLog = [];
  const bare = mountFake(null, { drawLog: plainLog });
  byClass(bare.figure, 'nx-play')[0].click();
  assert.deepEqual(plain(plainLog[plainLog.length - 1]), { level: null, depth: null });
});

test('the tool API takes a trailing level, defaults to the deepest and leaves no overlay on a frame', async () => {
  const lengths = [];
  class FakeOffline {
    constructor(channels, length) { lengths.push(length); this.destination = {}; }
    createGain() { return { connect() {} }; }
    startRendering() { return Promise.resolve({ sampleRate: 48000, getChannelData: () => new Float32Array(2) }); }
  }
  const quiet = { ...levelsStory, intro: levelsStory.intro.map(({ sfx, ...e }) => e), moments: levelsStory.moments.map(({ sfx, ...e }) => e) };
  const { player, figure } = mountFake(null, {
    storyOverride: quiet, globals: { OfflineAudioContext: FakeOffline, btoa: (s) => Buffer.from(s, 'binary').toString('base64') },
  });
  assert.equal(menuPanel(figure).hidden, false);
  assert.equal(player.positions('smooth', 'glance').length, 3);
  assert.equal(player.positions('smooth').length, 5);
  assert.ok(player.plan('smooth', 'glance').duration < player.plan('smooth').duration);
  await player.soundtrack('smooth', 'glance');
  await player.soundtrack('smooth');
  assert.deepEqual(lengths, [6000 * 48, 8000 * 48]);
  player.goto('smooth', 1, 'glance');
  assert.deepEqual(plain(seen(figure).transcript.length), 3);
  assert.equal(menuPanel(figure).hidden, true);
  player.renderAt('smooth', 99999, 'glance');
  assert.equal(seen(figure).play, 'Replay');
  assert.equal(endCard(figure).hidden, true, 'the last frame of an export carries no end card');
  assert.equal(menuPanel(figure).hidden, true);
});
