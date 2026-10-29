"""Built-in voice engine selection."""


def create_engine(name: str, url: str | None = None):
    if name == "kokoro":
        from .kokoro import KokoroEngine
        return KokoroEngine()
    if name == "http":
        from .http import HttpEngine
        return HttpEngine(url)
    raise ValueError(f"Unknown voice engine: {name}")
