# Download & Build

Workstreams is primarily a macOS desktop app. You do not need to install the CLI for normal use.

## Download the app

Download the latest release from GitHub:

- [Latest Workstreams release](https://github.com/workstream-labs/workstreams/releases/latest)
- macOS DMGs are published for Apple Silicon (`arm64`) and Intel (`x64`)
- The app includes an in-app updater, so future releases can be installed from inside Workstreams

### Installation steps

1. **Open the .dmg file** — Find the downloaded `Workstreams-darwin-arm64.dmg` (or `x64`) in your Downloads folder and double-click to open.

2. **Drag to Applications** — Drag the Workstreams icon into the Applications folder.

3. **Remove quarantine flag** — Since the app isn't signed with an Apple certificate yet, macOS will block it. Run this command to allow it:

   ```bash
   xattr -cr /Applications/Workstreams.app
   ```

   > **Why is this needed?** When you download a DMG from the internet, macOS tags every file with a hidden `com.apple.quarantine` flag. Gatekeeper checks for an Apple Developer certificate, and since this build isn't signed, it shows a misleading "app is damaged" error. `xattr -cr` strips that quarantine flag.

4. **Launch Workstreams** — Open the app from Applications. You're all set!

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
