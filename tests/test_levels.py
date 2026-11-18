"""Pin dive levels: story validation, the start menu in Chromium, and the per-level exports."""
import base64
import copy
import inspect
import json
from pathlib import Path
import re
import shutil

import pytest

from narrated_explainer import cli, export, layout
from narrated_explainer.bundle import build
from narrated_explainer.check import check_story
from narrated_explainer.story import validate_story

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "levels"
LEVEL_IDS = ["quick", "normal", "full"]
# Steps per (mode, level): intro steps plus the moments, as the fixture's tags select them.
STEPS = {("a", "quick"): 4, ("b", "quick"): 4, ("a", "normal"): 6, ("b", "normal"): 6, ("a", "full"): 7, ("b", "full"): 6}


def fixture_story() -> dict:
    return json.loads((FIXTURE / "story.json").read_text())


def errors_for(change) -> list[str]:
    story = fixture_story()
    change(story)
    return validate_story(story)


def moment(story: dict, identifier: str) -> dict:
    return next(entry for entry in story["moments"] if entry["id"] == identifier)


@pytest.fixture(scope="module")
def folder(tmp_path_factory):
    copy_of = tmp_path_factory.mktemp("levels") / "levels"
    shutil.copytree(FIXTURE, copy_of)
    build(copy_of, no_voice=True)
    return copy_of


# --- validation --------------------------------------------------------------------------------

def test_the_fixture_story_is_valid():
    assert validate_story(fixture_story()) == []


def test_new_labels_are_accepted():
    labels = {"depth": "Tiefe", "chooseDepth": "Wie tief?", "goDeeper": "Tiefer", "changeDepth": "Tiefe ändern",
              "startOver": "Von vorn", "steps": "Schritte", "aboutMin": "etwa {n} Min."}
    assert errors_for(lambda story: story.update(labels=labels)) == []


@pytest.mark.parametrize("levels", [
    [], "quick", [{"id": "quick", "label": "Quick"}], [{"id": "Bad Id", "label": "Q", "blurb": "b"}],
    [{"id": "quick", "label": " ", "blurb": "b"}], ["quick"],
    [{"id": "quick", "label": "Q", "blurb": "b"}, {"id": "quick", "label": "R", "blurb": "c"}],
])
def test_malformed_levels_are_rejected(levels):
    assert errors_for(lambda story: story.update(levels=levels)), levels


def test_unknown_level_id_on_a_moment_or_intro_step_fails():
    assert any("level" in error for error in errors_for(lambda story: moment(story, "s3").update(levels=["deep"])))
    assert any("level" in error for error in errors_for(lambda story: story["intro"][1].update(levels=["deep"])))
    assert any("level" in error for error in errors_for(lambda story: moment(story, "s3").update(levels=[])))


def test_fewer_than_three_moments_names_the_mode_and_level():
    errors = errors_for(lambda story: moment(story, "s4").update(levels=["normal", "full"]))
    assert any("mode a" in error and "level quick" in error and "three moments" in error for error in errors), errors
    assert any("mode b" in error and "level quick" in error for error in errors), errors


def test_a_level_with_no_heart_moment_names_the_mode_and_level():
    def drop_heart(story):
        del moment(story, "s2")["heart"]
        moment(story, "s3")["modes"] = ["a"]
        moment(story, "s3")["heart"] = True
    errors = errors_for(drop_heart)
    assert any("mode b" in error and "heart" in error for error in errors), errors
    assert not any("mode a" in error and "heart" in error for error in errors), errors


def test_intro_steps_do_not_count_as_moments():
    def only_intro(story):
        story["intro"] += [{"id": f"extra-{n}", "caption": "More setup.", "levels": ["quick"]} for n in range(3)]
        moment(story, "s4")["levels"] = ["normal", "full"]
    assert any("level quick" in error and "three moments" in error for error in errors_for(only_intro))


def test_a_story_without_levels_keeps_todays_rules():
    def strip(story):
        del story["levels"]
        for entry in story["intro"] + story["moments"]:
            entry.pop("levels", None)
        story["moments"] = story["moments"][:1]
    assert errors_for(strip) == []


def test_heart_and_level_tags_without_levels_are_allowed_and_ignored():
    def without_levels(story):
        del story["levels"]
    assert errors_for(without_levels) == []


# --- the start menu in Chromium -----------------------------------------------------------------

