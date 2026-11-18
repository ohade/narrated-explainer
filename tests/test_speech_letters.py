"""A capital A used as a name mid-sentence, followed by a word, is spoken as a letter, not as the article."""
import pytest

from narrated_explainer.speech import align_words, spoken_text


@pytest.mark.parametrize("caption, spoken", [
    ("Partner A answers first.", "Partner A. answers first."),
    ("Services A and B", "Services A. and B"),
    ("We cut partner A at 180 ms.", "We cut partner A. at 180 milliseconds."),
    ("Partner A 180", "Partner A. 180"),
    ('He said: "A partner" and then A wins.', 'He said: "A partner" and then A. wins.'),
])
def test_capital_a_followed_by_a_word_is_respelled_as_a_letter(caption, spoken):
    assert spoken_text(caption) == spoken


@pytest.mark.parametrize("caption", [
    "Plan A.",
    "partner A, then B",
    "Then A's reply waits.",
    "an A-grade link",
    "the A/B test",
    "Pick A; then wait",
    "Is it A?",
    "(partner A)",
    "partner A",
])
def test_capital_a_not_followed_by_a_word_is_unchanged(caption):
    assert spoken_text(caption) == caption


@pytest.mark.parametrize("caption", [
    "A partner answers.",
    "Note: A partner answers.",
    "Wait. A partner answers.",
    "Really? (A partner answers.)",
    "✓ A partner answers.",
    "She had a plan.",
])
def test_article_at_sentence_start_and_lowercase_a_are_unchanged(caption):
    assert spoken_text(caption) == caption.replace("✓ ", "")


def test_story_pronounce_for_a_wins_over_the_built_in_rule():
    assert spoken_text("Partner A answers first.", {"A": "Eh"}) == "Partner Eh answers first."


def test_story_respelling_that_contains_a_letter_a_is_not_rewritten():
    assert spoken_text("The API waits.", {"API": "A P I"}) == "The A P I waits."


def test_say_text_gets_the_same_letter_rule():
    assert spoken_text("ignored", say="Partner A answers.") == "Partner A. answers."


def test_alignment_keeps_one_span_per_caption_word_around_a_letter():
    caption = "Partner A answers first."
    words = [{"word": word, "start": i * 0.5, "end": i * 0.5 + 0.4}
             for i, word in enumerate(["Partner", "A", "answers", "first."])]
    aligned = align_words(caption, spoken_text(caption), words, 2.0)
    assert len(aligned) == 4
    for span, expected in zip(aligned, [[0.0, 0.4], [0.5, 0.9], [1.0, 1.4], [1.5, 1.9]]):
        assert span == pytest.approx(expected)
