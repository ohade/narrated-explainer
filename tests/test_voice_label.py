"""Human voice labels also refresh on unchanged audio reuse."""
import json

import pytest

from test_core import FakeEngine, FakeRecognizer, fake_encoder, folder, story
from narrated_explainer.narration import narrate


@pytest.mark.parametrize("engine_name,voice,label", [
    ("kokoro", "am_michael", "Michael (Kokoro)"),
    ("kokoro", "af_heart", "Heart (Kokoro)"),
    ("http", "local-voice", "local-voice"),
])
def test_voice_label_in_new_and_reused_manifest(folder, story, engine_name, voice, label):
    story["voice"] = {"engine": engine_name, "voice": voice, "speed": 1.0}
    (folder / "story.json").write_text(json.dumps(story))
    engine = FakeEngine()
    first = narrate(folder, engine=engine, recognizer=FakeRecognizer(), encoder=fake_encoder)
    assert first["label"] == label
    first["label"] = "old label"
    (folder / "narration/manifest.json").write_text(json.dumps(first))
    second = narrate(folder, engine=engine, recognizer=FakeRecognizer(), encoder=fake_encoder)
    assert second["label"] == label
    assert engine.calls == 2
