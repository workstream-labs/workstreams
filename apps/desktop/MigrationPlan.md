# Migration Plan: Per-Worktree Window Isolation

**Status:** Design  
**Author:** amandal  
**Date:** 2026-04-02  

---

## 1. Problem Statement

The current orchestrator switches worktrees by hot-swapping a single VS Code window's workspace folder, then saving/restoring editor and terminal state. This approach has fundamental race conditions that corrupt the editor grid layout, particularly with terminals:

- Two `applyWorkingSet` calls can run concurrently during rapid switches (no cancellation)
- Terminal group indices shift when the grid changes between save and restore
- `moveToBackground` has async side effects that race with `saveWorkingSet`
- A hardcoded 1500ms delay adds unnecessary latency to every switch
- Editor tab state is lost entirely on restart (`_workingSetMap` not persisted)

These bugs compound. Fixing them individually is possible but pushes complexity into a system working against VS Code's single-workspace-per-window design. Each worktree is conceptually its own workspace. The architecture should reflect that.

---

## 2. Proposed Architecture

**Give each worktree its own Electron BrowserWindow with a full, independent workbench instance.** The orchestrator becomes a coordinator that manages window lifecycle and routing rather than a state-swapping engine.

```
Before (current):
  [Single Window]
    ├── Orchestrator Sidebar
    ├── Editor Area (hot-swapped per worktree)
    ├── Terminals (backgrounded/foregrounded per worktree)
    └── Extension Host (shared, folder swapped)

After (proposed):
  [Orchestrator Window]         (lightweight coordinator)
    ├── Orchestrator Sidebar
    └── IPC to worktree windows

  [Worktree Window: main]       (full workbench)
    ├── Editor Area (own state)
    ├── Terminals (own, always visible)
    └── Extension Host (own process)

  [Worktree Window: ws/feature-a]
    ├── Editor Area (own state)
    ├── Terminals (own, always visible)
    └── Extension Host (own process)

  [Worktree Window: ws/dark-mode]
    └── ...
```

### Why This Works

1. **Zero save/restore logic.** Each window owns its editor grid, terminals, and extension state. Switching worktrees means focusing a window, not reconstructing one.

2. **Proven pattern.** The Sessions layer already does this: a separate `BrowserWindow` with its own workbench class, service collection, extension host, and storage. The bootstrap path is `sessions.desktop.main.ts` -> `sessions.main.ts` -> `Workbench.startup()`.

3. **No race conditions.** Each worktree's state lives in its own renderer process. No shared mutable state to synchronize during switches.

4. **Extension host correctness.** Git, TypeScript, and other workspace-aware extensions each see exactly one workspace folder. No `updateFolders()` calls, no re-indexing delays, no 1500ms wait.

5. **Crash isolation.** An extension host crash in one worktree doesn't affect others.

---

## 3. Precedent: How Sessions Bootstraps an Independent Window

The Sessions layer proves this architecture is viable. Here is the exact bootstrap sequence that a worktree window would follow:

### 3.1 Main Process: Window Type Detection

**`windowsMainService.ts:1572`** — The main process detects the window type from workspace identity:
```typescript
isSessionsWindow: isWorkspaceIdentifier(options.workspace) &&
                  isEqual(options.workspace.configPath, this.environmentMainService.agentSessionsWorkspace)
```

For worktree windows, we add an analogous flag:
```typescript
isWorktreeWindow: boolean;
worktreePath: string;
```

### 3.2 Main Process: HTML Entry Point Selection

**`windowImpl.ts:1212-1216`** — The window loads a different HTML file based on type:
```typescript
if (configuration.isSessionsWindow) {
    windowUrl = 'vs/sessions/electron-browser/sessions.html';
} else {
    windowUrl = 'vs/code/electron-browser/workbench/workbench.html';
}
```

Worktree windows load the standard workbench HTML (they ARE standard workbenches, just scoped to one folder).

### 3.3 Renderer: Independent Service Collection

**`sessions.main.ts:172-346`** — Sessions creates its own service collection from scratch:
- `IMainProcessService` — unique IPC connection per window (`window:${windowId}`)
- `INativeWorkbenchEnvironmentService` — own environment
- `IWorkspaceContextService` — own workspace (Sessions uses a custom one; worktree windows use standard `WorkspaceService` pointed at the worktree folder)
- `IStorageService` — own SQLite database (`StorageScope.WORKSPACE` is per-workspace)
- `IConfigurationService` — own config
- `IExtensionService` (via `NativeExtensionService`) — own extension host process

Each worktree window follows this same pattern. No service is shared between windows.

### 3.4 Renderer: Workbench Startup

