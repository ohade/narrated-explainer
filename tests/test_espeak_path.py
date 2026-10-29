"""The native data path adapter preserves bytes and bounds lifetime."""

import os
from pathlib import Path

from narrated_explainer.engines.kokoro import KokoroEngine, _native_data_directory


def test_long_native_data_path_is_copied_and_cleaned(tmp_path):
    source = tmp_path / ("long-" * 15) / ("nested-" * 12) / "data"
    source.mkdir(parents=True)
    (source / "phontab").write_bytes(b"bundled phoneme data")
    destination, temporary = _native_data_directory(str(source))
    assert temporary is not None
    assert len(os.fsencode(destination)) <= (229 if os.name == "nt" else 159)
    assert (Path(destination) / "phontab").read_bytes() == (source / "phontab").read_bytes()
    engine = KokoroEngine.__new__(KokoroEngine)
    engine._temporary_data = temporary
    engine.close()
    assert not Path(destination).exists()
    assert (source / "phontab").is_file()


def test_short_native_data_path_is_used_directly(tmp_path):
    # Use the standard temporary directory itself: no new model files needed.
    import tempfile
    source = tempfile.gettempdir()
    destination, temporary = _native_data_directory(source)
    assert destination == str(Path(source).resolve()) and temporary is None
