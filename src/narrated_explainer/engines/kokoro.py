"""In-process Kokoro ONNX voice plug-in."""

import os
from pathlib import Path
import shutil
import tempfile

from narrated_explainer.models import require_models


def _native_data_directory(source: str) -> tuple[str, tempfile.TemporaryDirectory | None]:
    # espeakng-loader 0.2.4 builds eSpeak-NG 1.52.0. Its speech.h defines
    # N_PATH_HOME_DEF as 160 on POSIX, 230 on Windows. speech.c uses snprintf
    # into that buffer and silently falls back when the truncated path is absent.
    # https://github.com/espeak-ng/espeak-ng/blob/1.52.0/src/libespeak-ng/speech.h
    maximum = 229 if os.name == "nt" else 159
    original = str(Path(source).resolve())
    if len(os.fsencode(original)) <= maximum:
        return original, None
    temporary = tempfile.TemporaryDirectory(prefix="nx-espeak-")
    destination = Path(temporary.name).resolve() / "data"
    if len(os.fsencode(destination)) > maximum:
        temporary.cleanup()
        raise ValueError("eSpeak data path exceeds its native limit; set TMPDIR (TEMP on Windows) to a shorter local directory")
    try:
        shutil.copytree(original, destination)
    except OSError:
        temporary.cleanup()
        raise
    return str(destination), temporary


class KokoroEngine:
    def __init__(self):
        import espeakng_loader
        from kokoro_onnx import Kokoro
        from kokoro_onnx.config import EspeakConfig
        root = require_models() / "kokoro"
        data_path, self._temporary_data = _native_data_directory(espeakng_loader.get_data_path())
        self.model = Kokoro(str(root / "kokoro-v1.0.onnx"), str(root / "voices-v1.0.bin"),
                            espeak_config=EspeakConfig(lib_path=espeakng_loader.get_library_path(), data_path=data_path))

    def close(self) -> None:
        """Release copied data; TemporaryDirectory also cleans it on collection."""
        if self._temporary_data is not None:
            self._temporary_data.cleanup()
            self._temporary_data = None

    def synthesize(self, text: str, voice: str, speed: float):
        return self.model.create(text, voice=voice, speed=speed, lang="en-us")