MENU_JS = """() => {
  const menu = document.querySelector('figure.nx .nx-depth-menu');
  const stage = document.querySelector('figure.nx .nx-stage').getBoundingClientRect();
  if (!menu) return { found: false };
  const cards = [...menu.querySelectorAll('.nx-depth-card')].map((el) => {
    const box = el.getBoundingClientRect();
    return { text: el.textContent, width: box.width, height: box.height, inside: box.left >= stage.left - 1
      && box.right <= stage.right + 1 && box.top >= stage.top - 1 && box.bottom <= stage.bottom + 1 };
  });
  const box = menu.getBoundingClientRect();
  return { found: true, hidden: menu.hidden, shown: Boolean(box.width && box.height), cards, stage: stage.toJSON() };
}"""
FOCUS_JS = """() => {
  const el = document.activeElement;
  return { card: el.classList.contains('nx-depth-card'), outline: getComputedStyle(el).outlineStyle,
           width: parseFloat(getComputedStyle(el).outlineWidth), text: el.textContent };
}"""


def has_menu(live) -> None:
    assert live.page.locator("figure.nx .nx-depth-menu .nx-depth-card").count() == 3, "the story has a start menu with three cards"


def test_cards_are_visible_at_rest_inside_the_stage(folder):
    with layout.LivePage(folder / "dist/levels.html", 1280, 720) as live:
        seen = live.page.evaluate(MENU_JS)
    assert seen["found"] and seen["shown"], seen
    assert all(re.search(r"\d+ steps, about \d+ min", card["text"]) for card in seen["cards"]), seen["cards"]
    assert all(card["width"] > 80 and card["height"] > 40 and card["inside"] for card in seen["cards"]), seen["cards"]


def test_cards_are_keyboard_reachable_with_a_visible_focus(folder):
    with layout.LivePage(folder / "dist/levels.html", 1280, 720) as live:
        has_menu(live)
        reached = []
        for _ in range(40):
            live.page.keyboard.press("Tab")
            state = live.page.evaluate(FOCUS_JS)
            if state["card"]:
                reached.append(state)
                if len(reached) == 3:
                    break
    assert len(reached) == 3, reached
    assert all(state["outline"] != "none" and state["width"] >= 2 for state in reached), reached


def test_the_menu_does_not_move_the_stage(folder):
    with layout.LivePage(folder / "dist/levels.html", 1280, 720) as live:
        has_menu(live)
        shown = live.page.evaluate(MENU_JS)
        live.page.evaluate("() => { document.querySelector('figure.nx .nx-depth-menu').hidden = true; }")
        hidden = live.page.evaluate(MENU_JS)
    assert shown["found"] and shown["shown"] and hidden["found"] and not hidden["shown"], (shown, hidden)
    assert shown["stage"] == hidden["stage"]


def test_clicking_a_card_starts_playing_that_level(folder):
    with layout.LivePage(folder / "dist/levels.html", 1280, 720) as live:
        has_menu(live)
        assert live.page.get_attribute("figure.nx .nx-play", "aria-label") == "Play", "nothing autoplays"
        live.page.click("figure.nx .nx-depth-card >> text=Quick")
        live.page.wait_for_function("document.querySelector('figure.nx .nx-play').getAttribute('aria-label') === 'Pause'")
        state = live.page.evaluate("""() => ({ hidden: document.querySelector('figure.nx .nx-depth-menu').hidden,
          chip: document.querySelector('figure.nx .nx-depth').textContent,
          markers: document.querySelectorAll('figure.nx .nx-marker').length })""")
        live.check_errors()
    assert state == {"hidden": True, "chip": "Quick", "markers": STEPS[("a", "quick")]}


def test_the_chip_reopens_the_menu_and_pauses(folder):
    with layout.LivePage(folder / "dist/levels.html", 1280, 720) as live:
        has_menu(live)
        live.page.click("figure.nx .nx-depth-card >> text=Normal")
        live.page.click("figure.nx .nx-depth")
        state = live.page.evaluate("""() => ({ shown: !document.querySelector('figure.nx .nx-depth-menu').hidden,
          play: document.querySelector('figure.nx .nx-play').getAttribute('aria-label') })""")
    assert state == {"shown": True, "play": "Play"}


# --- the player API and the exports per level ----------------------------------------------------

def test_the_tool_api_takes_a_level_and_defaults_to_the_deepest(folder):
    with layout.LivePage(folder / "dist/levels.html", 1280, 720) as live:
        counts = live.page.evaluate("""() => { const p = NarratedExplainer.players[0];
          return { quick: p.positions('a', 'quick').length, full: p.positions('a', 'full').length, none: p.positions('a').length,
                   short: p.plan('a', 'quick').duration, long: p.plan('a').duration }; }""")
    assert (counts["quick"], counts["full"], counts["none"]) == (STEPS[("a", "quick")], STEPS[("a", "full")], STEPS[("a", "full")])
    assert counts["short"] < counts["long"]


