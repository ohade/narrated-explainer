"""Public model files pinned to verified upstream bytes."""

import hashlib
import os
from pathlib import Path
import tempfile
import time
from urllib.request import urlopen

WHISPER_REVISION = "3d3d5dee26484f91867d81cb899cfcf72b96be6c"
KOKORO_BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/"
WHISPER_BASE = f"https://huggingface.co/Systran/faster-whisper-base.en/resolve/{WHISPER_REVISION}/"
# GitHub release asset digests and Hugging Face LFS metadata, checked upstream.
# Small non-LFS files were hashed directly from the immutable revision above.
MODEL_FILES = {
    "kokoro/kokoro-v1.0.onnx": (KOKORO_BASE + "kokoro-v1.0.onnx", "beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a"),
    "kokoro/voices-v1.0.bin": (KOKORO_BASE + "voices-v1.0.bin", "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d"),
    "whisper/model.bin": (WHISPER_BASE + "model.bin", "2a166925539a16005f14ff328359f9b9adb9dc4fb631bb3b227526862e93e2ef"),
    "whisper/config.json": (WHISPER_BASE + "config.json", "f3bc3821e9fc76a27bae538e11ae5b677dcdd352b4600429ce7951d398569aeb"),
    "whisper/tokenizer.json": (WHISPER_BASE + "tokenizer.json", "929c5252409436dce1b38a75d1abbcb5e132d170d8e324e4e04ed915fa2d22df"),
    "whisper/vocabulary.txt": (WHISPER_BASE + "vocabulary.txt", "ff77588746d3a2595d32ab5b69ffd7b95ce2441ac57533cb66fc3eb575a115cf"),
}


def cache_directory() -> Path:
    if os.name == "nt":
        root = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local"))
    else:
        root = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
    return root / "narrated-explainer/models"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch_file(path: Path, url: str, expected_hash: str) -> bool:
    """Download atomically, returning False only for a verified cache hit."""
    if path.is_file() and sha256_file(path) == expected_hash:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as output:
            temporary = Path(output.name)
            digest, size, started = hashlib.sha256(), 0, time.monotonic()
            with urlopen(url, timeout=60) as source:
                while chunk := source.read(1024 * 1024):
                    size += len(chunk)
                    if size > 1_000_000_000 or time.monotonic() - started > 900:
                        raise ValueError("Model download exceeded size or time limit")
                    output.write(chunk)
                    digest.update(chunk)
        if digest.hexdigest() != expected_hash:
            raise ValueError(f"SHA-256 mismatch for {path.name}; previous file preserved")
        temporary.replace(path)
        return True
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def fetch_models() -> list[dict]:
    root = cache_directory()
    return [{"file": name, "downloaded": fetch_file(root / name, url, digest)}
            for name, (url, digest) in MODEL_FILES.items()]


def verify_models() -> list[dict]:
    root = cache_directory()
    return [{"file": name, "ok": (root / name).is_file() and sha256_file(root / name) == digest,
             "fix": "explainer models fetch"} for name, (_, digest) in MODEL_FILES.items()]


def require_models() -> Path:
    if not all(item["ok"] for item in verify_models()):
        raise ValueError("Model files missing or hash mismatch. Run: explainer models fetch")
    return cache_directory()
