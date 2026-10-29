"""Focused validation and reuse regressions."""

import json

import pytest

from test_core import FakeEngine, FakeRecognizer, fake_encoder, folder, story
from narrated_explainer.narration import narrate
from narrated_explainer.story import validate_story


@pytest.mark.parametrize("mutate", [
    lambda value: value["timing"].update(end=None),
    lambda value: value["intro"][0].update(sfx=[]),
])
def test_malformed_story_values_report_without_crashing(story, mutate):
    mutate(story)
    errors = None
    try:
        errors = validate_story(story)
    except TypeError:
        pass  # Convert the observed crash into the contract assertion under test.
    assert isinstance(errors, list) and errors, "malformed JSON fields must return validation errors"


def test_display_only_change_realigns_without_resynthesizing(folder, story):
    story["intro"][0]["say"] = "The request starts here."
    (folder / "story.json").write_text(json.dumps(story))
    engine = FakeEngine()
    narrate(folder, engine=engine, recognizer=FakeRecognizer(), encoder=fake_encoder)
    story["intro"][0]["caption"] = "The request starts right here."
    (folder / "story.json").write_text(json.dumps(story))
    result = narrate(folder, engine=engine, recognizer=FakeRecognizer(), encoder=fake_encoder)
    assert engine.calls == 2, "unchanged spoken key must reuse the existing audio"
    assert len(result["clips"]["intro-one"]["words"]) == 5
