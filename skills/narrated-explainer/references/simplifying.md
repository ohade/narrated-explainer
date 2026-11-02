# Simplifying a hard subject

Do this before the storyboard exists. The format carries one idea per moment, so the material has
to be cut, ordered and renamed first; a storyboard written from raw notes keeps their jargon and
their order. Each part below produces something step 2 of the skill builds from.

## Select

- **State the takeaway first.** One sentence the viewer should be able to say afterwards. Every
  other decision here serves it.
- **List the minimum facts.** Write down the facts a viewer needs to reach the takeaway, and
  nothing else. More than about ten is two explainers.
- **Cut what changes nothing.** A detail stays only when it changes the mechanism or one of its
  important limits. The rest goes to the description paragraph or a second explainer.
- **Find the vague spots.** Before storyboarding, write the plain explanation once, as you would
  say it to a newcomer. Then list where it gets vague and which terms you cannot explain simply.
  Fix those in your own understanding first; a storyboard cannot hide them.

## Order

- **Only what the viewer has already seen.** Introduce each fact using only the facts that came
  before it. If a fact needs one that comes later, move one of them.
- **Whole picture, then zoom.** Show every actor and how they connect in the first moments, then
  narrow to one part at a time. A viewer who has seen the whole can place each detail.

## Name things plainly

- **Replace identifiers with words.** Code identifiers, internal service names, config keys and
  acronyms become plain words. The shipped example says "App", "Gateway" and "Services A and B"
  (examples/deadline-race/story.json), not the names from the codebase it describes.
- **One term per thing.** Choose one word for each actor and use it in every caption, label and
  the description. Two names for one thing read as two things.
- **Code names go in a legend.** When the viewer must know the real identifier, put it in the
  description or a legend, never in a caption. The voice would stumble on it anyway.

## Pick the object

- **Give the rule a familiar body.** Turn an abstract rule into a familiar object whose behaviour
  has the same arithmetic or logic as the real thing: a stopwatch counts down like a deadline; a
  queue fills and empties like a backlog; a gauge drains like a budget.
- **It must stay true at every moment.** Check each moment: does the object behave exactly as the
  real thing does here? If one moment needs the object to behave unlike the real thing, change
  the object, not the moment.
- **It must be more familiar than the idea.** An object the viewer has to learn explains nothing.
  When no everyday object fits, draw the real thing plainly instead.
- **State the mapping and its limit.** Write in the storyboard what each part of the object stands
  for and where the likeness ends. The limit stops you from drawing a moment the object cannot
  carry.
- **Devices are options.** Boxes, connecting lines, speech bubbles and a stopwatch are available,
  not required. The deadline-race intro builds its stopwatch in three steps before the story
  starts (the `intro` steps in examples/deadline-race/story.json); it is one worked example of
  introducing an object piece by piece.

## Contrasts

- **A contrast earns its place by serving the takeaway.** Two modes double the drawing work; keep
  them only when the difference is the lesson.
- **Label each mode honestly.** Each mode is one of: actual behaviour, conditional behaviour
  (state the condition, for example "with the new setting on"), or a common misconception. Say
  which in the storyboard and in the mode's label or first diverging caption.
- **One timeline, shared start.** Both modes begin from the same moments, and each diverging
  caption opens with the mode's name; the modes rule in storytelling.md says how.
- **Keep the honesty labels.** When numbers are invented for clarity, keep "illustrative example"
  and the assumptions behind them in the description. A viewer who takes them as measured will
  repeat them.

## Read-back test

- **Three conditions.** The explainer passes when every term in the takeaway is defined in a
  caption before it is used; no moment depends on something not yet shown; and a viewer could
  answer two questions afterwards: what causes the outcome, and what changes if one input changes.
- **Your own reading is a self-check, not proof.** You know the subject, so you fill gaps without
  noticing. When possible, show the explainer to someone new to the subject and ask them the two
  questions. A wrong answer points at the moment to fix.
