"""Deterministic figure snapshots and videos from the offline player API."""
import base64
import math
from pathlib import Path
import struct
import tempfile

from .bundle import build
from .capture import Capture
from .encoding import encode_frames
from .story import load_story


def _positive(value: float, name: str) -> None:
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be positive and finite")


def frame_times(duration_ms: float, fps: float):
    """N frames, with the final frame exactly at the plan's end."""
    _positive(duration_ms, "Plan duration")
    _positive(fps, "Frame rate")
    count = math.ceil(duration_ms * fps / 1000)
    for index in range(count):
        yield duration_ms if index == count - 1 else index * 1000 / fps


def _validate_capture(width: int, scheme: str) -> None:
    _positive(width, "Width")
    if scheme not in ("light", "dark"):
        raise ValueError("Scheme must be light or dark")


def _modes(story: dict) -> list[str]:
    return [mode["id"] for mode in story.get("modes", [{"id": "main"}])]


def snapshots(directory: Path, no_voice: bool = False, width: int = 1280,
              scheme: str = "light") -> list[Path]:
    _validate_capture(width, scheme)
    directory = Path(directory)
    story = load_story(directory)
    output = directory / "dist/snapshots"
    if (directory / "dist").is_symlink() or output.is_symlink():
        raise ValueError("Snapshot output directories must not be symbolic links")
    html = build(directory, no_voice=no_voice)
    output.mkdir(parents=True, exist_ok=True)
    for old in output.glob("*.png"):
        if old.is_file() or old.is_symlink():
            old.unlink()
    paths = []
    with Capture(html, width=width, scheme=scheme) as browser:
        rest = output / "rest.png"
        rest.write_bytes(browser.screenshot())
        paths.append(rest)
        for mode in _modes(story):
            for index, position in enumerate(browser.call("positions", mode)):
                browser.call("goto", mode, index)
                if browser.caption() != position["caption"]:
                    raise RuntimeError(f"Rendered caption differs from position: {mode}/{position['id']}")
                path = output / f"{mode}-{index:02d}-{position['id']}.png"
                path.write_bytes(browser.screenshot())
                paths.append(path)
        browser.check_errors()
    return paths


def _frames(browser, mode, duration, fps):
    dimensions = None
    for ms in frame_times(duration, fps):
        browser.call("renderAt", mode, ms)
        image = browser.screenshot()
        if image.startswith(b"\x89PNG\r\n\x1a\n"):
            current = struct.unpack(">II", image[16:24])
            if dimensions is not None and dimensions != current:
                raise RuntimeError("Figure dimensions changed during video capture")
            dimensions = current
        yield image


def video(directory: Path, mode: str | None = None, fps: float | None = None,
          format: str = "mp4", width: int | None = None, scheme: str = "light",
          out: Path | None = None, no_voice: bool = False) -> dict:
    if format not in ("mp4", "gif"):
        raise ValueError("Format must be mp4 or gif")
    fps = fps if fps is not None else (12 if format == "gif" else 30)
    width = width if width is not None else (960 if format == "gif" else 1280)
    _positive(fps, "Frame rate")
    _validate_capture(width, scheme)
    directory = Path(directory)
    story = load_story(directory)
    mode = mode if mode is not None else _modes(story)[0]
    if mode not in _modes(story):
        raise ValueError(f"Unknown mode: {mode}")
    html = build(directory, no_voice=no_voice)
    output = Path(out) if out is not None else directory / "dist" / f"{story['id']}-{mode}.{format}"
    output.parent.mkdir(parents=True, exist_ok=True)
    with Capture(html, width=width, scheme=scheme) as browser:
        duration = browser.call("plan", mode)["duration"]
        _positive(duration, "Plan duration")
        count = math.ceil(duration * fps / 1000)
        browser.prepare_video([mode])
        audio = None
        if format != "gif":
            soundtrack = browser.call("soundtrack", mode)
            audio = base64.b64decode(soundtrack["wavBase64"], validate=True)
        with tempfile.TemporaryDirectory(prefix=".explainer-video-", dir=output.parent) as temporary:
            staged = Path(temporary) / ("video." + format)
            encode_frames(_frames(browser, mode, duration, fps), staged, fps, count, format, audio)
            browser.check_errors()
            staged.replace(output)
    return {"path": output, "duration_ms": duration, "frames": count,
            "bytes": output.stat().st_size}
