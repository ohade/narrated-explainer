"""Story loading and the authored JSON contract."""

import json
import math
from pathlib import Path
import re

ID = re.compile(r"^[a-z0-9][a-z0-9-]*$")
CUES = set("click pop whoosh tick ding success fail alarm wind thud".split())
LABELS = set("play pause replay restart prev next voiceOn voiceOff soundOn soundOff speed mode transcript fullscreen more themeAuto themeLight themeDark "
             "depth chooseDepth goDeeper changeDepth startOver steps aboutMin learnMore close".split())
MAX_CHIPS = 3
LABEL_MAX, BLURB_MAX = 28, 90


def finite_number(value: object, minimum: float = 0, positive: bool = False) -> bool:
    return type(value) in (int, float) and math.isfinite(value) and (value > minimum if positive else value >= minimum)


def _valid_id(value: object) -> bool:
    return isinstance(value, str) and ID.fullmatch(value) is not None


def _text(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _level_definitions(levels: object) -> tuple[list[str], list[str]]:
    """The ids of the declared levels, shallowest first, and the errors in their definitions."""
    if not isinstance(levels, list) or not levels:
        return [], ["levels must be a nonempty array when supplied"]
    ids, errors = [], []
    for level in levels:
        if not isinstance(level, dict) or not _valid_id(level.get("id")) or not _text(level.get("label")) or not _text(level.get("blurb")):
            errors.append("each level needs a valid id, label and blurb")
        else:
            ids.append(level["id"])
    if len(set(ids)) != len(ids):
        errors.append("level ids must be unique")
    return ids, errors


def _selects(entry: dict, key: str, value: str | None) -> bool:
    """Whether `entry` plays for `value`: no list, or no value (a story without levels), means every value;
    a malformed list is reported elsewhere."""
    chosen = entry.get(key)
    return not isinstance(chosen, list) or value is None or value in chosen


def playable(story: dict, mode: str, level: str | None) -> tuple[list[dict], list[dict]]:
    """The intro steps and the moments a viewer of `mode` at `level` plays."""
    def kept(kind: str) -> list[dict]:
        entries = story.get(kind, [])
        return [entry for entry in entries if isinstance(entry, dict) and _selects(entry, "modes", mode) and _selects(entry, "levels", level)] if isinstance(entries, list) else []
    return kept("intro"), kept("moments")


def positions(story: dict, mode: str, level: str | None) -> list[str]:
    """The position ids a viewer of `mode` at `level` plays, in order: intro steps, then moments by time."""
    intro, moments = playable(story, mode, level)
    by_time = sorted(moments, key=lambda moment: moment["t"] if finite_number(moment.get("t")) else 0)
    return [entry["id"] for entry in intro + by_time if _valid_id(entry.get("id"))]


def declared_modes(story: dict) -> list[str]:
    return [mode["id"] for mode in story.get("modes", [{"id": "main"}])]


def declared_levels(story: dict) -> list[str]:
    """The declared levels, shallowest first; empty for a story without levels."""
    return [level["id"] for level in story.get("levels", [])]


def _level_coverage_errors(story: dict, modes: list[str], levels: list[str]) -> list[str]:
    errors = []
    for mode in modes:
        for level in levels:
            moments = playable(story, mode, level)[1]
            if len(moments) < 3:
                errors.append(f"mode {mode}, level {level}: needs at least three moments, has {len(moments)}")
            if not any(moment.get("heart") is True for moment in moments):
                errors.append(f"mode {mode}, level {level}: needs at least one heart moment")
    return errors


def levels_without_cue(story: dict) -> list[tuple[str, str]]:
    """The (mode, level) lists of a story with levels in which no step carries a sound cue."""
    return [(mode, level) for mode in declared_modes(story) for level in declared_levels(story)
            if not any("sfx" in entry for part in playable(story, mode, level) for entry in part)]


def _in_window(aside: dict, ids: list[str], index: int) -> bool:
    """Whether position `index` of `ids` is inside the window of `aside`; both ends must be in `ids`."""
    if "from" not in aside:
        return True
    first = ids.index(aside["from"]) if aside["from"] in ids else -1
    last = (ids.index(aside["to"]) if aside["to"] in ids else -1) if "to" in aside else len(ids) - 1
    return first != -1 and last != -1 and first <= index <= last


def asides_at(story: dict, mode: str, level: str | None, index: int) -> list[dict]:
    """Every aside offered at position `index` (-1 at rest) of `mode` and `level`; the player shows the first MAX_CHIPS."""
    ids = positions(story, mode, level)
    return [aside for aside in story.get("asides", [])
            if _selects(aside, "modes", mode) and _selects(aside, "levels", level) and _in_window(aside, ids, index)]


def crowded_asides(story: dict) -> list[tuple[str, str | None, int]]:
    """The (mode, level, position index) of the first position, per mode and level, that offers more than MAX_CHIPS asides."""
    found = []
    for mode in declared_modes(story):
        for level in declared_levels(story) or [None]:
            crowded = [index for index in range(len(positions(story, mode, level)))
                       if len(asides_at(story, mode, level, index)) > MAX_CHIPS]
            if crowded:
                found.append((mode, level, crowded[0]))
    return found


def aside_frame(story: dict, aside: dict) -> tuple[str, str | None, int]:
    """Where to show `aside` for a picture: the first (mode, level, position index) that offers it, deepest level first."""
    levels = declared_levels(story)[::-1] or [None]
    lists = [(mode, level) for mode in declared_modes(story) for level in levels
             if _selects(aside, "modes", mode) and _selects(aside, "levels", level)]
    for mode, level in lists:
        for index in range(len(positions(story, mode, level))):
            if aside in asides_at(story, mode, level, index):
                return mode, level, index
    mode, level = lists[0] if lists else (declared_modes(story)[0], levels[0])
    return mode, level, 0


def _block_problem(block: object) -> str | None:
    if not isinstance(block, dict):
        return "each body block must be an object"
    kind = block.get("type")
    keys = {"p": {"text"}, "code": {"text"}, "list": {"items"}}.get(kind)
    if keys is None:
        return f"unknown block type {kind!r}; use p, list or code"
    if set(block) != keys | {"type"}:
        return f"a {kind} block takes only type and {next(iter(keys))}"
    if kind == "list":
        items = block["items"]
        return None if isinstance(items, list) and items and all(_text(item) for item in items) else "a list block needs a nonempty array of nonempty items"
    return None if _text(block["text"]) else f"a {kind} block needs nonempty text"


def _aside_text_problems(aside: dict) -> list[str]:
    problems = [f"{key} must be nonempty text of at most {limit} characters"
                for key, limit in (("label", LABEL_MAX), ("blurb", BLURB_MAX))
                if not _text(aside.get(key)) or len(aside[key]) > limit]
    body = aside.get("body")
    if not isinstance(body, list) or not body:
        return problems + ["body must be a nonempty array of blocks"]
    return problems + [problem for block in body if (problem := _block_problem(block))]


def _aside_order_problem(story: dict, aside: dict, mode_ids: list[str], levels: list[str] | None) -> str | None:
    """The first (mode, level) list the aside is offered in where its `from` comes after its `to`."""
    for mode in mode_ids:
        for level in levels or [None]:
            ids = positions(story, mode, level)
            if _selects(aside, "modes", mode) and _selects(aside, "levels", level) and aside["from"] in ids \
                    and aside["to"] in ids and ids.index(aside["from"]) > ids.index(aside["to"]):
                return f"from {aside['from']} comes after to {aside['to']} in mode {mode}" + (f", level {level}" if level else "")
    return None


def _aside_place_problems(story: dict, aside: dict, mode_ids: list[str], levels: list[str] | None, step_ids: list[str]) -> list[str]:
    problems = [f"{key} {aside[key]!r} is not an intro step or moment id" for key in ("from", "to")
                if key in aside and aside[key] not in step_ids]
    if "to" in aside and "from" not in aside:
        problems.append("to needs a from")
    modes = aside.get("modes", mode_ids)
    if not isinstance(modes, list) or not modes or any(mode not in mode_ids for mode in modes):
        problems.append("modes must name known modes")
    chosen = aside.get("levels")
    if levels is not None and "levels" in aside and (not isinstance(chosen, list) or not chosen or any(level not in levels for level in chosen)):
        problems.append("levels must name known levels")
    order = _aside_order_problem(story, aside, mode_ids, levels) if "to" in aside and not problems else None
    return problems + [order] if order else problems


def _aside_errors(story: dict, mode_ids: list[str], levels: list[str] | None, step_ids: list[str]) -> list[str]:
    asides = story["asides"]
    if not isinstance(asides, list):
        return ["asides must be an array when supplied"]
    errors, seen = [], set()
    for aside in asides:
        if not isinstance(aside, dict) or not _valid_id(aside.get("id")):
            errors.append("each aside needs a valid id")
            continue
        name = f"aside {aside['id']}"
        problems = _aside_text_problems(aside) + _aside_place_problems(story, aside, mode_ids, levels, step_ids)
        if aside["id"] in seen:
            problems.append("id is used twice")
        elif aside["id"] in step_ids:
            problems.append("id clashes with a step id")
        seen.add(aside["id"])
        errors.extend(f"{name}: {problem}" for problem in problems)
    return errors


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
    if "speeds" in timing:  # optional and ignored by the player, which always offers its own six
        speeds = timing["speeds"]
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
    levels = None  # the declared level ids; None when the story has no levels
    if "levels" in story:
        levels, level_errors = _level_definitions(story["levels"])
        errors.extend(level_errors)
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
            if levels is not None and "levels" in entry:
                chosen = entry["levels"]
                if not isinstance(chosen, list) or not chosen or any(level not in levels for level in chosen):
                    errors.append("caption levels must name known levels")
            if "sfx" in entry and (not isinstance(entry["sfx"], str) or entry["sfx"] not in CUES):
                errors.append("sfx must name a supported cue")
            if "holdMs" in entry and not finite_number(entry["holdMs"]):
                errors.append("holdMs must be nonnegative milliseconds")
    if len(identifiers) != len(set(identifiers)):
        errors.append("intro and moment ids must be unique")
    if levels:
        errors.extend(_level_coverage_errors(story, mode_ids, levels))
    if "asides" in story:
        errors.extend(_aside_errors(story, mode_ids, levels, identifiers))
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
