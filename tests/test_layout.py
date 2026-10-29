"""Pin the live player's fit to common windows, export geometry and the theme switch in Chromium."""
from pathlib import Path
import shutil

import pytest

from narrated_explainer import capture, layout
from narrated_explainer.bundle import build
from narrated_explainer.check import check_story

EXAMPLE = Path(__file__).resolve().parents[1] / "examples" / "deadline-race"
NO_FIT = "figure.nx .nx-stage { max-width: none !important; }"
LIGHT_PAGE, DARK_PAGE = "rgb(255, 255, 255)", "rgb(21, 23, 26)"


@pytest.fixture(scope="module")
def race(tmp_path_factory):
    folder = tmp_path_factory.mktemp("race") / "deadline-race"
    shutil.copytree(EXAMPLE, folder, ignore=shutil.ignore_patterns("dist"))
    build(folder)
    return folder


def test_example_fits_every_window_scheme_mode_and_step(race):
    assert layout.check_layout(race / "dist/deadline-race.html") == []


def test_layout_check_reports_overflow_when_the_fit_is_disabled(race):
    errors = layout.check_layout(race / "dist/deadline-race.html", css=NO_FIT)
    assert any(error.startswith("deadline-race.html: 1920x1080 dark, mode before, step 1: stage extends")
               for error in errors), errors[:3]
    assert any("2000x1174 light" in error and "caption extends" in error for error in errors), errors[:3]


def test_check_reports_missing_chromium_with_the_setup_hint(race, monkeypatch):
    def missing(playwright):
        raise RuntimeError("Chromium is missing; run uv run playwright install chromium or rerun setup.sh")
    monkeypatch.setattr(layout, "launch_browser", missing)
    report = check_story(race)
    assert report["ok"] is False
    assert any("deadline-race.html" in error and "uv run playwright install chromium" in error
               for error in report["errors"]), report["errors"]


def test_capture_keeps_the_stage_geometry_at_width_1280(race):
    # Measured on the player before the fit rule existed.
    with capture.Capture(race / "dist/deadline-race.html", width=1280) as browser:
        box = browser.figure.locator(".nx-stage").bounding_box()
    assert box == {"x": 0, "y": 125, "width": 1280, "height": 1130.65625}


PAGE_COLOURS_JS = """(presses) => {
  const button = document.querySelector('figure.nx .nx-theme');
  if (!button) return null;
  for (let i = 0; i < presses; i += 1) button.click();
  const page = (el) => getComputedStyle(el).backgroundColor;
  return { label: button.textContent, figure: page(document.querySelector('figure.nx')), body: page(document.body) };
}"""


@pytest.mark.parametrize("scheme,presses,label,colour", [
    ("light", 2, "Theme: Dark", DARK_PAGE),
    ("dark", 1, "Theme: Light", LIGHT_PAGE),
])
def test_theme_choice_overrides_the_system_scheme_on_figure_and_page(race, scheme, presses, label, colour):
    with layout.LivePage(race / "dist/deadline-race.html", scheme=scheme) as live:
        seen = live.page.evaluate(PAGE_COLOURS_JS, presses)
    assert seen is not None, "the player has a Theme control"
    assert seen == {"label": label, "figure": colour, "body": colour}
