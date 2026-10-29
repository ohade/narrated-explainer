"""Single-file offline HTML and static network checks."""

import base64
import html
from html.parser import HTMLParser
from importlib.resources import files
import json
from pathlib import Path
import re

from .files import atomic_write
from .narration import clip_path, load_manifest, stale_reasons
from .story import load_story

CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
FRAGMENT_MARKER = "<!-- narrated-explainer fragment -->"


class _BundleParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.errors = []
        self.has_csp = False
        self.is_document = False
        self.script_kind = None
        self.code = []
        self.styles = []
        self.in_style = False

    def handle_starttag(self, tag, attrs):
        if tag in ("html", "head", "body"):
            self.is_document = True
        attrs = dict(attrs)
        if tag == "meta" and attrs.get("http-equiv", "").lower() == "content-security-policy":
            self.has_csp = attrs.get("content") == CSP
        for key, value in attrs.items():
            value = value or ""
            if (key in ("src", "srcset", "poster") or (tag == "link" and key == "href")) and re.search(r"(?:https?:)?//", value, re.I):
                self.errors.append("network-capable resource URL")
        if tag == "script":
            self.script_kind = attrs.get("type", "text/javascript")
        if tag == "style":
            self.in_style = True
        if "style" in attrs:
            self.styles.append(attrs["style"])

    def handle_endtag(self, tag):
        if tag == "script":
            self.script_kind = None
        if tag == "style":
            self.in_style = False

    def handle_data(self, data):
        if self.script_kind and self.script_kind != "application/json":
            self.code.append(data)
        if self.in_style:
            self.styles.append(data)

    def handle_decl(self, decl):
        if decl.lower().startswith("doctype"):
            self.is_document = True


def is_fragment_html(text: str) -> bool:
    """Recognize marked fragments without exempting full HTML documents."""
    if not text.startswith(FRAGMENT_MARKER):
        return False
    parser = _BundleParser()
    parser.feed(text)
    return not parser.is_document


def inspect_html(text: str) -> list[str]:
    parser = _BundleParser()
    parser.feed(text)
    errors = parser.errors
    if not parser.has_csp and not is_fragment_html(text):
        errors.append("missing or incorrect Content-Security-Policy meta tag")
    code = "\n".join(parser.code) if "<" in text else text
    patterns = ((r"\beval\s*\(", "eval is prohibited"),
                (r"\bnew\s+Function\b", "new Function is prohibited"),
                (r"\b(?:fetch|import)\s*\(", "network-capable fetch/import is prohibited"),
                (r"\b(?:XMLHttpRequest|WebSocket)\b", "network-capable API is prohibited"))
    for pattern, message in patterns:
        if re.search(pattern, code):
            errors.append(message)
    if re.search(r"(?:url\s*\(|@import)[^;\n]*(?:https?:)?//", "\n".join(parser.styles), re.I):
        errors.append("network-capable CSS URL")
    return errors


def _json_script(value: object) -> str:
    return json.dumps(value, ensure_ascii=False).replace("</", "<\\/").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def _narration_map(directory: Path, story: dict, no_voice: bool) -> dict | None:
    if no_voice:
        return None
    manifest = load_manifest(directory)
    if manifest is None:
        return None
    errors = stale_reasons(story, manifest)
    if errors:
        raise ValueError("; ".join(errors))
    clips = {}
    for identifier, clip in manifest["clips"].items():
        path = clip_path(directory, clip["file"])
        clips[identifier] = {"src": "data:audio/mpeg;base64," + base64.b64encode(path.read_bytes()).decode(),
                             "duration": clip["duration"], "words": clip["words"]}
    return {"label": manifest["label"], "clips": clips}


def build(directory: Path, fragment: bool = False, no_voice: bool = False, resources=None) -> Path:
    directory = Path(directory)
    story = load_story(directory)
    narration = _narration_map(directory, story, no_voice)
    resources = resources or files("narrated_explainer").joinpath("runtime")
    scripts = [resources.joinpath(name).read_text(encoding="utf-8") for name in ("kit.js", "sfx.js", "player.js")]
    scripts.append((directory / "scene.js").read_text(encoding="utf-8"))
    if any(re.search(r"</script", script, re.I) for script in scripts):
        raise ValueError("Authored JavaScript must not contain an HTML script closing tag")
    css = resources.joinpath("player.css").read_text(encoding="utf-8")
    if re.search(r"</style", css, re.I):
        raise ValueError("Stylesheet contains an HTML style closing tag")
    figure = ('<figure class="nx"></figure>\n<style>' + css + '</style>\n'
              '<script type="application/json" id="nx-story">' + _json_script(story) + '</script>\n'
              '<script type="application/json" id="nx-narration">' + _json_script(narration) + '</script>\n'
              + "\n".join("<script>" + script + "</script>" for script in scripts)
              + '<script>NarratedExplainer.mount(document.querySelector(\'figure.nx\'), {'
              'story: JSON.parse(document.getElementById("nx-story").textContent),'
              'narration: JSON.parse(document.getElementById("nx-narration").textContent)});</script>')
    meta = '<meta http-equiv="Content-Security-Policy" content="' + html.escape(CSP, quote=False) + '">'
    if fragment:
        output = FRAGMENT_MARKER + "\n" + figure
    else:
        description = '<p>' + html.escape(story["description"]) + '</p>' if story.get("description") else ""
        output = ('<!doctype html><html lang="' + html.escape(story["lang"], quote=True) + '"><head>'
                  '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
                  + meta + '<title>' + html.escape(story["title"]) + '</title>'
                  '<style>body.nx-page{padding:24px;font-family:system-ui,sans-serif;}'
                  'body.nx-page>h1{color:var(--nx-ink);}'
                  'body.nx-page>p,body.nx-page>footer{color:var(--nx-ink-2);}'
                  'body.nx-page>footer{margin-top:24px;}'
                  'body.nx-page>footer a{color:var(--nx-info-fg);}</style>'
                  '</head><body class="nx nx-page"><h1>'
                  + html.escape(story["title"]) + '</h1>' + description + figure
                  + '<footer><a href="https://github.com/ohade/narrated-explainer">Made with Narrated Explainer</a></footer></body></html>')
    errors = inspect_html(output)
    if errors:
        raise ValueError("Unsafe bundle: " + "; ".join(errors))
    destination = directory / "dist" / (story["id"] + (".fragment.html" if fragment else ".html"))
    atomic_write(destination, output)
    return destination
