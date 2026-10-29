"""Installation diagnostics and positive local narration smoke."""
import importlib.metadata
import os
from pathlib import Path
import sys
import tempfile

from . import models

PACKAGES = ("kokoro-onnx", "faster-whisper", "soundfile", "imageio-ffmpeg", "playwright")


def smoke_narration() -> dict:
    from .audio import Recognizer, encode_mp3
    from .engines import create_engine
    from .speech import assess
    text = "The request reaches the server and the timer stops."
    samples, rate = create_engine("kokoro").synthesize(text, "am_michael", 1.0)
    with tempfile.TemporaryDirectory(prefix="explainer-smoke-") as temporary:
        path = Path(temporary) / "smoke.mp3"
        encoder = encode_mp3(samples, rate, path)
        transcript, words, duration = Recognizer().transcribe(path)
    score, passed = assess(text, transcript)
    return {"ok": passed and bool(words) and duration > 0, "score": score,
            "duration": duration, "transcript": transcript, "encoder": encoder}


def doctor_report(smoke: bool = False) -> dict:
    checks = [{"name": "python", "ok": (3, 10) <= sys.version_info[:2] < (3, 14),
               "required": True, "detail": sys.version.split()[0], "fix": "uv python install 3.12"}]
    for package in PACKAGES:
        try:
            version = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            version = None
        checks.append({"name": package, "ok": version is not None, "required": True,
                       "detail": version, "fix": "uv sync"})
    checks.extend({"name": "model:" + item["file"], "required": True,
                   "fix": "explainer models fetch", **item} for item in models.verify_models())
    try:
        import imageio_ffmpeg
        encoder_ok = os.path.isfile(imageio_ffmpeg.get_ffmpeg_exe())
    except (ImportError, RuntimeError):
        encoder_ok = False
    checks.append({"name": "mp3-encoder", "ok": encoder_ok, "required": True,
                   "detail": "imageio-ffmpeg/libmp3lame mono 48kbps", "fix": "uv sync"})
    browser_ok = False
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as browser:
            browser_ok = Path(browser.chromium.executable_path).is_file()
    except ImportError:
        browser_ok = False
    checks.append({"name": "chromium", "ok": browser_ok, "required": False,
                   "fix": "uv run playwright install chromium"})
    for command, ready in (("snapshots", browser_ok), ("video", browser_ok and encoder_ok)):
        checks.append({"name": command, "ok": ready, "required": False,
                       "fix": "uv sync; uv run playwright install chromium"})
    ok = all(check["ok"] for check in checks if check["required"])
    if smoke and ok:
        receipt = smoke_narration()
        checks.append({"name": "smoke", "required": True, "fix": "explainer models fetch", **receipt})
        ok = receipt["ok"]
    elif smoke:
        checks.append({"name": "smoke", "required": True, "ok": False,
                       "detail": "Fix required checks before running smoke", "fix": "explainer doctor"})
    return {"schema_version": 1, "ok": ok, "checks": checks}
