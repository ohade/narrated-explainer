"""Pin v1 format rejection before story or encoder work."""
from unittest.mock import Mock

import pytest

from narrated_explainer import cli, encoding, export


def test_video_parser_rejects_webm(capsys):
    with pytest.raises(SystemExit) as error:
        cli._parser().parse_args(["video", "story", "--format", "webm"])
    assert error.value.code == 2
    assert "invalid choice: 'webm'" in capsys.readouterr().err


def test_video_rejects_webm_before_story_build_or_capture(tmp_path, monkeypatch):
    load = Mock(side_effect=AssertionError("WebM must be rejected before loading a story"))
    build = Mock()
    capture = Mock()
    monkeypatch.setattr(export, "load_story", load)
    monkeypatch.setattr(export, "build", build)
    monkeypatch.setattr(export, "Capture", capture)
    with pytest.raises(ValueError, match="^Format must be mp4 or gif$"):
        export.video(tmp_path / "absent", format="webm", out=tmp_path / "output/video.webm")
    load.assert_not_called()
    build.assert_not_called()
    capture.assert_not_called()
    assert not (tmp_path / "output").exists()


def test_encoder_rejects_webm(tmp_path):
    with pytest.raises(ValueError, match="format"):
        encoding.encoder_command(tmp_path / "out.webm", 30, 4, "webm", tmp_path / "audio.wav")
