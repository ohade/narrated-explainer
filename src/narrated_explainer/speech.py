"""Spoken forms, numeric verification and approximate recognizer alignment."""

from collections import Counter
from decimal import Decimal
from difflib import SequenceMatcher
import re

SMALL = dict(zip(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(),
    range(20),
))
TENS = dict(zip("twenty thirty forty fifty sixty seventy eighty ninety".split(), range(20, 100, 10)))
SCALES = {"thousand": 1000, "million": 1000000, "billion": 1000000000}
TOKEN = re.compile(r"[+-]?\d[\d,]*(?:\.\d+)?|[a-z]+", re.I)


def spoken_text(caption: str, pronounce: dict | None = None, say: str | None = None) -> str:
    """Apply whole-word pronunciations and the default symbol/unit rules."""
    text = caption if say is None else say
    for word, replacement in (pronounce or {}).items():
        text = re.sub(r"(?<!\w)" + re.escape(word) + r"(?!\w)", lambda _: replacement, text)
    text = re.sub(r"\bms\b", "milliseconds", text)
    text = text.replace("%", " percent").replace("&", " and ")
    text = re.sub(r"[✓✔✕✖✗×]", "", text)
    return " ".join(text.split())


def _number_at(tokens: list[str], start: int) -> tuple[str, int] | None:
    token = tokens[start]
    if token in ("minus", "negative") and start + 1 < len(tokens):
        number = _number_at(tokens, start + 1)
        if number:
            value, end = number
            return str((-Decimal(value)).normalize()), end
    if token.lstrip("+-")[0].isdigit():
        return str(Decimal(token.replace(",", "")).normalize()), start + 1
    if token not in SMALL and token not in TENS and token != "point":
        return None
    index, total, group = start, 0, 0
    previous = None
    while index < len(tokens):
        word = tokens[index]
        if word in SMALL or word in TENS:
            value = SMALL.get(word, TENS.get(word))
            # Adjacent unit numbers are separate values; a tens+unit pair is one.
            if previous in SMALL or (previous in TENS and value >= 10):
                break
            group += value
        elif word == "hundred" and group and previous != "hundred":
            group *= 100
        elif word in SCALES and group:
            total += group * SCALES[word]
            group = 0
        elif word == "and" and index + 1 < len(tokens) and (tokens[index + 1] in SMALL or tokens[index + 1] in TENS):
            if previous not in SCALES and previous != "hundred":
                break
        else:
            break
        previous = word
        index += 1
    value = Decimal(total + group)
    if index < len(tokens) and tokens[index] == "point":
        end, digits = index + 1, ""
        while end < len(tokens) and tokens[end] in SMALL and SMALL[tokens[end]] < 10:
            digits += str(SMALL[tokens[end]])
            end += 1
        if digits:
            value += Decimal("0." + digits)
            index = end
    if index == start:
        return None
    return str(value.normalize()), index


def canonical_tokens(text: str) -> list[tuple[str, int, int]]:
    """Return normalized words/numbers and their source token spans."""
    tokens = [match.group().lower() for match in TOKEN.finditer(text)]
    result, index = [], 0
    while index < len(tokens):
        number = _number_at(tokens, index)
        if number:
            value, end = number
            result.append(("#" + value, index, end))
            index = end
        else:
            result.append((tokens[index], index, index + 1))
            index += 1
    return result


def assess(expected: str, transcript: str) -> tuple[float, bool]:
    wanted = [word for word, _, _ in canonical_tokens(expected)]
    heard = [word for word, _, _ in canonical_tokens(transcript)]
    score = SequenceMatcher(None, wanted, heard, autojunk=False).ratio()
    wanted_numbers = Counter(word for word in wanted if word.startswith("#"))
    heard_numbers = Counter(word for word in heard if word.startswith("#"))
    return score, score >= 0.85 and not (wanted_numbers - heard_numbers)


def align_words(caption: str, spoken: str, transcript_words: list[dict], duration: float,
                pronounce: dict | None = None) -> list[list[float]]:
    """Map recognized spans to displayed words with character sequence alignment.

    Exact normalized words retain their observed spans before numeric expansion.
    Unrecognized words receive a collapsed boundary, never invented uniform timing.
    """
    raw_tokens, raw_times = [], []
    for word in transcript_words:
        for match in TOKEN.finditer(word["word"]):
            raw_tokens.append(match.group().lower())
            raw_times.append([max(0, float(word["start"])), min(duration, float(word["end"]))])
    # Match ungrouped text first, so "two hundred" keeps two observed word spans.
    exact_parts = ["".join(match.group().lower() for match in TOKEN.finditer(spoken_text(word, pronounce)))
                   for word in caption.split()]
    exact_chars = "".join(exact_parts)
    raw_chars = "".join(raw_tokens)
    raw_char_times = [time for token, time in zip(raw_tokens, raw_times) for _ in token]
    exact_mapping = {}
    for block in SequenceMatcher(None, exact_chars, raw_chars, autojunk=False).get_matching_blocks():
        exact_mapping.update({block.a + offset: block.b + offset for offset in range(block.size)})
    heard_chars, char_times = "", []
    for token, start, end in canonical_tokens(" ".join(raw_tokens)):
        heard_chars += token
        char_times.extend([[raw_times[start][0], raw_times[end - 1][1]]] * len(token))
    display_parts = ["".join(token for token, _, _ in canonical_tokens(spoken_text(word, pronounce)))
                     for word in caption.split()]
    display_chars = "".join(display_parts)
    mapping = {}
    for block in SequenceMatcher(None, display_chars, heard_chars, autojunk=False).get_matching_blocks():
        mapping.update({block.a + offset: block.b + offset for offset in range(block.size)})
    result, offset, exact_offset, boundary = [], 0, 0, 0.0
    for part, exact_part in zip(display_parts, exact_parts):
        exact_indices = [exact_mapping.get(index) for index in range(exact_offset, exact_offset + len(exact_part))]
        if exact_indices and None not in exact_indices and exact_indices == list(range(exact_indices[0], exact_indices[0] + len(exact_part))):
            times = [raw_char_times[index] for index in exact_indices]
        else:
            times = [char_times[mapping[index]] for index in range(offset, offset + len(part)) if index in mapping]
        pair = [max(boundary, min(time[0] for time in times)), max(time[1] for time in times)] if times else [boundary, boundary]
        pair[1] = max(pair[0], min(duration, pair[1]))
        result.append(pair)
        boundary, offset = pair[1], offset + len(part)
        exact_offset += len(exact_part)
    return result
