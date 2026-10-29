# Quality checklist

Run through this list with the snapshots open. Each item names what to look for and the usual fix.

## Every frame

| Check | Usual fix |
|---|---|
| No text overlaps other text, a box edge, a line or a token | Move the label; anchor it `end` or `middle`; shorten it |
| Text is at least 18 units high and readable on its fill | Use `kit.text` with `on` set to the fill's tone |
| Labels that cross a line have a halo | `halo: true` |
| Nothing is cut off at the edge of the view | Keep 20 units of margin inside the viewBox |
| Colours follow meaning (info, ok, warn, stop, ink-2) | Change the tone, not the hex value |

## The story

| Check | Usual fix |
|---|---|
| The at-rest frame alone explains the outcome | Show end-state labels at rest |
| Each moment shows the change its caption names | Derive the drawing from `stateAt`, not from the caption |
| Numbers in captions, labels and the model agree | Compute labels from model constants |
| Both modes share the same layout | Change state, never positions, between modes |
| Travel and pop-ins happen inside holds | Use `ctx.motion(ms)` |

## The build

| Check | Command |
|---|---|
| Story rules, stale narration, network calls | `explainer check <dir>` |
| Fits common screens in light and dark; not done until it passes | `explainer check <dir>` exit 0 |
| Every caption passed the speech check | `explainer narrate <dir>` exit 0 |
| No console errors in any position | `explainer snapshots <dir>` exit 0 |
| Keyboard: Space, Left, Right, R, V, S, T, F, 1-9 | Try them once in a browser |
| Reduced motion | Turn on the OS setting, press Play: it steps without tweening |
