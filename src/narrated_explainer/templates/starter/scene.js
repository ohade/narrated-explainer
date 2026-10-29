// Starter scene: a parcel travels from a shop, through a sorting centre, to a home before a
// 48-hour deadline. Copy this folder, then change story.json (the words) and this file (the
// drawing). The pattern has three parts:
//   stateAt(mode, t)  pure: works out what is true at story time t. No DOM, no clock, no random.
//   build(stage)      runs once: creates every SVG node through the kit and keeps the handles.
//   draw(state, ctx)  runs every frame: only reads state and ctx and calls handle setters.
NarratedExplainer.scene(function (story, kit) {
  const DUE = 48; // hours promised
  const ARRIVE = 40; // the moment "delivered" in story.json
  const SLOT_X = 451; // centre of the first queue slot; slots are 98 apart
  const SLOT_Y = 358;
  const PICKUP_PATH = [[130, 392], [230, 370], [380, 370], [SLOT_X, SLOT_Y]];
  const DRIVE_PATH = [[SLOT_X + 3 * 98, SLOT_Y], [820, 370], [970, 370], [1070, 392]];

  // Everything here depends only on t, so the player can jump anywhere and get the same picture.
  // Times between moments are part of the story too: the parcel moves while time runs.
  function stateAt(mode, t) {
    const slot = 3 * kit.ramp(t, 12, 21); // 0 is the back of the line, 3 the front
    let stage = 'courier';
    if (t >= 12) stage = 'line';
    if (t >= 22) stage = 'front';
    if (t >= 30) stage = 'van';
    if (t >= ARRIVE) stage = 'home';
    return {
      t,
      stage,
      left: DUE - Math.min(t, ARRIVE), // the clock stops when the parcel arrives
      pickup: kit.ramp(t, 0, 12),
      slot,
      ahead: 3 - Math.ceil(slot),
      drive: kit.ramp(t, 30, 40),
    };
  }

  let parts; // the handles, filled by build

  return {
    stateAt,

    build(stage) {
      const svg = kit.svg(stage, '0 0 1200 520', 'A parcel travels from a shop through a sorting centre to a home');
      parts = {
        watch: kit.stopwatch(svg, {
          cx: 120, cy: 150, max: DUE, unit: 'h', operator: true,
          segments: [{ to: 12, tone: 'warn', label: 'Last 12 hours' }, { to: DUE, tone: 'info', label: 'Time left' }],
        }),
        readout: kit.readout(svg, { x: 1170, y: 70, anchor: 'end' }),
        shop: kit.box(svg, { x: 30, y: 300, w: 200, h: 150, label: 'Shop', sub: 'Sender' }),
        centre: kit.box(svg, { x: 380, y: 260, w: 440, h: 220, label: 'Sorting centre' }),
        home: kit.box(svg, { x: 970, y: 300, w: 200, h: 150, label: 'Home', sub: 'Receiver' }),
        road1: kit.arrow(svg, { from: [230, 370], to: [380, 370], label: 'Courier' }),
        road2: kit.arrow(svg, { from: [820, 370], to: [970, 370], label: 'Van', dashed: true }),
        line: kit.queue(svg, { x: 405, y: 330, slots: 4, slotW: 92, gap: 6, title: 'Waiting line' }),
        bubble: kit.bubble(svg, { x: 640, y: 206, w: 250, text: 'Van 7, please!', tail: [745, 326] }),
        stamp: kit.stamp(svg, { x: 1150, y: 300, kind: 'ok' }),
        parcel: kit.token(svg, { label: 'Parcel', tone: 'info' }),
      };
    },

    draw(s, ctx) {
      const intro = ctx.at.kind === 'intro';
      // ctx.motion(ms) runs 0..1 after arriving at a step, for movement inside the hold.
      // It is 1 when paused or stepping, so the picture always ends in its final pose.
      // Sound cues belong in story.json ("sfx" on a step), because snapshots and videos play only
      // those. ctx.sfx(name) is for live-only extras: it plays once per arrival, in the browser.
      const fresh = (id, ms) => (ctx.at.id === id ? ctx.motion(ms) : 1);

      // The intro winds the stopwatch to 48 hours, then presses its crown to start it.
      if (intro && ctx.at.index === 0) {
        const m = ctx.motion(2000);
        const wound = kit.ease.inOut(m);
        parts.watch.wind(m);
        parts.watch.set({ value: DUE * wound, total: wound >= 0.5 ? DUE : 0 });
      } else {
        const m = intro ? ctx.motion(1600) : 1;
        parts.watch.press(m);
        parts.watch.set({ value: s.left, total: DUE });
      }

      const home = s.stage === 'home';
      if (home) parts.readout.set(s.left + ' h to spare', 'ok');
      else parts.readout.set(Math.ceil(s.left) + ' h left', s.left <= 12 ? 'warn' : 'ink');

      // The parcel: along the courier's road, then forward in the line, then on the van.
      let parcelAt = kit.along(PICKUP_PATH, kit.ease.inOut(s.pickup));
      if (s.stage === 'line' || s.stage === 'front') parcelAt = [SLOT_X + s.slot * 98, SLOT_Y];
      if (s.stage === 'van' || home) parcelAt = kit.along(DRIVE_PATH, kit.ease.inOut(s.drive));
      parts.parcel.moveTo(parcelAt);

      // Other parcels wait ahead of ours, at the front (right-hand) end of the line.
      const waiting = s.stage === 'courier' || s.stage === 'line';
      parts.line.set([0, 1, 2, 3].map((i) => (waiting && i >= 4 - s.ahead ? { label: '', tone: 'ink-2' } : null)));

      parts.road1.draw(intro ? 0 : fresh('pickup', 900));
      parts.road2.draw(s.t < 30 ? 0 : fresh('van', 900));

      parts.bubble.show(s.stage === 'front');
      parts.bubble.pop(fresh('scan', 450));

      const centreStatus = { line: 'In line', front: 'Label read', van: 'Sent on the van', home: 'Sent on the van' };
      parts.centre.setStatus(centreStatus[s.stage] || '', 'ink-2');
      parts.home.setStatus(home ? 'Delivered' : '', 'ok');
      parts.home.setTone(home ? 'ok' : null);

      const landed = fresh('delivered', 600);
      parts.stamp.show(home);
      parts.stamp.pop(landed);
    },
  };
});
