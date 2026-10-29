"""Human/agent command interface: result stdout, diagnostics stderr."""
import argparse
from importlib.resources import files
import json
from pathlib import Path
import shutil
import sys
from urllib.error import URLError

from . import __version__, doctor


def _positive_number(value: str) -> float:
    import math
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise argparse.ArgumentTypeError("must be positive and finite")
    return number


def _positive_width(value: str) -> int:
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return number


def _export_parser(commands, name: str, help_text: str):
    command = commands.add_parser(name, help=help_text)
    command.add_argument("directory", type=Path)
    command.add_argument("--no-voice", action="store_true", help="Build without narration; retain story sound cues")
    command.add_argument("--width", type=_positive_width, default=1280 if name == "snapshots" else None,
                         help="Figure width in pixels (1280; GIF 960)")
    command.add_argument("--scheme", choices=("light", "dark"), default="light")
    return command


def new_story(destination: Path, template=None) -> None:
    destination = Path(destination)
    if destination.exists() or destination.is_symlink():
        raise ValueError("Destination exists; choose a new story directory")
    template = template or files("narrated_explainer").joinpath("templates", "starter")
    shutil.copytree(str(template), destination)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="explainer", description="Build local, offline narrated SVG stories.",
                                     epilog="Start: explainer new my-story; explainer narrate my-story; explainer build my-story")
    parser.add_argument("--version", action="version", version=__version__)
    commands = parser.add_subparsers(dest="command")
    commands.add_parser("new", help="Copy a starter into a new directory").add_argument("directory", type=Path)
    narration = commands.add_parser("narrate", help="Record and verify every caption")
    narration.add_argument("directory", type=Path)
    narration.add_argument("--url", help="Explicit OpenAI-compatible speech endpoint for voice.engine=http")
    builder = commands.add_parser("build", help="Create one offline HTML file")
    builder.add_argument("directory", type=Path)
    builder.add_argument("--fragment", action="store_true")
    builder.add_argument("--no-voice", action="store_true")
    _export_parser(commands, "snapshots", "Capture every mode and position as PNG")
    video = _export_parser(commands, "video", "Encode deterministic frames and offline soundtrack")
    video.add_argument("--mode", help="Mode identifier (default: first mode)")
    video.add_argument("--fps", type=_positive_number, help="Frames per second (MP4 30; GIF 12)")
    video.add_argument("--format", choices=("mp4", "gif"), default="mp4")
    video.add_argument("--out", type=Path, help="Output path (default: dist/<story>-<mode>.<format>)")
    check = commands.add_parser("check", help="Validate story, narration and built files")
    check.add_argument("directory", type=Path)
    check.add_argument("--json", action="store_true", help="Versioned JSON result")
    model_commands = commands.add_parser("models", help="Manage pinned local models").add_subparsers(dest="model_command", required=True)
    model_commands.add_parser("fetch", help="Fetch missing or invalid model bytes")
    diagnostic = commands.add_parser("doctor", help="Inspect packages, models, encoder and browser")
    diagnostic.add_argument("--smoke", action="store_true")
    diagnostic.add_argument("--json", action="store_true", help="Versioned JSON result")
    return parser


def _run(args) -> int:
    if args.command == "new":
        new_story(args.directory)
        print(f"Created {args.directory}. Next: explainer narrate {args.directory}")
    elif args.command == "narrate":
        from .narration import narrate
        manifest = narrate(args.directory, url=args.url)
        print(f"Verified {len(manifest['clips'])} clips")
    elif args.command == "build":
        from .bundle import build
        print(build(args.directory, args.fragment, args.no_voice))
    elif args.command == "snapshots":
        from .export import snapshots
        for path in snapshots(args.directory, no_voice=args.no_voice, width=args.width, scheme=args.scheme):
            print(path)
    elif args.command == "video":
        from .export import video
        result = video(args.directory, mode=args.mode, fps=args.fps, format=args.format,
                       width=args.width, scheme=args.scheme, out=args.out, no_voice=args.no_voice)
        print(f"{result['path']}: plan {result['duration_ms']:g} ms; {result['frames']} frames; {result['bytes']} bytes")
    elif args.command == "models":
        from .models import fetch_models
        for result in fetch_models():
            print(f"{result['file']}: {'downloaded and verified' if result['downloaded'] else 'verified cache; no download'}")
    elif args.command == "doctor":
        report = doctor.doctor_report(args.smoke)
        if args.json:
            print(json.dumps(report))
        else:
            for check in report["checks"]:
                status = "ok" if check["ok"] else ("missing" if check["required"] else "warning")
                print(f"{check['name']}: {status}" + (f"; fix: {check['fix']}" if not check["ok"] else ""))
        return 0 if report["ok"] else 1
    elif args.command == "check":
        from .check import check_story
        report = check_story(args.directory)
        if args.json:
            print(json.dumps(report))
        else:
            for error in report["errors"]:
                print(error, file=sys.stderr)
            for warning in report["warnings"]:
                print("warning: " + warning, file=sys.stderr)
            for message in report["info"]:
                print(message)
            for built in report["built"]:
                print(f"{built['file']}: {built['bytes']} bytes")
            if report["ok"]:
                print("Story and narration checks passed")
        return 0 if report["ok"] else 1
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as exit_request:
        if exit_request.code == 0:
            return 0
        raise
    if args.command is None:
        parser.print_help()
        return 0
    try:
        return _run(args)
    except KeyboardInterrupt:
        print("Interrupted", file=sys.stderr)
        return 130
    except URLError:
        print("Network request failed or timed out; verify endpoint and connection, then retry", file=sys.stderr)
        return 1
    except (ValueError, OSError, ImportError, RuntimeError) as error:
        print(f"explainer: {error}", file=sys.stderr)
        return 1
    except Exception as error:
        # The console boundary contains library failures; library APIs still raise.
        print(f"explainer: unexpected runtime failure ({type(error).__name__}); run explainer doctor", file=sys.stderr)
        return 1
