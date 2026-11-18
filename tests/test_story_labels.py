"""Every label the player shows can be renamed by a story, including the More menu and Replay labels."""

from narrated_explainer.story import validate_story


def story_with_labels(labels):
    return {"id": "labels", "title": "Labels", "lang": "en",
            "timing": {"end": 10, "unit": "ms", "realMsPerUnit": 30, "holdMs": 1600},
            "atRest": {"mode": "main", "t": 10, "caption": "Press Play."},
            "intro": [{"id": "intro-one", "caption": "The request starts here."}],
            "moments": [{"id": "send", "t": 0, "caption": "The request reaches the server."}],
            "labels": labels}


def test_more_and_replay_labels_are_accepted():
    assert validate_story(story_with_labels({"more": "Options", "replay": "Play again"})) == []


def test_unknown_labels_are_still_rejected():
    assert validate_story(story_with_labels({"moreOptions": "Options"}))
