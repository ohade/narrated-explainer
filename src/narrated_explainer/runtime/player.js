// Narrated Explainer player: a pure controller (positions, clock, plan) and a DOM view
// (controls, captions, audio, drawing). See docs/architecture.md, section "Runtime".
(function (root) {
  'use strict';

  const NX = root.NarratedExplainer || (root.NarratedExplainer = {});
  NX.players = NX.players || [];

  const DEFAULT_HOLD_MS = 1600;
  const REDUCED_STEP_MS = 2500;
  const CLIP_GRACE_MS = 1500; // a clip that never reports its end releases after duration + this
  const UNKNOWN_CLIP_MS = 12000; // ... or after this when its duration is unknown
  const PLAN_CLIP_TAIL_MS = 300; // plan(): a hold lasts max(holdMs, clip duration + this)
  const LANDING_EPSILON = 1e-9;

  const DEFAULT_LABELS = {
    play: 'Play', pause: 'Pause', restart: 'Restart', prev: 'Previous', next: 'Next',
    voiceOn: 'Voice: on', voiceOff: 'Voice: off', soundOn: 'Sound: on', soundOff: 'Sound: off',
    speed: 'Speed', mode: 'Mode', transcript: 'Transcript', fullscreen: 'Fullscreen',
    themeAuto: 'Theme: Auto', themeLight: 'Theme: Light', themeDark: 'Theme: Dark',
  };
  const THEMES = ['auto', 'light', 'dark'];
  const THEME_KEY = 'narrated-explainer-theme';

  const finite = (v, fallback) => (typeof v === 'number' && isFinite(v) ? v : fallback);
  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  function modeList(story) {
    return story.modes && story.modes.length ? story.modes : [{ id: 'main', label: 'Main' }];
  }

  // Intro steps in order, then the moments of `mode` sorted by t (stable for equal t).
  function buildPositions(story, mode) {
    const intro = (story.intro || []).map((s) => ({
      kind: 'intro', id: s.id, t: 0, caption: s.caption || '', sfx: s.sfx || null, holdMs: s.holdMs,
    }));
    const moments = (story.moments || [])
      .filter((m) => !m.modes || m.modes.indexOf(mode) !== -1)
      .map((m) => ({ kind: 'moment', id: m.id, t: m.t, caption: m.caption || '', sfx: m.sfx || null, holdMs: m.holdMs }))
      .sort((a, b) => a.t - b.t);
    return intro.concat(moments).map((p, index) => Object.assign(p, { index }));
  }

  // The index of the last word that has started at `time` seconds, or -1.
  function wordIndexAt(words, time) {
    let found = -1;
    for (let i = 0; i < (words || []).length; i += 1) {
      if (words[i][0] <= time) found = i;
      else break;
    }
    return found;
  }

  const KEY_ACTIONS = {
    ' ': 'toggle', Spacebar: 'toggle', k: 'toggle', ArrowLeft: 'prev', ArrowRight: 'next',
    r: 'restart', v: 'voice', s: 'sound', t: 'transcript', f: 'fullscreen',
  };

  // Maps a keydown to an action name, or null. Digits 1-9 give `mode:<index>`.
  function keyAction(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return null;
    const key = event.key || '';
    if (/^[1-9]$/.test(key)) return 'mode:' + (Number(key) - 1);
    const lower = key.length === 1 ? key.toLowerCase() : key;
    return Object.prototype.hasOwnProperty.call(KEY_ACTIONS, lower) ? KEY_ACTIONS[lower] : null;
  }

  // ---------------------------------------------------------------------------------------------
  // Controller: no DOM, no clock. Every method that needs time takes `now` in real milliseconds.
  // `clipDurations` maps a position id to its clip length in seconds (null: clip of unknown length).
  function createController(story, clipDurations, options) {
    const durations = clipDurations || {};
    const timing = story.timing || {};
    const end = finite(timing.end, 0);
    const msPerUnit = finite(timing.realMsPerUnit, 1);
    const baseHoldMs = finite(timing.holdMs, DEFAULT_HOLD_MS);
    const modeIds = modeList(story).map((m) => m.id);
    const rest = story.atRest || {};
    const cache = {};
    const listFor = (mode) => cache[mode] || (cache[mode] = buildPositions(story, mode));
    const hasClip = (id) => Object.prototype.hasOwnProperty.call(durations, id);
    const clipMs = (id) => {
      const seconds = durations[id];
      return typeof seconds === 'number' && isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
    };

    const restMode = modeIds.indexOf(rest.mode) !== -1 ? rest.mode : modeIds[0];
    const s = {
      mode: restMode, list: listFor(restMode), t: finite(rest.t, end),
      atRest: true, finished: false, playing: false, onPosition: false, stepped: false, index: -1,
      arrivedAt: -Infinity, holdUntil: 0, releaseAt: 0, clipPending: false, last: 0,
      speed: 1, voiceOn: true, reduced: Boolean(options && options.reduced), sfxPlayed: {},
    };
    let cue = { seq: 0, id: null, clip: false, sfx: null };

    function setCue(p, sfx) {
      cue = { seq: cue.seq + 1, id: p.id, clip: s.voiceOn && hasClip(p.id), sfx };
      s.sfxPlayed = {};
    }

    function arrive(now, i) {
      const p = s.list[i];
      s.index = i;
      s.onPosition = true;
      s.t = p.t;
      s.stepped = false;
      s.arrivedAt = now;
      s.last = now;
      s.holdUntil = now + (s.reduced ? REDUCED_STEP_MS : finite(p.holdMs, baseHoldMs));
      setCue(p, p.sfx);
      s.clipPending = cue.clip;
      const ms = cue.clip ? clipMs(p.id) : null;
      s.releaseAt = !cue.clip ? now : now + (ms === null ? UNKNOWN_CLIP_MS : ms + CLIP_GRACE_MS);
    }

    function finish() {
      s.t = end;
      s.playing = false;
      s.onPosition = false;
      s.finished = true;
      s.index = s.list.length - 1;
    }

    function leave(now) {
      const next = s.index + 1;
      if (next < s.list.length) {
        if (s.reduced || s.list[next].t <= s.t) arrive(now, next);
        else { s.onPosition = false; s.last = now; }
      } else if (s.reduced || s.t >= end) {
        finish();
      } else {
        s.onPosition = false;
        s.last = now;
      }
    }

    function travel(now) {
      const elapsed = Math.max(0, now - s.last);
      s.last = now;
      const next = s.index + 1;
      const target = next < s.list.length ? s.list[next].t : end;
      const t = s.reduced ? target : s.t + elapsed * s.speed / msPerUnit;
      if (t < target - LANDING_EPSILON) { s.t = t; return; }
      if (next < s.list.length) arrive(now, next);
      else finish();
    }

    function start(now) {
      s.atRest = false;
      s.finished = false;
      s.playing = true;
      s.last = now;
      if (!s.list.length) { finish(); return; }
      if (s.list[0].kind === 'intro' || s.list[0].t <= 0) { arrive(now, 0); return; }
      s.index = -1;
      s.onPosition = false;
      s.stepped = false;
      s.t = 0;
      s.arrivedAt = -Infinity;
      s.sfxPlayed = {};
    }

    function jump(i, now) {
      if (!s.list.length) return;
      const index = Math.min(s.list.length - 1, Math.max(0, i));
      const p = s.list[index];
      s.playing = false;
      s.atRest = false;
      s.finished = false;
      s.index = index;
      s.onPosition = true;
      s.stepped = true;
      s.clipPending = false;
      s.t = p.t;
      s.last = now;
      setCue(p, null);
    }

    // The last position at or before story time t that the player has passed.
    function lastPassed(t) {
      let found = -1;
      for (let i = 0; i < s.list.length; i += 1) {
        if (s.list[i].kind === 'intro' || s.list[i].t < t) found = i;
        else break;
      }
      return found;
    }

    function at() {
      if (s.atRest) return { kind: 'rest', index: -1, id: null };
      if (s.onPosition) return { kind: s.list[s.index].kind, index: s.index, id: s.list[s.index].id };
      return { kind: 'between', index: s.index, id: null };
    }

    function caption() {
      if (s.atRest) return rest.caption || '';
      return s.index >= 0 ? s.list[s.index].caption : '';
    }

    const api = {
      get cue() { return cue; },
      modes: () => modeIds.slice(),
      positions(mode) {
        return listFor(mode || s.mode).map((p) => ({ kind: p.kind, index: p.index, id: p.id, t: p.t, caption: p.caption }));
      },
      snapshot() {
        return {
          mode: s.mode, t: s.t, at: at(), caption: caption(), playing: s.playing, reduced: s.reduced,
          speed: s.speed, voiceOn: s.voiceOn, atRest: s.atRest, finished: s.finished, stepped: s.stepped,
        };
      },
      play(now) {
        if (s.playing) return;
        if (s.atRest || s.finished) { start(now); return; }
        s.playing = true;
        s.last = now;
        if (s.onPosition) arrive(now, s.index);
      },
      pause(now) {
        s.playing = false;
        s.last = now;
      },
      restart(now) {
        s.playing = false;
        start(now);
      },
      step(direction, now) {
        if (s.finished && direction > 0) return;
        if (s.atRest) jump(direction > 0 ? 0 : s.list.length - 1, now);
        else if (s.onPosition) jump(s.index + direction, now);
        else jump(direction > 0 ? s.index + 1 : s.index, now);
      },
      jump,
      tick(now) {
        if (!s.playing) { s.last = now; return; }
        if (!s.onPosition) { travel(now); return; }
        if (now >= s.holdUntil && (!s.clipPending || now >= s.releaseAt)) leave(now);
        else s.last = now;
      },
      // `seq` is the cue seq of the arrival whose clip ended; a late end of an earlier clip is
      // ignored. Without `seq` the current clip ends.
      clipEnded(seq) {
        if (seq !== undefined && seq !== cue.seq) return;
        s.clipPending = false;
      },
      // The earliest real time at which tick() can change the state on its own.
      nextEventAt() {
        if (!s.playing) return Infinity;
        if (s.onPosition) return s.clipPending ? Math.max(s.holdUntil, s.releaseAt) : s.holdUntil;
        if (s.reduced) return s.last;
        const next = s.index + 1;
        const target = next < s.list.length ? s.list[next].t : end;
        return s.last + (target - s.t) * msPerUnit / s.speed;
      },
      setMode(mode, now) {
        if (modeIds.indexOf(mode) === -1 || mode === s.mode) return;
        const previous = s.onPosition ? s.list[s.index] : null;
        s.mode = mode;
        s.list = listFor(mode);
        s.clipPending = false;
        if (s.atRest) return;
        if (s.finished) { s.index = s.list.length - 1; return; }
        if (previous) {
          const same = previous.kind === 'intro' ? s.index : s.list.findIndex((p) => p.id === previous.id);
          if (same !== -1) { s.index = same; return; }
        }
        s.onPosition = false;
        s.index = lastPassed(s.t);
        s.last = now;
      },
      setSpeed(speed) {
        if (finite(speed, 0) > 0) s.speed = speed;
      },
      setVoice(on) {
        s.voiceOn = Boolean(on);
        if (!s.voiceOn) s.clipPending = false;
      },
      setReduced(reduced) {
        s.reduced = Boolean(reduced);
      },
      motion(now, ms) {
        if (!s.playing || s.atRest || s.stepped || s.reduced || !(ms > 0)) return 1;
        return clamp01((now - s.arrivedAt) / ms);
      },
      sfxOnce(name) {
        if (!s.playing || s.sfxPlayed[name]) return false;
        s.sfxPlayed[name] = true;
        return true;
      },
      plan(mode) {
        const segments = [];
        let hold = null;
        let move = null;
        const { now } = simulate(mode, Infinity, (time, sim) => {
          const snap = sim.snapshot();
          const onPosition = snap.playing && snap.at.kind !== 'between';
          if (hold && !(onPosition && sim.cue.seq === hold.seq)) { hold.segment.end = time; hold = null; }
          if (move && (snap.at.kind !== 'between' || !snap.playing)) { move.end = time; move.tTo = snap.t; move = null; }
          if (!hold && onPosition) {
            const segment = { kind: 'hold', start: time, end: time, at: snap.at, clipId: sim.cue.clip ? sim.cue.id : null, sfx: sim.cue.sfx };
            hold = { seq: sim.cue.seq, segment };
            segments.push(segment);
          }
          if (!move && snap.playing && snap.at.kind === 'between') {
            move = { kind: 'travel', start: time, end: time, tFrom: snap.t, tTo: snap.t };
            segments.push(move);
          }
        });
        return { duration: now, segments };
      },
      // The frame at `ms` on the plan: a snapshot, motion from plan time, and `clipTime`, the
      // seconds into the narration clip being spoken at that frame (null when none is).
      renderAt(mode, ms) {
        const { sim, cueSeq, cueAt } = simulate(mode, ms, () => {});
        sim.tick(ms);
        const snap = sim.snapshot();
        const elapsed = ms - (sim.cue.seq === cueSeq ? cueAt : ms);
        const clipLengthMs = sim.cue.clip ? clipMs(sim.cue.id) : null;
        const speaking = sim.cue.clip && snap.playing && snap.at.kind !== 'between' && (clipLengthMs === null || elapsed < clipLengthMs);
        return Object.assign(snap, { motion: (motionMs) => sim.motion(ms, motionMs), clipTime: speaking ? elapsed / 1000 : null });
      },
    };

    // Plays `mode` from the start at speed 1 with the voice on, on a fresh controller, ticking at
    // exact event times up to `untilMs`; each clip "ends" at its duration plus PLAN_CLIP_TAIL_MS.
    function simulate(mode, untilMs, onStep) {
      const sim = createController(story, durations, { reduced: false });
      sim.setMode(mode, 0);
      let now = 0;
      let seen = 0;
      let seenAt = 0;
      let clipEnd = null;
      const observe = () => {
        if (sim.cue.seq !== seen) {
          seen = sim.cue.seq;
          seenAt = now;
          const ms = sim.cue.clip ? clipMs(sim.cue.id) : null;
          clipEnd = ms === null ? null : now + ms + PLAN_CLIP_TAIL_MS;
        }
        onStep(now, sim);
      };
      sim.play(0);
      observe();
      const limit = 10 * (story.intro || []).length + 10 * (story.moments || []).length + 10;
      for (let guard = 0; sim.snapshot().playing && guard < limit; guard += 1) {
        const next = Math.min(clipEnd === null ? Infinity : clipEnd, sim.nextEventAt());
        if (next > untilMs || next === Infinity) break;
        now = next;
        if (clipEnd !== null && clipEnd <= now) { clipEnd = null; sim.clipEnded(seen); }
        sim.tick(now);
        observe();
      }
      return { sim, now, cueSeq: seen, cueAt: seenAt };
    }

    return api;
  }

  // ---------------------------------------------------------------------------------------------
  // View helpers.
  function h(doc, tag, attrs, text) {
    const el = doc.createElement(tag);
    Object.keys(attrs || {}).forEach((k) => el.setAttribute(k, attrs[k]));
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function isTypingTarget(target) {
    if (!target || !target.tagName) return false;
    const tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
  }

  function base64Bytes(dataUri) {
    const comma = dataUri.indexOf(',');
    if (dataUri.slice(0, 5) !== 'data:' || dataUri.slice(0, comma).indexOf(';base64') === -1) {
      throw new Error('soundtrack needs base64 data: clips, got ' + dataUri.slice(0, 30));
    }
    const binary = root.atob(dataUri.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  // 16-bit PCM mono WAV, base64.
  function wavBase64(buffer) {
    const samples = buffer.getChannelData(0);
    const bytes = new Uint8Array(44 + samples.length * 2);
    const view = new DataView(bytes.buffer);
    const text = (offset, str) => { for (let i = 0; i < str.length; i += 1) bytes[offset + i] = str.charCodeAt(i); };
    text(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    text(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i += 1) {
      view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    return root.btoa(binary);
  }

  // Narration clips and sound cues placed on `plan`, mixed offline into a WAV (no DOM).
  function renderSoundtrack(plan, clips, sfx) {
    const sampleRate = 48000;
    const Offline = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    const ac = new Offline(1, Math.max(1, Math.ceil(plan.duration / 1000 * sampleRate)), sampleRate);
    const out = ac.createGain();
    out.connect(ac.destination);
    const decodes = [];
    plan.segments.filter((seg) => seg.kind === 'hold').forEach((seg) => {
      if (seg.sfx && sfx && sfx.cues[seg.sfx]) sfx.cues[seg.sfx](ac, out, seg.start / 1000);
      if (!seg.clipId || !clips[seg.clipId]) return;
      decodes.push(ac.decodeAudioData(base64Bytes(clips[seg.clipId].src)).then((buffer) => {
        const src = ac.createBufferSource();
        src.buffer = buffer;
        src.connect(out);
        src.start(seg.start / 1000);
      }));
    });
    return Promise.all(decodes)
      .then(() => ac.startRendering())
      .then((buffer) => ({ sampleRate, wavBase64: wavBase64(buffer) }));
  }

  // Narration: one reusable Audio element made on the first user gesture, clip play and stop, the
  // clip-end report to the controller, and the index of the word being spoken. `onWord` is called
  // whenever that index may have changed.
  function createVoice(narration, controller) {
    const clips = narration ? narration.clips || {} : {};
    const state = { audio: null, seq: 0, id: null };
    const voice = {
      onWord: () => {},
      unlock() {
        if (state.audio || !narration) return;
        state.audio = new root.Audio();
        const ended = () => {
          if (state.seq) controller.clipEnded(state.seq);
          state.seq = 0;
          voice.onWord();
        };
        state.audio.addEventListener('ended', ended);
        state.audio.addEventListener('error', ended);
        state.audio.addEventListener('timeupdate', () => { if (!controller.snapshot().playing) voice.onWord(); });
      },
      play(id, seq) {
        const clip = clips[id];
        if (!state.audio || !clip || !clip.src) { controller.clipEnded(seq); return; }
        state.seq = seq;
        state.id = id;
        state.audio.src = clip.src;
        const started = state.audio.play();
        if (started && started.catch) {
          started.catch(() => { if (state.seq === seq) { state.seq = 0; controller.clipEnded(seq); } });
        }
      },
      stop() {
        state.seq = 0;
        if (state.audio) {
          state.audio.pause();
          state.audio.currentTime = 0;
        }
        voice.onWord();
      },
      word() {
        const clip = state.seq && clips[state.id];
        return clip && state.audio ? wordIndexAt(clip.words, state.audio.currentTime) : -1;
      },
    };
    return voice;
  }

  let documentKeysInstalled = false;
  function installDocumentKeys(doc) {
    if (documentKeysInstalled) return;
    documentKeysInstalled = true;
    doc.addEventListener('keydown', (event) => {
      if (NX.players.length !== 1) return;
      const player = NX.players[0];
      if (!player.figure.contains(event.target)) player._onKey(event);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // View: builds the controls inside `figure` and drives the controller from the browser clock.
  function mount(figure, options) {
    const factory = NX._scene;
    if (typeof factory !== 'function') throw new Error('NarratedExplainer.scene(factory) must run before mount()');
    const story = options.story;
    const narration = options.narration || null;
    const clips = narration ? narration.clips || {} : {};
    const durations = {};
    Object.keys(clips).forEach((id) => { durations[id] = typeof clips[id].duration === 'number' ? clips[id].duration : null; });
    const doc = figure.ownerDocument;
    const reducedQuery = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const c = createController(story, durations, { reduced: Boolean(reducedQuery && reducedQuery.matches) });
    const voice = createVoice(narration, c);
    const scene = factory(story, NX.kit || {});
    const labels = Object.assign({}, DEFAULT_LABELS, story.labels || {});
    const modes = modeList(story);
    const speeds = (story.timing && story.timing.speeds) || [0.5, 1];
    const uid = 'nx-' + (story.id || 'story') + '-' + (NX.players.length + 1);
    const ui = { soundOn: true, frameRequest: 0, lastCue: 0, captionKey: '', wordSpans: [], word: -1 };

    figure.classList.add('nx');
    figure.setAttribute('tabindex', '-1');
    if (story.lang) figure.setAttribute('lang', story.lang);

    // DOM ------------------------------------------------------------------------------------
    const bar = figure.appendChild(h(doc, 'div', { class: 'nx-bar' }));
    const controls = bar.appendChild(h(doc, 'div', { class: 'nx-controls' }));
    const button = (parent, cls, text, attrs) => {
      const b = parent.appendChild(h(doc, 'button', Object.assign({ type: 'button', class: cls }, attrs || {}), text));
      return b;
    };
    const modeButtons = [];
    if (modes.length > 1) {
      const group = controls.appendChild(h(doc, 'div', { class: 'nx-group', role: 'group', 'aria-label': labels.mode }));
      modes.forEach((m) => {
        const b = button(group, 'nx-mode', m.label || m.id, { 'aria-pressed': 'false' });
        b.addEventListener('click', () => selectMode(m.id));
        modeButtons.push([m.id, b]);
      });
    }
    const playButton = button(controls, 'nx-play', labels.play);
    const restartButton = button(controls, 'nx-restart', labels.restart);
    const prevButton = button(controls, 'nx-prev', labels.prev);
    const nextButton = button(controls, 'nx-next', labels.next);
    const speedGroup = controls.appendChild(h(doc, 'div', { class: 'nx-group', role: 'group', 'aria-label': labels.speed }));
    const speedButtons = speeds.map((v) => {
      const b = button(speedGroup, 'nx-speed', v + '×', { 'aria-pressed': String(v === 1) });
      b.addEventListener('click', () => { c.setSpeed(v); renderControls(c.snapshot()); });
      return [v, b];
    });
    const voiceButton = button(controls, 'nx-voice', labels.voiceOn, { 'aria-pressed': 'true' });
    const voiceName = controls.appendChild(h(doc, 'span', { class: 'nx-voice-name' }, narration ? narration.label || '' : ''));
    if (!narration) { voiceButton.hidden = true; voiceName.hidden = true; }
    const soundButton = button(controls, 'nx-sound', labels.soundOn, { 'aria-pressed': 'true' });
    const transcriptButton = button(controls, 'nx-transcript-toggle', labels.transcript, { 'aria-expanded': 'false', 'aria-controls': uid + '-transcript' });
    const fullscreenButton = button(controls, 'nx-fullscreen', labels.fullscreen);
    if (typeof figure.requestFullscreen !== 'function') fullscreenButton.hidden = true;
    const themeButton = button(controls, 'nx-theme', labels.themeAuto);
    const progress = bar.appendChild(h(doc, 'div', { class: 'nx-progress' }));
    const stage = figure.appendChild(h(doc, 'div', { class: 'nx-stage' }));
    // The figcaption is the figure's last child (HTML content model), so the transcript comes first.
    const transcript = figure.appendChild(h(doc, 'div', { class: 'nx-transcript', id: uid + '-transcript' }));
    transcript.hidden = true;
    const transcriptList = transcript.appendChild(h(doc, 'ol', {}));
    const captionEl = figure.appendChild(h(doc, 'figcaption', { class: 'nx-caption', 'aria-live': 'polite', id: uid + '-caption' }));
    scene.build(stage);

    let markers = [];
    let transcriptItems = [];
    function buildLists() {
      progress.textContent = '';
      transcriptList.textContent = '';
      const list = c.positions();
      markers = list.map((p, i) => {
        const b = button(progress, 'nx-marker nx-marker-' + p.kind, '', { 'aria-label': (i + 1) + ' / ' + list.length + ': ' + p.caption });
        b.addEventListener('click', () => jumpTo(i));
        return b;
      });
      transcriptItems = list.map((p, i) => {
        const li = transcriptList.appendChild(h(doc, 'li', {}));
        const b = button(li, 'nx-transcript-item', p.caption);
        b.addEventListener('click', () => jumpTo(i));
        return b;
      });
    }

    // Audio ----------------------------------------------------------------------------------
    // Called from every user gesture: the shared AudioContext and the Audio element exist only after one.
    function unlock() {
      if (NX.sfx) { NX.sfx.ensure(); NX.sfx.setMuted(!ui.soundOn); }
      voice.unlock();
    }

    function stopClip() { voice.stop(); }

    // Starts the narration and cue of a new arrival or step, once.
    function handleCue() {
      const cue = c.cue;
      if (cue.seq === ui.lastCue) return;
      ui.lastCue = cue.seq;
      stopClip();
      if (cue.clip) voice.play(cue.id, cue.seq);
      if (cue.sfx && ui.soundOn && NX.sfx) NX.sfx.play(cue.sfx);
    }

    // Drawing --------------------------------------------------------------------------------
    function renderCaption(snap) {
      const key = snap.mode + '|' + snap.caption;
      if (key === ui.captionKey) return;
      ui.captionKey = key;
      captionEl.textContent = '';
      ui.wordSpans = snap.caption.split(/\s+/).filter(Boolean).map((word, i) => {
        if (i) captionEl.appendChild(doc.createTextNode(' '));
        return captionEl.appendChild(h(doc, 'span', { class: 'nx-word' }, word));
      });
      ui.word = -1;
      fit();
    }

    function renderWord(index) {
      if (index === ui.word) return;
      if (ui.wordSpans[ui.word]) ui.wordSpans[ui.word].classList.remove('nx-word-on');
      if (ui.wordSpans[index]) ui.wordSpans[index].classList.add('nx-word-on');
      ui.word = index;
    }
    voice.onWord = () => renderWord(voice.word());

    function renderControls(snap) {
      playButton.textContent = snap.playing ? labels.pause : labels.play;
      modeButtons.forEach(([id, b]) => b.setAttribute('aria-pressed', String(id === snap.mode)));
      speedButtons.forEach(([v, b]) => b.setAttribute('aria-pressed', String(v === snap.speed)));
      voiceButton.textContent = snap.voiceOn ? labels.voiceOn : labels.voiceOff;
      voiceButton.setAttribute('aria-pressed', String(snap.voiceOn));
      soundButton.textContent = ui.soundOn ? labels.soundOn : labels.soundOff;
      soundButton.setAttribute('aria-pressed', String(ui.soundOn));
      const current = snap.atRest ? -1 : snap.at.index;
      const exact = snap.at.kind === 'intro' || snap.at.kind === 'moment';
      markers.forEach((b, i) => {
        b.classList.toggle('nx-passed', i <= current);
        if (exact && i === current) b.setAttribute('aria-current', 'step');
        else b.removeAttribute('aria-current');
      });
      transcriptItems.forEach((b, i) => {
        if (exact && i === current) b.setAttribute('aria-current', 'step');
        else b.removeAttribute('aria-current');
      });
    }

    // Draws `snap` (live or a tool frame) with its controls, caption and highlighted word.
    function render(snap, motion, sfx, word) {
      scene.draw(scene.stateAt(snap.mode, snap.t), {
        mode: snap.mode, t: snap.t, at: snap.at, playing: snap.playing, reduced: snap.reduced, motion, sfx,
      });
      renderCaption(snap);
      renderControls(snap);
      renderWord(word);
    }

    function renderLive(now) {
      render(c.snapshot(), (ms) => c.motion(now, ms), (name) => {
        if (ui.soundOn && NX.sfx && c.sfxOnce(name)) NX.sfx.play(name);
      }, voice.word());
    }

    // Playback loop: animation frames only while playing.
    function frame(now) {
      ui.frameRequest = 0;
      c.tick(now);
      handleCue();
      renderLive(now);
      if (c.snapshot().playing) ui.frameRequest = root.requestAnimationFrame(frame);
    }

    function loop() {
      if (!ui.frameRequest && c.snapshot().playing) ui.frameRequest = root.requestAnimationFrame(frame);
    }

    const clock = () => root.performance.now();

    function update() {
      handleCue();
      renderLive(clock());
      loop();
    }

    // Actions ----------------------------------------------------------------------------------
    function togglePlay() {
      unlock();
      if (c.snapshot().playing) { c.pause(clock()); stopClip(); } else c.play(clock());
      update();
    }
    function restart() { unlock(); stopClip(); c.restart(clock()); update(); }
    function step(direction) { unlock(); stopClip(); c.step(direction, clock()); update(); }
    function jumpTo(index) { unlock(); stopClip(); c.jump(index, clock()); update(); }
    function selectMode(id) {
      unlock();
      if (id === c.snapshot().mode) return; // the controller ignores it; keep the clip playing
      stopClip();
      c.setMode(id, clock());
      buildLists();
      update();
    }
    function toggleVoice() {
      unlock();
      c.setVoice(!c.snapshot().voiceOn);
      if (!c.snapshot().voiceOn) stopClip();
      renderControls(c.snapshot());
    }
    function toggleSound() {
      ui.soundOn = !ui.soundOn;
      unlock();
      renderControls(c.snapshot());
    }
    function toggleTranscript() {
      transcript.hidden = !transcript.hidden;
      transcriptButton.setAttribute('aria-expanded', String(!transcript.hidden));
      fit();
    }
    // Theme: Auto follows the operating system; a choice is remembered when storage allows it.
    const themed = doc.body && doc.body.classList.contains('nx') ? [figure, doc.body] : [figure];
    function applyTheme(theme) {
      ui.theme = theme;
      themed.forEach((el) => {
        if (theme === 'auto') el.removeAttribute('data-nx-theme');
        else el.setAttribute('data-nx-theme', theme);
      });
      themeButton.textContent = labels['theme' + theme[0].toUpperCase() + theme.slice(1)];
    }
    function cycleTheme() {
      applyTheme(THEMES[(THEMES.indexOf(ui.theme) + 1) % THEMES.length]);
      try { root.localStorage.setItem(THEME_KEY, ui.theme); } catch (error) { /* playback does not need storage */ }
    }
    let storedTheme = null;
    try { storedTheme = root.localStorage.getItem(THEME_KEY); } catch (error) { /* no storage: Auto */ }
    applyTheme(THEMES.indexOf(storedTheme) === -1 ? 'auto' : storedTheme);

    // Fit: with the figure's top at the window's top, the stage keeps its aspect ratio and narrows
    // until everything above and below it also fits the window height.
    function fit() {
      if (!root.innerHeight || typeof stage.getBoundingClientRect !== 'function') return;
      const box = stage.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const outer = figure.getBoundingClientRect();
      const free = root.innerHeight - (box.top - outer.top) - (outer.bottom - box.bottom);
      stage.style.maxWidth = Math.max(0, Math.floor(free * box.width / box.height)) + 'px';
    }
    if (typeof root.addEventListener === 'function') root.addEventListener('resize', fit);

    function toggleFullscreen() {
      if (doc.fullscreenElement === figure) doc.exitFullscreen();
      else if (typeof figure.requestFullscreen === 'function') figure.requestFullscreen();
    }

    playButton.addEventListener('click', togglePlay);
    restartButton.addEventListener('click', restart);
    prevButton.addEventListener('click', () => step(-1));
    nextButton.addEventListener('click', () => step(1));
    voiceButton.addEventListener('click', toggleVoice);
    soundButton.addEventListener('click', toggleSound);
    transcriptButton.addEventListener('click', toggleTranscript);
    fullscreenButton.addEventListener('click', toggleFullscreen);
    themeButton.addEventListener('click', cycleTheme);
    if (reducedQuery && reducedQuery.addEventListener) {
      reducedQuery.addEventListener('change', () => { c.setReduced(reducedQuery.matches); renderLive(clock()); });
    }

    const KEY_HANDLERS = {
      toggle: togglePlay, prev: () => step(-1), next: () => step(1), restart, voice: () => { if (narration) toggleVoice(); },
      sound: toggleSound, transcript: toggleTranscript, fullscreen: toggleFullscreen,
    };

    function onKey(event) {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      const action = keyAction(event);
      if (!action) return;
      // Space on a focused button already clicks it.
      if (action === 'toggle' && event.key === ' ' && event.target && event.target.tagName === 'BUTTON') return;
      if (action.slice(0, 5) === 'mode:') {
        const m = modes[Number(action.slice(5))];
        if (!m || modes.length < 2) return;
        selectMode(m.id);
      } else {
        KEY_HANDLERS[action]();
      }
      event.preventDefault();
    }
    figure.addEventListener('keydown', onKey);
    installDocumentKeys(doc);

    // Tool API -------------------------------------------------------------------------------
    // Stops playback silently and shows `mode`'s markers and transcript, for goto and renderAt.
    function showMode(mode) {
      c.pause(clock());
      stopClip();
      if (ui.frameRequest) { root.cancelAnimationFrame(ui.frameRequest); ui.frameRequest = 0; }
      c.setMode(mode, clock());
      buildLists();
    }

    const player = {
      figure,
      story,
      _onKey: onKey,
      positions: (mode) => c.positions(mode),
      goto(mode, index) {
        showMode(mode);
        c.jump(index, clock());
        ui.lastCue = c.cue.seq; // draw only: no narration, no cue
        renderLive(clock());
      },
      plan: (mode) => c.plan(mode),
      renderAt(mode, ms) {
        showMode(mode);
        const f = c.renderAt(mode, ms);
        const words = f.clipTime === null ? null : (clips[f.at.id] || {}).words;
        render(f, f.motion, () => {}, words ? wordIndexAt(words, f.clipTime) : -1);
      },
      soundtrack: (mode) => renderSoundtrack(c.plan(mode), clips, NX.sfx),
    };

    buildLists();
    renderLive(clock());
    NX.players.push(player);
    return player;
  }

  NX.scene = function (factory) { NX._scene = factory; };
  NX.mount = mount;
  NX._createController = createController;
  NX._wordIndexAt = wordIndexAt;
  NX._keyAction = keyAction;
})(globalThis);
