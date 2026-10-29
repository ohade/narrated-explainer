"""Story loading and the authored JSON contract."""

import json
import math
from pathlib import Path
import re

ID = re.compile(r"^[a-z0-9][a-z0-9-]*$")
CUES = set("click pop whoosh tick ding success fail alarm wind thud".split())
LABELS = set("play pause restart prev next voiceOn voiceOff soundOn soundOff speed mode transcript fullscreen themeAuto themeLight themeDark".split())


def finite_number(value: object, minimum: float = 0, positive: bool = False) -> bool:
    return type(value) in (int, float) and math.isfinite(value) and (value > minimum if positive else value >= minimum)


def _valid_id(value: object) -> bool:
    return isinstance(value, str) and ID.fullmatch(value) is not None


def _text(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def validate_story(story: object) -> list[str]:
    """Report all invalid contract fields without mutating the story."""
    if not isinstance(story, dict):
        return ["story must be an object"]
    errors = []
    if not _valid_id(story.get("id")):
        errors.append("story.id must be a lowercase hyphenated identifier")
    for key in ("title", "lang"):
        if not _text(story.get(key)):
            errors.append(f"story.{key} must be nonempty text")
    if "description" in story and not isinstance(story["description"], str):
        errors.append("description must be text")
    timing = story.get("timing")
    if not isinstance(timing, dict):
        errors.append("timing must be an object")
        timing = {}
    for key in ("end", "realMsPerUnit", "holdMs"):
        if not finite_number(timing.get(key), positive=key != "holdMs"):
            errors.append(f"timing.{key} has an invalid numeric value")
    if not _text(timing.get("unit")):
        errors.append("timing.unit must be text")
    speeds = timing.get("speeds")
    if not isinstance(speeds, list) or not speeds or not all(finite_number(speed, positive=True) for speed in speeds):
        errors.append("timing.speeds must contain positive speeds")
    modes = story.get("modes", [{"id": "main", "label": "Main"}])
    mode_ids = []
    if not isinstance(modes, list) or not modes:
        errors.append("modes must be a nonempty array when supplied")
        modes = []
    for mode in modes:
        if not isinstance(mode, dict) or not _valid_id(mode.get("id")) or not _text(mode.get("label")):
            errors.append("each mode needs a valid id and label")
        else:
            mode_ids.append(mode["id"])
    if len(set(mode_ids)) != len(mode_ids):
        errors.append("mode ids must be unique")
    rest = story.get("atRest")
    if not isinstance(rest, dict) or rest.get("mode") not in mode_ids or not _text(rest.get("caption")):
        errors.append("atRest needs a known mode and caption")
    elif not finite_number(rest.get("t")) or not finite_number(timing.get("end")) or rest["t"] > timing["end"]:
        errors.append("atRest.t must be within timing.end")
    identifiers = []
    for kind in ("intro", "moments"):
        entries = story.get(kind, [])
        if not isinstance(entries, list):
            errors.append(f"{kind} must be an array")
            continue
        if len(entries) > 10000:
            errors.append(f"{kind} exceeds 10000 captions")
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                errors.append(f"{kind} entries must be objects")
                continue
            if not _valid_id(entry.get("id")):
                errors.append(f"{kind} entry needs a valid id")
            else:
                identifiers.append(entry["id"])
            if not _text(entry.get("caption")) or ("say" in entry and not _text(entry["say"])):
                errors.append(f"{kind} caption/say must be nonempty text")
            if kind == "intro" and "t" in entry:
                errors.append("intro steps must not have t")
            if kind == "moments" and (not finite_number(entry.get("t")) or entry["t"] > (timing.get("end") if finite_number(timing.get("end")) else 0)):
                errors.append("moment.t must be within timing.end")
            selected = entry.get("modes", mode_ids)
            if not isinstance(selected, list) or not selected or any(mode not in mode_ids for mode in selected):
                errors.append("caption modes must name known modes")
            if "sfx" in entry and (not isinstance(entry["sfx"], str) or entry["sfx"] not in CUES):
                errors.append("sfx must name a supported cue")
            if "holdMs" in entry and not finite_number(entry["holdMs"]):
                errors.append("holdMs must be nonnegative milliseconds")
    if len(identifiers) != len(set(identifiers)):
        errors.append("intro and moment ids must be unique")
    for key, allowed in (("labels", LABELS), ("pronounce", None)):
        mapping = story.get(key, {})
        if not isinstance(mapping, dict) or any(not _text(name) or not _text(value) or (allowed is not None and name not in allowed) for name, value in mapping.items()):
            errors.append(f"{key} must map supported text keys to text")
    voice = story.get("voice", {})
    if not isinstance(voice, dict):
        errors.append("voice must be an object")
    else:
        if voice.get("engine", "kokoro") not in ("kokoro", "http"):
            errors.append("voice.engine must be kokoro or http")
        if not _text(voice.get("voice", "am_michael")) or not finite_number(voice.get("speed", 1.0), positive=True):
            errors.append("voice needs a nonempty voice and positive speed")
    return errors


def load_story(directory: Path) -> dict:
    path = directory / "story.json"
    if path.stat().st_size > 5_000_000:
        raise ValueError("story.json exceeds 5 MB")
    story = json.loads(path.read_text(encoding="utf-8"))
    errors = validate_story(story)
    if errors:
        raise ValueError("Invalid story: " + "; ".join(errors))
    return story


def captions(story: dict) -> list[dict]:
    return story.get("intro", []) + story.get("moments", [])


def voice_settings(story: dict) -> dict:
    return {"engine": "kokoro", "voice": "am_michael", "speed": 1.0, **story.get("voice", {})}
