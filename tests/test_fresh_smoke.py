"""REAL fresh-process smoke for the installed CLI selected by acceptance."""

import json
import os
from pathlib import Path
import subprocess
import sys

import pytest


@pytest.mark.slow
def test_fresh_installed_cli_smoke():
    executable = os.environ.get("EXPLAINER_ACCEPTANCE_BIN", str(Path(sys.executable).parent / "explainer"))
    result = subprocess.run([executable, "doctor", "--smoke", "--json"], capture_output=True, text=True, timeout=180)
    assert result.returncode == 0, "fresh installed smoke must pass: " + result.stderr
    report = json.loads(result.stdout)
    assert report["ok"] and any(check["name"] == "smoke" and check["ok"] for check in report["checks"])
