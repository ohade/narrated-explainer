"""Export readiness stays optional in global diagnostics."""
from types import SimpleNamespace

from narrated_explainer.doctor import doctor_report


def test_export_readiness_with_and_without_browser(monkeypatch):
    import playwright.sync_api
    report = doctor_report()
    readiness = {check["name"]: check for check in report["checks"]}
    assert "snapshots" in readiness and "video" in readiness
    assert readiness["snapshots"]["ok"] and readiness["video"]["ok"]

    class MissingBrowser:
        def __enter__(self):
            return SimpleNamespace(chromium=SimpleNamespace(executable_path="/not-installed/chromium"))

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(playwright.sync_api, "sync_playwright", MissingBrowser)
    missing = doctor_report()
    checks = {check["name"]: check for check in missing["checks"]}
    for name in ("snapshots", "video"):
        assert checks[name]["ok"] is False
        assert checks[name]["required"] is False
        assert "uv run playwright install chromium" in checks[name]["fix"]
    assert missing["ok"] == report["ok"]
