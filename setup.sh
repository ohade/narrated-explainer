#!/usr/bin/env bash
# User-level bootstrap; no sudo or system Python required.
set -euo pipefail

usage() {
  printf '%s\n' 'Usage: bash setup.sh [--no-browser] [--skill auto|claude|codex|all|none]' \
    'Installs uv-managed Python 3.12, the editable tool and pinned voice models.'
}

# Bootstrap exception: a bare invocation installs with the defaults below.
browser=1
skill=auto
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --no-browser) browser=0; shift ;;
    --skill)
      if [[ $# -lt 2 ]]; then printf '%s\n' '--skill needs a value' >&2; exit 2; fi
      skill=$2; shift 2 ;;
    *) printf '%s\n' 'Unknown option; run bash setup.sh --help' >&2; exit 2 ;;
  esac
done
case "$skill" in auto|claude|codex|all|none) ;; *) usage >&2; exit 2 ;; esac
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
targets=()
for agent in claude codex; do
  if [[ "$skill" == all || "$skill" == "$agent" || ( "$skill" == auto && -d "$HOME/.$agent/skills" ) ]]; then
    target="$HOME/.$agent/skills/narrated-explainer"
    if [[ -e "$target" && ! -L "$target" ]]; then
      printf '%s\n' "Refusing to overwrite non-link skill target: $target" >&2
      exit 1
    fi
    targets+=("$target")
  fi
done
export PATH="$HOME/.local/bin:$PATH"
if ! command -v uv >/dev/null 2>&1; then
  installer=$(mktemp)
  trap 'if [[ -n "${installer:-}" ]]; then unlink "$installer"; fi' EXIT
  if command -v curl >/dev/null 2>&1; then
    curl -q -fsSL --connect-timeout 30 --max-time 120 https://astral.sh/uv/install.sh -o "$installer"
  elif command -v wget >/dev/null 2>&1; then
    wget --timeout=120 -q https://astral.sh/uv/install.sh -O "$installer"
  else
    printf '%s\n' 'Install curl or wget, then run setup again.' >&2; exit 1
  fi
  UV_NO_MODIFY_PATH=1 sh "$installer"
  unlink "$installer"
  installer=''
fi
uv python install 3.12
uv tool install --force --editable "$repo" --python 3.12
tool_bin=$(uv tool dir --bin)
export PATH="$tool_bin:$PATH"
explainer models fetch
if [[ "$browser" -eq 1 ]]; then
  uv tool run --from "$repo" playwright install chromium
fi
if [[ ${#targets[@]} -gt 0 ]]; then
  for target in "${targets[@]}"; do
    mkdir -p -- "$(dirname -- "$target")"
    ln -sfn -- "$repo/skills/narrated-explainer" "$target"
  done
fi
explainer doctor --smoke
printf '%s\n' "Ready. Add $tool_bin to PATH in your shell if needed."
