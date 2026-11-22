"""Contact sheets: one PNG per mode and level, so a reviewer opens a few images instead of every frame."""
import base64
from html import escape
from pathlib import Path
import re

from playwright.sync_api import sync_playwright

from .capture import WAIT_MS, launch_browser

FRAMES_PER_SHEET = 6
# Two columns of three rows stay within 1568 px, the longest side an image reader takes without shrinking it.
TILE_WIDTH, IMAGE_HEIGHT, LABEL_HEIGHT, GAP = 760, 488, 24, 16
# Snapshot frames are named <mode>[-<level>]-<two-digit index>-<id>; rest.png and aside pictures share one sheet.
FRAME_NAME = re.compile(r"^(?P<where>.+?)-\d{2}-")
SHEET_CSS = f"""
body {{ margin: 0; background: #d4d4d4; }}
main {{ display: grid; grid-template-columns: repeat(2, max-content); gap: {GAP}px; width: max-content; }}
figure {{ margin: 0; }}
figcaption {{ height: {LABEL_HEIGHT}px; line-height: {LABEL_HEIGHT}px; font: 15px/{LABEL_HEIGHT}px monospace;
  color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }}
img {{ display: block; max-width: {TILE_WIDTH}px; max-height: {IMAGE_HEIGHT}px; }}
"""


def sheet_groups(frames: list[Path]) -> dict[str, list[Path]]:
    """Frames grouped by mode and level, in capture order; frames outside any mode go to "rest"."""
    groups: dict[str, list[Path]] = {}
    for frame in frames:
        match = None if frame.stem.startswith("aside-") else FRAME_NAME.match(frame.stem)
        groups.setdefault(match["where"] if match else "rest", []).append(frame)
    return groups


def _sheet_html(frames: list[Path]) -> str:
    tiles = "".join(
        f'<figure><figcaption>{escape(frame.stem)}</figcaption>'
        f'<img alt="" src="data:image/png;base64,{base64.b64encode(frame.read_bytes()).decode()}"></figure>'
        for frame in frames)
    return f"<!doctype html><html><head><style>{SHEET_CSS}</style></head><body><main>{tiles}</main></body></html>"


def _render(page, frames: list[Path]) -> bytes:
    page.set_content(_sheet_html(frames), wait_until="load", timeout=WAIT_MS)
    broken = page.evaluate("[...document.images].filter(image => !image.complete || image.naturalWidth === 0).length")
    if broken:
        raise RuntimeError(f"Contact sheet could not draw {broken} frame(s)")
    return page.locator("main").screenshot(type="png", timeout=WAIT_MS)


def contact_sheets(frames: list[Path]) -> list[Path]:
    """Write sheet-<group>[-<n>].png beside the frames, at most six frames each; return the sheet paths."""
    chunks = []
    for where, group in sheet_groups(frames).items():
        parts = [group[start:start + FRAMES_PER_SHEET] for start in range(0, len(group), FRAMES_PER_SHEET)]
        for number, part in enumerate(parts, start=1):
            suffix = f"-{number}" if len(parts) > 1 else ""
            chunks.append((part[0].parent / f"sheet-{where}{suffix}.png", part))
    sheets = []
    with sync_playwright() as playwright:
        browser = launch_browser(playwright)
        try:
            context = browser.new_context(viewport={"width": 2 * TILE_WIDTH + GAP, "height": 1000},
                                          device_scale_factor=1, service_workers="block")
            # Every image is inline data; anything that reaches the network is a defect, so refuse it.
            context.route("**/*", lambda route: route.abort())
            page = context.new_page()
            for path, part in chunks:
                path.write_bytes(_render(page, part))
                sheets.append(path)
        finally:
            browser.close()
    return sheets
