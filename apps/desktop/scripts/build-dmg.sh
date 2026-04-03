#!/usr/bin/env bash
#
# build-dmg.sh — Build a Workstreams DMG installer for macOS.
#
# Usage:
#   ./scripts/build-dmg.sh           # interactive arch picker
#   ./scripts/build-dmg.sh arm64     # Apple Silicon
#   ./scripts/build-dmg.sh x64       # Intel
#
# Must be run from apps/desktop/.

set -euo pipefail

# ---------------------------------------------------------------------------
# Colors and helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

info()    { printf "${CYAN}%s${RESET}\n" "$*"; }
success() { printf "${GREEN}%s${RESET}\n" "$*"; }
warn()    { printf "${YELLOW}%s${RESET}\n" "$*"; }
error()   { printf "${RED}%s${RESET}\n" "$*" >&2; }
step()    { printf "\n${BOLD}${CYAN}==> %s${RESET}\n" "$*"; }

# ---------------------------------------------------------------------------
# Ensure we are in apps/desktop
# ---------------------------------------------------------------------------
if [[ ! -f "product.json" ]] || [[ ! -d "build/darwin" ]]; then
	error "This script must be run from apps/desktop/."
	error "  cd apps/desktop && ./scripts/build-dmg.sh"
	exit 1
fi

DESKTOP_ROOT="$(pwd)"
PARENT_DIR="$(dirname "$DESKTOP_ROOT")"

# ---------------------------------------------------------------------------
# Determine architecture
# ---------------------------------------------------------------------------
pick_arch() {
	echo ""
	info "Select target architecture:"
	echo ""
	printf "  ${BOLD}1)${RESET} Apple Silicon ${DIM}(arm64)${RESET}\n"
	printf "  ${BOLD}2)${RESET} Intel         ${DIM}(x64)${RESET}\n"
	echo ""
	printf "${CYAN}? ${RESET}Enter choice [1/2]: "
	read -r choice
	case "$choice" in
		1|arm64)  ARCH="arm64" ;;
		2|x64)    ARCH="x64" ;;
		*)
			error "Invalid choice: $choice"
			exit 1
			;;
	esac
}

if [[ $# -ge 1 ]]; then
	case "$1" in
		arm64|aarch64|"apple silicon"|"Apple Silicon")
			ARCH="arm64"
			;;
		x64|x86_64|intel|Intel)
			ARCH="x64"
			;;
		*)
			error "Unknown architecture: $1"
			echo "  Valid options: arm64, x64"
			exit 1
			;;
	esac
else
	pick_arch
fi

QUALITY="${VSCODE_QUALITY:-stable}"
APP_DIR="Workstreams-darwin-${ARCH}"
DMG_OUTPUT_DIR="dmg-output"
DMG_FILE="${DMG_OUTPUT_DIR}/Workstreams-darwin-${ARCH}.dmg"

echo ""
info "Configuration:"
printf "  ${DIM}Architecture :${RESET} %s\n" "$ARCH"
printf "  ${DIM}Quality      :${RESET} %s\n" "$QUALITY"
printf "  ${DIM}App output   :${RESET} %s\n" "${PARENT_DIR}/${APP_DIR}"
printf "  ${DIM}DMG output   :${RESET} %s\n" "${DESKTOP_ROOT}/${DMG_FILE}"
echo ""

# ---------------------------------------------------------------------------
# Track created artifacts for cleanup
# ---------------------------------------------------------------------------
ARTIFACTS=(
	"out"
	"out-build"
	"out-vscode-min"
	"out-vscode-reh-min"
	"out-vscode-reh-web-min"
	".build"
	"${DMG_OUTPUT_DIR}"
	"${PARENT_DIR}/${APP_DIR}"
)

# ---------------------------------------------------------------------------
# Step 1 — Clean previous build artifacts
# ---------------------------------------------------------------------------
step "Step 1/7 — Cleaning previous build artifacts"

