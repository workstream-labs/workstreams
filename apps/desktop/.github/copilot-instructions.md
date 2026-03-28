# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

**NEVER use `npm run compile` to compile TypeScript files.**

### Type-checking (must pass before running tests or declaring work complete)
- `src/` changes: `npm run compile-check-ts-native` (validates `./src/tsconfig.json`)
- `extensions/` changes: `npm run gulp compile-extensions`
- `build/` changes: `cd build && npm run typecheck`
- Layering violations: `npm run valid-layers-check`

### Running VS Code from source
- `./scripts/code.sh` (macOS/Linux) or `scripts\code.bat` (Windows) — launches Electron with the dev build
- `./scripts/code-web.sh` — launches the web version
- `./scripts/code-server.sh` — launches the server version

### Running tests
- Unit tests: `./scripts/test.sh` (macOS/Linux) or `scripts\test.bat` (Windows)
  - Filter by name: `./scripts/test.sh --grep "pattern"`
- Integration tests: `./scripts/test-integration.sh` or `scripts\test-integration.bat`
  - Integration test files end with `.integrationTest.ts` or live under `extensions/`
- Browser unit tests: `npm run test-browser`
- Node unit tests: `npm run test-node`
- Build script tests: `npm run test-build-scripts`

### Incremental watching
- `npm run watch` — watches client + extensions (use for active development)
- `npm run watch-client` — watches client only

## Architecture

This is a fork of VS Code (Code - OSS) with two major custom additions: the **Orchestrator** (worktree sidebar in the workbench) and the **Sessions layer** (a separate agent-focused window).

VS Code uses a strict **layered architecture**: `base` → `platform` → `editor` → `workbench` (and `sessions`). Each layer may only import from layers below it.

### Layer responsibilities
- **`src/vs/base/`** — Foundation utilities, data structures, UI primitives. No service dependencies.
- **`src/vs/platform/`** — Platform services and dependency injection infrastructure. Defines service interfaces (`I*Service`) and their implementations.
- **`src/vs/editor/`** — The Monaco text editor. Self-contained editor with language services, syntax highlighting, and editing features.
- **`src/vs/workbench/`** — The full IDE shell. Parts (editor area, sidebar, panel, statusbar), the contribution system, and the extension API.
- **`src/vs/sessions/`** — Agent sessions window. A complete alternative workbench for agentic workflows. Can import from `vs/workbench` but **not** vice versa.
- **`src/vs/code/`** — Electron main process entry points.
- **`src/vs/server/`** — Remote server entry points.

### Key patterns
- **Dependency injection**: Services are injected via constructor parameters (decorated with `@I*Service`). Non-service parameters must come after service parameters.
- **Contribution model**: Features register via `registerWorkbenchContribution2()` and contribute to extension points. Each contribution in `workbench/contrib/` is a self-contained feature module.
- **Platform targets**: Code is organized by runtime environment (`common/` = all, `browser/` = web, `node/` = Node.js, `electron-browser/` = Electron renderer, `electron-main/` = Electron main).
- **Disposables**: All event listeners and resources must be disposed. Use `DisposableStore`, `MutableDisposable`, or `DisposableMap`. Never register disposables to a class from a repeatedly-called method; return `IDisposable` instead.
- **Events vs method calls**: Events are for broadcasting state changes. Use direct method calls or service interactions for control flow between components.

### Test structure
- Unit tests live alongside source code: `src/vs/**/test/` directories
- Test files use the pattern `*.test.ts`
- Integration tests use `*.integrationTest.ts`
- Extension tests live under `extensions/<name>/src/test/`

## Coding Guidelines

### Formatting
- **Tabs, not spaces** for indentation
- PascalCase for types and enum values; camelCase for functions, methods, properties, locals
- Single quotes for code strings; double quotes for user-facing strings that need localization
- Arrow function parameters: only parenthesize when necessary (`x => x + x`, not `(x) => x + x`)
- Curly braces always required around loop/conditional bodies
- Top-level exports: prefer `export function x() {}` over `export const x = () => {}`

