# Download & Build

Workstreams is primarily a macOS desktop app. You do not need to install the CLI for normal use.

## Download the app

Download the latest release from GitHub:

- [Latest Workstreams release](https://github.com/workstream-labs/workstreams/releases/latest)
- macOS DMGs are published for Apple Silicon (`arm64`) and Intel (`x64`)
- The app includes an in-app updater, so future releases can be installed from inside Workstreams

## What you need

- macOS
- Git installed locally
- For AI-assisted flows, install `claude` or `codex` on your `PATH`
- `Terminal` is always available for manual work even without an agent binary

## Build from source

If you want to run the desktop app from source:

```bash
git clone https://github.com/workstream-labs/workstreams.git
cd workstreams/apps/desktop
bash install.sh
./scripts/code.sh
```

The desktop build expects Node.js 22 and installs the Electron dependencies for you.

## Where the CLI fits

The terminal workflow still exists in the repository under `apps/cli`, but this website is intentionally desktop-first. If you only want to use Workstreams as intended, install the app and keep the CLI as implementation detail.

## Next Steps

- [Quickstart](/getting-started/quickstart)
- [Workstreams & Switching](/guide/concepts)