**`workbench.ts:322-382`** — The workbench creates DOM, registers singleton services, renders parts, restores state, and advances lifecycle phases (`Ready` -> `Restored` -> `Eventually`).

Worktree windows use the standard `Workbench` class from `workbench/browser/workbench.ts` — no custom workbench needed.

---

## 4. Design: Orchestrator as Coordinator

The orchestrator moves from being a state-swapping engine to a window lifecycle manager.

### 4.1 Orchestrator Window

A lightweight window (could be the standard workbench or a custom Sessions-style window) that shows:
- The worktree sidebar (existing `OrchestratorPart`)
- Session state indicators (Working/Permission/Review/Idle)
- Diff stats and branch info per worktree

When the user clicks a worktree in the sidebar:
- If a window exists for that worktree: focus it
- If not: create a new window for that worktree

The orchestrator window can optionally show its own editor area (for the main repo) or be a sidebar-only coordinator.

### 4.2 Worktree Windows

Standard VS Code workbench windows, each opened with a single workspace folder pointing to the worktree path (e.g., `/repo/.workstreams/trees/feature-a/`).

Each window:
- Has its own editor grid, terminals, extension host
- Knows it is a worktree window (via `INativeWindowConfiguration.isWorktreeWindow`)
- Reports session state changes back to the orchestrator via IPC
- May hide certain UI elements (e.g., orchestrator sidebar is only in the coordinator)

### 4.3 IPC Coordination

All cross-window communication goes through the main process. Two IPC patterns are already proven:

**Pattern 1: Service proxying** (used by `IGitWorktreeService`)
- Main process hosts a singleton coordination service
- Renderer windows call it transparently via `ProxyChannel`
- Service maintains authoritative state (which worktrees exist, their session states)

**Pattern 2: HTTP notification server** (used by `hookNotificationServer.ts`)
- Claude hook events POST to `http://127.0.0.1:51742/hook/complete`
- Main process normalizes and broadcasts via IPC to all windows
- Each window updates its own UI independently

For the orchestrator, we extend Pattern 1:

```typescript
// Main process service
interface IOrchestratorCoordinationService {
    // Window lifecycle
    openWorktreeWindow(worktreePath: string): Promise<number>; // returns windowId
    focusWorktreeWindow(worktreePath: string): Promise<void>;
    closeWorktreeWindow(worktreePath: string): Promise<void>;

    // State
    getWorktreeWindows(): { worktreePath: string; windowId: number }[];
    onDidChangeWorktreeWindows: Event<void>;

    // Session state (from hook notifications)
    getSessionState(worktreePath: string): WorktreeSessionState;
    onDidChangeSessionState: Event<{ worktreePath: string; state: WorktreeSessionState }>;
}
```

The orchestrator sidebar calls `openWorktreeWindow(path)` on click. The main process either focuses an existing window or creates a new one via `windowsMainService.open()`.

### 4.4 Hook Notification Routing

The existing `hookNotificationServer.ts` runs in the main process and receives Claude lifecycle events. Currently it broadcasts to the single workbench window. With multiple windows:

1. Hook fires with `worktreePath` in the payload
2. Main process looks up which window owns that worktree
3. Routes the notification to that specific window AND the orchestrator window
4. Each updates independently (worktree window updates its own status bar; orchestrator updates the sidebar icon)

---

## 5. What Gets Deleted

The entire save/restore machinery becomes unnecessary:

