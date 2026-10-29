"""MP3 encoding and local speech recognition."""

from pathlib import Path
import subprocess

from .models import require_models


def encode_mp3(samples, sample_rate: int, destination: Path) -> str:
    import imageio_ffmpeg
    import numpy
    audio = numpy.asarray(samples, dtype="float32")
    if audio.ndim == 2:
        audio = audio.mean(axis=1)
    if audio.ndim != 1 or not len(audio) or not numpy.isfinite(audio).all():
        raise ValueError("Voice engine returned invalid samples")
    result = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y",
                             "-f", "f32le", "-ar", str(sample_rate), "-ac", "1", "-i", "pipe:0",
                             "-codec:a", "libmp3lame", "-b:a", "48k", "-ac", "1", str(destination)],
                            input=audio.astype("<f4").tobytes(), capture_output=True, timeout=120)
    if result.returncode:
        raise ValueError("MP3 encoding failed (imageio-ffmpeg/libmp3lame)")
    return "imageio-ffmpeg/libmp3lame mono 48kbps"


class Recognizer:
    def __init__(self):
        from faster_whisper import WhisperModel
        self.model = WhisperModel(str(require_models() / "whisper"), device="cpu", compute_type="int8", local_files_only=True)

    def transcribe(self, path: Path) -> tuple[str, list[dict], float]:
        segments, info = self.model.transcribe(str(path), language="en", word_timestamps=True,
                                                initial_prompt=None, beam_size=5)
        text, words = [], []
        for segment in segments:
            text.append(segment.text)
            words.extend({"word": word.word, "start": word.start, "end": word.end} for word in (segment.words or []))
        return " ".join(text).strip(), words, info.duration
