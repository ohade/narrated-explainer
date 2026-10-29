"""An explicit bootstrap exception: bare setup installs its defaults."""

import os
from pathlib import Path
import subprocess


def test_bare_setup_installs_browser_and_default_skill(tmp_path):
    binary = tmp_path / "bin"
    binary.mkdir()
    calls = tmp_path / "calls"
    for name in ("uv", "explainer"):
        path = binary / name
        path.write_text('#!/bin/sh\nprintf "%s %s\\n" "$(basename "$0")" "$*" >> "$CALL_LOG"\nif [ "$*" = "tool dir --bin" ]; then printf "%s\\n" "$FAKE_BIN"; fi\n')
        path.chmod(0o755)
    home = tmp_path / "home"
    (home / ".claude/skills").mkdir(parents=True)
    repo = Path(__file__).resolve().parents[1]
    env = {**os.environ, "PATH": str(binary) + os.pathsep + os.environ["PATH"],
           "HOME": str(home), "CALL_LOG": str(calls), "FAKE_BIN": str(binary)}
    result = subprocess.run(["/bin/bash", str(repo / "setup.sh")], env=env, capture_output=True, text=True)
    assert result.returncode == 0
    assert calls.is_file(), "bare setup is an installer, not help"
    content = calls.read_text()
    assert "uv python install 3.12" in content and "playwright install chromium" in content
    assert "explainer models fetch" in content and "explainer doctor --smoke" in content
    assert (home / ".claude/skills/narrated-explainer").is_symlink()
