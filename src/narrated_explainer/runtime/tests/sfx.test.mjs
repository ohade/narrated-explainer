// Pins the sound cues on a stub AudioContext: each cue schedules only oscillators, noise buffers
// and gains, never before `when`, and the shared context exists only after ensure().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const runtime = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAMES = ['click', 'pop', 'whoosh', 'tick', 'ding', 'success', 'fail', 'alarm', 'wind', 'thud'];

function load(globals = {}) {
  const context = vm.createContext({ ...globals });
  vm.runInContext(readFileSync(path.join(runtime, 'sfx.js'), 'utf8'), context, { filename: 'sfx.js' });
  return context.NarratedExplainer;
}

// A stub with only the factories the cues may use; any other factory call throws.
function stubContext() {
  const log = { times: [], starts: [], made: [], reachedOut: false };
  const out = { name: 'out' };
  const param = (name) => {
    const at = (v, t) => { log.times.push([name, t]); };
    return {
      value: 1,
      setValueAtTime: at,
      linearRampToValueAtTime: at,
      exponentialRampToValueAtTime: (v, t) => { assert.ok(v > 0, name + ' exponential ramp to ' + v); at(v, t); },
      setTargetAtTime: at,
      cancelScheduledValues: at,
    };
  };
  const node = (kind, extra) => {
    log.made.push(kind);
    return Object.assign({
      connect(target) { if (target === out) log.reachedOut = true; return target; },
      disconnect() {},
    }, extra);
  };
  const source = (kind, extra) => node(kind, Object.assign({
    start(t = 0) { log.starts.push(t); },
    stop(t = 0) { log.times.push([kind + '.stop', t]); },
  }, extra));
  const ac = {
    sampleRate: 8000,
    currentTime: 0,
    state: 'running',
    destination: { name: 'destination' },
    resume() { return Promise.resolve(); },
    createOscillator: () => source('oscillator', { type: 'sine', frequency: param('frequency'), detune: param('detune') }),
    createGain: () => node('gain', { gain: param('gain') }),
    createBufferSource: () => source('bufferSource', { buffer: null, loop: false, playbackRate: param('playbackRate') }),
    createBuffer(channels, length, rate) {
      log.made.push('buffer');
      const data = new Float32Array(length);
      return { numberOfChannels: channels, length, sampleRate: rate, duration: length / rate, getChannelData: () => data };
    },
  };
  return { ac, out, log };
}

test('the ten cues, by name', () => {
  const NX = load();
  assert.deepEqual([...NX.sfx.names], NAMES);
  assert.deepEqual(Object.keys(NX.sfx.cues).sort(), [...NAMES].sort());
});

for (const name of NAMES) {
  test('cue ' + name + ' schedules nodes no earlier than when', () => {
    const NX = load();
    const { ac, out, log } = stubContext();
    const when = 5;
    NX.sfx.cues[name](ac, out, when);
    assert.ok(log.starts.length > 0, 'starts at least one source');
    assert.ok(log.reachedOut, 'connects to the destination it was given');
    for (const t of log.starts) assert.ok(t >= when, 'start at ' + t);
    for (const [what, t] of log.times) assert.ok(t >= when, what + ' at ' + t);
    for (const kind of log.made) assert.ok(['oscillator', 'gain', 'buffer', 'bufferSource'].includes(kind), kind);
  });
}

test('one shared AudioContext, made by ensure() only, with a master gain the mute sets to 0', () => {
  let made = 0;
  function Stub() { made += 1; return stubContext().ac; }
  const NX = load({ AudioContext: Stub });
  NX.sfx.play('click');
  assert.equal(made, 0, 'no context before the first click');
  NX.sfx.ensure();
  NX.sfx.ensure();
  assert.equal(made, 1);
  NX.sfx.setMuted(true);
  assert.equal(NX.sfx.master.gain.value, 0);
  NX.sfx.setMuted(false);
  assert.equal(NX.sfx.master.gain.value, 1);
});