### Localization
- All user-visible strings must use `nls.localize()` (from `vs/nls`)
- No string concatenation in localized strings — use placeholders (`{0}`, `{1}`)
- UI labels use title-style capitalization (prepositions of 4 or fewer letters are lowercase unless first/last)

### Code quality rules
- All files must include the Microsoft copyright header
- Prefer `async`/`await` over `.then()` chains
- Do not use `any` or `unknown` without strong justification — define proper types
- Do not export types/functions unless shared across components
- Never use storage keys of another component — create proper APIs instead
- Use `IEditorService` to open editors, not `IEditorGroupsService.activeGroup.openEditor`
- Avoid `bind()`/`call()`/`apply()` — use arrow functions or closures instead
- Prefer correlated file watchers (`fileService.createWatcher`) over shared ones
- Prefer `IHoverService` for tooltips
- Prefer named regex capture groups over numbered ones
- Clean up any temporary files created during development

### Testing
- Minimize assertions per test. Prefer one `assert.deepStrictEqual` snapshot over many precise assertions.
- Match existing test patterns — use `describe`/`test` consistently
- Don't add tests outside the relevant suite

## Orchestrator (Worktree Sidebar)

The orchestrator manages multiple git worktrees per repository, shown in a sidebar to the left of the editor. This is the primary custom addition to the workbench layer.

### Key files
- **Interface**: `src/vs/workbench/services/orchestrator/common/orchestratorService.ts` — `IOrchestratorService`, `IRepositoryEntry`, `IWorktreeEntry`
- **Implementation**: `src/vs/workbench/browser/parts/orchestrator/orchestratorService.ts` — `OrchestratorServiceImpl` (registered as eager singleton)
- **UI**: `src/vs/workbench/browser/parts/orchestrator/orchestratorPart.ts` — `OrchestratorPart` renders the sidebar with repo/worktree list
- **Git operations**: `src/vs/workbench/services/orchestrator/common/gitWorktreeService.ts` (interface), `electron-browser/` (renderer impl), `electron-main/` (main process impl via IPC)
- **Terminal handling**: `src/vs/workbench/contrib/orchestrator/browser/orchestratorTerminalContribution.ts` — backgrounds/restores terminals per worktree, handles Claude session hook events
- **Tests**: `src/vs/workbench/services/orchestrator/test/browser/orchestratorService.test.ts`

### How worktree switching works (`switchTo`)
1. Fire `onDidChangeActiveWorktree` — terminal contribution backgrounds old terminals
2. Save editor working set for previous worktree (`editorGroupsService.saveWorkingSet`)
3. Restore editor working set for target worktree (`applyWorkingSet`)
4. Swap workspace folder via `workspaceEditingService.updateFolders`
5. Fire `onDidApplyWorktreeEditorState` — terminal contribution restores new terminals

### Persistence
- Repo paths, collapse state, and active worktree are persisted in `StorageScope.APPLICATION` / `StorageTarget.MACHINE` under key `orchestrator.repositoryState`
- Saved eagerly on every mutation (add/remove repo, toggle collapse, switch worktree)
- Restored on startup via `restoreState()` — worktrees are rediscovered from git; stale repos silently skipped
- Editor working sets (`_workingSetMap`) are session-only (not persisted across restarts)

### Cyclic dependency warning
`OrchestratorServiceImpl` injects `IWorkspaceEditingService`. Do NOT inject `IOrchestratorService` into `NativeWorkspaceEditingService` — this creates a cycle. To check orchestrator state from there, read the storage key directly.

### Watermark
The editor empty state (`editorGroupWatermark.ts`) shows a workstreams-branded onboarding screen instead of the default VS Code watermark. It uses `IOrchestratorService` to show contextual actions ("+ Add Repository" when no repos, "Select a worktree" when repos exist).

### Workspace dialog
When the orchestrator is active (has repos in storage), the "Save untitled workspace?" dialog on close is suppressed — the untitled workspace is silently discarded. See `workspaceEditingService.ts` `saveUntitledBeforeShutdown`.

## Claude Session State via Hooks

The app tracks Claude Code lifecycle events in each worktree via a hook-based notification system.

