"""Runtime failure exits are stable and do not expose a traceback."""

from narrated_explainer import cli


def test_unexpected_runtime_failure_returns_one_without_traceback(monkeypatch, capsys):
    def fail(_):
        raise TypeError("dependency interface changed")
    monkeypatch.setattr(cli, "_run", fail)
    try:
        result = cli.main(["doctor"])
    except TypeError:
        result = None
    output = capsys.readouterr()
    assert result == 1 and "TypeError" in output.err and "Traceback" not in output.err
