"""Deterministic figure snapshots and videos from the offline player API."""
import base64
import math
from pathlib import Path
import struct
import tempfile

from .bundle import build
from .capture import Capture
from .encoding import encode_frames
from .story import declared_levels, declared_modes, load_story


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


def _level_args(level: str | None) -> tuple:
    """The trailing player-API argument for `level`; a story without levels passes none."""
    return () if level is None else (level,)


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
        for mode in declared_modes(story):
            for level in declared_levels(story) or [None]:
                where = mode if level is None else f"{mode}-{level}"
                level_args = _level_args(level)
                for index, position in enumerate(browser.call("positions", mode, *level_args)):
                    browser.call("goto", mode, index, *level_args)
                    if browser.caption() != position["caption"]:
                        raise RuntimeError(f"Rendered caption differs from position: {where}/{position['id']}")
                    path = output / f"{where}-{index:02d}-{position['id']}.png"
                    path.write_bytes(browser.screenshot())
                    paths.append(path)
        browser.check_errors()
    return paths


def _frames(browser, mode, duration, fps, level_args=()):
    dimensions = None
    for ms in frame_times(duration, fps):
        browser.call("renderAt", mode, ms, *level_args)
        image = browser.screenshot()
        if image.startswith(b"\x89PNG\r\n\x1a\n"):
            current = struct.unpack(">II", image[16:24])
            if dimensions is not None and dimensions != current:
                raise RuntimeError("Figure dimensions changed during video capture")
            dimensions = current
        yield image


def video(directory: Path, mode: str | None = None, fps: float | None = None,
          format: str = "mp4", width: int | None = None, scheme: str = "light",
          out: Path | None = None, no_voice: bool = False, level: str | None = None) -> dict:
    if format not in ("mp4", "gif"):
        raise ValueError("Format must be mp4 or gif")
    fps = fps if fps is not None else (12 if format == "gif" else 30)
    width = width if width is not None else (960 if format == "gif" else 1280)
    _positive(fps, "Frame rate")
    _validate_capture(width, scheme)
    directory = Path(directory)
    story = load_story(directory)
    mode = mode if mode is not None else declared_modes(story)[0]
    if mode not in declared_modes(story):
        raise ValueError(f"Unknown mode: {mode}")
    levels = declared_levels(story)
    if level is not None and level not in levels:
        raise ValueError(f"Unknown level: {level}" if levels else "Story has no levels")
    # An explicit level is part of the default file name; the default level is the deepest, so every step plays.
    named = "" if level is None else f"-{level}"
    level = level if level is not None else (levels[-1] if levels else None)
    level_args = _level_args(level)
    html = build(directory, no_voice=no_voice)
    output = Path(out) if out is not None else directory / "dist" / f"{story['id']}-{mode}{named}.{format}"
    output.parent.mkdir(parents=True, exist_ok=True)
    with Capture(html, width=width, scheme=scheme) as browser:
        duration = browser.call("plan", mode, *level_args)["duration"]
        _positive(duration, "Plan duration")
        count = math.ceil(duration * fps / 1000)
        browser.prepare_video([mode], *level_args)
        audio = None
        if format != "gif":
            soundtrack = browser.call("soundtrack", mode, *level_args)
            audio = base64.b64decode(soundtrack["wavBase64"], validate=True)
        with tempfile.TemporaryDirectory(prefix=".explainer-video-", dir=output.parent) as temporary:
            staged = Path(temporary) / ("video." + format)
            encode_frames(_frames(browser, mode, duration, fps, level_args), staged, fps, count, format, audio)
            browser.check_errors()
            staged.replace(output)
    return {"path": output, "duration_ms": duration, "frames": count,
            "bytes": output.stat().st_size}
