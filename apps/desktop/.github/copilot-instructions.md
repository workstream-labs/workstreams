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

VS Code uses a strict **layered architecture**: `base` → `platform` → `editor` → `workbench` (and `sessions`). Each layer may only import from layers below it.

### Layer responsibilities
- **`src/vs/base/`** — Foundation utilities, data structures, UI primitives. No service dependencies.
- **`src/vs/platform/`** — Platform services and dependency injection infrastructure. Defines service interfaces (`I*Service`) and their implementations.
- **`src/vs/editor/`** — The Monaco text editor. Self-contained editor with language services, syntax highlighting, and editing features.
- **`src/vs/workbench/`** — The full IDE shell. Parts (editor area, sidebar, panel, statusbar), the contribution system, and the extension API.
- **`src/vs/sessions/`** — Agent sessions window. A dedicated workbench layer for agentic workflows. Sits alongside `vs/workbench`; may import from it but **not** vice versa.
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

This is the main custom addition to this VS Code fork. The orchestrator manages multiple git worktrees per repository, shown in a sidebar to the left of the editor.

### Key files
- **Interface**: `src/vs/workbench/services/orchestrator/common/orchestratorService.ts` — `IOrchestratorService`, `IRepositoryEntry`, `IWorktreeEntry`
- **Implementation**: `src/vs/workbench/browser/parts/orchestrator/orchestratorService.ts` — `OrchestratorServiceImpl` (registered as eager singleton)
- **UI**: `src/vs/workbench/browser/parts/orchestrator/orchestratorPart.ts` — `OrchestratorPart` renders the sidebar with repo/worktree list
- **Git operations**: `src/vs/workbench/services/orchestrator/common/gitWorktreeService.ts` (interface), `electron-browser/` (renderer impl), `electron-main/` (main process impl via IPC)
- **Terminal handling**: `src/vs/workbench/contrib/orchestrator/browser/orchestratorTerminalContribution.ts` — backgrounds/restores terminals per worktree
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
