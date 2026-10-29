# Writing scene.js

`scene.js` is a plain script with no imports. It registers one factory with the player:

```js
NarratedExplainer.scene(function (story, kit) {
  const END = story.timing.end;

  // 1. The model: pure. Same mode and t give the same object. No DOM, no clock, no randomness.
  function stateAt(mode, t) {
    const sent = t >= 0;
    return { t, sent, timeLeft: Math.max(0, 300 - t) };
  }

  let parts;
  return {
    stateAt,
    // 2. Build every node once.
    build(stage) {
      const svg = kit.svg(stage, '0 0 1200 460', 'How the request travels');
      parts = {
        app: kit.box(svg, { x: 20, y: 160, w: 240, h: 120, label: 'App' }),
        line: kit.arrow(svg, { from: [260, 220], to: [520, 220], label: 'call' }),
        request: kit.token(svg, { label: 'request', tone: 'info' }),
        clock: kit.readout(svg, { x: 1180, y: 60, anchor: 'end' }),
      };
    },
    // 3. Draw: only set attributes from state and ctx.
    draw(state, ctx) {
      const trip = ctx.at.id === 'send' ? ctx.motion(1100) : 1;   // travel inside the hold
      parts.request.moveTo(kit.along([[260, 220], [520, 220]], kit.ease.inOut(trip)));
      parts.line.draw(state.sent ? 1 : 0);
      parts.clock.set('Time left: ' + Math.round(state.timeLeft) + ' ms',
        state.timeLeft === 0 ? 'stop' : 'ink');
    },
  };
});
```

## The rules that keep it right

- **Everything visible derives from `stateAt`.** Captions, labels and drawings then agree in
  every mode and at every time, including when the viewer steps backwards.
- **Build once, draw often.** `draw` runs every animation frame. Creating nodes there leaks
  memory and breaks the snapshot tests.
- **Motion inside holds.** `ctx.motion(ms)` returns 0..1 progress since the player arrived at the
  current position, and 1 when paused, stepping, at rest or in reduced motion. Use it for token
  trips, pop-ins and the stopwatch wind so story time can stand still while things move.
- **The at-rest frame** is `stateAt(atRest.mode, atRest.t)` with motion 1. Make it a complete
  picture of the outcome; hide only the playhead (`ctx.at.kind === 'rest'`).
- **Sound cues go in `story.json`.** `ctx.sfx(name)` is for live-only extras; videos and
  snapshots include only the cues in `story.json`.

## ctx

| Field | Meaning |
|---|---|
| `mode`, `t` | Current mode id and story time |
| `at` | `{ kind, index, id }`; `kind` is `rest`, `intro`, `moment` or `between` |
| `motion(ms)` | 0..1 progress of the current arrival's motion (see above) |
| `playing`, `reduced` | Booleans |
| `sfx(name)` | A cue, at most once per arrival, live playback only |

## Kit reference

Tones: `ink`, `ink-2`, `info`, `ok`, `warn`, `stop`, `sunken`, plus explicit `<accent>-fg` and
`<accent>-bg` (for example `ok-bg`). Never write colours; the light and dark palettes come from
the player's stylesheet.

Pure helpers (also usable in tests): `clamp01(x)`, `lerp(a, b, p)`, `ramp(t, from, to)` (0..1),
`along(points, p)` (a point at fraction `p` of a polyline), `ease.in`, `ease.out`, `ease.inOut`,
`ease.outBack`.

| Builder | Options (defaults) | Handle |
|---|---|---|
| `svg(stage, viewBox, label)` | | the `<svg>` element |
| `el(parent, tag, attrs)` | | the element |
| `text(parent, x, y, str, opts)` | `size` 20, `weight` 400, `anchor` start, `tone` ink, `on` (fill tone underneath, picks a readable colour), `halo` | the `<text>` element |
| `box(parent, opts)` | `x`, `y`, `w`, `h`, `label`, `sub`, `tone` | `g`, `center`, `edge(side, f)`, `setTone(t)`, `setStatus(text, tone)` |
| `arrow(parent, opts)` | `from`, `to`, `label`, `tone` ink, `dashed`, `head` true | `show(b)`, `setTone(t)`, `setDashed(b)`, `draw(p)`, `setLabel(s)` |
| `token(parent, opts)` | `label`, `tone` info | `moveTo([x, y])`, `show(b)`, `setTone(t)`, `setLabel(s)` |
| `bubble(parent, opts)` | `x`, `y`, `w`, `h` 44, `text`, `tail` [x, y] | `show(b)`, `pop(p)`, `setText(s)` |
| `queue(parent, opts)` | `x`, `y`, `slots` 4, `slotW` 64, `gap` 8, `h` 56, `title` | `set(items)`; each item `{ label, tone }` or `null` |
| `readout(parent, opts)` | `x`, `y`, `size` 34, `anchor` start | `set(text, tone)` |
| `stopwatch(parent, opts)` | `cx`, `cy`, `r` 56, `max` 60, `unit`, `segments` [{ `to`, `tone`, `label` }], `operator` | `set({ value, total, flash, click, rim })`, `wind(p)`, `press(p)` |
| `figure(parent, opts)` | `x`, `y`, `scale` 1, `tone` info | `reach([x, y])`, `wave(p)` |
| `axis(parent, opts)` | `x0`, `x1`, `y`, `t0`, `t1`, `ticks`, `unit` | `x(t)` |
| `meter(parent, opts)` | `x`, `y`, `w`, `h`, `tone` | `set(p)`, `setTone(t)` |
| `stamp(parent, opts)` | `x`, `y`, `kind` ok or stop, `size` | `show(b)`, `pop(p)` |

To hide an arrow, prefer `draw(0)` over `show(false)`: its label and head manage their own
visibility.

## Patterns

- **Stopwatch intro.** Give the stopwatch one segment per part of the budget. During intro step
  `i`, call `wind(ctx.motion(2000))` while the dial's `value` eases from the previous total to
  the new one, and `press(ctx.motion(2000))` on the start step. During the story, set `value` to
  the time left so the arcs empty.
- **Token trips.** Keep a table of paths per moment id, and in `draw` move the token along the
  path for the current moment with `kit.along(path, kit.ease.inOut(ctx.motion(1100)))`.
- **Speech bubbles.** Show the bubble when the state says so and call `pop(ctx.motion(450))` only
  on the moment it appears; elsewhere `pop(1)`.
- **Modes.** Keep one layout. Let `stateAt` branch on `mode` for values and statuses, never for
  positions of boxes.

## Testing the model

Load `kit.js` and your `scene.js` in Node with `vm.runInContext`, capture the factory through a
stub `NarratedExplainer.scene`, and assert `stateAt` values at the key moments of each mode.
`examples/deadline-race/scene.test.mjs` is a complete example, including a check that drawing
creates no nodes and writes no `NaN`.
