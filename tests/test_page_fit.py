"""Pin the standalone page's first view and the small-text warning in Chromium."""
from pathlib import Path
import shutil

import pytest

from narrated_explainer import layout
from narrated_explainer.bundle import build
from narrated_explainer.check import check_story

ROOT = Path(__file__).resolve().parents[1]
LANDSCAPE = [(width, height) for width, height in layout.WINDOWS if width >= height]

# At scroll 0, how far the stage or caption reaches past the window at each mode and step.
PAGE_TOP_JS = """() => {
  const player = NarratedExplainer.players[0];
  const figure = player.figure;
  const modes = player.story.modes && player.story.modes.length ? player.story.modes.map((m) => m.id) : ['main'];
  const parts = [figure.querySelector('.nx-stage'), ...figure.querySelectorAll('.nx-stage svg'),
                 figure.querySelector('figcaption')];
  const past = [];
  for (const mode of modes) {
    player.positions(mode).forEach((_, index) => {
      player.goto(mode, index);
      scrollTo(0, 0);
      const reach = Math.max(...parts.map((el) => {
        const box = el.getBoundingClientRect();
        return Math.max(0, box.bottom - innerHeight, box.right - innerWidth, -box.top, -box.left);
      }));
      if (reach > 0.5) past.push(`mode ${mode}, step ${index + 1}: ${Math.round(reach)}px`);
    });
  }
  return past;
}"""


def built(tmp_path_factory, source: Path) -> Path:
    folder = tmp_path_factory.mktemp(source.name) / source.name
    shutil.copytree(source, folder, ignore=shutil.ignore_patterns("dist"))
    build(folder, no_voice=True)
    return folder


@pytest.fixture(scope="module")
def race(tmp_path_factory):
    return built(tmp_path_factory, ROOT / "examples" / "deadline-race")


def test_standalone_page_fits_from_its_top_in_landscape_windows(race):
    overflow = []
    with layout.LivePage(race / "dist/deadline-race.html") as live:
        for scheme in layout.SCHEMES:
            for width, height in LANDSCAPE:
                live.resize(width, height, scheme)
                overflow += [f"{width}x{height} {scheme}, {case}" for case in live.page.evaluate(PAGE_TOP_JS)]
    assert overflow == []


def test_check_warns_once_per_window_when_stage_text_is_small(tmp_path_factory):
    folder = built(tmp_path_factory, ROOT / "tests" / "fixtures" / "tall-stage")
    warnings = check_story(folder)["warnings"]
    small = [warning for warning in warnings if "tall-stage.html" in warning and "shorten or split" in warning]
    assert any(warning.startswith("tall-stage.html: 1440x900:") for warning in small), warnings
    assert len(small) == len(layout.WINDOWS), small
