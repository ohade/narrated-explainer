"""Pin the footer credit's font and size in a standalone page, and the player font in a bare host page."""
from pathlib import Path
import shutil

import pytest

from narrated_explainer import layout
from narrated_explainer.bundle import build

EXAMPLE = Path(__file__).resolve().parents[1] / "examples" / "deadline-race"
HOST = '<!doctype html><html><head><meta charset="utf-8"><title>Host</title></head><body>{}</body></html>'

STANDALONE_JS = """() => {
  const footer = document.querySelector('body.nx-page > footer');
  const link = footer && footer.querySelector('a');
  const caption = document.querySelector('figure.nx figcaption');
  if (!link || !caption) return null;
  const style = getComputedStyle(link);
  return { credit: footer.classList.contains('nx-credit'), family: style.fontFamily, size: style.fontSize,
           caption: getComputedStyle(caption).fontFamily };
}"""
FRAGMENT_JS = """() => ({
  figure: getComputedStyle(document.querySelector('figure.nx')).fontFamily,
  caption: getComputedStyle(document.querySelector('figure.nx figcaption')).fontFamily,
})"""


@pytest.fixture(scope="module")
def race(tmp_path_factory):
    folder = tmp_path_factory.mktemp("credit") / "deadline-race"
    shutil.copytree(EXAMPLE, folder, ignore=shutil.ignore_patterns("dist"))
    return folder


def test_footer_link_uses_the_player_font_at_16px(race):
    page = build(race, no_voice=True)
    with layout.LivePage(page) as live:
        seen = live.page.evaluate(STANDALONE_JS)
    assert seen is not None, "the standalone page has a footer link and a caption"
    assert seen["credit"], "the footer carries the nx-credit class"
    assert seen["family"] == seen["caption"]
    assert seen["size"] == "16px"


def test_fragment_in_a_bare_host_page_uses_the_player_font(race, tmp_path):
    fragment = build(race, fragment=True, no_voice=True)
    host = tmp_path / "host.html"
    host.write_text(HOST.format(fragment.read_text(encoding="utf-8")), encoding="utf-8")
    with layout.LivePage(host) as live:
        seen = live.page.evaluate(FRAGMENT_JS)
    assert seen["figure"].startswith("system-ui"), seen
    assert seen["caption"] == seen["figure"]
