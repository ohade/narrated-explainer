"""CLI and setup boundary tests; installer tools are isolated local fixtures."""

import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from narrated_explainer import cli, doctor


def test_cli_help_version_usage_and_json(capsys, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert cli.main([]) == 0
    assert "usage:" in capsys.readouterr().out
    assert cli.main(["--version"]) == 0
    assert "0.1.0" in capsys.readouterr().out
    with pytest.raises(SystemExit) as error:
        cli.main(["--unknown"])
    assert error.value.code == 2
    monkeypatch.setattr(doctor, "doctor_report", lambda smoke=False: {"schema_version": 1, "ok": False, "checks": []})
    assert cli.main(["doctor", "--json"]) == 1
    assert json.loads(capsys.readouterr().out)["schema_version"] == 1
    assert list(tmp_path.iterdir()) == []


def test_new_copies_template_and_refuses_overwrite(tmp_path):
    template = tmp_path / "template"
    template.mkdir()
    (template / "story.json").write_text('{"id":"starter"}')
    destination = tmp_path / "new-story"
    cli.new_story(destination, template=template)
    assert (destination / "story.json").is_file()
    with pytest.raises(ValueError, match="exists"):
        cli.new_story(destination, template=template)
    assert (destination / "story.json").read_text() == '{"id":"starter"}'


def test_doctor_required_model_gap_fails_but_browser_is_optional(monkeypatch):
    from narrated_explainer import models
    monkeypatch.setattr(models, "verify_models", lambda: [{"file": "fixture", "ok": False, "fix": "explainer models fetch"}])
    report = doctor.doctor_report()
    assert report["schema_version"] == 1
    assert report["ok"] is False
    assert any("models fetch" in check.get("fix", "") for check in report["checks"])
    monkeypatch.setattr(models, "verify_models", lambda: [{"file": "fixture", "ok": True}])
    monkeypatch.setattr(Path, "is_file", lambda path: False)
    report = doctor.doctor_report()
    assert report["ok"] is True
    browser = next(check for check in report["checks"] if check["name"] == "chromium")
    assert browser["ok"] is False and browser["required"] is False
    assert browser["fix"] == "uv run playwright install chromium"


def test_setup_repeats_safe_local_boundaries_and_protects_skill(tmp_path):
    repo = Path(__file__).resolve().parents[1]
    binary = tmp_path / "bin"
    binary.mkdir()
    logfile = tmp_path / "calls.log"
    uv = binary / "uv"
    uv.write_text('#!/bin/sh\nprintf "uv %s\\n" "$*" >> "$CALL_LOG"\nif [ "$*" = "tool dir --bin" ]; then printf "%s\\n" "$FAKE_BIN"; fi\n')
    explainer = binary / "explainer"
    explainer.write_text('#!/bin/sh\nprintf "explainer %s\\n" "$*" >> "$CALL_LOG"\n')
    uv.chmod(0o755)
    explainer.chmod(0o755)
    home = tmp_path / "home"
    home.mkdir()
    env = {**os.environ, "HOME": str(home), "PATH": str(binary) + os.pathsep + os.environ["PATH"],
           "CALL_LOG": str(logfile), "FAKE_BIN": str(binary)}
    for _ in range(2):
        result = subprocess.run(["bash", str(repo / "setup.sh"), "--no-browser", "--skill", "none"], env=env, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
    assert logfile.is_file(), "setup must install Python/tool and run models plus doctor"
    calls = logfile.read_text()
    assert calls.count("uv python install 3.12") == 2
    assert calls.count("uv tool install --force --editable") == 2
    assert calls.count("explainer models fetch") == 2
    assert calls.count("explainer doctor --smoke") == 2
    assert "playwright install" not in calls
    target = home / ".claude/skills/narrated-explainer"
    target.mkdir(parents=True)
    (target / "keep").write_text("owned")
    result = subprocess.run(["bash", str(repo / "setup.sh"), "--no-browser", "--skill", "claude"], env=env, capture_output=True, text=True)
    assert result.returncode == 1
    assert (target / "keep").read_text() == "owned"
