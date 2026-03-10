#!/bin/sh
set -e

REPO="workstream-labs/workstreams"
BINARY_NAME="ws"
INSTALL_DIR="/usr/local/bin"

# ─── Detect platform ──────────────────────────────────────────────────────────

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin) PLATFORM="darwin" ;;
  Linux)  PLATFORM="linux" ;;
  *)
    echo "Error: unsupported OS: $OS"
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64|amd64)  ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *)
    echo "Error: unsupported architecture: $ARCH"
    exit 1
    ;;
esac

TARGET="${PLATFORM}-${ARCH}"

# ─── Determine install directory ──────────────────────────────────────────────

if [ ! -w "$INSTALL_DIR" ]; then
  INSTALL_DIR="$HOME/.local/bin"
  mkdir -p "$INSTALL_DIR"
fi

# ─── Fetch latest release ────────────────────────────────────────────────────

echo "Fetching latest release..."

LATEST_URL="https://api.github.com/repos/${REPO}/releases/latest"

if command -v curl >/dev/null 2>&1; then
  RELEASE_JSON=$(curl -fsSL "$LATEST_URL")
elif command -v wget >/dev/null 2>&1; then
  RELEASE_JSON=$(wget -qO- "$LATEST_URL")
else
  echo "Error: curl or wget is required"
  exit 1
fi

VERSION=$(echo "$RELEASE_JSON" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"//;s/".*//')

if [ -z "$VERSION" ]; then
  echo "Error: could not determine latest version"
  exit 1
fi

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/ws-${TARGET}"

# ─── Download and install ─────────────────────────────────────────────────────

echo "Downloading ws ${VERSION} (${TARGET})..."

TMP_FILE=$(mktemp)
trap 'rm -f "$TMP_FILE"' EXIT

if command -v curl >/dev/null 2>&1; then
  curl -fsSL -o "$TMP_FILE" "$DOWNLOAD_URL"
else
  wget -qO "$TMP_FILE" "$DOWNLOAD_URL"
fi

chmod +x "$TMP_FILE"
mv "$TMP_FILE" "${INSTALL_DIR}/${BINARY_NAME}"

echo "Installed ws to ${INSTALL_DIR}/${BINARY_NAME}"

# ─── Verify PATH ──────────────────────────────────────────────────────────────

if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
  echo ""
  echo "Warning: ${INSTALL_DIR} is not in your PATH."
  echo "Add it with:"
  echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
fi

# ─── Check dependencies ──────────────────────────────────────────────────────

echo ""

if ! command -v tmux >/dev/null 2>&1; then
  echo "Warning: tmux is not installed (required)"
  case "$PLATFORM" in
    darwin) echo "  brew install tmux" ;;
    linux)  echo "  sudo apt install tmux  # or your package manager" ;;
  esac
fi

if ! command -v git >/dev/null 2>&1; then
  echo "Warning: git is not installed (required)"
fi

HAS_AGENT=0
for agent in claude codex aider; do
  if command -v "$agent" >/dev/null 2>&1; then
    HAS_AGENT=1
    break
  fi
done

if [ "$HAS_AGENT" = "0" ]; then
  echo "Warning: no AI coding agent found in PATH (claude, codex, or aider)"
  echo "  Install at least one — e.g. https://claude.ai/code"
fi

echo ""
echo "Done! Run 'ws --help' to get started."