| File | What Gets Removed |
|------|-------------------|
| `orchestratorService.ts` | `switchTo()` steps 0-6, `_workingSetMap`, `pendingTerminalRestore`, the 1500ms delay, `saveWorkingSet`/`applyWorkingSet` calls |
| `orchestratorTerminalContribution.ts` | Phase 1 and Phase 2 entirely. `_ownership` map, `_findGroupIndex`, `moveToBackground`/`showBackgroundTerminal` dance. Terminal backgrounding/foregrounding is no longer needed — each window owns its terminals permanently |
| `editorParts.ts` | Working Sets API stays (it's upstream VS Code), but the orchestrator no longer calls it |

**Lines of code removed:** ~250 lines of the most bug-prone, race-condition-laden code in the codebase.

---

## 6. What Gets Added

### 6.1 Main Process: Orchestrator Coordination Service

**New file:** `src/vs/workbench/services/orchestrator/electron-main/orchestratorCoordinationService.ts`

Manages the mapping of worktree paths to window IDs. Creates windows via `IWindowsMainService.open()`. Routes hook notifications. Tracks which windows are alive.

**~200 lines.** Straightforward Map + IPC event forwarding.

### 6.2 Main Process: Window Configuration Extension

**Modified:** `windowsMainService.ts`, `windowImpl.ts`

Add `isWorktreeWindow` and `worktreePath` to `INativeWindowConfiguration`. Route to correct HTML entry point (standard workbench for worktree windows).

**~30 lines changed.**

### 6.3 Renderer: Orchestrator Window Mode

**Modified:** `orchestratorPart.ts`, `orchestratorService.ts`

The orchestrator service in the coordinator window calls `IOrchestratorCoordinationService` (main process) to open/focus windows instead of calling `switchTo()`. The sidebar renders window-open state alongside session state.

**~100 lines changed.**

### 6.4 Renderer: Worktree Window Awareness

**New file:** `src/vs/workbench/contrib/orchestrator/browser/worktreeWindowContribution.ts`

A lightweight contribution in worktree windows that:
- Hides the orchestrator sidebar (it's only in the coordinator)
- Sets up hook notification listening for its own worktree path
- Reports session state changes back to the coordination service

**~80 lines.**

### 6.5 IPC Channel Registration

**Modified:** `app.ts` (electron-main)

Register `IOrchestratorCoordinationService` as an IPC channel, same pattern as existing `gitWorktree` and `hookNotification` channels.

**~15 lines.**

---

## 7. Memory and Resource Impact

### 7.1 Per-Window Cost

Each worktree window is a separate Electron renderer process + extension host:

| Component | Memory | Notes |
|-----------|--------|-------|
| Renderer process | ~80-120 MB | Chromium renderer with DOM, JS heap |
| Extension host (default) | ~150-250 MB | Depends on installed extensions |
| Extension host (git only) | ~50-80 MB | If heavy extensions are lazy-loaded |
| **Total per window** | **~230-370 MB** | |

### 7.2 Scaling

| Worktrees | Current (single window) | Proposed (multi-window) | Delta |
|-----------|------------------------|------------------------|-------|
| 1 | ~400 MB | ~400 MB | 0 |
| 2 | ~400 MB | ~700 MB | +300 MB |
| 3 | ~400 MB | ~1000 MB | +600 MB |
| 5 | ~400 MB | ~1600 MB | +1200 MB |

### 7.3 Mitigations

**Lazy extension host startup.** The extension host uses `LazyCreateExtensionHostManager` — if no extensions are assigned to a host affinity, the process is never spawned. For background worktree windows (not focused), we can defer extension host creation until first focus.

**Extension affinity.** The `extensions.experimental.affinity` setting already allows grouping extensions into separate processes. Heavy extensions (Python, TypeScript) can be isolated so only git loads in most worktree windows.

**On-demand window creation.** Don't pre-create windows for all worktrees. Create on first click, keep alive in background. Close idle windows after a configurable timeout.

**Shared extension installation directory.** Extensions are installed once globally. Each host loads from the same directory — no disk duplication.

### 7.4 Acceptable Trade-off

A machine with 16 GB RAM can comfortably run 5 worktree windows (~1.6 GB) alongside the rest of the system. This is comparable to having 5 VS Code windows open, which is normal for many developers. The trade-off is explicit: memory for correctness. The current approach uses less memory but corrupts state.

---

## 8. Migration Strategy

### Phase 1: Coordinator + Multi-Window (core architecture)

1. Add `IOrchestratorCoordinationService` to the main process
2. Extend `INativeWindowConfiguration` with worktree metadata
3. Modify orchestrator sidebar to open/focus windows instead of calling `switchTo()`
4. Worktree windows are standard workbench windows pointed at the worktree folder
5. Hook notifications route to the correct window
6. Remove `switchTo()`, Phase 1/Phase 2 terminal dance, `_workingSetMap`

**Outcome:** Each worktree gets its own window with full isolation. No layout corruption. No 1500ms delay. Editor tabs and terminals survive restarts automatically (each window has its own `StorageScope.WORKSPACE`).

### Phase 2: UX Polish

1. **Window grouping.** Group worktree windows in the OS taskbar/dock (Electron's `BrowserWindow.setWindowButtonPosition` or app-level grouping).
2. **Orchestrator window as hub.** The coordinator window shows a compact overview: worktree name, session state, diff stats, last active time. Double-click opens the worktree window.
3. **Keyboard shortcuts.** `Cmd+1/2/3` to switch between worktree windows (via main process IPC).
4. **Auto-close idle windows.** Close worktree windows that haven't been focused in N minutes (configurable). Re-open on click from orchestrator.
5. **Single-window mode.** For users who prefer the current UX, keep the hot-swap path as an opt-in fallback behind a setting.

### Phase 3: Resource Optimization

1. **Deferred extension host.** Don't start the extension host for background windows until they're focused.
2. **Extension filtering.** Load only essential extensions (git, diff) in worktree windows. Disable language servers, linters, formatters until the user opens a relevant file.
3. **Window hibernation.** Serialize a background window's state and close it entirely. Restore on focus (similar to Chrome's tab discarding).

---

## 9. Risk Assessment

### 9.1 Risks and Mitigations

| Risk | Severity | Likelihood | Mitigation |
|------|----------|-----------|------------|
| Memory pressure with many worktrees | Medium | High (>5 worktrees) | Lazy window creation, deferred ext host, configurable idle timeout |
| OS window management UX (Alt-Tab clutter) | Medium | Medium | Window grouping, orchestrator hub, keyboard shortcuts |
| Extension state conflicts between windows | Low | Low | Each window has its own `StorageScope.WORKSPACE`; extensions use workspace-scoped storage by default |
| Main process becomes coordination bottleneck | Low | Low | IPC is async and lightweight; coordination service is a simple map + event forwarder |
| Users expect single-window experience | Medium | Medium | Phase 2 polish; single-window fallback mode |
| Two workbench windows for same worktree | Low | Low | Coordination service enforces 1:1 mapping; `focusWorktreeWindow()` if already open |

### 9.2 What Could Go Wrong

**The orchestrator sidebar lives in one window but needs global state.** The coordination service in the main process is the single source of truth. The sidebar queries it for all worktree states, session states, and window liveness. This is a clean separation: main process owns state, renderer owns UI.

**Claude hooks need to reach the right window.** The hook notification server already receives `worktreePath` in the payload. The coordination service maps path to windowId and routes the event. If the window doesn't exist (closed or not yet created), the orchestrator window still receives the notification and updates the sidebar icon.

**Extension host startup time adds latency to first window open.** Extension host cold start is 1-2 seconds. This is the same latency as opening any new VS Code window. Warm subsequent opens (window was backgrounded, not closed) have zero ext host latency.

---

## 10. Alternatives Considered

### 10.1 Fix the Current Hot-Swap Approach (Approach C)

Add cancellation tokens, persist `_workingSetMap`, use group IDs instead of indices, await async effects in Phase 1.

**Why not:** Fixes the symptoms but not the cause. The single-window hot-swap model is inherently fragile because it fights VS Code's assumption of one workspace per window. Each new feature (e.g., review comments on diff editors, terminal split layouts) adds more state to save/restore and more race conditions to handle. The bug surface area grows linearly with features.

### 10.2 Virtual EditorParts in Same Window (Approach B)

Create multiple `EditorPart` instances in the same DOM, CSS-swap visibility.

**Why not:** Solves the editor grid problem but not the extension host problem. Git, TypeScript, and other workspace-aware extensions still see a single workspace folder. `updateFolders()` still triggers re-indexing. Terminals still need the background/foreground dance. The coordination complexity moves from "save/restore state" to "manage hidden DOM trees and shared extension context." Net complexity is similar, and the extension host issues remain.

### 10.3 Multi-Root Workspace

Open all worktrees as folders in a single multi-root workspace.

**Why not:** Multi-root workspaces are poorly supported by many extensions. Git extension gets confused with multiple `.git` directories. Terminal CWD is ambiguous. Editor state is not scoped per root folder. This would create more problems than it solves.

---

## 11. Success Criteria

1. **Switching between worktrees is instant.** Focus a window (~16ms) instead of swap + wait (~2-3 seconds).
2. **Layout never corrupts.** No grid distortion, no terminals in wrong groups, no empty editors.
3. **State survives restart.** Each window restores its own editors and terminals from its own `StorageScope.WORKSPACE`.
4. **Memory stays under 2 GB** for 5 concurrent worktree windows.
5. **Hook notifications reach the correct window** within 100ms.
6. **The orchestrator sidebar accurately reflects** all worktree session states across all windows.

---

## 12. Open Questions

1. **Should the orchestrator window be a custom workbench (like Sessions) or a standard workbench with the orchestrator sidebar?** A standard workbench lets it double as the main repo's editor. A custom workbench keeps it lightweight.

2. **Window positioning.** Should worktree windows open in the same position (overlapping) or tiled? Should the orchestrator remember per-worktree window positions?

3. **Single-monitor vs multi-monitor.** On a single monitor, N overlapping windows is worse UX than a single window with switching. Should we detect monitor count and adapt?

4. **Shared clipboard / undo context.** Currently, copy-paste between worktrees is natural (single window). With separate windows, it still works (OS clipboard), but cross-worktree undo history is lost. Is this acceptable?

5. **Terminal ownership.** When a user creates a terminal in a worktree window, it's scoped to that window permanently. What happens if they want to move a terminal between worktrees? Disallow, or support via IPC?
