"""Live-player fit check: the stage and caption stay inside common windows."""
from pathlib import Path
import time

from playwright.sync_api import Error, sync_playwright

from .capture import WAIT_MS, Capture, launch_browser
from .story import crowded_asides, levels_without_cue

WINDOWS = [(1280, 720), (1440, 900), (1920, 1080), (2000, 1174), (2560, 1440), (390, 844)]
SCHEMES = ["light", "dark"]

# Walks every mode, level and position as the reader first sees it: a standalone page in a landscape window
# at scroll 0, otherwise with the figure's top at the window's top. Overflow and text sizes in CSS px.
MEASURE_JS = """() => {
  const player = NarratedExplainer.players[0];
  const figure = player.figure;
  const modes = player.story.modes && player.story.modes.length ? player.story.modes.map((m) => m.id) : ['main'];
  const levels = player.story.levels && player.story.levels.length ? player.story.levels.map((l) => l.id) : [null];
  const page = document.documentElement;
  const pageTop = document.body.classList.contains('nx-page') && innerWidth >= innerHeight;
  const transparent = (el) => el && el.tagName !== 'svg'
    && (getComputedStyle(el).opacity === '0' || transparent(el.parentElement));
  const zero = (el) => { const box = el.getBoundingClientRect(); return !box.width || !box.height; };
  const textSize = (el) => {
    if (zero(el.closest('.nx-stage')) || zero(el.closest('svg'))) return 0;
    const shown = el.textContent.trim() && getComputedStyle(el).visibility === 'visible' && !transparent(el);
    const matrix = shown ? el.getScreenCTM() : null;
    return matrix ? parseFloat(getComputedStyle(el).fontSize) * Math.hypot(matrix.a, matrix.b) : Infinity;
  };
  const past = (el) => {
    const box = el.getBoundingClientRect();
    return Math.max(0, box.bottom - innerHeight, box.right - innerWidth, -box.top, -box.left);
  };
  const cases = [];
  for (const mode of modes) for (const level of levels) {
    player.positions(mode, level).forEach((_, index) => {
      player.goto(mode, index, level);
      scrollTo(0, pageTop ? 0 : figure.getBoundingClientRect().top + scrollY);
      const stage = [figure.querySelector('.nx-stage'), ...figure.querySelectorAll('.nx-stage svg')];
      cases.push({ mode, level, index, stage: Math.max(...stage.map(past)), caption: past(figure.querySelector('figcaption')),
                   sideways: Math.max(0, page.scrollWidth - page.clientWidth), pageTop,
                   collapsed: [...new Set(stage.filter(zero).map((el) => el.tagName === 'svg' ? 'an svg' : 'the stage'))],
                   text: Math.min(...[...figure.querySelectorAll('.nx-stage svg text')].map(textSize)) });
    });
  }
  return cases;
}"""
# Where the chip rail and every aside panel sit against the stage, per mode, level and position, as the viewer
# sees them. Arrival animations are finished and the chips' fade is switched off, so a chip that has just
# left takes no space and none is measured mid-pop.
ASIDES_JS = """() => {
  const player = NarratedExplainer.players[0];
  const figure = player.figure;
  const modes = player.story.modes && player.story.modes.length ? player.story.modes.map((m) => m.id) : ['main'];
  const levels = player.story.levels && player.story.levels.length ? player.story.levels.map((l) => l.id) : [null];
  const calm = document.head.appendChild(document.createElement('style'));
  calm.textContent = '.nx .nx-aside-chip { transition: none !important; }';
  const past = (el, box) => { const r = el.getBoundingClientRect();
    return Math.max(0, box.left - r.left, r.right - box.right, box.top - r.top, r.bottom - box.bottom); };
  const stage = () => figure.querySelector('.nx-stage').getBoundingClientRect();
  const settle = () => document.getAnimations().forEach((animation) => animation.finish());
  const rails = [];
  const panels = [];
  const wanted = new Set(player.story.asides.map((a) => a.id));
  for (const mode of modes) for (const level of levels) {
    player.positions(mode, level).forEach((_, index) => {
      const offered = player.asidesAt(mode, index, level);
      player.showAsides(mode, index, level);
      settle();
      const rail = figure.querySelector('.nx-asides');
      if (offered.length) rails.push({ mode, level, index, past: Math.max(past(rail, stage()),
        ...offered.map((id) => past(figure.querySelector('.nx-aside-chip[data-aside="' + id + '"]'), stage()))) });
      for (const id of offered) if (wanted.delete(id)) {
        player.showAsides(mode, index, level, id);
        settle();
        panels.push({ id, mode, level, index, past: past(figure.querySelector('.nx-aside-card'), stage()) });
      }
    });
  }
  calm.remove();
  return { rails, panels };
}"""
FRAME_JS = "() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))"


