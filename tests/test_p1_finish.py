"""Focused signed-value, observed-timing and structured-check regressions."""

import json

import pytest

from narrated_explainer.cli import main
from narrated_explainer.bundle import build, inspect_html
from narrated_explainer.speech import align_words, assess
from test_core import folder, story


@pytest.mark.parametrize("expected,heard", [
    ("-18", "18"), ("18", "-18"), ("-18", "+18"),
    ("negative eighteen", "eighteen"), ("-0.5", "point five"),
])
def test_changed_numeric_sign_is_rejected(expected, heard):
    template = "The temperature stays at {} degrees for the full test."
    assert assess(template.format(expected), template.format(heard))[1] is False


@pytest.mark.parametrize("expected,heard", [
    ("-18", "minus eighteen"), ("-18", "negative eighteen"),
    ("-0.5", "minus point five"), ("+18", "eighteen"), ("-18", "-18"),
    ("well-timed", "well timed"),
])
def test_matching_signed_values_and_word_hyphens_pass(expected, heard):
    assert assess(f"Read {expected} now", f"Read {heard} now")[1] is True


def test_exact_spelled_number_preserves_each_observed_word_interval():
    caption = "Wait two hundred milliseconds."
    words = [{"word": word, "start": i * 0.2, "end": (i + 1) * 0.2}
             for i, word in enumerate(caption.split())]
    assert align_words(caption, caption, words, 0.8) == [
        [word["start"], word["end"]] for word in words
    ]


@pytest.mark.parametrize("manifest", ['{"clips": []}', '[1]', '{invalid',
                                      '{"clips": {"intro-one": []}}'])
def test_malformed_narration_still_emits_versioned_json(folder, manifest, capsys):
    (folder / "narration").mkdir()
    (folder / "narration/manifest.json").write_text(manifest)
    result = main(["check", str(folder), "--json"])
    output = capsys.readouterr()
    assert output.out.strip(), "malformed narration must produce a JSON report"
    report = json.loads(output.out)
    assert result == 1 and report["schema_version"] == 1
    assert report["ok"] is False and report["errors"]
    assert output.err == ""


def test_fragment_omits_meta_and_reports_host_csp_responsibility(folder, capsys):
    fragment = build(folder, fragment=True, no_voice=True).read_text()
    assert fragment.startswith("<!-- narrated-explainer fragment -->")
    assert '<meta http-equiv="Content-Security-Policy"' not in fragment
    assert inspect_html(fragment) == []
    assert "body.nx-page" not in fragment and "<body" not in fragment
    main(["check", str(folder), "--json"])
    report = json.loads(capsys.readouterr().out)
    assert "CSP: host page's responsibility" in report["info"]
    assert not any("Content-Security-Policy" in error for error in report["errors"])
    main(["check", str(folder)])
    assert "CSP: host page's responsibility" in capsys.readouterr().out


@pytest.mark.parametrize("unsafe", [
    '<img src="https://example.test/image">', '<script>eval("x")</script>',
    '<script>new Function("x")</script>', '<script>fetch("x")</script>',
])
def test_fragment_retains_other_offline_checks(unsafe):
    assert inspect_html("<!-- narrated-explainer fragment -->\n<figure></figure>" + unsafe)


def test_fragment_marker_cannot_exempt_a_standalone_document_from_csp():
    text = "<!-- narrated-explainer fragment -->\n<!doctype html><html><head></head><body><figure></figure></body></html>"
    assert any("Content-Security-Policy" in error for error in inspect_html(text))
