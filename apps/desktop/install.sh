#!/usr/bin/env bash
set -euo pipefail

# ─── Workstreams Desktop — full dev setup ────────────────────────────────────
# One script to go from zero to a running desktop app.
#
# What it does:
#   1. Installs nvm (if missing)
#   2. Installs & activates Node 22 (from .nvmrc)
#   3. Runs npm install (handles all sub-directory installs via postinstall)
#   4. Downloads Electron
#   5. Compiles the project
#   6. Launches the app via scripts/code.sh
#
# Usage:
#   cd apps/desktop && bash install.sh
# ─────────────────────────────────────────────────────────────────────────────

DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_VERSION="22"

info()  { printf '\033[1;36m▸\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
err()   { printf '\033[1;31m✘\033[0m %s\n' "$*" >&2; }

# ── nvm ──────────────────────────────────────────────────────────────────────

ensure_nvm() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

  if command -v nvm &>/dev/null; then
    return 0
  fi

  if [ -s "$NVM_DIR/nvm.sh" ]; then
    . "$NVM_DIR/nvm.sh"
    return 0
  fi

  info "Installing nvm…"
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  . "$NVM_DIR/nvm.sh"
  ok "nvm installed"
}

# ── Node ─────────────────────────────────────────────────────────────────────

ensure_node() {
  ensure_nvm

  local required_version
  required_version="$(cat "$DESKTOP_DIR/.nvmrc" 2>/dev/null || echo "$NODE_VERSION")"
  local required_major="${required_version%%.*}"

  local current
  current="$(node --version 2>/dev/null || echo "")"

  if [[ "$current" == v${required_major}.* ]]; then
    local current_minor current_patch required_minor required_patch
    current="${current#v}"
    current_minor="$(echo "$current" | cut -d. -f2)"
    current_patch="$(echo "$current" | cut -d. -f3)"
    required_minor="$(echo "$required_version" | cut -d. -f2)"
    required_patch="$(echo "$required_version" | cut -d. -f3)"

    if [ "$current_minor" -gt "$required_minor" ] || \
       { [ "$current_minor" -eq "$required_minor" ] && [ "$current_patch" -ge "$required_patch" ]; }; then
      ok "Node v${current} satisfies requirement (>= v${required_version})"
      return 0
    fi
  fi

  if nvm ls "$required_version" &>/dev/null 2>&1; then
    info "Switching to Node ${required_version}…"
    nvm use "$required_version"
  else
    info "Installing Node ${required_version}…"
    nvm install "$required_version"
    nvm use "$required_version"
  fi

  ok "Node $(node --version) active"
}

# ── Python (needed for node-gyp native modules) ─────────────────────────────

check_python() {
  if command -v python3 &>/dev/null; then
    ok "Python 3 found: $(python3 --version)"
    return 0
  fi

  if command -v python &>/dev/null; then
    ok "Python found: $(python --version)"
    return 0
  fi

  err "Python not found — node-gyp requires Python 3 for native modules"
  err "Install it: brew install python3 (macOS) or apt install python3 (Linux)"
  exit 1
}

# ── Build tools (macOS: Xcode CLI tools) ─────────────────────────────────────

check_build_tools() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    if xcode-select -p &>/dev/null; then
      ok "Xcode Command Line Tools found"
    else
      info "Installing Xcode Command Line Tools…"
      xcode-select --install 2>/dev/null || true
      err "Xcode CLI tools installation started — re-run this script after it completes"
      exit 1
    fi
  elif [[ "$OSTYPE" == "linux"* ]]; then
    if command -v gcc &>/dev/null && command -v make &>/dev/null; then
      ok "Build tools (gcc, make) found"
    else
      err "Build tools missing — install build-essential: sudo apt install build-essential"
      exit 1
    fi
  fi
}

# ── npm install ──────────────────────────────────────────────────────────────

run_npm_install() {
  cd "$DESKTOP_DIR"

  info "Running npm install (this installs all sub-directories via postinstall)…"
  npm install
  ok "npm install complete"
}

# ── Electron + compile ───────────────────────────────────────────────────────

ensure_electron() {
  cd "$DESKTOP_DIR"

  if [ -d ".build/electron" ]; then
    ok "Electron already downloaded"
    return 0
  fi

  info "Downloading Electron…"
  npm run electron
  ok "Electron downloaded"
}

compile_project() {
  cd "$DESKTOP_DIR"

  if [ -d "out" ]; then
    ok "Project already compiled (out/ exists)"
    return 0
  fi

  info "Compiling project (this may take a few minutes)…"
  npm run compile
  ok "Compilation complete"
}

# ── Main ─────────────────────────────────────────────────────────────────────

main() {
  echo ""
  echo "  Workstreams Desktop — dev setup"
  echo "  ────────────────────────────────"
  echo ""

  ensure_node
  check_python
  check_build_tools
  run_npm_install
  ensure_electron
  compile_project

  echo ""
  ok "All done! Launch the app with:"
  echo ""
  echo "    cd $DESKTOP_DIR && ./scripts/code.sh"
  echo ""
}

main
