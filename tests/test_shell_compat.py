"""Run the same setup assertions on the OS-provided Bash."""

import subprocess

from test_cli_setup import test_setup_repeats_safe_local_boundaries_and_protects_skill as check_setup


def test_setup_with_system_bash(tmp_path, monkeypatch):
    original = subprocess.run

    def run_with_system_bash(arguments, **kwargs):
        if arguments[0] == "bash":
            arguments = ["/bin/bash", *arguments[1:]]
        return original(arguments, **kwargs)

    monkeypatch.setattr(subprocess, "run", run_with_system_bash)
    check_setup(tmp_path)