### Architecture (data flow)
1. **Hook script** (`~/.claude/hooks/workstreams-notify.sh`) — installed automatically on startup. Reads JSON from Claude Code's stdin, extracts event type, and curls the notification server.
2. **HTTP notification server** (port `51742`, Electron main process) — `src/vs/workbench/services/orchestrator/electron-main/hookNotificationServer.ts`. Maps raw Claude events to normalized states (`Start`, `Stop`, `PermissionRequest`, `SessionEnd`).
3. **IPC bridge** — `IHookNotificationService` (channel `hookNotification`) proxied from main to renderer.
4. **Terminal contribution** — `orchestratorTerminalContribution.ts` listens to notifications, updates `WorktreeSessionState` on the orchestrator service, shows toast notifications, and plays accessibility sounds.

### Key files
- **Hook setup**: `src/vs/workbench/services/orchestrator/electron-main/claudeHookSetup.ts` — writes hook script and registers in `~/.claude/settings.json`
- **Notification server**: `src/vs/workbench/services/orchestrator/electron-main/hookNotificationServer.ts`
- **Service interface**: `src/vs/workbench/services/orchestrator/common/hookNotificationService.ts`

### Session states (`WorktreeSessionState` enum, matches Superset)
- **Idle** — default, git-branch icon. Set by `Stop` on active worktree
- **Working** — animated braille spinner (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏), triggered by `Start` (UserPromptSubmit/PostToolUse/PostToolUseFailure)
- **Permission** — pause icon, triggered by `PermissionRequest`, with toast notification + sound
- **Review** — checkmark icon, triggered by `Stop` on background (non-active) worktree

### Environment variable
Terminals created in worktrees get `WORKSTREAMS_WORKTREE_PATH` injected so hook scripts can identify which worktree a Claude session belongs to.

## Sessions Layer (Agent Window)

`src/vs/sessions/` is a complete, independent workbench implementation optimized for agent session workflows. It is **not** an extension of the standard workbench — it's a parallel window type with its own layout, parts, and contributions.

### Key differences from standard workbench
- **Fixed layout** — no user-configurable part positions
- **Chat-first UX** — chat bar is a primary part (sidebar left, chat bar center, auxiliary bar right)
- **Modal editors** — all editors open as overlay modals, not in an editor grid
- **Simplified chrome** — no activity bar, no status bar, no banner
- **Separate storage keys** — all parts use `workbench.agentsession.*` prefixes to avoid conflicts

### Grid structure
```
Root (HORIZONTAL)
├── Sidebar (300px)
└── Right Section (VERTICAL)
    ├── Titlebar
    ├── Chat Bar (flex) + Auxiliary Bar (300px)
    └── Panel (300px, hidden by default)
```

### Key files
- **Layout**: `src/vs/sessions/browser/workbench.ts` — main `Workbench` class
- **Menus**: `src/vs/sessions/browser/menus.ts` — custom menu IDs (`SessionsCommandCenter`, `ChatBarTitle`, etc.)
- **Parts**: `src/vs/sessions/browser/parts/` — titlebar, sidebar, chat bar, auxiliary bar, panel, project bar
- **Entry points**: `sessions.desktop.main.ts` (desktop), `sessions.common.main.ts` (shared)
- **Documentation**: `src/vs/sessions/README.md`, `src/vs/sessions/LAYOUT.md`, `src/vs/sessions/AI_CUSTOMIZATIONS.md`

### Major contributions (in `src/vs/sessions/contrib/`)
- **sessions/** — session list, management service (`ISessionsManagementService`)
- **chat/** — chat actions, prompts service, AI customization harness, run scripts
- **accountMenu/** — sign in/out, settings, updates (sidebar footer)
- **changes/** — file changes visualization (auxiliary bar)
- **welcome/** — onboarding flow

## Workbench UI Customizations

Default VS Code UI is modified to focus on the orchestrator-driven workflow:

- **Auxiliary bar (chat panel)** hidden by default — `LayoutStateKeys.AUXILIARYBAR_HIDDEN` defaults to `true`
- **Outline and Timeline views** registered with `hideByDefault: true`
- **Terminal button added to title bar** — opens terminal in editor area via `MenuId.LayoutControlMenu`
