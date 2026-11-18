"""Pin the control bar: one row of icon buttons on desktop, a More menu for the rarely used controls."""
from pathlib import Path
import shutil

import pytest

from narrated_explainer import layout
from narrated_explainer.bundle import build

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "control-bar"
DESKTOP_BAR_MAX, PHONE_BAR_MAX = 92, 140
BAR_JS = "() => document.querySelector('figure.nx .nx-bar').getBoundingClientRect().height"
# Visible controls only: the menu items sit in a closed <details>, so they have no box until it opens.
ROW_JS = """() => [...document.querySelectorAll('figure.nx .nx-controls button, figure.nx .nx-controls select, figure.nx .nx-controls summary')]
  .map((el) => ({ el, box: el.getBoundingClientRect() })).filter(({ box }) => box.width && box.height)
  .map(({ el, box }) => ({ cls: el.className, top: box.top, bottom: box.bottom, left: box.left, width: box.width, height: box.height }))"""
STAGE_JS = "() => document.querySelector('figure.nx .nx-stage').getBoundingClientRect().toJSON()"
MENU_JS = """() => {
  const more = document.querySelector('figure.nx .nx-more');
  const menu = more && more.querySelector('.nx-menu');
  if (!menu) return { open: null, shown: false, top: 0, items: [] };
  const box = menu.getBoundingClientRect();
  return { open: more.open, shown: Boolean(box.width && box.height), top: box.top,
           items: [...menu.children].filter((el) => el.getBoundingClientRect().width).map((el) => el.className.split(' ')[0]) };
}"""
SUMMARY_BOTTOM_JS = "() => document.querySelector('figure.nx .nx-more summary').getBoundingClientRect().bottom"
SUMMARY = "figure.nx .nx-more summary"
FIRST_CLASS = lambda row: [item["cls"].split(" ")[0] for item in row]  # noqa: E731


@pytest.fixture(scope="module")
def page(tmp_path_factory):
    folder = tmp_path_factory.mktemp("bar") / "control-bar"
    shutil.copytree(FIXTURE, folder)
    return build(folder, no_voice=True)


def open_menu(live):
    assert live.page.locator(SUMMARY).count() == 1, "the bar has a More menu"
    live.page.click(SUMMARY)


def test_desktop_bar_is_one_row_of_at_most_92_px(page):
    with layout.LivePage(page, 1280, 720) as live:
        row = live.page.evaluate(ROW_JS)
        bar = live.page.evaluate(BAR_JS)
    centres = {round((item["top"] + item["bottom"]) / 2) for item in row}
    assert max(centres) - min(centres) <= 1, (sorted(centres), FIRST_CLASS(row))
    assert bar <= DESKTOP_BAR_MAX, bar


def test_row_order_is_modes_play_previous_next_then_speed_fullscreen_more(page):
    with layout.LivePage(page, 1280, 720) as live:
        row = sorted(live.page.evaluate(ROW_JS), key=lambda item: item["left"])
    assert FIRST_CLASS(row) == ["nx-mode", "nx-mode", "nx-mode", "nx-play", "nx-prev", "nx-next",
                                "nx-speed", "nx-fullscreen", "nx-more-toggle"], FIRST_CLASS(row)


def test_icon_buttons_are_44_px_targets_with_a_24_px_glyph(page):
    with layout.LivePage(page, 1280, 720) as live:
        sizes = live.page.evaluate("""() => [...document.querySelectorAll(
          'figure.nx .nx-play, .nx-prev, .nx-next, .nx-fullscreen, .nx-more-toggle')].map((el) => {
            const svg = el.querySelector('svg');
            const glyph = svg ? svg.getBoundingClientRect() : { width: 0, height: 0 };
            const box = el.getBoundingClientRect();
            return [box.width, box.height, glyph.width, glyph.height, el.getAttribute('aria-label'), el.getAttribute('data-icon')];
          })""")
    assert [(w, h, gw, gh) for w, h, gw, gh, _, _ in sizes] == [(44, 44, 24, 24)] * 5, sizes
    assert [name for *_, name, _ in sizes] == ["Play", "Previous", "Next", "Fullscreen", "More"]
    assert [icon for *_, icon in sizes] == ["play", "prev", "next", "fullscreen", "more"]


def test_phone_bar_may_wrap_but_stays_at_most_140_px(page):
    with layout.LivePage(page, 390, 844) as live:
        bar = live.page.evaluate(BAR_JS)
    assert bar <= PHONE_BAR_MAX, bar


def test_more_menu_opens_below_the_summary_without_moving_the_stage(page):
    with layout.LivePage(page, 1280, 720) as live:
        before = live.page.evaluate(STAGE_JS)
        closed = live.page.evaluate(MENU_JS)
        open_menu(live)
        opened = live.page.evaluate(MENU_JS)
        after = live.page.evaluate(STAGE_JS)
        summary_bottom = live.page.evaluate(SUMMARY_BOTTOM_JS)
    assert (closed["open"], closed["shown"]) == (False, False), closed
    assert (opened["open"], opened["shown"]) == (True, True)
    assert opened["items"] == ["nx-restart", "nx-sound", "nx-transcript-toggle", "nx-theme"]
    assert opened["top"] >= summary_bottom - 1, (opened["top"], summary_bottom)
    assert after == before, (before, after)


def test_escape_closes_the_menu_and_a_click_outside_closes_it(page):
    with layout.LivePage(page, 1280, 720) as live:
        open_menu(live)
        live.page.keyboard.press("Escape")
        assert live.page.evaluate(MENU_JS)["open"] is False
        open_menu(live)
        assert live.page.evaluate(MENU_JS)["open"] is True
        live.page.click("figure.nx .nx-caption")
        assert live.page.evaluate(MENU_JS)["open"] is False


def test_restart_closes_the_menu_and_toggles_leave_it_open(page):
    with layout.LivePage(page, 1280, 720) as live:
        open_menu(live)
        live.page.click("figure.nx .nx-menu .nx-sound")
        live.page.click("figure.nx .nx-menu .nx-transcript-toggle")
        assert live.page.evaluate(MENU_JS)["open"] is True
        live.page.click("figure.nx .nx-menu .nx-restart")
        assert live.page.evaluate(MENU_JS)["open"] is False
