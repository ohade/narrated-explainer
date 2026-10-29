"""Live-player fit check: the stage and caption stay inside common windows."""
from pathlib import Path
import time

from playwright.sync_api import Error, sync_playwright

from .capture import WAIT_MS, Capture, launch_browser

WINDOWS = [(1280, 720), (1440, 900), (1920, 1080), (2000, 1174), (2560, 1440), (390, 844)]
SCHEMES = ["light", "dark"]

# Walks every mode and position as the reader first sees it: a standalone page in a landscape window
# at scroll 0, otherwise with the figure's top at the window's top. Overflow and text sizes in CSS px.
MEASURE_JS = """() => {
  const player = NarratedExplainer.players[0];
  const figure = player.figure;
  const modes = player.story.modes && player.story.modes.length ? player.story.modes.map((m) => m.id) : ['main'];
  const page = document.documentElement;
  const pageTop = document.body.classList.contains('nx-page') && innerWidth >= innerHeight;
  const transparent = (el) => el && el.tagName !== 'svg'
    && (getComputedStyle(el).opacity === '0' || transparent(el.parentElement));
  const textSize = (el) => {
    const shown = el.textContent.trim() && getComputedStyle(el).visibility === 'visible' && !transparent(el);
    const matrix = shown ? el.getScreenCTM() : null;
    return matrix ? parseFloat(getComputedStyle(el).fontSize) * Math.hypot(matrix.a, matrix.b) : Infinity;
  };
  const past = (el) => {
    const box = el.getBoundingClientRect();
    return Math.max(0, box.bottom - innerHeight, box.right - innerWidth, -box.top, -box.left);
  };
  const cases = [];
  for (const mode of modes) {
    player.positions(mode).forEach((_, index) => {
      player.goto(mode, index);
      scrollTo(0, pageTop ? 0 : figure.getBoundingClientRect().top + scrollY);
      const stage = [figure.querySelector('.nx-stage'), ...figure.querySelectorAll('.nx-stage svg')];
      cases.push({ mode, index, stage: Math.max(...stage.map(past)), caption: past(figure.querySelector('figcaption')),
                   sideways: Math.max(0, page.scrollWidth - page.clientWidth), pageTop,
                   text: Math.min(...[...figure.querySelectorAll('.nx-stage svg text')].map(textSize)) });
    });
  }
  return cases;
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


SMALL_TEXT_PX = 11


def inspect_layout(path: Path, css: str = "") -> tuple[list[str], list[str]]:
    """Errors for each window, scheme, mode and step where the player does not fit;
    one warning per window whose smallest stage text is under SMALL_TEXT_PX."""
    errors, warnings = [], []
    try:
        with LivePage(path, css=css) as live:
            for width, height in WINDOWS:
                smallest = None
                for scheme in SCHEMES:
                    live.resize(width, height, scheme)
                    for case in live.measure():
                        rule = "fit from the page top" if case["pageTop"] else "fit from the figure top"
                        problems = [f"{part} extends {round(case[part] + 0.49)}px past the window ({rule})"
                                    for part in ("stage", "caption") if case[part] > 0.5]
                        if case["sideways"] > 0.5:
                            problems.append(f"page scrolls sideways by {round(case['sideways'] + 0.49)}px")
                        if problems:
                            errors.append(f"{path.name}: {width}x{height} {scheme}, mode {case['mode']}, "
                                          f"step {case['index'] + 1}: " + "; ".join(problems))
                        if smallest is None or case["text"] < smallest["text"]:
                            smallest = case
                if smallest and smallest["text"] < SMALL_TEXT_PX:
                    warnings.append(f"{path.name}: {width}x{height}: smallest stage text is "
                                    f"{smallest['text']:.1f}px at mode {smallest['mode']}, step "
                                    f"{smallest['index'] + 1}; shorten or split the scene")
    except (RuntimeError, Error) as error:
        return [f"{path.name}: layout check failed: {error}"], []
    return errors, warnings


def check_layout(path: Path, css: str = "") -> list[str]:
    """One error per window, scheme, mode and step where the player does not fit."""
    return inspect_layout(path, css)[0]
