#!/usr/bin/env bash
set -euo pipefail

REPO='chetjones003/thread-app-manager'
PREVIEW=false
if [[ "${1:-}" == '--preview' ]]; then PREVIEW=true; fi

show_banner() {
  cat <<'BANNER'

                    T3 RUNTIME MANAGER

                         .------.
                         |  T3  |
                         '---+--'
                             |
                        .----+----.
                       /           \
                [ WORKTREE ]   [ WORKTREE ]
                     |               |
                 [ APP ]           [ APP ]

             INSTALL  /  T3 CODE RUNTIME COMPANION
  ----------------------------------------------------------------

BANNER
}

step() { printf '  [%s] %s\n' "$1" "$2"; }
fail() { step '!' "$1" >&2; exit 1; }

show_banner
case "$(uname -s)" in
  Darwin) OS='macOS';;
  Linux) OS='Linux';;
  *) fail 'Supported platforms: macOS and Linux.';;
esac
step '*' "Platform: $OS $(uname -m)"

if [[ "$PREVIEW" == true ]]; then
  step '+' 'Checking latest release...'
  if [[ "$OS" == 'Linux' ]]; then
    step '+' 'Downloading the latest x86_64 Debian package'
    step '+' 'Installing with apt...'
  else
    step '+' 'Downloading the latest macOS app archive'
    step '+' 'Copying app to /Applications...'
  fi
  step '+' 'Done. T3 Runtime Manager is ready to launch.'
  printf '\n'
  exit 0
fi

command -v curl >/dev/null || fail 'curl is required.'
command -v python3 >/dev/null || fail 'python3 is required to read release metadata.'

if [[ "$OS" == 'Linux' ]]; then
  if [[ "$(uname -m)" != 'x86_64' ]]; then fail 'Linux installer currently supports x86_64.'; fi
  command -v apt-get >/dev/null || fail 'Use the AppImage release on distributions without apt.'
  command -v sudo >/dev/null || fail 'sudo is required to install the Debian package.'
  EXTENSION='.deb'
else
  case "$(uname -m)" in
    arm64|aarch64) ARCH='arm64';;
    x86_64) ARCH='x64';;
    *) fail "Unsupported macOS architecture: $(uname -m)";;
  esac
  EXTENSION="-${ARCH}-mac.zip"
fi

step '*' 'Checking latest release...'
API_URL="https://api.github.com/repos/$REPO/releases/latest"
ASSET_URL="$(curl -fsSL "$API_URL" | python3 -c 'import json,sys; assets=json.load(sys.stdin)["assets"]; suffix=sys.argv[1]; print(next((a["browser_download_url"] for a in assets if a["name"].endswith(suffix)), ""))' "$EXTENSION")"
[[ -n "$ASSET_URL" ]] || fail "No compatible $OS installer was found in the latest release."
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
FILE="$TMP_DIR/${ASSET_URL##*/}"
step '*' "Downloading ${FILE##*/}..."
curl -fL --progress-bar "$ASSET_URL" -o "$FILE"

if [[ "$OS" == 'Linux' ]]; then
  step '*' 'Installing Debian package...'
  sudo apt-get install -y "$FILE"
else
  step '*' 'Copying app to /Applications...'
  ditto -x -k "$FILE" "$TMP_DIR/unpacked"
  APP_PATH="$(find "$TMP_DIR/unpacked" -maxdepth 3 -name 'T3 Runtime Manager.app' -print -quit)"
  [[ -n "$APP_PATH" ]] || fail 'The downloaded archive did not contain the app bundle.'
  DEST='/Applications/T3 Runtime Manager.app'
  if [[ -w /Applications ]]; then ditto "$APP_PATH" "$DEST"; else sudo ditto "$APP_PATH" "$DEST"; fi
fi

step '+' 'Done. T3 Runtime Manager is ready to launch.'
printf '\n'
