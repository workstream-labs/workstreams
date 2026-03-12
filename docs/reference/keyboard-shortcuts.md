# Keyboard Shortcuts

All keyboard shortcuts for the TUI components.

## Dashboard (`ws switch`)

### Navigation

| Key | Action |
|---|---|
| `j` / `↓` | Select next workstream |
| `k` / `↑` | Select previous workstream |
| `g` | Jump to first workstream |
| `G` | Jump to last workstream |

### Actions

| Key | Action |
|---|---|
| `Enter` | Open action picker for selected workstream |
| `/` | Enter search mode |
| `?` | Toggle help overlay |
| `q` / `Esc` / `Ctrl+C` | Quit dashboard |

### Search Mode

| Key | Action |
|---|---|
| *Type* | Filter workstreams (multi-term AND match) |
| `↑` / `↓` | Navigate filtered results |
| `Enter` | Confirm filter |
| `Esc` | Clear search and return to normal mode |

## Diff Viewer (`ws diff <name>`)

### Panel Navigation

| Key | Action |
|---|---|
| `Tab` / `h` / `l` | Switch between file list and diff panels |

### Scrolling

| Key | Action |
|---|---|
| `j` / `↓` | Scroll down |
| `k` / `↑` | Scroll up |
| `d` | Scroll down half-page |
| `u` | Scroll up half-page |
| `g` | Jump to top |
| `G` | Jump to bottom |

### Files

| Key | Action |
|---|---|
| `n` | Next file |
| `p` | Previous file |

### View & Comments

| Key | Action |
|---|---|
| `t` | Toggle unified / side-by-side view |
| `c` | Add inline comment on current line |
| `q` | Quit viewer |

## Log Viewer (`ws logs <name>`)

### Scrolling

| Key | Action |
|---|---|
| `j` / `↓` | Scroll down |
| `k` / `↑` | Scroll up |
| `d` | Scroll down half-page |
| `u` | Scroll up half-page |
| `g` | Jump to top |
| `G` | Jump to bottom |

### Modes

| Key | Action |
|---|---|
| `f` | Toggle follow mode (auto-scroll to new output) |
| `q` | Quit viewer |

## Choice Picker

Used for editor selection and other interactive prompts.

| Key | Action |
|---|---|
| `j` / `↓` | Next option |
| `k` / `↑` | Previous option |
| `Enter` | Confirm selection |
| `q` / `Esc` / `Ctrl+C` | Cancel |
