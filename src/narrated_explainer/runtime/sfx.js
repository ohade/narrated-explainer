// Narrated Explainer sound effects: ten cues synthesised with Web Audio oscillators, noise buffers
// and gain envelopes, so they ship as code. Each cue is (audioContext, destination, when), so the
// same code plays live and renders offline. The shared AudioContext is made on the first click.
(function (root) {
  'use strict';

  const NX = root.NarratedExplainer || (root.NarratedExplainer = {});
  const SILENT = 0.0001; // exponential ramps cannot reach 0

  // Attack-then-decay gain envelope into `dest`; returns the gain node to connect sources to.
  function envelope(ac, dest, when, attack, peak, decay) {
    const g = ac.createGain();
    g.gain.setValueAtTime(SILENT, when);
    g.gain.linearRampToValueAtTime(peak, when + attack);
    g.gain.exponentialRampToValueAtTime(SILENT, when + attack + decay);
    g.connect(dest);
    return g;
  }

  // One oscillator gliding from `from` Hz to `to` Hz over the envelope.
  function tone(ac, dest, when, spec) {
    const attack = spec.attack || 0.005;
    const length = attack + spec.decay;
    const osc = ac.createOscillator();
    osc.type = spec.type || 'sine';
    osc.frequency.setValueAtTime(spec.from, when);
    if (spec.to && spec.to !== spec.from) osc.frequency.exponentialRampToValueAtTime(spec.to, when + length);
    osc.connect(envelope(ac, dest, when, attack, spec.peak, spec.decay));
    osc.start(when);
    osc.stop(when + length + 0.02);
  }

  // Deterministic noise (seeded), so offline renders are identical every time. `smooth` in 0..1
  // low-passes it by a one-pole filter while filling the buffer: 0 is white, near 1 is a rumble.
  function noiseBuffer(ac, seconds, smooth) {
    const length = Math.max(1, Math.round(seconds * ac.sampleRate));
    const buffer = ac.createBuffer(1, length, ac.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 0x2f6b9a1d;
    let last = 0;
    let peak = 0;
    for (let i = 0; i < length; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const white = seed / 2147483648 - 1;
      last = smooth * last + (1 - smooth) * white;
      data[i] = last;
      peak = Math.max(peak, Math.abs(last));
    }
    if (peak > 0) for (let i = 0; i < length; i += 1) data[i] /= peak;
    return buffer;
  }

  function noise(ac, dest, when, spec) {
    const attack = spec.attack || 0.002;
    const length = attack + spec.decay;
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer(ac, length + 0.02, spec.smooth || 0);
    src.connect(envelope(ac, dest, when, attack, spec.peak, spec.decay));
    src.start(when);
    src.stop(when + length + 0.02);
  }

  const cues = {
    click(ac, dest, when) {
      noise(ac, dest, when, { decay: 0.02, peak: 0.5 });
      tone(ac, dest, when, { type: 'square', from: 2200, decay: 0.02, peak: 0.08 });
    },
    pop(ac, dest, when) {
      tone(ac, dest, when, { from: 380, to: 920, attack: 0.004, decay: 0.09, peak: 0.45 });
    },
    whoosh(ac, dest, when) {
      noise(ac, dest, when, { smooth: 0.9, attack: 0.18, decay: 0.32, peak: 0.45 });
      tone(ac, dest, when, { from: 180, to: 520, attack: 0.18, decay: 0.3, peak: 0.05 });
    },
    tick(ac, dest, when) {
      tone(ac, dest, when, { from: 1600, attack: 0.001, decay: 0.035, peak: 0.25 });
    },
    ding(ac, dest, when) {
      tone(ac, dest, when, { from: 1318.5, attack: 0.004, decay: 1.1, peak: 0.3 });
      tone(ac, dest, when, { from: 2637, attack: 0.004, decay: 0.5, peak: 0.08 });
    },
    success(ac, dest, when) {
      [523.25, 659.25, 783.99].forEach((f, i) => {
        tone(ac, dest, when + i * 0.11, { type: 'triangle', from: f, attack: 0.008, decay: i === 2 ? 0.5 : 0.18, peak: 0.3 });
      });
    },
    fail(ac, dest, when) {
      tone(ac, dest, when, { type: 'square', from: 311, to: 294, decay: 0.18, peak: 0.12 });
      tone(ac, dest, when + 0.2, { type: 'square', from: 233, to: 156, decay: 0.42, peak: 0.12 });
    },
    alarm(ac, dest, when) {
      for (let i = 0; i < 4; i += 1) {
        tone(ac, dest, when + i * 0.16, { type: 'square', from: i % 2 ? 660 : 880, attack: 0.005, decay: 0.12, peak: 0.12 });
      }
    },
    // Winding a clockwork crown: a ratchet of short clicks that speeds up.
    wind(ac, dest, when) {
      let at = when;
      for (let i = 0; i < 9; i += 1) {
        noise(ac, dest, at, { attack: 0.001, decay: 0.012, peak: 0.35 });
        tone(ac, dest, at, { type: 'square', from: 2600 + 90 * (i % 3), attack: 0.001, decay: 0.012, peak: 0.05 });
        at += 0.1 - i * 0.006;
      }
    },
    thud(ac, dest, when) {
      tone(ac, dest, when, { from: 130, to: 42, attack: 0.003, decay: 0.28, peak: 0.7 });
      noise(ac, dest, when, { smooth: 0.97, attack: 0.002, decay: 0.08, peak: 0.4 });
    },
  };

  const shared = { context: null, master: null, muted: false };

  NX.sfx = {
    names: ['click', 'pop', 'whoosh', 'tick', 'ding', 'success', 'fail', 'alarm', 'wind', 'thud'],
    cues,
    get master() { return shared.master; },
    // Creates the one shared AudioContext and its master gain; call only from a user gesture.
    ensure() {
      if (!shared.context) {
        const Context = root.AudioContext || root.webkitAudioContext;
        if (!Context) return null;
        shared.context = new Context();
        shared.master = shared.context.createGain();
        shared.master.gain.value = shared.muted ? 0 : 1;
        shared.master.connect(shared.context.destination);
      }
      if (shared.context.state === 'suspended') shared.context.resume();
      return shared.context;
    },
    // Plays a cue now on the shared context; does nothing before ensure().
    play(name) {
      if (!shared.context || !cues[name]) return;
      cues[name](shared.context, shared.master, shared.context.currentTime + 0.01);
    },
    setMuted(muted) {
      shared.muted = Boolean(muted);
      if (shared.master) shared.master.gain.value = shared.muted ? 0 : 1;
    },
  };
})(globalThis);
