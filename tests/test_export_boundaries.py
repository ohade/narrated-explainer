"""Capture diagnostics and stale-output containment."""
from pathlib import Path

import pytest

from narrated_explainer import capture, export
from narrated_explainer.cli import new_story


def test_snapshot_cleanup_refuses_symlinked_dist(tmp_path, monkeypatch):
    folder = tmp_path / "story"
    new_story(folder)
    outside = tmp_path / "other"
    (outside / "snapshots").mkdir(parents=True)
    stale = outside / "snapshots/keep.png"
    stale.write_bytes(b"keep")
    (folder / "dist").symlink_to(outside, target_is_directory=True)
    monkeypatch.setattr(export, "build", lambda *args, **kwargs: tmp_path / "built.html")
    monkeypatch.setattr(export, "Capture", lambda *args, **kwargs: pytest.fail("Must reject before browser capture"))
    try:
        export.snapshots(folder, no_voice=True)
    except ValueError:
        pass
    assert stale.exists(), "cleanup must not follow a symlinked dist outside the story"


def test_player_api_timeout_has_actionable_diagnostic(tmp_path, monkeypatch):
    html = tmp_path / "timeout.html"
    html.write_text("""<figure class="nx"><figcaption>Ready.</figcaption></figure>
      <script>window.NarratedExplainer={players:[{soundtrack:()=>new Promise(()=>{})}]};</script>""")
    runtime_error = None
    with capture.Capture(html) as browser:
        monkeypatch.setattr(capture, "WAIT_MS", 100)
        try:
            browser.call("soundtrack", "main")
        except Exception as error:
            runtime_error = error
    assert isinstance(runtime_error, RuntimeError), "API timeout must reach CLI with its cause, not a generic library failure"
    assert "Player API timed out: soundtrack" in str(runtime_error)
