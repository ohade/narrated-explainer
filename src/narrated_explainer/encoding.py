"""Stream PNG frames through packaged ffmpeg with bounded waits."""
from collections.abc import Iterable
from pathlib import Path
import subprocess
import tempfile
from threading import Timer

import imageio_ffmpeg

ENCODER_WAIT = 120


def encoder_command(destination: Path, fps: float, count: int, format: str,
                    audio: Path | None = None) -> list[str]:
    duration = count / fps
    command = [imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y",
               "-f", "image2pipe", "-framerate", str(fps), "-i", "pipe:0"]
    if audio is not None:
        command += ["-i", str(audio)]
    command += ["-filter_complex_threads", "1"]
    if format == "gif":
        command += ["-filter_complex", "[0:v]split[a][b];[a]palettegen[p];[b][p]paletteuse[v]",
                    "-map", "[v]", "-an", "-loop", "0"]
    else:
        command += ["-filter_complex", f"[1:a]apad,atrim=duration={duration:g}[audio]",
                    "-map", "0:v:0", "-map", "[audio]"]
        if format == "mp4":
            command += ["-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264",
                        "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart"]
        else:
            raise ValueError("Unknown video format")
    command += ["-t", f"{duration:.12g}", "-f", format, str(destination)]
    return command


def _stop_encoder(process) -> None:
    if process.poll() is None:
        process.kill()
    process.wait(timeout=10)


def encode_frames(frames: Iterable[bytes], destination: Path, fps: float, count: int,
                  format: str, audio: bytes | None = None) -> None:
    with tempfile.TemporaryDirectory(prefix="explainer-encoder-") as temporary:
        audio_path = None
        if audio is not None:
            audio_path = Path(temporary) / "soundtrack.wav"
            audio_path.write_bytes(audio)
        command = encoder_command(destination, fps, count, format, audio_path)
        with tempfile.TemporaryFile() as diagnostics:
            process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=diagnostics)
            try:
                for image in frames:
                    # Killing a stalled encoder releases a blocked pipe writer.
                    timer = Timer(ENCODER_WAIT, process.kill)
                    timer.start()
                    try:
                        process.stdin.write(image)
                        process.stdin.flush()
                    finally:
                        timer.cancel()
                process.stdin.close()
                process.wait(timeout=ENCODER_WAIT)
                if process.returncode:
                    diagnostics.seek(0)
                    raise RuntimeError("Video encoder failed: " + diagnostics.read().decode(errors="replace")[-4000:])
                if not destination.is_file() or destination.stat().st_size == 0:
                    raise RuntimeError("Video encoder produced no output")
            except (BrokenPipeError, subprocess.TimeoutExpired) as error:
                _stop_encoder(process)
                diagnostics.seek(0)
                detail = diagnostics.read().decode(errors="replace")[-4000:]
                raise RuntimeError(f"Video encoder failed or timed out: {detail}") from error
            finally:
                _stop_encoder(process)
                if not process.stdin.closed:
                    process.stdin.close()