for artifact in "out" "out-build" "out-vscode-min" "out-vscode-reh-min" "out-vscode-reh-web-min" ".build" "${DMG_OUTPUT_DIR}"; do
	if [[ -d "$artifact" ]]; then
		warn "  Removing $artifact/"
		rm -rf "$artifact"
	fi
done

if [[ -d "${PARENT_DIR}/${APP_DIR}" ]]; then
	warn "  Removing ${PARENT_DIR}/${APP_DIR}/"
	rm -rf "${PARENT_DIR}/${APP_DIR}"
fi

success "  Clean complete."

# ---------------------------------------------------------------------------
# Step 2 — Install dependencies
# ---------------------------------------------------------------------------
step "Step 2/7 — Installing dependencies"

if [[ ! -d "node_modules" ]]; then
	npm install
else
	info "  node_modules exists, skipping npm install. Run 'npm install' manually if stale."
fi

# ---------------------------------------------------------------------------
# Step 3 — Download Electron
# ---------------------------------------------------------------------------
step "Step 3/7 — Downloading Electron"

npm run electron

# ---------------------------------------------------------------------------
# Step 4 — Compile for production
# ---------------------------------------------------------------------------
step "Step 4/7 — Compiling for production (this may take a while)"

NODE_OPTIONS="--max-old-space-size=8192" npx gulp compile-build-without-mangling

# ---------------------------------------------------------------------------
# Step 5 — Minify for production
# ---------------------------------------------------------------------------
step "Step 5/7 — Minifying for production"

npx gulp minify-vscode

# ---------------------------------------------------------------------------
# Step 6 — Package the Electron app
# ---------------------------------------------------------------------------
step "Step 6/7 — Packaging Electron app (${ARCH})"

npx gulp "vscode-darwin-${ARCH}-min"

if [[ ! -d "${PARENT_DIR}/${APP_DIR}" ]]; then
	error "Packaging failed — expected output at ${PARENT_DIR}/${APP_DIR}"
	exit 1
fi

success "  Packaged at ${PARENT_DIR}/${APP_DIR}"

# ---------------------------------------------------------------------------
# Step 7 — Create the DMG
# ---------------------------------------------------------------------------
step "Step 7/7 — Creating DMG"

mkdir -p "${DMG_OUTPUT_DIR}"

VSCODE_ARCH="$ARCH" VSCODE_QUALITY="$QUALITY" npx tsx build/darwin/create-dmg.ts "${PARENT_DIR}/" "${DMG_OUTPUT_DIR}"

if [[ ! -f "$DMG_FILE" ]]; then
	error "DMG was not created at expected path: $DMG_FILE"
	exit 1
fi

DMG_SIZE=$(du -h "$DMG_FILE" | cut -f1)
echo ""
success "DMG created successfully!"
printf "  ${DIM}Path :${RESET} %s\n" "${DESKTOP_ROOT}/${DMG_FILE}"
printf "  ${DIM}Size :${RESET} %s\n" "$DMG_SIZE"

# ---------------------------------------------------------------------------
# Post-build — Cleanup
# ---------------------------------------------------------------------------
echo ""
warn "Build artifacts that can be cleaned up:"
total_size=0
for artifact in "${ARTIFACTS[@]}"; do
	if [[ -e "$artifact" ]]; then
		size=$(du -sh "$artifact" 2>/dev/null | cut -f1)
		printf "  ${DIM}%-50s${RESET} %s\n" "$artifact" "$size"
	fi
done

echo ""
printf "${CYAN}? ${RESET}Delete all build artifacts listed above? [y/N]: "
read -r cleanup_choice
if [[ "$cleanup_choice" =~ ^[Yy]$ ]]; then
	step "Cleaning up build artifacts"
	for artifact in "${ARTIFACTS[@]}"; do
		if [[ -e "$artifact" ]]; then
			warn "  Removing $artifact"
			rm -rf "$artifact"
		fi
	done
	success "  Cleanup complete."
else
	info "Skipping cleanup. You can manually remove the artifacts later."
fi

echo ""
success "Done!"
