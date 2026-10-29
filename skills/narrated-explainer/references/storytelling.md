# Storytelling rules

These rules come from building and revising the first explainer many times with a reader who did
not know the subject. Each one fixed a real complaint.

## Shape

- **Start with the stakes.** The intro sets up what can go wrong, often with a visible budget
  (a stopwatch, a fuel gauge, a queue). A viewer who knows the stakes watches every moment for
  its effect on them.
- **One change per moment.** If a moment needs two sentences of "and also", split it.
- **Five to ten moments.** Fewer feels thin; more loses the thread. Put detail in the
  description paragraph or a second explainer.
- **Use modes for contrasts.** When the material compares two behaviours, write both as modes on
  the same timeline. Shared moments keep the same caption; the moments where they diverge carry
  the lesson. Start each diverging caption with the mode's name ("Before: ...", "After: ...").
- **End on the consequence**, not on the mechanism: what the viewer gains or loses.

## Captions

- At most 25 words, ideally under 20. Two short sentences beat one long one.
- Present tense, active voice, concrete subject: "Service A answers in 20 ms", not "A response is
  received".
- Name the number and its unit every time it matters. The voice reads digits well.
- Define a term the first time it appears, in the same caption.
- Say what changed and why it matters. Never describe the drawing ("the box turns red"); the
  viewer can see that.
- The at-rest caption invites the viewer to press Play. It does not summarise the story.

## Pacing

- `holdMs` (default 1600 ms) is the minimum pause on a moment. The player also waits for the
  narration to finish, so long captions slow the story down automatically.
- `realMsPerUnit` sets how fast story time runs between moments. Pick it so the slowest motion
  between moments is still readable at 1x; offer 0.5x for dense stories.
- Put travel (a token moving between boxes) inside a moment's hold with `ctx.motion(ms)`, so
  story time stands still while something moves. Then the model stays simple and the clock on
  screen never jumps.

## Sound

- Cue names: `click`, `pop`, `whoosh`, `tick`, `ding`, `success`, `fail`, `alarm`, `wind`,
  `thud`.
- Pair a cue with the moment's main change: `whoosh` for something leaving, `pop` for something
  appearing, `success` or `fail` for the outcome, `wind` while setting a stopwatch.
- Leave most moments silent apart from the voice.

## Voice

- The default voice is Kokoro `am_michael`. Other Kokoro voices work with
  `"voice": { "voice": "af_heart" }` and similar ids; run `explainer doctor` to list them.
- Spell out what the voice should say for acronyms and symbols in `pronounce`. Use `say` on one
  moment only when a single caption needs different spoken text.
