# Tools and models

Every tool here runs locally. This page records what was chosen, what was considered, and why.
It reflects a review of primary repositories and model cards in October 2026. Speeds and quality
notes come from the publishers unless marked as measured.

## What the default install uses

| Job | Choice | Code licence | Weights licence | Why |
|---|---|---|---|---|
| Voice | [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) through [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) | MIT | Apache-2.0 | Natural narration, about 300 MB, runs on a CPU, installs with pip and no system packages |
| Speech check and word timings | [faster-whisper](https://github.com/SYSTRAN/faster-whisper) `base.en`, int8 | MIT | MIT | About 145 MB, CPU, word timestamps, bundled audio decoding |
| Sound effects | Web Audio synthesis in `sfx.js` | MIT (this repo) | none | Zero downloads, sample-accurate, renders offline for video |
| Animation | Plain SVG driven by a pure `stateAt(mode, t)` | MIT (this repo) | none | Any frame can be drawn at any time, so playback, stepping, snapshots and video all agree |
| Snapshots and video | [Playwright](https://github.com/microsoft/playwright-python) frame stepping + ffmpeg from [imageio-ffmpeg](https://github.com/imageio/imageio-ffmpeg) | Apache-2.0 / BSD-2 wrapper | none | Frame-exact output with the soundtrack muxed in |
| Python | [uv](https://github.com/astral-sh/uv) installs Python 3.12 and every dependency | MIT / Apache-2.0 | none | One command, no system Python needed |

The voice stack installs eSpeak NG and phonemizer (GPL-3.0) on your machine to turn text into
phonemes. They are not part of this repository. The ffmpeg binary from imageio-ffmpeg is an
LGPL/GPL build.

## Voices considered

| Model | Code / weights | Notes |
|---|---|---|
| Chatterbox, Turbo, Nano (Resemble AI) | MIT / MIT | Expressive, emotion tags, voice cloning. Several GB of weights; a strong optional upgrade through the `http` engine |
| Qwen3-TTS | Apache-2.0 / Apache-2.0 | Ten languages, voice design. 2.5-4.5 GB; GPU recommended |
| Pocket TTS (Kyutai) | MIT / CC-BY-4.0 | CPU-native and tiny; weights are behind an access gate, so not an unattended default |
| Dia, Dia2, Sesame CSM, Orpheus, Maya1, VibeVoice | permissive | Dialogue or expressive models; GPU-oriented, several GB |
| MeloTTS | MIT / MIT | Small and fast; less expressive |
| Piper | GPL-3.0 engine | Very fast, many languages; voices carry their own licences |
| Supertonic 3 | MIT / OpenRAIL-M | Use restrictions; repository archived |
| F5-TTS, Higgs Audio v3, IndexTTS2, NeuTTS Nano | non-commercial or custom | Excluded from the default |

Any local server that speaks the OpenAI `/v1/audio/speech` API works with
`"voice": { "engine": "http" }` and `explainer narrate --url ...`.

## Speech check considered

whisper.cpp (MIT, native build), Parakeet TDT v3 (CC-BY-4.0, 25 languages, larger), Moonshine
(MIT, low latency) and WhisperX (BSD-2, forced alignment) are good alternatives. faster-whisper
won on install simplicity.

## Sound and music considered

| Option | Licence | Notes |
|---|---|---|
| ZzFX, jsfxr, Tone.js | MIT / Unlicense / MIT | Fine synths; plain Web Audio was enough for ten cues |
| Kenney audio packs | CC0 | Good human-made effects if you prefer samples |
| Stable Audio Open (and Small) | custom community licence, gated | Excluded from the default |
| AudioLDM2, Tango 2, TangoFlux, MMAudio, AudioGen, MusicGen | non-commercial | Excluded |
| ACE-Step 1.5 | MIT / MIT | Best open music model found; about 10 GB and slow on CPU, so not installed by default |

## Animation and export considered

| Option | Licence | Notes |
|---|---|---|
| anime.js v4, Motion | MIT | Good timelines, but each brings its own clock; a pure model needs none |
| GSAP | custom no-charge licence, not open source | Excluded |
| Theatre.js, Lottie | Apache-2.0, MIT | Need an editor or authored files |
| Rough.js | MIT | Nice hand-drawn look; a possible style option |
| Motion Canvas, Revideo, Manim | MIT | Render video only, not an interactive page |
| Remotion | custom company licence | Excluded |
| Playwright `recordVideo` | Apache-2.0 | Real-time capture drops frames and has no audio |
| WebCodecs + Mediabunny | MPL-2.0 | In-browser export without ffmpeg; SVG raster fidelity untested |
