"""REAL inference acceptance; requires the verified model cache."""

import json
from pathlib import Path
import shutil

import pytest

from narrated_explainer.narration import narrate


@pytest.mark.slow
def test_real_local_two_caption_narration(tmp_path):
    source = Path(__file__).parent / "fixtures/two-caption"
    for filename in ("story.json", "scene.js"):
        shutil.copyfile(source / filename, tmp_path / filename)
    manifest = narrate(tmp_path)
    story = json.loads((tmp_path / "story.json").read_text())
    entries = story["intro"] + story["moments"]
    assert len(manifest["clips"]) == 2
    assert "48kbps" in manifest["settings"]["encoder"]
    for entry in entries:
        clip = manifest["clips"][entry["id"]]
        assert clip["score"] >= 0.85
        assert clip["duration"] > 0
        assert len(clip["words"]) == len(entry["caption"].split())
        assert all(0 <= start <= end <= clip["duration"] for start, end in clip["words"])
        assert (tmp_path / "narration" / clip["file"]).stat().st_size > 1000
