"""Pin that the stage fits the screen in fullscreen and that its size never depends on what came before."""
from pathlib import Path
import shutil

import pytest

from narrated_explainer import layout
from narrated_explainer.bundle import build

EXAMPLE = Path(__file__).resolve().parents[1] / "examples" / "deadline-race"
WINDOWS = [(1280, 720), (1440, 900), (1920, 1080), (2000, 1174), (2560, 1440), (390, 844)]
STAGE_WIDTH_JS = "() => document.querySelector('figure.nx .nx-stage').getBoundingClientRect().width"
TOGGLE_JS = "() => document.querySelector('figure.nx .nx-transcript-toggle').click()"
AFTER_STEP_1_JS = "() => NarratedExplainer.players[0].goto('after', 0)"
SCROLL_TO_BOTTOM_JS = "() => { scrollTo(0, document.documentElement.scrollHeight); return scrollY; }"
EDGES_JS = """() => {
  const figure = document.querySelector('figure.nx');
  const style = getComputedStyle(figure);
  return {
    full: document.fullscreenElement === figure,
    width: figure.querySelector('.nx-stage').getBoundingClientRect().width,
    stage: figure.querySelector('.nx-stage').getBoundingClientRect().bottom,
    caption: figure.querySelector('.nx-caption').getBoundingClientRect().bottom,
    screen: innerHeight,
    natural: figure.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
    sideways: figure.scrollWidth - figure.clientWidth,
  };
}"""


def built(tmp_path_factory, fragment: bool) -> Path:
    folder = tmp_path_factory.mktemp("race") / "deadline-race"
    shutil.copytree(EXAMPLE, folder, ignore=shutil.ignore_patterns("dist"))
    return build(folder, fragment=fragment, no_voice=True)


def enter(live) -> None:
    live.page.click("figure.nx .nx-fullscreen")
    live.page.wait_for_function("() => document.fullscreenElement === document.querySelector('figure.nx')")
    live.page.evaluate(layout.FRAME_JS)


def leave(live) -> None:
    live.page.evaluate("() => document.exitFullscreen()")
    live.page.wait_for_function("() => !document.fullscreenElement")
    live.page.evaluate(layout.FRAME_JS)


def width(live) -> float:
    return live.page.evaluate(STAGE_WIDTH_JS)


def toggle(live) -> None:
    live.page.evaluate(TOGGLE_JS)
    live.page.evaluate(layout.FRAME_JS)


@pytest.mark.parametrize("fragment", [False, True], ids=["standalone", "fragment"])
def test_fullscreen_fits_the_stage_and_caption_in_every_window(tmp_path_factory, fragment):
    edges = {}
    with layout.LivePage(built(tmp_path_factory, fragment), 800, 600) as live:
        live.page.evaluate(AFTER_STEP_1_JS)
        for window in WINDOWS:
            live.resize(*window, "light")
            enter(live)
            edges[window] = live.page.evaluate(EDGES_JS)
            leave(live)
    for window, edge in edges.items():
        assert edge["full"], (window, edge)
        assert edge["stage"] <= edge["screen"] + 1, (window, edge)
        assert edge["caption"] <= edge["screen"] + 1, (window, edge)
        assert edge["width"] >= min(120, edge["natural"]) - 1, (window, edge)
        assert edge["sideways"] <= 0, (window, edge)


@pytest.mark.parametrize("window", [(1440, 900), (390, 844)], ids=["1440x900", "390x844"])
@pytest.mark.parametrize("fragment", [False, True], ids=["standalone", "fragment"])
def test_fullscreen_width_depends_only_on_the_window(tmp_path_factory, fragment, window):
    with layout.LivePage(built(tmp_path_factory, fragment), 800, 600) as live:
        live.page.evaluate(AFTER_STEP_1_JS)
        live.resize(*window, "light")
        windowed = width(live)
        enter(live)
        entered = width(live)
        toggle(live)
        opened = width(live)
        live.resize(window[0], window[1] - 1, "light")
        live.resize(*window, "light")
        resized = width(live)
        toggle(live)
        closed = width(live)
        leave(live)
        left = width(live)
        toggle(live)
        scrolled_to = live.page.evaluate(SCROLL_TO_BOTTOM_JS)
        enter(live)
        scrolled = width(live)
    history = {"opened": opened, "resized": resized, "closed": closed}
    assert all(abs(value - entered) <= 1 for value in history.values()), (entered, history)
    assert scrolled_to > 0
    assert abs(scrolled - entered) <= 1, (entered, scrolled)
    assert abs(left - windowed) <= 1, (windowed, left)