def test_the_layout_check_covers_every_mode_and_level(folder):
    with layout.LivePage(folder / "dist/levels.html", 1280, 720) as live:
        cases = live.measure()
    assert {(case["mode"], case.get("level")) for case in cases} == set(STEPS), cases[:2]
    assert len(cases) == sum(STEPS.values())
    assert layout.inspect_layout(folder / "dist/levels.html")[0] == []


def test_layout_errors_name_the_level(folder):
    errors = layout.inspect_layout(folder / "dist/levels.html", css="figure.nx figcaption { min-height: 3000px !important; }")[0]
    assert any(error.startswith("levels.html: 1280x720 light, mode a, step 1: caption extends") and " at level quick (" in error
               and error.endswith("(fit from the page top)") for error in errors), errors[:2]
    assert any(" at level full (" in error for error in errors) and any(" at level normal (" in error for error in errors)


def test_snapshots_cover_every_level(folder):
    paths = export.snapshots(folder, no_voice=True, width=800)
    names = {path.name for path in paths}
    assert "rest.png" in names
    assert {"a-quick-00-hello.png", "a-full-06-s5.png", "b-normal-05-s4.png"} <= names, sorted(names)
    assert len(names) == 1 + sum(STEPS.values())
    assert not any(name.startswith("a-quick-04") for name in names), "Quick has four steps"


def test_check_warns_without_failing_for_a_level_with_no_sound_cue(folder):
    report = check_story(folder)
    warnings = [warning for warning in report["warnings"] if "sound cue" in warning]
    assert len(warnings) == 2, report["warnings"]
    assert all("level quick" in warning for warning in warnings)
    assert {"mode a", "mode b"} == {part for warning in warnings for part in ("mode a", "mode b") if part in warning}
    assert not any("sound cue" in error for error in report["errors"])


class FakeCapture:
    calls = []

    def __init__(self, path, width=1280, scheme="light"):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def call(self, method, *args):
        self.calls.append((method, args))
        if method == "plan":
            return {"duration": 100, "segments": []}
        if method == "soundtrack":
            return {"sampleRate": 48000, "wavBase64": base64.b64encode(b"wav").decode()}

    def screenshot(self):
        return b"png"

    def prepare_video(self, modes, level=None):
        self.calls.append(("prepare_video", (modes, level)))

    def check_errors(self):
        pass


@pytest.fixture
def fake_video(folder, tmp_path, monkeypatch):
    monkeypatch.setattr(export, "Capture", FakeCapture)
    monkeypatch.setattr(export, "encode_frames", lambda frames, destination, fps, count, format, audio: (list(frames), destination.write_bytes(b"v")))
    FakeCapture.calls = []
    work = tmp_path / "levels"
    shutil.copytree(folder, work, ignore=shutil.ignore_patterns("dist"))
    return work


def test_video_takes_a_level(fake_video):
    assert "level" in inspect.signature(export.video).parameters
    result = export.video(fake_video, mode="b", level="quick", format="mp4", no_voice=True)
    assert ("plan", ("b", "quick")) in FakeCapture.calls
    assert ("soundtrack", ("b", "quick")) in FakeCapture.calls
    assert ("prepare_video", (["b"], "quick")) in FakeCapture.calls
    assert [args for method, args in FakeCapture.calls if method == "renderAt"][0] == ("b", 0, "quick")
    assert result["path"].name == "levels-b-quick.mp4", "an explicit level is part of the default file name"


def test_video_without_a_level_plays_the_deepest(fake_video):
    result = export.video(fake_video, no_voice=True)
    assert ("plan", ("a", "full")) in FakeCapture.calls
    assert result["path"].name == "levels-a.mp4"


def test_video_rejects_an_unknown_level_and_a_level_on_a_story_without_levels(fake_video, tmp_path):
    assert "level" in inspect.signature(export.video).parameters
    with pytest.raises(ValueError, match="Unknown level: deep"):
        export.video(fake_video, level="deep", no_voice=True)
    plain = tmp_path / "plain"
    shutil.copytree(fake_video, plain)
    story = fixture_story()
    del story["levels"]
    (plain / "story.json").write_text(json.dumps(story))
    with pytest.raises(ValueError, match="no levels"):
        export.video(plain, level="quick", no_voice=True)


def test_the_cli_passes_the_level_to_video(folder, monkeypatch, capsys):
    seen = {}
    def fake(directory, **kwargs):
        seen.update(kwargs)
        return {"path": Path("x.mp4"), "duration_ms": 1, "frames": 1, "bytes": 1}
    monkeypatch.setattr(export, "video", fake)
    assert cli.main(["video", "--help"]) == 0
    assert "--level" in capsys.readouterr().out
    assert cli.main(["video", str(folder), "--level", "quick"]) == 0
    assert seen["level"] == "quick"
