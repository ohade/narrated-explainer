"""Story, narration and built-file checks."""
from pathlib import Path
import re

from .bundle import inspect_html, is_fragment_html
from .layout import inspect_layout
from .narration import clip_path, load_manifest, stale_reasons
from .story import load_story


def check_story(directory: Path) -> dict:
    errors, warnings, built, info = [], [], [], []
    try:
        story = load_story(directory)
    except (ValueError, OSError) as error:
        return {"schema_version": 1, "ok": False, "errors": [str(error)], "warnings": [], "built": [], "info": []}
    scene = directory / "scene.js"
    if not scene.is_file():
        errors.append("Missing scene.js")
    elif re.search(r"#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(", scene.read_text(encoding="utf-8")):
        warnings.append("scene.js contains colour literals; use kit tones")
    try:
        manifest = load_manifest(directory)
    except (ValueError, OSError) as error:
        errors.append(str(error))
        manifest = None
    if manifest is None:
        errors.append("Missing narration; run: explainer narrate")
    else:
        clips = manifest.get("clips", {})
        if not isinstance(clips, dict):
            errors.append("narration clips must be an object")
        else:
            errors.extend(stale_reasons(story, manifest))
            for clip in clips.values():
                if not isinstance(clip, dict) or "file" not in clip:
                    errors.append("narration clip must be an object with an MP3 file")
                    continue
                try:
                    if not clip_path(directory, clip["file"]).is_file():
                        errors.append("Missing narration clip; run: explainer narrate")
                except ValueError as error:
                    errors.append(str(error))
    for path in sorted((directory / "dist").glob("*.html")):
        text = path.read_text(encoding="utf-8")
        errors.extend(f"{path.name}: {error}" for error in inspect_html(text))
        layout_errors, layout_warnings = inspect_layout(path)
        errors.extend(layout_errors)
        warnings.extend(layout_warnings)
        if is_fragment_html(text) and "CSP: host page's responsibility" not in info:
            info.append("CSP: host page's responsibility")
        built.append({"file": path.name, "bytes": path.stat().st_size})
    return {"schema_version": 1, "ok": not errors, "errors": errors, "warnings": warnings, "built": built, "info": info}
