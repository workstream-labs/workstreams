#!/usr/bin/env bash
set -euo pipefail

REPO="workstream-labs/workstreams"
INSTALL_DIR="${WS_INSTALL_DIR:-/usr/local/bin}"
BINARY_NAME="ws"

# Detect OS and architecture
detect_platform() {
  local os arch

  os="$(uname -s)"
  case "$os" in
    Darwin) os="darwin" ;;
    Linux)  os="linux" ;;
    *)
      echo "Error: Unsupported OS: $os" >&2
      exit 1
      ;;
  esac

  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64)  arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *)
      echo "Error: Unsupported architecture: $arch" >&2
      exit 1
      ;;
  esac

  echo "${os}-${arch}"
}

# Get the download URL for the latest release
get_download_url() {
  local platform="$1"
  local asset="ws-${platform}"

  local url
  url="https://github.com/${REPO}/releases/latest/download/${asset}"
  echo "$url"
}

main() {
  local platform
  platform="$(detect_platform)"

  echo "Detected platform: ${platform}"

  local url
  url="$(get_download_url "$platform")"

  echo "Downloading ws from ${url}..."

  local tmp
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT

  if command -v curl &>/dev/null; then
    curl -fSL --progress-bar "$url" -o "$tmp"
  elif command -v wget &>/dev/null; then
    wget -q --show-progress "$url" -O "$tmp"
  else
    echo "Error: curl or wget is required" >&2
    exit 1
  fi

  chmod +x "$tmp"

  echo "Installing to ${INSTALL_DIR}/${BINARY_NAME}..."

  if [ -w "$INSTALL_DIR" ]; then
    mv "$tmp" "${INSTALL_DIR}/${BINARY_NAME}"
  else
    echo "(requires sudo)"
    sudo mv "$tmp" "${INSTALL_DIR}/${BINARY_NAME}"
  fi

  echo "ws installed successfully! Run 'ws --help' to get started."
}

main
