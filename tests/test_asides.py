"""Pin asides: story validation, the chips and the panel in Chromium, the layout check and the snapshots."""
import copy
import json
from pathlib import Path
import shutil

from playwright.sync_api import TimeoutError as PlaywrightTimeout
import pytest

from narrated_explainer import capture, export, layout
from narrated_explainer.bundle import build
from narrated_explainer.narration import expected_clips
from narrated_explainer.story import validate_story

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "asides"
# Steps per (mode, level) of the fixture, as in the levels fixture it was made from.
STEPS = {("a", "quick"): 4, ("b", "quick"): 4, ("a", "normal"): 6, ("b", "normal"): 6, ("a", "full"): 7, ("b", "full"): 6}
ASIDE_IDS = ["timed", "late", "tour", "always"]


def fixture_story() -> dict:
    return json.loads((FIXTURE / "story.json").read_text())


def errors_for(change) -> list[str]:
    story = fixture_story()
    change(story)
    return validate_story(story)


def aside(story: dict, identifier: str) -> dict:
    return next(entry for entry in story["asides"] if entry["id"] == identifier)


@pytest.fixture(scope="module")
def folder(tmp_path_factory):
    copy_of = tmp_path_factory.mktemp("asides") / "asides"
    shutil.copytree(FIXTURE, copy_of)
    build(copy_of, no_voice=True)
    return copy_of


# --- validation --------------------------------------------------------------------------------

def test_the_fixture_story_is_valid():
    assert validate_story(fixture_story()) == []


def test_new_labels_are_accepted_and_others_still_rejected():
    assert errors_for(lambda story: story.update(labels={"learnMore": "Mehr erfahren", "close": "Schliessen"})) == []
    assert errors_for(lambda story: story.update(labels={"learnLess": "Weniger"}))


def blurb_of(length):
    return lambda story: aside(story, "timed").update(blurb="b" * length)


def label_of(length):
    return lambda story: aside(story, "timed").update(label="l" * length)


@pytest.mark.parametrize("name,change,word", [
    ("a label of 29 characters", label_of(29), "28"),
    ("an empty label", lambda story: aside(story, "timed").update(label=" "), "label"),
    ("no blurb", lambda story: aside(story, "timed").pop("blurb"), "blurb"),
    ("a blurb of 91 characters", blurb_of(91), "90"),
    ("no body", lambda story: aside(story, "timed").pop("body"), "body"),
    ("an empty body", lambda story: aside(story, "timed").update(body=[]), "body"),
    ("a body that is not a list", lambda story: aside(story, "timed").update(body="text"), "body"),
    ("an unknown block type", lambda story: aside(story, "timed").update(body=[{"type": "img", "text": "x"}]), "block type"),
    ("an html block", lambda story: aside(story, "timed").update(body=[{"type": "html", "text": "<b>x</b>"}]), "block type"),
    ("a paragraph without text", lambda story: aside(story, "timed").update(body=[{"type": "p"}]), "text"),
    ("a code block with empty text", lambda story: aside(story, "timed").update(body=[{"type": "code", "text": ""}]), "text"),
    ("a list without items", lambda story: aside(story, "timed").update(body=[{"type": "list", "items": []}]), "items"),
    ("a list with an empty item", lambda story: aside(story, "timed").update(body=[{"type": "list", "items": ["a", " "]}]), "items"),
    ("a link on a block", lambda story: aside(story, "timed").update(body=[{"type": "p", "text": "x", "href": "https://example.com"}]), "block"),
    ("a block that is not an object", lambda story: aside(story, "timed").update(body=["text"]), "block"),
    ("a from that is no step", lambda story: aside(story, "timed").update({"from": "nowhere"}), "from"),
    ("a to that is no step", lambda story: aside(story, "timed").update({"to": "nowhere"}), "to"),
    ("a to without a from", lambda story: (aside(story, "timed").pop("from"), aside(story, "timed").update({"to": "s3"})), "to"),
    ("a from after its to", lambda story: aside(story, "timed").update({"from": "s4", "to": "s2"}), "after"),
    ("an unknown mode", lambda story: aside(story, "timed").update(modes=["z"]), "modes"),
    ("an empty mode list", lambda story: aside(story, "timed").update(modes=[]), "modes"),
    ("an unknown level", lambda story: aside(story, "timed").update(levels=["deep"]), "levels"),
    ("an id that is a step id", lambda story: aside(story, "timed").update(id="s2"), "step id"),
    ("a repeated id", lambda story: aside(story, "late").update(id="timed"), "twice"),
])
def test_invalid_asides_are_named_in_the_error(name, change, word):
    errors = errors_for(change)
    assert errors, name
    target = "s2" if "step id" in word else "timed"
    assert any(f"aside {target}" in error and word in error for error in errors), (name, errors)


