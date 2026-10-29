"""Pin that the live player's stage never collapses, and that the check catches a collapsed stage."""
from pathlib import Path
import re
import shutil

import pytest

from narrated_explainer import layout
from narrated_explainer.bundle import build
from narrated_explainer.story import load_story, validate_story

EXAMPLE = Path(__file__).resolve().parents[1] / "examples" / "deadline-race"
STAGE_WIDTH_JS = "() => document.querySelector('figure.nx .nx-stage').getBoundingClientRect().width"
TOGGLE_JS = "() => document.querySelector('figure.nx .nx-transcript-toggle').click()"
COLLAPSED = "figure.nx .nx-stage { max-width: 0px !important; }"
TALL_CAPTION = "figure.nx .nx-caption { min-height: 1500px; }"


def built(tmp_path_factory, fragment: bool = False) -> Path:
    folder = tmp_path_factory.mktemp("race") / "deadline-race"
    shutil.copytree(EXAMPLE, folder, ignore=shutil.ignore_patterns("dist"))
    return build(folder, fragment=fragment, no_voice=True)


@pytest.fixture(scope="module")
def page(tmp_path_factory):
    return built(tmp_path_factory)


def stage_width(live) -> float:
    live.page.evaluate(layout.FRAME_JS)
    return live.page.evaluate(STAGE_WIDTH_JS)


@pytest.mark.parametrize("width, height", [(1280, 720), (1920, 1080)])
def test_opening_and_closing_the_transcript_keeps_the_stage_size(page, width, height):
    with layout.LivePage(page, width, height) as live:
        fitted = stage_width(live)
        live.page.evaluate(TOGGLE_JS)
        opened = stage_width(live)
        live.page.evaluate(TOGGLE_JS)
        closed = stage_width(live)
    assert fitted > 0
    assert abs(opened - fitted) <= 1 and abs(closed - fitted) <= 1, (fitted, opened, closed)


def test_a_short_window_keeps_a_minimum_stage_and_recovers(page):
    with layout.LivePage(page, 1280, 720) as live:
        fitted = stage_width(live)
        live.resize(1280, 150, "light")
        short = stage_width(live)
        live.resize(1280, 720, "light")
        restored = stage_width(live)
    assert short >= 120, short
    assert abs(restored - fitted) <= 1, (fitted, restored)


def test_check_reports_a_collapsed_stage_and_its_text_as_zero(page):
    errors, warnings = layout.inspect_layout(page, css=COLLAPSED)
    assert any("zero width or height" in error for error in errors), errors[:3]
    sizes = [float(size) for warning in warnings for size in re.findall(r"is ([\d.]+)px", warning)]
    assert sizes and all(size == 0 for size in sizes), warnings


def test_story_may_localise_the_theme_labels():
    story = load_story(EXAMPLE)
    story["labels"] = {**story.get("labels", {}), "themeAuto": "Auto", "themeLight": "Clair", "themeDark": "Sombre"}
    assert validate_story(story) == []


def test_overflow_errors_name_the_fit_rule(page):
    errors = layout.check_layout(page, css=TALL_CAPTION)
    assert any(error.startswith(f"{page.name}: 1920x1080 ") and error.endswith("(fit from the page top)")
               for error in errors), errors[:3]
    assert any(error.startswith(f"{page.name}: 390x844 ") and error.endswith("(fit from the figure top)")
               for error in errors), errors[:3]


def test_fragment_build_fits_every_window(tmp_path_factory):
    assert layout.check_layout(built(tmp_path_factory, fragment=True)) == []