class LivePage(Capture):
    """The player as a reader sees it: no capture styles, any window and scheme."""

    def __init__(self, path: Path, width: int = 1280, height: int = 720, scheme: str = "light", css: str = ""):
        super().__init__(path, width, scheme)
        self.height, self.css = height, css

    def __enter__(self):
        self.playwright = sync_playwright().start()
        try:
            self.browser = launch_browser(self.playwright)
            context = self.browser.new_context(viewport={"width": self.width, "height": self.height},
                                               device_scale_factor=1, color_scheme=self.scheme,
                                               service_workers="block")
            context.set_default_timeout(WAIT_MS)
            context.route("**/*", self._route)
            context.route_web_socket("**/*", self._deny_socket)
            self.page = context.new_page()
            self.page.on("pageerror", lambda error: self.errors.append(f"Page error: {error}"))
            self.page.on("console", self._console)
            self.page.goto(self.path.resolve().as_uri(), wait_until="load", timeout=WAIT_MS)
            deadline = time.monotonic() + WAIT_MS / 1000
            while not self.page.evaluate("Boolean(window.NarratedExplainer && NarratedExplainer.players.length > 0)"):
                self.check_errors()
                if time.monotonic() >= deadline:
                    raise RuntimeError("Player API did not become ready within 30 seconds")
                self.page.wait_for_timeout(20)
            if self.css:
                self.page.add_style_tag(content=self.css)
            self.check_errors()
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def resize(self, width: int, height: int, scheme: str) -> None:
        self.page.emulate_media(color_scheme=scheme)
        self.page.set_viewport_size({"width": width, "height": height})
        self.page.evaluate(FRAME_JS)

    def measure(self) -> list[dict]:
        cases = self.page.evaluate(MEASURE_JS)
        self.check_errors()
        return cases

    def measure_asides(self) -> dict:
        """The overflow of the chip rail at each position that offers an aside, and of each aside's panel."""
        measured = self.page.evaluate(ASIDES_JS)
        self.check_errors()
        return measured


SMALL_TEXT_PX = 11


def _aside_overflow_errors(measured: dict, prefix: str) -> list[str]:
    """Errors for a chip rail or an aside panel that extends outside the stage."""
    errors = [f"{prefix}, mode {rail['mode']}, step {rail['index'] + 1}: the chip rail extends {round(rail['past'] + 0.49)}px outside the stage"
              + (f" at level {rail['level']}" if rail["level"] else "") for rail in measured["rails"] if rail["past"] > 0.5]
    return errors + [f"{prefix}: aside {panel['id']} panel extends {round(panel['past'] + 0.49)}px outside the stage"
                     for panel in measured["panels"] if panel["past"] > 0.5]


def inspect_layout(path: Path, css: str = "") -> tuple[list[str], list[str]]:
    """Errors for each window, scheme, mode, level and step where the player does not fit; one warning
    per window whose smallest stage text is under SMALL_TEXT_PX, one per level list with no sound cue and
    one per mode and level that offers more asides than can show at once."""
    errors, warnings = [], []
    try:
        with LivePage(path, css=css) as live:
            story = live.page.evaluate("NarratedExplainer.players[0].story")
            warnings += [f"{path.name}: mode {mode}, level {level} has no sound cue; give a step an sfx"
                         for mode, level in levels_without_cue(story)]
            warnings += [f"{path.name}: mode {mode}" + (f", level {level}" if level else "")
                         + f": more than three asides can show at step {index + 1}; only the first three get a chip"
                         for mode, level, index in crowded_asides(story)]
            for width, height in WINDOWS:
                smallest = None
                for scheme in SCHEMES:
                    live.resize(width, height, scheme)
                    for case in live.measure():
                        rule = "fit from the page top" if case["pageTop"] else "fit from the figure top"
                        at_level = f" at level {case['level']}" if case["level"] else ""
                        problems = [f"{part} extends {round(case[part] + 0.49)}px past the window{at_level} ({rule})"
                                    for part in ("stage", "caption") if case[part] > 0.5]
                        problems += [f"{part} renders with zero width or height{at_level}" for part in case["collapsed"]]
                        if case["sideways"] > 0.5:
                            problems.append(f"page scrolls sideways by {round(case['sideways'] + 0.49)}px{at_level}")
                        if problems:
                            errors.append(f"{path.name}: {width}x{height} {scheme}, mode {case['mode']}, "
                                          f"step {case['index'] + 1}: " + "; ".join(problems))
                        if smallest is None or case["text"] < smallest["text"]:
                            smallest = case
                    if story.get("asides"):
                        errors += _aside_overflow_errors(live.measure_asides(), f"{path.name}: {width}x{height} {scheme}")
                if smallest and smallest["text"] < SMALL_TEXT_PX:
                    in_level = f", level {smallest['level']}" if smallest["level"] else ""
                    warnings.append(f"{path.name}: {width}x{height}: smallest stage text is "
                                    f"{smallest['text']:.1f}px at mode {smallest['mode']}{in_level}, step "
                                    f"{smallest['index'] + 1}; shorten or split the scene")
    except (RuntimeError, Error) as error:
        return [f"{path.name}: layout check failed: {error}"], []
    return errors, warnings


def check_layout(path: Path, css: str = "") -> list[str]:
    """One error per window, scheme, mode, level and step where the player does not fit."""
    return inspect_layout(path, css)[0]
