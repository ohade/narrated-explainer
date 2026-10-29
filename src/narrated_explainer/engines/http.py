"""Explicit OpenAI-compatible speech endpoint, with no authentication."""

import io
import json
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


class HttpEngine:
    def __init__(self, url: str | None):
        if not url:
            raise ValueError("The http engine requires --url http://localhost:PORT/v1/audio/speech")
        parsed = urlsplit(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("Speech URL must be an http(s) endpoint without credentials, query or fragment")
        self.url = url

    def synthesize(self, text: str, voice: str, speed: float):
        import soundfile
        request = Request(self.url, data=json.dumps({"model": "tts-1", "input": text,
                          "voice": voice, "speed": speed, "response_format": "wav"}).encode(),
                          headers={"Content-Type": "application/json"}, method="POST")
        with urlopen(request, timeout=120) as response:
            audio = response.read(50_000_001)
        if len(audio) > 50_000_000:
            raise ValueError("Speech response exceeds 50 MB")
        return soundfile.read(io.BytesIO(audio), dtype="float32")