def test_a_from_after_its_to_names_the_mode_and_level_where_both_appear():
    errors = errors_for(lambda story: aside(story, "timed").update({"from": "s4", "to": "s2"}))
    assert any("aside timed" in error and "mode a" in error and "level quick" in error for error in errors), errors


def test_equal_ends_open_ended_windows_and_ends_missing_from_a_level_are_valid():
    def change(story):
        aside(story, "timed").update({"from": "s3", "to": "s3"})
        aside(story, "tour").update({"from": "s1", "to": "s4"})  # s1 is missing at quick: hidden there, not an error
    assert errors_for(change) == []
    assert errors_for(lambda story: aside(story, "late").pop("modes")) == []


def test_asides_that_are_not_an_array_or_not_objects_fail():
    assert errors_for(lambda story: story.update(asides="timed"))
    assert any("aside" in error for error in errors_for(lambda story: story["asides"].append("timed")))
    assert any("aside" in error for error in errors_for(lambda story: story["asides"].append({"label": "no id"})))


def test_a_story_without_asides_validates_and_narrates_as_before():
    story = fixture_story()
    plain = copy.deepcopy(story)
    del plain["asides"]
    assert validate_story(plain) == []
    assert expected_clips(story) == expected_clips(plain), "asides are not narrated"


def test_a_story_without_levels_ignores_level_tags_on_asides():
    def without_levels(story):
        del story["levels"]
        for entry in story["intro"] + story["moments"]:
            entry.pop("levels", None)
    assert errors_for(without_levels) == []  # the tour aside is tagged normal and full, which are ignored
    def unknown_tag(story):
        without_levels(story)
        aside(story, "tour")["levels"] = ["deep"]
    assert errors_for(unknown_tag) == []


# --- the chips and the panel in Chromium ---------------------------------------------------------

CHIPS_JS = """() => [...document.querySelectorAll('figure.nx .nx-aside-chip')]
  .filter((el) => getComputedStyle(el).display !== 'none').map((el) => el.dataset.aside)"""
SAME_CHIPS_JS = """(want) => JSON.stringify([...document.querySelectorAll('figure.nx .nx-aside-chip')]
  .filter((el) => getComputedStyle(el).display !== 'none').map((el) => el.dataset.aside)) === JSON.stringify(want)"""
BOXES_JS = """() => {
  const rect = (el) => { const box = el ? el.getBoundingClientRect() : null; return box && { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height }; };
  const body = document.querySelector('figure.nx .nx-aside-body');
  const panel = document.querySelector('figure.nx .nx-aside-panel');
  return { stage: rect(document.querySelector('figure.nx .nx-stage')), card: rect(document.querySelector('figure.nx .nx-aside-card')),
           close: rect(document.querySelector('figure.nx .nx-aside-close')), panelShown: Boolean(panel && !panel.hidden && panel.getBoundingClientRect().width),
           scrolls: body ? getComputedStyle(body).overflowY : null, sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
           bodyOverflows: body ? body.scrollHeight > body.clientHeight : null };
}"""
FOCUS_JS = """() => { const el = document.activeElement;
  return { chip: el.classList.contains('nx-aside-chip'), outline: getComputedStyle(el).outlineStyle,
           width: parseFloat(getComputedStyle(el).outlineWidth), id: el.dataset.aside || null }; }"""


def settle(live) -> None:
    """Lets the arrival animations run out, so a box is measured at rest and not mid-pop."""
    live.page.evaluate("() => Promise.all(document.getAnimations().map((animation) => animation.finished))")


def chips_are(live, expected: list[str]) -> None:
    """Waits a moment for the chips to settle (a leaving chip fades first), then asserts them."""
    try:
        live.page.wait_for_function(SAME_CHIPS_JS, arg=expected, timeout=2500)
    except PlaywrightTimeout:
        pass
    assert live.page.evaluate(CHIPS_JS) == expected


def choose(live, label: str) -> None:
    live.page.click(f"figure.nx .nx-depth-card >> text={label}")
    live.page.click("figure.nx .nx-play")  # pause where the level starts: the test steps by hand


def inside(inner: dict, outer: dict) -> bool:
    return inner["left"] >= outer["left"] - 1 and inner["right"] <= outer["right"] + 1 \
        and inner["top"] >= outer["top"] - 1 and inner["bottom"] <= outer["bottom"] + 1


