"""Real media and renderer-stall regression checks (local fixtures only)."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys

import pytest


def write_story(folder: Path, *, stall: bool = False) -> None:
    folder.mkdir()
    story = {
        "id": "duration-check", "title": "Duration check", "lang": "en",
        "timing": {"end": 1, "unit": "ms", "realMsPerUnit": 101,
                   "holdMs": 0, "speeds": [1]},
        "atRest": {"mode": "main", "t": 0, "caption": "Ready"},
        "moments": [{"id": "start", "t": 0, "caption": "Start", "sfx": "click"},
                    {"id": "end", "t": 1, "caption": "End"}],
    }
    (folder / "story.json").write_text(json.dumps(story))
    draw = "if(state.t===1){while(true){}}" if stall else "label.textContent=String(state.t);"
    (folder / "scene.js").write_text("""NarratedExplainer.scene(function(story,kit){
      let label;return {
        stateAt(mode,t){return {t};},
        build(stage){const svg=kit.svg(stage,'0 0 200 100','Fixture');
          label=kit.text(svg,20,50,'');},
        draw(state,ctx){""" + draw + "}};});")


def test_synchronous_scene_draw_has_host_timed_deadline(tmp_path):
    folder = tmp_path / "story"
    write_story(folder, stall=True)
    script = """
import sys
from pathlib import Path
from narrated_explainer import capture, export
original = capture.Capture.__enter__
def enter(self):
    result = original(self)
    capture.WAIT_MS = 100
    return result
capture.Capture.__enter__ = enter
try:
    export.snapshots(Path(sys.argv[1]), no_voice=True, width=320)
except RuntimeError as error:
    assert 'Player API timed out: goto' in str(error), str(error)
    assert error.__cause__ is not None
    print('bounded synchronous draw timeout; browser closed')
else:
    raise AssertionError('synchronous draw stall must fail')
"""
    process = subprocess.Popen(
        [sys.executable, "-c", script, str(folder)],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True,
    )
    try:
        stdout, stderr = process.communicate(timeout=4)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGTERM)
        process.communicate(timeout=3)
        pytest.fail("synchronous scene draw must return a bounded API timeout")
    assert process.returncode == 0, stderr
    assert "bounded synchronous draw timeout; browser closed" in stdout
