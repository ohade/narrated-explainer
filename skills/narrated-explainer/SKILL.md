---
name: narrated-explainer
description: Turn any material (a document, notes, a process, a concept, a comparison) into one self-contained HTML explainer with an animated SVG story, local AI narration, sound effects, captions and playback controls. Use when the user asks for an animated or narrated explainer, an explainer video, a walkthrough animation, "make this visual", "animate how X works", or a before/after comparison that should play like a short film. Not for slide decks with static bullets or for charts of data.
---

# Narrated Explainer

You turn the user's material into a short animated story that a reader plays in any browser. The
result is one HTML file that works offline: the voice is recorded on this machine with an
open-source model and embedded in the file.

The `explainer` command does the mechanical work (recording, checking, bundling, snapshots,
video). You do the thinking: what the story is, what moves on screen, and what the narrator
says.

## 0. Check the tools

Run `explainer doctor`. If the command is missing, ask the user to clone
`https://github.com/ohade/narrated-explainer` and run `./setup.sh` (macOS or Linux) or
`./setup.ps1` (Windows, experimental). Do not continue without it; the voice and the checks need
the local models.

## 1. Understand the material

Read all of it. Then write down, for yourself:

- **The one takeaway**: the sentence a viewer should be able to say afterwards.
- **The audience**: what they already know. Explain every term they do not.
- **A contrast, if there is one**: before and after, slow and fast, option A and option B. A
  contrast becomes two modes that the viewer switches between, and it is the strongest teaching
  device this format has.

Ask the user at most two questions, and only when the answer changes the story (usually the
audience or which contrast matters). Otherwise decide and state your assumption.

## 2. Storyboard before code

Create the folder with `explainer new <dir>`, then write `<dir>/storyboard.md`:

1. The takeaway, the audience and the modes.
2. **Actors**: three to six things on screen (boxes, people, a stopwatch, a queue, tokens that
   travel). Each one has a place in a 1200-wide view and one job.
3. **The model**: the few numbers or states that change over story time `t`. Everything drawn is
   derived from these, so captions, labels and drawings can never disagree.
4. **Positions**: an optional intro of two or three steps that sets the scene, then five to ten
   moments. For each: `t`, what changes on screen (one change per moment), the caption, and an
   optional sound cue.

Show the storyboard to the user when they asked to review the plan; otherwise continue.

Read `references/storytelling.md` for caption and pacing rules.

## 3. Write the story

- `story.json` holds every word: title, description, modes, timing, the at-rest caption, intro
  steps and moments. Captions are the narration script. Write them to be heard: short sentences,
  present tense, concrete numbers, no abbreviations the voice would stumble on (add them to
  `pronounce`, for example `"API": "A P I"`).
- `scene.js` holds the pure model `stateAt(mode, t)` and the drawing. Build every SVG node once
  in `build`, and in `draw` only change attributes from `state` and `ctx`. Use the kit's
  primitives before drawing your own. Read `references/scene-authoring.md` for the kit API and
  the patterns for travel, pop-ins and the stopwatch intro.

The contract for both files is `docs/architecture.md` in the repository.

## 4. Record, build, check

```bash
explainer narrate <dir>    # records each caption, checks it with speech-to-text, aligns words
explainer build <dir>      # writes <dir>/dist/<id>.html
explainer check <dir>      # story rules, stale narration, no network calls in the file
```

`explainer check` also verifies that the explainer fits common screens; it is not done until check passes.
When check warns about small text at 1440x900 or larger, shorten or split the scene before calling it done.

When a caption fails the speech check, fix the text, not the threshold: add a `pronounce`
entry, rephrase, or give the moment a `say` override.

## 5. Look at every frame

```bash
explainer snapshots <dir>  # one PNG per mode and position in <dir>/dist/snapshots/
```

Open every PNG and look at it. Passing tests do not show overlapping labels. Fix and repeat
until all of these hold, using `references/quality-checklist.md`:

- No text overlaps other text, a box edge or a token, at any position and in every mode.
- Every label is readable: at least 18 units high, a halo where it crosses a line.
- The at-rest frame alone tells the whole story.
- Each moment shows exactly the change its caption describes.

## 6. Deliver

Give the user the path to `dist/<id>.html` and one sentence: open it in a browser and press
Play. Offer `explainer video <dir>` when they want an MP4 to share, and
`explainer build <dir> --fragment` when they want to embed the figure in another page.

## Rules

- Never autoplay and never make sound before the viewer clicks.
- Colours carry meaning: `info` for the subject, `ok` for success, `warn` for caution, `stop` for
  failure, `ink-2` for secondary text. Use tone names, never hex values.
- Respect reduced motion: take motion from `ctx.motion(ms)`, which already returns 1 when the
  viewer prefers less motion.
- One sound cue per moment at most. Sound supports the change; it does not decorate.
- Keep the file self-contained: no web fonts, images or scripts from the network.
