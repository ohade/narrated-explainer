"""Pin that fitting the stage on resize neither moves a reader's scroll position nor changes the stage size."""
from pathlib import Path
import shutil

import pytest

from narrated_explainer import layout
from narrated_explainer.bundle import build

EXAMPLE = Path(__file__).resolve().parents[1] / "examples" / "deadline-race"
STAGE_WIDTH_JS = "() => document.querySelector('figure.nx .nx-stage').getBoundingClientRect().width"
TOGGLE_JS = "() => document.querySelector('figure.nx .nx-transcript-toggle').click()"
AFTER_STEP_1_JS = "() => NarratedExplainer.players[0].goto('after', 0)"
SCROLL_TO_BOTTOM_JS = "() => { scrollTo(0, document.documentElement.scrollHeight); return scrollY; }"
# Hides the page around the player and keeps the control row and each button label on one line, so the
# space the fit works with does not depend on the default font (DejaVu Sans on Linux is about 10% wider
# than the macOS system font, which wraps the controls and the page title).
FONT_NEUTRAL_CSS = """
body.nx-page > :not(figure.nx) { display: none !important; }
figure.nx .nx-controls, figure.nx .nx-group {
  flex-wrap: nowrap !important; overflow: hidden !important; white-space: nowrap !important;
}
"""
# Stage width at After step 1, light scheme, under FONT_NEUTRAL_CSS with the transcript closed. Measured on
# the fit before the no-reflow change (939bfef) and on this one, identical on macOS and on Linux with DejaVu Sans.
WIDTHS = {(1280, 720): 558, (1440, 900): 761, (1920, 1080): 965,
          (2000, 1174): 1072, (2560, 1440): 1373, (390, 844): 342}


def built(tmp_path_factory, fragment: bool) -> Path:
    folder = tmp_path_factory.mktemp("race") / "deadline-race"
    shutil.copytree(EXAMPLE, folder, ignore=shutil.ignore_patterns("dist"))
    return build(folder, fragment=fragment, no_voice=True)


@pytest.mark.parametrize("fragment", [False, True], ids=["standalone", "fragment"])
def test_resizing_keeps_the_scroll_position_in_an_open_transcript(tmp_path_factory, fragment):
    with layout.LivePage(built(tmp_path_factory, fragment), 390, 844) as live:
        live.page.evaluate(TOGGLE_JS)
        live.page.evaluate(layout.FRAME_JS)
        before = live.page.evaluate(SCROLL_TO_BOTTOM_JS)
        live.resize(390, 790, "light")
        after = live.page.evaluate("() => scrollY")
    assert before > 0
    assert abs(after - before) <= 1, (before, after)


def test_stage_widths_are_unchanged_with_the_transcript_closed_and_open(tmp_path_factory):
    closed, opened = {}, {}
    with layout.LivePage(built(tmp_path_factory, False), 800, 600, css=FONT_NEUTRAL_CSS) as live:
        live.page.evaluate(AFTER_STEP_1_JS)
        for width, height in WIDTHS:
            live.resize(width, height, "light")
            closed[width, height] = live.page.evaluate(STAGE_WIDTH_JS)
            live.page.evaluate(TOGGLE_JS)
            live.resize(width, height - 1, "light")
            live.resize(width, height, "light")
            opened[width, height] = live.page.evaluate(STAGE_WIDTH_JS)
            live.page.evaluate(TOGGLE_JS)
    assert all(abs(closed[window] - expected) <= 1 for window, expected in WIDTHS.items()), closed
    assert all(abs(opened[window] - expected) <= 1 for window, expected in WIDTHS.items()), opened
