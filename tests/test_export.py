"""Pin frame, browser, output and encoder export contracts."""
import base64
import json
from pathlib import Path
import struct
from types import SimpleNamespace

import pytest

from narrated_explainer import capture, cli, encoding, export
from narrated_explainer.cli import new_story


@pytest.mark.parametrize("duration,fps,expected", [
    (100, 30, [0, 1000 / 30, 100]),
    (101, 30, [0, 1000 / 30, 2000 / 30, 101]),
    (10, 12, [10]),
])
def test_exact_count_and_final_state(duration, fps, expected):
    assert list(export.frame_times(duration, fps)) == pytest.approx(expected)


@pytest.mark.parametrize("duration,fps", [(0, 30), (-1, 30), (100, 0), (100, -1), (100, float("nan"))])
def test_invalid_schedule_rejected(duration, fps):
    with pytest.raises(ValueError):
        list(export.frame_times(duration, fps))


class FakeCapture:
    calls = []
    options = []
    fail = False

    def __init__(self, path, width=1280, scheme="light"):
        self.options.append((width, scheme))
        self.current_caption = "Rest"

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def call(self, method, *args):
        self.calls.append((method, args))
        if method == "positions":
            return [{"id": "arrive", "caption": "Arrive"}, {"id": "leave", "caption": "Leave"}]
        if method == "goto":
            self.current_caption = ["Arrive", "Leave"][args[1]]
        if method == "plan":
            return {"duration": 100, "segments": []}
        if method == "soundtrack":
            return {"sampleRate": 48000, "wavBase64": base64.b64encode(b"fixture-wav").decode()}

    def caption(self):
        return "Mismatch" if self.fail else self.current_caption

    def screenshot(self):
        return b"fixture-png"

    def prepare_video(self, modes):
        self.calls.append(("prepare_video", (modes,)))

    def check_errors(self):
        pass


@pytest.fixture
def fake_story(tmp_path, monkeypatch):
    new_story(tmp_path / "story")
    folder = tmp_path / "story"
    story = json.loads((folder / "story.json").read_text())
    story["modes"] = [{"id": "first", "label": "First"}, {"id": "second", "label": "Second"}]
    story["atRest"]["mode"] = "first"
    (folder / "story.json").write_text(json.dumps(story))
    FakeCapture.calls = []
    FakeCapture.options = []
    FakeCapture.fail = False
    monkeypatch.setattr(export, "Capture", FakeCapture, raising=False)
    return folder


def test_snapshots_rebuild_and_stale_png_scope(fake_story):
    output = fake_story / "dist/snapshots"
    output.mkdir(parents=True)
    (output / "stale.png").write_bytes(b"old")
    (output / "keep.txt").write_text("keep")
    (fake_story / "dist/elsewhere.png").write_bytes(b"keep")
    result = export.snapshots(fake_story, no_voice=True, width=900, scheme="dark")
    assert {p.name for p in result} == {"rest.png", "first-00-arrive.png", "first-01-leave.png", "second-00-arrive.png", "second-01-leave.png"}
    assert not (output / "stale.png").exists()
    assert (output / "keep.txt").read_text() == "keep"
    assert (fake_story / "dist/elsewhere.png").exists()
    html = fake_story / "dist" / (json.loads((fake_story / "story.json").read_text())["id"] + ".html")
    html.write_text("stale")
    export.snapshots(fake_story, no_voice=True)
    assert "NarratedExplainer.mount" in html.read_text()
    assert FakeCapture.options[0] == (900, "dark")
    assert [(m, a) for m, a in FakeCapture.calls if m == "goto"][:4] == [("goto", ("first", 0)), ("goto", ("first", 1)), ("goto", ("second", 0)), ("goto", ("second", 1))]


def test_caption_mismatch_is_failure(fake_story):
    FakeCapture.fail = True
    with pytest.raises(RuntimeError, match="caption"):
        export.snapshots(fake_story, no_voice=True)


@pytest.mark.parametrize("format,fps,width,audio", [("gif", 12, 960, False), ("mp4", 30, 1280, True)])
def test_video_frames_defaults_soundtrack_and_atomic_output(fake_story, monkeypatch, format, fps, width, audio):
    observations = []
    def encode(frames, destination, frame_rate, count, selected_format, soundtrack=None):
        observations.append((len(list(frames)), frame_rate, count, selected_format, soundtrack))
        destination.write_bytes(b"encoded-file")
    monkeypatch.setattr(export, "encode_frames", encode, raising=False)
    output = fake_story / ("custom." + format)
    result = export.video(fake_story, format=format, out=output, no_voice=True)
    count = 2 if format == "gif" else 3
    assert observations == [(count, fps, count, format, b"fixture-wav" if audio else None)]
    assert [a[1] for m, a in FakeCapture.calls if m == "renderAt"] == pytest.approx([0, 100] if format == "gif" else [0, 1000 / 30, 100])
    assert any(m == "prepare_video" for m, _ in FakeCapture.calls)
    assert any(m == "soundtrack" for m, _ in FakeCapture.calls) is audio
    assert FakeCapture.options == [(width, "light")]
    assert result["frames"] == count and result["duration_ms"] == 100 and result["bytes"] == 12
    assert output.read_bytes() == b"encoded-file"
    def broken(*args):
        raise RuntimeError("encoder failed")
    monkeypatch.setattr(export, "encode_frames", broken)
    with pytest.raises(RuntimeError, match="encoder failed"):
        export.video(fake_story, format=format, out=output, no_voice=True)
    assert output.read_bytes() == b"encoded-file"


