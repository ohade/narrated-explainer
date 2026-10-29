"""Incremental, checked narration with atomic manifest publication."""

import hashlib
import json
from pathlib import Path
import tempfile

from .files import atomic_write
from .speech import align_words, assess, spoken_text
from .story import captions, load_story, voice_settings


def clip_key(engine: str, voice: str, speed: float, spoken: str) -> str:
    payload = json.dumps([engine, voice, float(speed), spoken], ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


def expected_clips(story: dict) -> dict:
    settings = voice_settings(story)
    return {entry["id"]: {"spoken": spoken_text(entry["caption"], story.get("pronounce"), entry.get("say")),
                          "caption": entry["caption"]} for entry in captions(story)}


def stale_reasons(story: dict, manifest: dict) -> list[str]:
    settings = voice_settings(story)
    errors = []
    clips = manifest.get("clips", {})
    if not isinstance(clips, dict):
        return ["narration clips must be an object"]
    for identifier, expected in expected_clips(story).items():
        clip = clips.get(identifier, {})
        key = clip_key(settings["engine"], settings["voice"], settings["speed"], expected["spoken"])
        if not isinstance(clip, dict) or clip.get("key") != key:
            errors.append(f"stale narration: {identifier}; run explainer narrate")
        elif len(clip.get("words", [])) != len(expected["caption"].split()):
            errors.append(f"stale word alignment: {identifier}; run explainer narrate")
        elif "caption" in clip and clip["caption"] != expected["caption"]:
            errors.append(f"stale displayed caption: {identifier}; run explainer narrate")
    return errors


def load_manifest(directory: Path) -> dict | None:
    path = directory / "narration/manifest.json"
    if not path.exists():
        return None
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise ValueError("narration/manifest.json must be an object")
    return manifest


def clip_path(directory: Path, filename: str) -> Path:
    if not isinstance(filename, str) or Path(filename).name != filename or not filename.endswith(".mp3"):
        raise ValueError("Narration file must be an MP3 basename")
    path = directory / "narration" / filename
    if path.is_symlink():
        raise ValueError("Narration clips must not be symbolic links")
    return path


def _record_clip(identifier: str, expected: dict, settings: dict, key: str,
                 destination: Path, engine, recognizer, encoder, pronounce: dict) -> tuple[dict, str]:
    for _ in range(3):
        samples, rate = engine.synthesize(expected["spoken"], settings["voice"], settings["speed"])
        encoding = encoder(samples, rate, destination)
        transcript, words, duration = recognizer.transcribe(destination)
        score, passed = assess(expected["spoken"], transcript)
        if passed:
            aligned = align_words(expected["caption"], expected["spoken"], words, duration, pronounce)
            return {"file": destination.name, "key": key, "spoken": expected["spoken"], "caption": expected["caption"],
                    "duration": duration, "score": score, "words": aligned}, encoding
    raise ValueError(f"Narration failed speech check after three takes: {identifier}")


def narrate(directory: Path, engine=None, recognizer=None, encoder=None, url: str | None = None) -> dict:
    from .audio import Recognizer, encode_mp3
    directory = Path(directory)
    story = load_story(directory)
    settings = voice_settings(story)
    output = directory / "narration"
    output.mkdir(exist_ok=True)
    lock = output / ".writer-lock"
    try:
        lock.mkdir()
    except FileExistsError as error:
        raise ValueError("Narration is already running; remove .writer-lock only after that process exits") from error
    try:
        previous = load_manifest(directory) or {"clips": {}}
        clips, pending = {}, []
        for identifier, expected in expected_clips(story).items():
            key = clip_key(settings["engine"], settings["voice"], settings["speed"], expected["spoken"])
            old = previous.get("clips", {}).get(identifier, {})
            if old.get("key") == key and clip_path(directory, old.get("file", "")).is_file():
                if old.get("caption") == expected["caption"]:
                    clips[identifier] = old
                    continue
                recognizer = recognizer or Recognizer()
                _, words, duration = recognizer.transcribe(clip_path(directory, old["file"]))
                clips[identifier] = {**old, "caption": expected["caption"],
                                      "words": align_words(expected["caption"], expected["spoken"], words,
                                                           duration, story.get("pronounce", {}))}
                continue
            pending.append((identifier, expected, key))
        encoding = previous.get("settings", {}).get("encoder", "imageio-ffmpeg/libmp3lame mono 48kbps")
        if pending:
            from .engines import create_engine
            engine = engine or create_engine(settings["engine"], url)
            recognizer = recognizer or Recognizer()
            encoder = encoder or encode_mp3
            with tempfile.TemporaryDirectory(prefix="takes-", dir=output) as temporary:
                staged = []
                for identifier, expected, key in pending:
                    filename = f"{identifier}-{key[:16]}.mp3"
                    path = Path(temporary) / filename
                    clips[identifier], encoding = _record_clip(identifier, expected, settings, key, path,
                                                                engine, recognizer, encoder, story.get("pronounce", {}))
                    staged.append(path)
                for path in staged:
                    path.replace(output / path.name)
        label = (settings["voice"].split("_", 1)[-1].capitalize() + " (Kokoro)"
                 if settings["engine"] == "kokoro" else settings["voice"])
        manifest = {**settings, "label": label,
                    "settings": {"encoder": encoding, "recognizer": "faster-whisper base.en cpu int8"}, "clips": clips}
        atomic_write(output / "manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        return manifest
    finally:
        lock.rmdir()