def test_a_timed_chip_appears_inside_its_window_and_is_gone_after_it(folder):
    with layout.LivePage(folder / "dist/asides.html", 1280, 720) as live:
        chips_are(live, ["always"])  # at rest only the untimed chip, beside the start menu
        choose(live, "Full")
        seen = [live.page.evaluate(CHIPS_JS)]
        for _ in range(STEPS[("a", "full")] - 1):
            live.page.click("figure.nx .nx-next")
            live.page.wait_for_timeout(350)  # a leaving chip fades out for under 350 ms
            seen.append(live.page.evaluate(CHIPS_JS))
        live.check_errors()
    # hello, setup, s1, s2, s3, s4, s5
    assert seen == [["always"], ["always"], ["tour", "always"], ["timed", "tour", "always"], ["timed", "tour", "always"],
                    ["late", "always"], ["late", "always"]], seen


def test_the_level_and_the_mode_filter_the_chips(folder):
    with layout.LivePage(folder / "dist/asides.html", 1280, 720) as live:
        choose(live, "Quick")  # hello, s2, s3, s4: the tour needs s1, which Quick leaves out
        for _ in range(2):
            live.page.click("figure.nx .nx-next")
        chips_are(live, ["timed", "always"])
        live.page.click("figure.nx .nx-next")
        live.page.click("figure.nx .nx-next")
        chips_are(live, ["late", "always"])
        live.page.click("figure.nx .nx-mode >> text=Mode B")
        chips_are(live, ["always"])


def test_chips_are_keyboard_reachable_with_a_visible_focus(folder):
    with layout.LivePage(folder / "dist/asides.html", 1280, 720) as live:
        chips_are(live, ["always"])
        reached = None
        for _ in range(40):
            live.page.keyboard.press("Tab")
            state = live.page.evaluate(FOCUS_JS)
            if state["chip"]:
                reached = state
                break
        assert reached is not None, "Tab never reached a chip"
        assert reached["outline"] != "none" and reached["width"] >= 2, reached
        live.page.keyboard.press("Enter")
        live.page.wait_for_selector("figure.nx .nx-aside-panel", state="visible", timeout=2500)
        live.page.keyboard.press("Escape")
        live.page.wait_for_selector("figure.nx .nx-aside-panel", state="hidden", timeout=2500)
        assert live.page.evaluate(FOCUS_JS)["id"] == "always", "focus returns to the chip"


@pytest.mark.parametrize("width,height", [(1280, 720), (390, 844)])
def test_the_panel_fits_inside_the_stage_and_scrolls_when_long(folder, width, height):
    with layout.LivePage(folder / "dist/asides.html", width, height) as live:
        chips_are(live, ["always"])
        live.page.click('figure.nx [data-aside="always"]')
        live.page.wait_for_selector("figure.nx .nx-aside-panel", state="visible", timeout=2500)
        settle(live)
        boxes = live.page.evaluate(BOXES_JS)
        title = live.page.inner_text("figure.nx .nx-aside-title")
        live.check_errors()
    assert boxes["panelShown"] and boxes["card"] and boxes["close"], boxes
    assert inside(boxes["card"], boxes["stage"]), boxes
    assert inside(boxes["close"], boxes["stage"]) and boxes["close"]["width"] >= 44 and boxes["close"]["height"] >= 44, boxes
    assert boxes["scrolls"] == "auto" and boxes["sideways"] <= 0, boxes
    assert title == "What is a stage?"
    if width < 600:
        assert boxes["bodyOverflows"], "at 390 px the long body scrolls inside the panel"


def test_the_chips_and_the_panel_do_not_move_the_stage(folder):
    with layout.LivePage(folder / "dist/asides.html", 1280, 720) as live:
        chips_are(live, ["always"])
        with_chip = live.page.evaluate(BOXES_JS)["stage"]
        live.page.add_style_tag(content="figure.nx .nx-asides { display: none !important; }")
        without_chip = live.page.evaluate(BOXES_JS)["stage"]
    assert with_chip is not None and with_chip == without_chip
    with layout.LivePage(folder / "dist/asides.html", 1280, 720) as live:
        before = live.page.evaluate(BOXES_JS)["stage"]
        live.page.click('figure.nx [data-aside="always"]')
        live.page.wait_for_selector("figure.nx .nx-aside-panel", state="visible", timeout=2500)
        assert live.page.evaluate(BOXES_JS)["stage"] == before


