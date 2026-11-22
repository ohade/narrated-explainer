"""Pin the faster authoring loop: contact sheets, a silent check, and a warning for long stories."""
import json
from pathlib import Path
import shutil
import struct

import pytest

from narrated_explainer import cli
from narrated_explainer.check import check_story

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "levels"


@pytest.fixture
def folder(tmp_path):
    copy_of = tmp_path / "levels"
    shutil.copytree(FIXTURE, copy_of)
    return copy_of


def run_cli(argv: list[str]) -> int:
    try:
        return cli.main(argv)
    except SystemExit as stop:
        return stop.code


def png_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    assert data.startswith(b"\x89PNG\r\n\x1a\n"), path.name
    return struct.unpack(">II", data[16:24])


def test_snapshots_command_writes_contact_sheets_of_at_most_six_frames(folder, capsys):
    assert run_cli(["snapshots", str(folder), "--no-voice", "--width", "800"]) == 0
    output = folder / "dist/snapshots"
    sheets = sorted(path.name for path in output.glob("sheet-*.png"))
    # Steps per mode and level in the fixture: quick 4/4, normal 6/6, full 7/6; full in mode a needs two sheets.
    assert sheets == ["sheet-a-full-1.png", "sheet-a-full-2.png", "sheet-a-normal.png", "sheet-a-quick.png",
                      "sheet-b-full.png", "sheet-b-normal.png", "sheet-b-quick.png", "sheet-rest.png"]
    for name in sheets:
        width, height = png_size(output / name)
        assert width <= 1600 and height <= 1600, (name, width, height)
    printed = capsys.readouterr().out
    assert all(name in printed for name in sheets), printed


def test_check_warns_when_a_mode_and_level_play_more_than_ten_moments(folder):
    story = json.loads((folder / "story.json").read_text())
    last = max(moment["t"] for moment in story["moments"])
    # Keep every extra moment inside timing.end so the story still loads and only the count is new.
    story["moments"] += [{"id": f"extra{n}", "t": last + n / 10, "modes": ["a"], "levels": ["full"],
                          "caption": f"Extra step number {n}."} for n in range(1, 11)]
    (folder / "story.json").write_text(json.dumps(story))
    report = check_story(folder)
    assert not any("Invalid story" in error for error in report["errors"]), report["errors"]
    warnings = [warning for warning in report["warnings"] if "moments" in warning]
    assert len(warnings) == 1, warnings
    assert "mode a" in warnings[0] and "level full" in warnings[0] and "two explainers" in warnings[0]


def test_check_without_voice_skips_only_the_narration_checks(folder, capsys):
    assert run_cli(["build", str(folder), "--no-voice"]) == 0
    capsys.readouterr()
    assert run_cli(["check", str(folder), "--no-voice", "--json"]) == 0
    silent = json.loads(capsys.readouterr().out)
    assert silent["ok"] is True, silent["errors"]
    assert not any("narration" in error.lower() for error in silent["errors"])
    assert run_cli(["check", str(folder), "--json"]) != 0
    voiced = json.loads(capsys.readouterr().out)
    assert any("Missing narration" in error for error in voiced["errors"]), voiced["errors"]
