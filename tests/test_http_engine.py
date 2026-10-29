"""The HTTP plug-in talks to a real isolated local fixture server."""

from http.server import BaseHTTPRequestHandler, HTTPServer
import io
import json
import threading

import numpy
import pytest
import soundfile

from narrated_explainer.engines.http import HttpEngine


def test_http_engine_posts_contract_and_decodes_audio():
    received = []
    wav = io.BytesIO()
    soundfile.write(wav, numpy.zeros(1600, dtype="float32"), 16000, format="WAV")

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            received.append((self.path, json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.end_headers()
            self.wfile.write(wav.getvalue())

        def log_message(self, *args):
            pass  # The fixture server has no application logging.

    server = HTTPServer(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=server.serve_forever)
    worker.start()
    try:
        samples, rate = HttpEngine(f"http://127.0.0.1:{server.server_port}/v1/audio/speech").synthesize("A clear request.", "voice", 1.1)
    finally:
        server.shutdown()
        worker.join(timeout=5)
        server.server_close()
    assert rate == 16000 and len(samples) == 1600
    assert received == [("/v1/audio/speech", {"model": "tts-1", "input": "A clear request.", "voice": "voice", "speed": 1.1, "response_format": "wav"})]


@pytest.mark.parametrize("url", [None, "file:///tmp/audio", "http://user:secret@localhost/v1/audio/speech"])
def test_http_engine_rejects_missing_or_credentialed_endpoint(url):
    with pytest.raises(ValueError):
        HttpEngine(url)
