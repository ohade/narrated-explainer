// Deadline race: an App gives a request 300 ms. The request waits in a busy Gateway's queue, then
// fans out to Services A and B. Before, each service gets a fixed 200 ms timeout, so the App gives
// up at 300 ms and A's reply is lost. After, the Gateway passes the deadline on: each service gets
// the 100 ms left minus a 20 ms reserve, B times out at 280 ms and the answer arrives at 296 ms.
// Two views share one pure model: a system view with a stopwatch intro, and a timeline.
NarratedExplainer.scene(function (story, kit) {
  const DEADLINE = 300; // the App's stopwatch: budget plus buffer
  const BUDGET = 200; // the time the Gateway may spend on its own work
  const QUEUE_END = 200; // the request leaves the queue and fans out
  const BUDGET_AT = 201; // the moment that explains each service's timeout
  const A_ANSWER = 220;
  const A_TRAVEL = 10; // A's reply climbs to the Gateway row, 220..230
  const RESERVE = 20;
  const BUILD = 10; // the Gateway builds the answer after B times out
  const CARRY = 6; // and carries it back to the App
  const END = 320;
  const AHEAD_LEAVE_AT = [50, 100, 150];

  // ---- The model ----

  const countdownAt = (t) => Math.max(0, Math.ceil(DEADLINE - t));
  const serviceBudgetFor = (mode) => (mode === 'after' ? Math.min(countdownAt(QUEUE_END), BUDGET) - RESERVE : BUDGET);

  function aStatusAt(t, stopped, received) {
    if (received) return 'used';
    if (stopped) return 'lost';
    if (t >= A_ANSWER) return 'waiting';
    return t >= QUEUE_END ? 'asked' : 'idle';
  }

  const label = (bubble, timing, tone) => ({ bubble, timing, tone });

  // The speech bubble and answer timing on each fan-out line; null where nothing shows.
  function lineLabelsOf(s) {
    if (!s.fanOut) return { a: label(null, null, null), b: label(null, null, null) };
    const ask = 'You have ' + s.serviceBudget + ' ms to answer. Hurry!';
    const a = s.t >= A_ANSWER ? label(null, 'Answered in ' + (A_ANSWER - QUEUE_END) + ' ms ✓', 'ok') : label(ask, null, null);
    let b = label(ask, 'Waiting… ' + Math.floor(s.t - QUEUE_END) + ' ms', 'ink');
    if (s.bLine === 'timed-out') b = label(null, 'No answer in ' + s.serviceBudget + ' ms: timed out', 'ink-2');
    if (s.callStatus === 'cancelled') b = label(null, 'No answer after ' + (DEADLINE - QUEUE_END) + ' ms. Call cancelled.', 'stop');
    return { a, b };
  }

  function stateAt(mode, storyT) {
    const t = Math.min(END, Math.max(0, storyT));
    const after = mode === 'after';
    const budget = serviceBudgetFor(mode);
    const bTimerEnd = QUEUE_END + budget;
    const answerBuilt = bTimerEnd + BUILD;
    const arrival = answerBuilt + CARRY;
    const fanOut = t >= QUEUE_END;
    const stopped = !after && t >= DEADLINE;
    const received = after && t >= arrival;
    const bTimedOut = after && t >= bTimerEnd;
    let answerAt = 'none';
    if (after && t >= answerBuilt) answerAt = t < arrival ? 'call' : 'app';
    const s = {
      mode,
      t,
      countdown: countdownAt(t),
      hand: received ? DEADLINE - arrival : Math.max(0, DEADLINE - t),
      readout: received ? 'Answered with ' + (DEADLINE - arrival) + ' ms to spare' : 'Time left: ' + countdownAt(t) + ' ms',
      queueFill: kit.ramp(t, 0, QUEUE_END),
      ahead: AHEAD_LEAVE_AT.filter((leaveAt) => t < leaveAt).length,
      requestAt: fanOut ? 'work' : 'queue',
      fanOut,
      budgetShown: t >= BUDGET_AT,
      serviceBudget: budget,
      bStatus: bTimedOut ? 'timed-out' : fanOut ? 'waiting' : 'idle',
      bLine: bTimedOut ? 'timed-out' : 'open',
      bBarEnd: fanOut ? Math.min(t, after ? bTimerEnd : DEADLINE) : QUEUE_END,
      aStatus: aStatusAt(t, stopped, received),
      aLift: kit.ramp(t, A_ANSWER, A_ANSWER + A_TRAVEL),
      appStatus: received ? 'received' : stopped ? 'stopped' : 'waiting',
      callStatus: stopped ? 'cancelled' : 'open',
      answerAt,
      answerBuild: after ? kit.ramp(t, bTimerEnd, answerBuilt) : 0,
      answerLift: after ? kit.ramp(t, answerBuilt, arrival) : 0,
    };
    s.lineLabels = lineLabelsOf(s);
    return s;
  }

  // ---- Geometry (viewBox units) ----

  const QUEUE_Y = 318;
  const SLOT_W = 40;
  const SLOT_GAP = 6;
  const slotX = (fromBack) => 450 + SLOT_W / 2 + (SLOT_W + SLOT_GAP) * fromBack; // four queue slots; slot 3 is the front
  const WORK = { x: 642, y: 260, w: 148, h: 116 }; // the "Working on it" area, right of the queue
  const UPRIGHT = -90; // our request stands upright in a queue slot and lies flat everywhere else
  const APP_SPOT = [145, 300];
  const REQUEST_START = [355, 300]; // at the press the request waits on the call, between the App and the Gateway
  const WORK_REQUEST = [706, 300];
  const WORK_REPLY = [716, 350];
  // The fan-out lines meet each service below its name, so tokens arrive without crossing it.
  const SERVICE_A = [1065, 230];
  const SERVICE_B = [1065, 390];
  const LINE_A = [[800, 260], [960, 230]];
  const LINE_B = [[800, 340], [960, 390]];
  // Token trips drawn inside the hold of the moment that starts them; story time stands still.
  const TRIP_MS = 1100;
  const TRIPS = {
    send: { request: [REQUEST_START, [430, 300], [slotX(0), QUEUE_Y]] },
    'fan-out': {
      request: [[slotX(3), QUEUE_Y], WORK_REQUEST],
      // The asks set off a little way along their lines, clear of "Working on it".
      reqA: [kit.along(LINE_A, 0.2), LINE_A[1], SERVICE_A],
      reqB: [kit.along(LINE_B, 0.2), LINE_B[1], SERVICE_B],
    },
    // A's reply comes down the Gateway's edge, beside our request rather than across it.
    'a-answers': { reply: [SERVICE_A, LINE_A[1], LINE_A[0], [800, WORK_REPLY[1]], WORK_REPLY] },
  };
  const SEND_TURN_FROM = 0.6; // on the send trip our request turns upright once inside the Gateway
  // The answer travels by story time, 290..296, so it reaches the App as its status turns. It runs
  // along the bottom of the Gateway and climbs to the call left of our request, right of "call".
  const ANSWER_PATH = [WORK_REPLY, [520, WORK_REPLY[1]], [505, 300], [355, 300], APP_SPOT];
  const WIND = { 'intro-budget': [0, BUDGET], 'intro-buffer': [BUDGET, DEADLINE] };
  const WIND_MS = 2000;
  const PRESS_MS = 600;

  const xOf = (t) => 260 + 2.2 * t;
  const ROW_2 = 268; // the Gateway's second timeline row, where A's reply waits
  const ANSWER_RIGHT = 916; // the answer grows leftward out of the 280..300 slot
  const ANSWER_SLOT = 40;
  const ANSWER_FULL = 340;
  const ANSWER_RISE = ROW_2 - 120; // up to the App lane
  // A's reply waits right of the fan-out arrows and left of the deadline line.
  const REPLY_CHIP = { x: 724, w: 192 };

  const APP_TEXT = {
    waiting: ['waiting', 'ink-2'],
    stopped: ['✕ stopped waiting, no answer', 'stop'],
    received: ['✓ answer received in time', 'ok'],
  };
  const SYS_APP_TEXT = {
    waiting: ['waiting', 'ink-2'],
    stopped: ['✕ gave up', 'stop'],
    received: ["✓ got A's reply", 'ok'],
  };

  const round = (v) => Math.round(v * 100) / 100;
  const show = (node, on) => node.setAttribute('visibility', on ? 'visible' : 'hidden');
  const haloText = (svg, x, y, str, opts) => kit.text(svg, x, y, str, Object.assign({ size: 18, halo: true }, opts));

  let p; // system view handles
  let q; // timeline handles

  function buildSystem(stage) {
    const svg = kit.svg(stage, '0 0 1200 460', 'System view: the App, the Gateway and Services A and B');
    const systemNode = (tag, attrs) => kit.el(svg, tag, attrs);
    p = {
      watch: kit.stopwatch(svg, {
        cx: 130, cy: 112, r: 56, max: DEADLINE, unit: 'ms', operator: true,
        segments: [{ to: BUDGET, tone: 'info', label: 'budget 200 ms' }, { to: DEADLINE, tone: 'warn', label: 'buffer +100 ms' }],
      }),
      readout: kit.readout(svg, { x: 1185, y: 118, anchor: 'end' }),
      app: kit.box(svg, { x: 10, y: 240, w: 270, h: 120, label: 'App' }),
      gateway: kit.box(svg, { x: 430, y: 180, w: 370, h: 240, label: 'Gateway' }),
      serviceA: kit.box(svg, { x: 960, y: 170, w: 210, h: 80, label: 'Service A' }),
      serviceB: kit.box(svg, { x: 960, y: 330, w: 210, h: 80, label: 'Service B' }),
      queue: kit.queue(svg, { x: 450, y: 260, slots: 4, slotW: SLOT_W, gap: SLOT_GAP, h: 116, title: 'Queue' }),
    };
    systemNode('rect', { x: WORK.x, y: WORK.y, width: WORK.w, height: WORK.h, rx: 6, fill: 'none', class: 'nx-stroke-edge', 'stroke-width': 2, 'stroke-dasharray': '8 6' });
    kit.text(svg, WORK.x, WORK.y - 12, 'Working on it', { size: 18, tone: 'ink-2' });
    kit.text(svg, 615, 446, 'Grey: other requests ahead in line', { size: 18, anchor: 'middle', tone: 'ink-2' });
    p.calls = [295, 305].map((y) => kit.arrow(svg, { from: [280, y], to: [430, y], head: false }));
    haloText(svg, 355, 332, 'call', { anchor: 'middle', tone: 'ink-2' });
    p.cancel = haloText(svg, 424, 230, '✕ cancelled at 300 ms', { anchor: 'end', weight: 600, tone: 'stop' });
    p.lineA = kit.arrow(svg, { from: LINE_A[0], to: LINE_A[1], head: false });
    p.fanOut = haloText(svg, 806, 196, 'Fan-out', {});
    p.lineB = kit.arrow(svg, { from: LINE_B[0], to: LINE_B[1], head: false });
    p.bTimedOut = haloText(svg, 880, 400, 'timed out', { anchor: 'middle', weight: 700, tone: 'ink-2' });
    p.bubbles = {
      a: kit.bubble(svg, { x: 705, y: 132, w: 350, h: 34, tail: [905, 196] }),
      b: kit.bubble(svg, { x: 836, y: 280, w: 350, h: 34, tail: [880, 338] }),
    };
    p.timings = {
      a: kit.readout(svg, { x: 880, y: 155, size: 18, anchor: 'middle' }),
      b: kit.readout(svg, { x: 806, y: 440, size: 18 }),
    };
    // Our request turns upright to fit a queue slot, so it is drawn here rather than as a kit token.
    p.request = systemNode('g', { 'data-part': 'our-request' });
    kit.el(p.request, 'rect', { x: -55, y: -17, width: 110, height: 34, rx: 6, class: 'nx-fill-info-fg' });
    kit.text(p.request, 0, 6, 'Our request', { size: 18, weight: 600, anchor: 'middle', on: 'info' });
    p.reqA = kit.token(svg, { label: 'request', tone: 'info' });
    p.reqB = kit.token(svg, { label: 'request', tone: 'info' });
    p.reply = kit.token(svg, { label: 'reply', tone: 'info' });
    p.answer = kit.token(svg, { label: "A's reply + B timed out", tone: 'ok' });
  }

  function buildTimeline(stage) {
    const svg = kit.svg(stage, '0 0 1200 600', 'Timeline: what each part does from 0 to 400 ms');
    const timelineNode = (parent, tag, attrs) => kit.el(parent, tag, attrs);
    kit.text(svg, 20, 30, 'In this example both services get the same timeout.', { size: 18, tone: 'ink-2' });
    [['App', 'waits until 300 ms', 128], ['Gateway', '', 248], ['Service A', 'answers after 20 ms', 368],
      ['Service B', 'never answers', 468]].forEach(([name, note, y]) => {
      kit.text(svg, 20, y, name, { size: 22, weight: 600 });
      if (note) kit.text(svg, 20, y + 26, note, { size: 18, tone: 'ink-2' });
    });
    kit.axis(svg, { x0: xOf(0), x1: xOf(400), y: 550, t0: 0, t1: 400, ticks: 4, unit: 'ms' });
    // The deadline and the playhead lie under everything else, so haloed labels stay readable over them.
    timelineNode(svg, 'line', { x1: xOf(DEADLINE), y1: 76, x2: xOf(DEADLINE), y2: 550, class: 'nx-stroke-stop', 'stroke-width': 3 });
    haloText(svg, xOf(DEADLINE), 68, 'Deadline · 300 ms', { anchor: 'middle', weight: 600, tone: 'stop' });
    const playhead = timelineNode(svg, 'line', { x1: xOf(0), y1: 76, x2: xOf(0), y2: 550, class: 'nx-stroke-ink', 'stroke-width': 2, 'data-part': 'playhead' });
    q = { playhead, queue: kit.meter(svg, { x: xOf(0), y: 206, w: xOf(QUEUE_END) - xOf(0), h: 36, tone: 'warn-bg' }) };
    // Left-aligned in the queue bar, so the answer rising through this lane at 290..296 passes clear.
    haloText(svg, xOf(0) + 12, 230, 'Waiting in queue (Gateway busy)', {});
    q.reserve = timelineNode(svg, 'g', { 'data-part': 'reserve' });
    timelineNode(q.reserve, 'rect', { x: xOf(DEADLINE - RESERVE), y: 206, width: 2.2 * RESERVE, height: 36, class: 'nx-fill-ok-bg nx-stroke-ok', 'stroke-width': 2 });
    haloText(q.reserve, xOf(DEADLINE) + 8, 230, '20 ms reserve', { weight: 600, tone: 'ok' });
    q.bBar = timelineNode(svg, 'rect', { x: xOf(QUEUE_END), y: 448, width: 0, height: 24, class: 'nx-fill-ink-2-fg' });
    // B's planned 200 ms, hatched past the deadline.
    q.bPlan = timelineNode(svg, 'g', { 'data-part': 'b-plan' });
    timelineNode(q.bPlan, 'rect', { x: xOf(DEADLINE), y: 448, width: 2.2 * 100, height: 24, fill: 'none', class: 'nx-stroke-ink-2', 'stroke-width': 2, 'stroke-dasharray': '8 6' });
    for (let x = xOf(DEADLINE) + 6; x + 24 <= xOf(400); x += 12) {
      timelineNode(q.bPlan, 'line', { x1: x, y1: 472, x2: x + 24, y2: 448, class: 'nx-stroke-ink-2', 'stroke-width': 2, opacity: 0.5 });
    }
    haloText(q.bPlan, xOf(400), 506, "B's timeout: full 200 ms, would end at 400 ms", { anchor: 'end' });
    q.bShort = haloText(svg, xOf(QUEUE_END), 506, "B's timeout: 80 ms", {});
    q.fanOut = [[[694, 244], [680, 356]], [[706, 244], [722, 446]]].map(([from, to]) => kit.arrow(svg, { from, to }));
    q.fanOutLabel = haloText(svg, 668, 314, 'Fan-out · 100 ms left', { anchor: 'end' });
    q.app = kit.readout(svg, { x: xOf(DEADLINE) + 8, y: 126, size: 18 });
    q.bTimedOut = kit.token(svg, { label: 'timed out', tone: 'stop' });
    q.bTimedOut.moveTo([824, 426]);
    q.aReply = kit.token(svg, { label: "A's reply", tone: 'info' });
    // Waiting in the Gateway row, A's reply is narrower than a kit token would make it.
    q.replyChip = timelineNode(svg, 'g', { 'data-part': 'reply-chip' });
    q.replyChipBox = timelineNode(q.replyChip, 'rect', { x: REPLY_CHIP.x, y: ROW_2 - 17, width: REPLY_CHIP.w, height: 34, rx: 8 });
    q.replyChipLabel = kit.text(q.replyChip, REPLY_CHIP.x + REPLY_CHIP.w / 2, ROW_2 + 6, '', { size: 18, weight: 600, anchor: 'middle', on: 'info' });
    q.answer = timelineNode(svg, 'g', { 'data-part': 'answer' });
    q.answerBox = timelineNode(q.answer, 'rect', { x: ANSWER_RIGHT - ANSWER_SLOT, y: ROW_2 - 18, width: ANSWER_SLOT, height: 36, rx: 6, class: 'nx-fill-ok-fg' });
    // The label grows with the box, scaled about the box's middle.
    q.answerLabelGroup = timelineNode(q.answer, 'g', {});
    q.answerLabel = kit.text(q.answerLabelGroup, 0, 6, "One answer: A's reply + B timed out", { size: 18, weight: 600, anchor: 'middle', on: 'ok' });
  }

  // The stopwatch: wound in the first two intro steps, pressed in the third, then counting down.
  // The press runs early in its hold, so it lands with the click story.json cues on arrival.
  function drawStopwatch(s, ctx) {
    const w = p.watch;
    if (ctx.at.kind === 'intro') {
      const windRange = WIND[ctx.at.id];
      if (windRange) {
        const m = ctx.motion(WIND_MS);
        const e = kit.ease.inOut(m);
        w.wind(m);
        w.set({ value: kit.lerp(windRange[0], windRange[1], e), total: e >= 0.5 ? windRange[1] : windRange[0] });
      } else {
        w.press(ctx.motion(PRESS_MS));
        w.set({ value: DEADLINE, total: DEADLINE });
      }
      return;
    }
    const flash = ctx.at.kind === 'moment' && ctx.at.id === 'deadline-passes' ? 1 - ctx.motion(700) : 0;
    const zero = s.countdown === 0 && s.appStatus !== 'received';
    w.press(1);
    w.set({ value: s.hand, total: DEADLINE, flash, rim: zero ? 'stop' : 'ink-2' });
  }

  function drawSystem(s, ctx, holdMotion) {
    const intro = ctx.at.kind === 'intro';
    const readoutTone = s.appStatus === 'received' ? 'ok' : s.countdown === 0 ? 'stop' : 'ink';
    p.readout.set(intro ? '' : s.readout, readoutTone);
    p.app.setStatus(SYS_APP_TEXT[s.appStatus][0], SYS_APP_TEXT[s.appStatus][1]);
    const cancelled = s.callStatus === 'cancelled';
    p.calls.forEach((line) => line.setTone(cancelled ? 'stop' : 'ink'));
    show(p.cancel, cancelled);
    p.queue.set([0, 1, 2, 3].map((slot) => (slot >= 4 - s.ahead ? { label: '', tone: 'edge' } : null)));

    const reach = s.fanOut ? holdMotion('fan-out', 500) : 0;
    p.lineA.draw(reach);
    show(p.fanOut, s.fanOut);
    p.lineB.draw(reach);
    const bTimedOut = s.bLine === 'timed-out';
    p.lineB.setDashed(bTimedOut);
    p.lineB.setTone(bTimedOut ? 'ink-2' : 'ink');
    show(p.bTimedOut, bTimedOut);

    ['a', 'b'].forEach((key) => {
      const l = s.lineLabels[key];
      p.bubbles[key].show(l.bubble !== null);
      p.bubbles[key].setText(l.bubble || '');
      p.bubbles[key].pop(holdMotion('fan-out', 450));
      p.timings[key].set(l.timing || '', l.tone || 'ink');
    });
  }

  // The request, the asks, A's reply and the answer: where the state puts them, or on a trip
  // during the hold of the moment that moves them.
  function drawTokens(s, ctx) {
    const intro = ctx.at.kind === 'intro';
    const lost = s.aStatus === 'lost';
    const at = {
      request: intro ? REQUEST_START : s.requestAt === 'work' ? WORK_REQUEST : [slotX(3 - s.ahead), QUEUE_Y],
      reqA: SERVICE_A,
      reqB: SERVICE_B,
      reply: WORK_REPLY,
      answer: s.answerAt === 'app' ? APP_SPOT : kit.along(ANSWER_PATH, s.answerLift),
    };
    let requestTurn = !intro && s.requestAt === 'queue' ? UPRIGHT : 0;
    const trip = ctx.at.kind === 'moment' ? TRIPS[ctx.at.id] : null;
    if (trip) {
      const e = kit.ease.inOut(ctx.motion(TRIP_MS));
      Object.keys(trip).forEach((name) => { at[name] = kit.along(trip[name], e); });
      if (ctx.at.id === 'send') requestTurn = UPRIGHT * kit.ramp(e, SEND_TURN_FROM, 1);
      if (ctx.at.id === 'fan-out') requestTurn = UPRIGHT * (1 - e);
    }
    show(p.request, !intro || ctx.at.id === 'intro-start');
    p.request.setAttribute('transform', 'translate(' + round(at.request[0]) + ' ' + round(at.request[1]) + ') rotate(' + round(requestTurn) + ')');
    p.reqA.show(s.aStatus === 'asked');
    p.reqA.moveTo(at.reqA);
    p.reqB.show(s.fanOut && s.bLine === 'open');
    p.reqB.moveTo(at.reqB);
    p.reply.show((s.aStatus === 'waiting' && s.answerAt === 'none') || lost);
    p.reply.setTone(lost ? 'stop' : 'info');
    p.reply.moveTo(at.reply);
    p.answer.show(s.answerAt !== 'none');
    p.answer.moveTo(at.answer);
  }

  function drawTimeline(s, ctx, holdMotion) {
    const after = s.mode === 'after';
    show(q.playhead, ctx.at.kind !== 'rest');
    q.playhead.setAttribute('x1', round(xOf(s.t)));
    q.playhead.setAttribute('x2', round(xOf(s.t)));
    q.queue.set(s.queueFill);
    q.fanOut.forEach((arrow) => arrow.draw(s.fanOut ? holdMotion('fan-out', 500) : 0));
    show(q.fanOutLabel, s.fanOut);

    // Each service's timeout appears at the moment that explains it.
    show(q.reserve, after && s.budgetShown);
    q.reserve.setAttribute('opacity', round(holdMotion('after-budget', 500)));
    show(q.bPlan, !after && s.budgetShown);
    q.bPlan.setAttribute('opacity', round(holdMotion('before-budget', 500)));
    show(q.bShort, after && s.budgetShown);
    show(q.bBar, s.fanOut);
    q.bBar.setAttribute('width', round(2.2 * (s.bBarEnd - QUEUE_END)));
    q.bTimedOut.show(s.bStatus === 'timed-out');

    // A's reply climbs to the Gateway row and waits there, or is lost; after, the answer replaces it.
    const answering = after && s.bStatus === 'timed-out';
    const climbing = s.aStatus === 'waiting' && s.aLift < 1;
    const lost = s.aStatus === 'lost';
    q.aReply.moveTo([803, kit.lerp(360, ROW_2, s.aLift)]);
    q.aReply.show(climbing);
    q.replyChipLabel.textContent = lost ? "A's reply lost" : "A's reply waits for B";
    q.replyChipBox.setAttribute('class', lost ? 'nx-fill-stop-fg' : 'nx-fill-info-fg');
    show(q.replyChip, (s.aStatus === 'waiting' && !climbing && !answering) || lost);

    show(q.answer, answering);
    const width = ANSWER_SLOT + (ANSWER_FULL - ANSWER_SLOT) * s.answerBuild;
    q.answerBox.setAttribute('x', round(ANSWER_RIGHT - width));
    q.answerBox.setAttribute('width', round(width));
    q.answerLabelGroup.setAttribute('transform', 'translate(' + round(ANSWER_RIGHT - width / 2) + ' ' + ROW_2 + ') scale(' + round(width / ANSWER_FULL) + ')');
    q.answerLabel.setAttribute('opacity', round(s.answerBuild));
    q.answer.setAttribute('transform', 'translate(0 ' + round(-ANSWER_RISE * s.answerLift) + ')');
    q.app.set(APP_TEXT[s.appStatus][0], APP_TEXT[s.appStatus][1]);
  }

  return {
    stateAt,
    build(stage) {
      buildSystem(stage);
      buildTimeline(stage);
    },
    draw(s, ctx) {
      // Motion 0..1 inside the hold of moment id; 1 anywhere else, so every position ends in its final pose.
      const holdMotion = (id, ms) => (ctx.at.kind === 'moment' && ctx.at.id === id ? ctx.motion(ms) : 1);
      drawStopwatch(s, ctx);
      drawSystem(s, ctx, holdMotion);
      drawTokens(s, ctx);
      drawTimeline(s, ctx, holdMotion);
    },
  };
});