def test_explicit_video_rate_and_width(fake_story, monkeypatch):
    def encode(frames, destination, fps, count, format, audio):
        assert fps == 20 and count == 2
        assert len(list(frames)) == 2
        destination.write_bytes(b"ok")
    monkeypatch.setattr(export, "encode_frames", encode, raising=False)
    export.video(fake_story, mode="second", fps=20, width=801, no_voice=True)
    assert FakeCapture.options == [(801, "light")]
    assert ("renderAt", ("second", 100)) in FakeCapture.calls


@pytest.mark.parametrize("kwargs", [{"mode": "absent"}, {"format": "avi"}, {"fps": 0}, {"width": 0}, {"scheme": "sepia"}])
def test_invalid_export_options(fake_story, kwargs):
    with pytest.raises(ValueError):
        export.video(fake_story, no_voice=True, **kwargs)


@pytest.mark.parametrize("format,video_codec,audio_codec", [("mp4", "libx264", "aac"), ("gif", None, None)])
def test_encoder_codec_duration_and_palette(format, video_codec, audio_codec, tmp_path):
    command = encoding.encoder_command(tmp_path / ("out." + format), 30, 3, format, tmp_path / "audio.wav" if audio_codec else None)
    import imageio_ffmpeg
    assert command[0:1] == [imageio_ffmpeg.get_ffmpeg_exe()]
    assert "image2pipe" in command and "pipe:0" in command
    if video_codec:
        assert command[command.index("-c:v") + 1] == video_codec
        assert command[command.index("-c:a") + 1] == audio_codec
        assert "apad" in " ".join(command) and "atrim=duration=0.1" in " ".join(command)
    if format == "mp4":
        assert "yuv420p" in command and "pad=ceil(iw/2)*2:ceil(ih/2)*2" in " ".join(command)
    if format == "gif":
        assert "palettegen" in " ".join(command) and "paletteuse" in " ".join(command)
        assert "-an" in command


def test_missing_browser_actionable_message():
    def unavailable(**kwargs):
        raise RuntimeError("Executable doesn't exist")
    with pytest.raises(RuntimeError, match="uv run playwright install chromium"):
        capture.launch_browser(SimpleNamespace(chromium=SimpleNamespace(launch=unavailable)))


def test_real_fresh_capture_geometry_and_progress(tmp_path):
    from narrated_explainer.bundle import build
    new_story(tmp_path / "story")
    html = build(tmp_path / "story", no_voice=True)
    with capture.Capture(html, width=801, scheme="dark") as browser:
        assert browser.caption()
        browser.prepare_video(["main"])
        assert browser.page.locator("figure.nx .nx-controls").is_hidden()
        assert browser.page.locator("figure.nx .nx-progress").is_visible()
        assert browser.page.locator("figure.nx figcaption").is_visible()
        frames = []
        for mode in ["main"]:
            for position in browser.call("positions", mode):
                browser.call("goto", mode, position["index"])
                frames.append(struct.unpack(">II", browser.screenshot()[16:24]))
        assert frames and len(set(frames)) == 1 and frames[0][0] == 801


@pytest.mark.parametrize("script,error", [("console.error('capture-error')", "capture-error"), ("throw new Error('capture-error')", "capture-error"), ("new Image().src='https://example.test/blocked.png'", "Blocked network"), ("new WebSocket('wss://example.test/socket')", "Blocked network")])
def test_browser_errors_and_network_attempts_fail(tmp_path, script, error):
    html = tmp_path / "page.html"
    html.write_text("<figure class='nx'></figure><script>" + script + "</script>")
    with pytest.raises(RuntimeError, match=error):
        with capture.Capture(html):
            pass


@pytest.mark.parametrize("command", ["snapshots", "video"])
def test_export_command_help(command, capsys):
    result = None
    try:
        result = cli.main([command, "--help"])
    except SystemExit as error:
        result = error.code
    assert result == 0
    output = capsys.readouterr().out
    assert "--width" in output and "--scheme" in output and "--no-voice" in output