def test_goto_and_the_tool_api_show_no_chip_but_showasides_does(folder):
    with layout.LivePage(folder / "dist/asides.html", 1280, 720) as live:
        assert live.page.evaluate("() => typeof NarratedExplainer.players[0].showAsides") == "function"
        live.page.evaluate("() => NarratedExplainer.players[0].goto('a', 3, 'full')")
        chips_are(live, [])
        assert live.page.evaluate("() => { const panel = document.querySelector('figure.nx .nx-aside-panel'); return !panel || panel.hidden; }") is True
        live.page.evaluate("() => NarratedExplainer.players[0].showAsides('a', 3, 'full', 'timed')")
        chips_are(live, ["timed", "tour", "always"])
        assert live.page.inner_text("figure.nx .nx-aside-title") == "Why it matters"


# --- the layout check and the snapshots ----------------------------------------------------------

def test_the_layout_check_passes_for_the_fixture(folder):
    errors, warnings = layout.inspect_layout(folder / "dist/asides.html")
    assert errors == [], errors[:3]
    assert not any("three" in warning for warning in warnings), warnings


def test_the_layout_check_reports_a_rail_or_a_panel_outside_the_stage(folder):
    page = folder / "dist/asides.html"
    wide = layout.inspect_layout(page, css="figure.nx .nx-asides { width: 5000px !important; max-width: none !important; }")[0]
    assert any("chip rail" in error and "outside the stage" in error and error.startswith("asides.html: 1280x720") for error in wide), wide[:3]
    tall = layout.inspect_layout(page, css="figure.nx .nx-aside-card { min-height: 9000px !important; }")[0]
    assert any("aside always" in error and "panel" in error and "outside the stage" in error for error in tall), tall[:3]
    assert any("390x844" in error and "aside timed" in error for error in tall), "the 390 px window is measured too"


def test_the_check_warns_without_failing_when_more_than_three_asides_can_show(folder, tmp_path):
    crowded = tmp_path / "asides"
    shutil.copytree(FIXTURE, crowded)
    story = fixture_story()
    story["asides"] += [{"id": f"extra-{n}", "label": f"Extra {n}", "blurb": "One too many.", "body": [{"type": "p", "text": "More."}]}
                        for n in range(2)]
    (crowded / "story.json").write_text(json.dumps(story))
    assert validate_story(story) == [], "too many chips is a warning, not an error"
    page = build(crowded, no_voice=True)
    errors, warnings = layout.inspect_layout(page)
    assert errors == [], errors[:3]
    assert any("asides can show" in warning and "three" in warning for warning in warnings), warnings


class SpyCapture(capture.Capture):
    """The real capture, recording every player call made through it."""
    calls: list = []

    def call(self, method, *args):
        self.calls.append((method, args))
        return super().call(method, *args)


def test_snapshots_open_each_panel_at_a_frame_that_offers_its_aside(folder, monkeypatch):
    monkeypatch.setattr(export, "Capture", SpyCapture)
    SpyCapture.calls = []
    export.snapshots(folder, no_voice=True, width=800)
    opened = {args[3]: args[:3] for method, args in SpyCapture.calls if method == "showAsides"}
    # the deepest level of the first mode that offers the aside, at its first position there
    assert opened == {"timed": ("a", 3, "full"), "late": ("a", 5, "full"), "tour": ("a", 2, "full"), "always": ("a", 0, "full")}, opened


def test_capture_never_shows_the_chip_rail(folder):
    with capture.Capture(folder / "dist/asides.html") as browser:
        display = browser.page.evaluate("""() => { const rail = document.querySelector('figure.nx .nx-asides');
          return rail ? getComputedStyle(rail).display : 'missing'; }""")
    assert display == "none"


def test_snapshots_write_one_picture_per_aside_with_its_panel_open(folder):
    paths = export.snapshots(folder, no_voice=True, width=800)
    names = {path.name for path in paths}
    assert {f"aside-{identifier}.png" for identifier in ASIDE_IDS} <= names, sorted(names)
    assert len(names) == 1 + sum(STEPS.values()) + len(ASIDE_IDS)
    sizes = {name: (folder / "dist/snapshots" / name).stat().st_size for name in names}
    assert all(sizes[f"aside-{identifier}.png"] > 1000 for identifier in ASIDE_IDS)
    assert len({(folder / "dist/snapshots" / f"aside-{identifier}.png").read_bytes() for identifier in ASIDE_IDS}) == len(ASIDE_IDS)
