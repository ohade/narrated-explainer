"""Offline contract checks."""
import hashlib
import json

import pytest

from narrated_explainer.bundle import build, inspect_html
from narrated_explainer.models import fetch_file
from narrated_explainer.narration import clip_key, narrate, stale_reasons
from narrated_explainer.speech import align_words, assess, spoken_text
from narrated_explainer.story import validate_story


@pytest.fixture
def story():
    return {"id": "test-story", "title": "A clear story", "lang": "en",
            "timing": {"end": 10, "unit": "ms", "realMsPerUnit": 30,
                       "holdMs": 1600, "speeds": [0.5, 1]},
            "atRest": {"mode": "main", "t": 10, "caption": "Press Play."},
            "intro": [{"id": "intro-one", "caption": "The request starts here."}],
            "moments": [{"id": "send", "t": 0, "caption": "The request reaches the server."}]}


@pytest.fixture
def folder(tmp_path, story):
    (tmp_path / "story.json").write_text(json.dumps(story))
    (tmp_path / "scene.js").write_text("NarratedExplainer.scene(() => ({}));")
    return tmp_path


def test_spoken_rules_and_whole_words():
    assert spoken_text("✓ API & APIs wait 200 ms at 50%.", {"API": "A P I"}) == "A P I and APIs wait 200 milliseconds at 50 percent."
    assert spoken_text("ignored ✓", {"API": "A P I"}, "API & 2 ms") == "A P I and 2 milliseconds"


@pytest.mark.parametrize("expected,heard", [
    ("Wait 200 milliseconds", "Wait two hundred milliseconds"),
    ("Wait 0.5 seconds", "Wait point five seconds"),
    ("Wait 0.5 seconds", "Wait zero point five seconds"),
    ("There are 1,500 requests", "There are fifteen hundred requests"),
    ("There are 1500 requests", "There are one thousand five hundred requests"),
])
def test_semantic_numbers_pass(expected, heard):
    score, passed = assess(expected, heard)
    assert score >= 0.85 and passed


@pytest.mark.parametrize("expected,heard", [
    ("The timer waits for 80 milliseconds before sending the request", "The timer waits for 18 milliseconds before sending the request"),
    ("Wait 200 then wait 200", "Wait two hundred then wait"),
    ("one two three four five six", "six five four three two one"),
])
def test_numbers_and_order_reject(expected, heard):
    assert assess(expected, heard)[1] is False


def test_alignment_maps_expanded_words_to_display():
    words = [{"word": value, "start": i * 0.2, "end": (i + 1) * 0.2}
             for i, value in enumerate("A P I waits two hundred milliseconds".split())]
    aligned = align_words("API waits 200 ms", "A P I waits 200 milliseconds", words, 1.4)
    assert len(aligned) == 4
    assert aligned[0] == pytest.approx([0, 0.6])
    assert aligned[2] == pytest.approx([0.8, 1.2])
    assert aligned[-1] == pytest.approx([1.2, 1.4])


@pytest.mark.parametrize("mutate", [
    lambda s: s.update(id="../escape"),
    lambda s: s["moments"][0].update(id="intro-one"),
    lambda s: s["moments"][0].update(t=11),
    lambda s: s["moments"][0].pop("t"),
    lambda s: s["intro"][0].update(t=0),
    lambda s: s["moments"][0].update(modes=["unknown"]),
    lambda s: s["intro"][0].update(sfx="unknown"),
    lambda s: s["timing"].update(realMsPerUnit=0),
    lambda s: s["timing"].update(end=True),
    lambda s: s.update(labels={"unknown": "text"}),
    lambda s: s.update(voice={"speed": 0}),
    lambda s: s.update(intro=None),
])
def test_invalid_stories_report_errors(story, mutate):
    mutate(story)
    assert validate_story(story)


def test_valid_story(story):
    assert validate_story(story) == []


def test_cache_hash_verification_and_atomic_failure(tmp_path):
    source, target = tmp_path / "source", tmp_path / "model"
    source.write_bytes(b"verified model bytes")
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    assert fetch_file(target, source.as_uri(), digest) is True
    assert fetch_file(target, "file:///does-not-exist", digest) is False
    with pytest.raises(ValueError, match="SHA-256"):
        fetch_file(target, source.as_uri(), "0" * 64)
    assert target.read_bytes() == source.read_bytes()


def fake_encoder(samples, rate, destination):
    destination.write_bytes(b"fixture audio")
    return "fixture-encoder"


class FakeEngine:
    calls = 0

    def synthesize(self, text, voice, speed):
        self.calls += 1
        return [0] * 16000, 16000


class FakeRecognizer:
    def transcribe(self, path):
        text = "The request starts here." if "intro-one" in path.name else "The request reaches the server."
        words = [{"word": word, "start": i * 0.2, "end": (i + 1) * 0.2}
                 for i, word in enumerate(text.split())]
        return text, words, 1.0


def test_narration_reuse_staleness_and_rollback(folder, story):
    engine = FakeEngine()
    manifest = narrate(folder, engine=engine, recognizer=FakeRecognizer(), encoder=fake_encoder)
    assert len(manifest["clips"]) == 2 and engine.calls == 2
    for clip in manifest["clips"].values():
        assert clip["score"] >= 0.85
        assert clip["key"] == clip_key("kokoro", "am_michael", 1.0, clip["spoken"])
    original = (folder / "narration/manifest.json").read_bytes()
    narrate(folder, engine=engine, recognizer=FakeRecognizer(), encoder=fake_encoder)
    assert engine.calls == 2
    story["moments"][0]["caption"] = "A changed caption."
    assert stale_reasons(story, manifest)
    (folder / "story.json").write_text(json.dumps(story))
    with pytest.raises(ValueError, match="three takes"):
        narrate(folder, engine=engine, recognizer=FakeRecognizer(), encoder=fake_encoder)
    assert engine.calls == 5
    assert (folder / "narration/manifest.json").read_bytes() == original


def test_bundle_escapes_json_and_inlines_resources(folder, story, tmp_path):
    resources = tmp_path / "resources"
    resources.mkdir()
    for name in ("kit.js", "sfx.js", "player.js", "player.css"):
        (resources / name).write_text("/* " + name + " */")
    story["title"] = "A </script><script>alert(1)</script> title"
    (folder / "story.json").write_text(json.dumps(story))
    output = build(folder, resources=resources)
    assert output.is_file()
    html = output.read_text()
    assert "Content-Security-Policy" in html
    assert "connect-src 'none'" in html
    assert "<h1>A &lt;/script&gt;" in html
    assert "<\\/script>" in html
    assert "NarratedExplainer.mount" in html
    assert inspect_html(html) == []
    fragment = build(folder, fragment=True, resources=resources).read_text()
    assert "<figure" in fragment and "<h1>" not in fragment


@pytest.mark.parametrize("content", [
    '<img src="https://example.test/image">',
    '<link rel="stylesheet" href="https://example.test/style">',
    'fetch("https://example.test/data")',
    'new XMLHttpRequest()', 'new WebSocket("wss://example.test")',
    'import("https://example.test/code")', 'eval("code")', 'new Function("code")',
])
def test_bundle_rejects_network_and_dynamic_code(content):
    assert inspect_html(content)
