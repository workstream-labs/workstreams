# Alternate Plan: Fix the Hot-Swap Architecture

**Status:** Design  
**Author:** amandal  
**Date:** 2026-04-02  

---

## 1. Problem Statement

The worktree switch in `orchestratorService.ts` (`switchTo()`) corrupts the editor grid layout, particularly with terminals. The root cause is not a single bug but a set of compounding coordination failures between the orchestrator, the Editor Working Sets API, and the terminal contribution.

The problems, in order of severity:

1. **No switch cancellation.** Two `applyWorkingSet` calls run concurrently during rapid switches.
2. **Terminal group index is positional.** Shifts when groups change between save and restore.
3. **Phase 1 is sync but calls async `moveToBackground`.** Grid captured mid-mutation.
4. **`pendingTerminalRestore` guard fires too late.** Rapid switches bypass it.
5. **`applyWorkingSet` return value ignored.** Silent failures leave partial state.
6. **`showBackgroundTerminal` places terminal in wrong group first.** Layout reflows before correction.
7. **Tab order within groups not tracked.** Terminals always appended, not restored to original position.
8. **`_workingSetMap` not persisted.** Editor state lost on restart.
9. **1500ms hardcoded delay.** Unnecessary — `updateFolders()` does not restart the extension host.

This plan fixes all nine issues while keeping the single-window hot-swap model.

---

## 2. Fix 1: Cancellable Switch via Generation Counter

**The problem.** `switchTo()` is async and takes ~2 seconds. If the user clicks another worktree during that time, a second `switchTo()` starts while the first is still in-flight. Both call `applyWorkingSet` on different working sets, stomping on each other's grid state.

**The fix.** Use VS Code's idiomatic `LongRunningOperation` pattern with a generation counter. This is the same pattern used by `EditorPanes` (`editorPanes.ts:452`) and `SearchEditor` (`searchEditor.ts:488`).

**File:** `orchestratorService.ts`

```typescript
// New fields
private _switchGeneration = 0;
private _switchCts: CancellationTokenSource | undefined;

async switchTo(worktree: IWorktreeEntry): Promise<void> {
    const previousPath = this._activeWorktree?.path;
    this._activeWorktree = worktree;

    // ... update repositories, fire onDidChangeRepositories, saveState (unchanged) ...

    if (previousPath !== worktree.path) {
        // Cancel any in-flight switch
        this._switchCts?.cancel();
        this._switchCts?.dispose();
        this._switchCts = new CancellationTokenSource();
        const token = this._switchCts.token;
        const generation = ++this._switchGeneration;

        // Helper: bail if a newer switch started
        const isCurrent = () => this._switchGeneration === generation;

        // Step 0: Wait for in-flight terminal restore
        await this.pendingTerminalRestore;
        if (!isCurrent()) return;

        // Step 1: Background terminals (now async — see Fix 3)
        this._onDidChangeActiveWorktree.fire(worktree);
        await this.pendingTerminalBackground;
        if (!isCurrent()) return;

        // Step 2: Save editor state
        if (previousPath) {
            const workingSet = this.editorGroupsService.saveWorkingSet(previousPath);
            this._workingSetMap.set(previousPath, workingSet);
            this._persistWorkingSetMap();  // Fix 8
        }

        // Step 3: Clear editors
        await this.editorGroupsService.applyWorkingSet('empty');
        if (!isCurrent()) return;

        // Step 4: Swap workspace folder
        const folderData = { uri: URI.file(worktree.path) };
        const currentFolders = this.workspaceContextService.getWorkspace().folders;
        if (currentFolders.length === 0) {
            await this.workspaceEditingService.addFolders([folderData], true);
        } else {
            await this.workspaceEditingService.updateFolders(0, currentFolders.length, [folderData], true);
        }
        if (!isCurrent()) return;

        // Step 5: Restore editors (with reduced delay — see Fix 9)
        const savedSet = this._workingSetMap.get(worktree.path);
        if (savedSet) {
            await this._waitForGitReady(token);  // Fix 9: event-driven, not 1500ms
            if (!isCurrent()) return;

            const applied = await this.editorGroupsService.applyWorkingSet(savedSet);
            if (!applied) {
                this.logService.warn('[OrchestratorService] applyWorkingSet failed');  // Fix 5
            }
        }
        if (!isCurrent()) return;

        // Step 6: Restore terminals
        this._onDidApplyWorktreeEditorState.fire(worktree);
    }
}
```

**Why generation counter over CancellationToken alone:** The token cancels downstream work (good for aborting network requests), but `isCurrent()` is simpler for "should I keep going?" checks between sequential steps. VS Code's `LongRunningOperation` uses both — the token for async ops, the generation for stale checks. We follow the same pattern.

**Lines of code:** ~20 lines changed in `switchTo()`.

---

## 3. Fix 2: Group ID Instead of Positional Index

**The problem.** Terminal contribution saves each terminal's position as an integer index into `getGroups(GRID_APPEARANCE)`. Between save and restore, groups can be added/removed, causing the index to point to a different group or overshoot entirely.

**The fix.** Track the group's stable `id` (a unique number assigned at creation) instead of its position in the array.

**File:** `orchestratorTerminalContribution.ts`

```typescript
// Before
interface ITerminalOwnership {
    readonly worktreeKey: string;
    groupIndex: number;
}

// After
interface ITerminalOwnership {
    readonly worktreeKey: string;
    groupId: number;       // stable ID, not positional index
    tabIndex: number;      // position within the group (Fix 7)
}
```

**Phase 1 change** (`_onActiveWorktreeChanging`):

```typescript
// Before (line 255)
info.groupIndex = this._findGroupIndex(instance);

// After
const group = this._findGroup(instance);
if (group) {
    info.groupId = group.id;
    info.tabIndex = group.getIndexOfEditor(instance.resource);
}
```

**Phase 2 change** (`_onWorktreeEditorStateApplied`):

```typescript
// Before (line 343)
const targetGroup = groups[groupIndex] ?? groups[0];

// After
const targetGroup = groups.find(g => g.id === groupId) ?? groups[0];
```

**Why this works.** Group IDs are assigned by `EditorGroupView` at construction and never reused within a session. Even after `applyWorkingSet` reconstructs the grid, the IDs for preserved groups remain stable. If a group was destroyed and recreated, the ID changes — the fallback to `groups[0]` handles that case, which is still better than the current positional overshoot.

**Lines of code:** ~15 lines changed.

---

## 4. Fix 3: Async Phase 1 (Await moveToBackground)

**The problem.** `_onActiveWorktreeChanging` is synchronous (it's an event handler). It calls `moveToBackground()` which triggers async editor tab removal internally. `saveWorkingSet` runs before tabs are fully removed, capturing a dirty grid state.

**The fix.** Split Phase 1 into a sync event (for the orchestrator to detect the switch) and an async completion promise.

**File:** `orchestratorTerminalContribution.ts`

```typescript
// New: expose a promise for the orchestrator to await
pendingTerminalBackground: Promise<void> = Promise.resolve();

// Phase 1 becomes async internally
private async _doBackgroundTerminals(worktree: IWorktreeEntry): Promise<void> {
    // ... existing snapshot + background logic ...
    
    // NEW: wait for all moveToBackground to settle
    // moveToBackground triggers editor close which is async
    // Give the editor service one microtask tick to process closures
    await new Promise(resolve => setTimeout(resolve, 0));
}
```

**File:** `orchestratorService.ts`

```typescript
// Step 1: Fire worktree change
this._onDidChangeActiveWorktree.fire(worktree);

// NEW: Wait for terminal backgrounding to complete
await this.pendingTerminalBackground;
if (!isCurrent()) return;

// Step 2: NOW safe to save editor state
const workingSet = this.editorGroupsService.saveWorkingSet(previousPath);
```

**Why `setTimeout(0)` is sufficient.** `moveToBackground` calls `detachFromElement()` on the xterm instance and updates the terminal service's internal arrays. The editor tab removal is enqueued as a microtask. A zero-delay timeout ensures we yield back to the event loop once, letting all pending microtasks (editor close callbacks, group updates) settle before `saveWorkingSet` runs.

**Lines of code:** ~15 lines changed.

---

## 5. Fix 4: pendingTerminalRestore Guard Timing

**The problem.** `pendingTerminalRestore` is assigned in the `onDidApplyWorktreeEditorState` listener (step 6), but step 0 of the next switch awaits it before step 6 of the current switch fires. So rapid switches bypass the guard.

**The fix.** This is already solved by Fix 1 (generation counter). The `isCurrent()` check after every `await` makes the `pendingTerminalRestore` guard redundant for correctness. However, we keep it as a belt-and-suspenders measure, and also assign it earlier:

**File:** `orchestratorTerminalContribution.ts`

```typescript
// Before: assigned in onDidApplyWorktreeEditorState listener
this._orchestratorService.pendingTerminalRestore = this._onWorktreeEditorStateApplied(wt);

// After: also assign pendingTerminalBackground in onDidChangeActiveWorktree listener
this._register(this._orchestratorService.onDidChangeActiveWorktree(wt => {
    this._orchestratorService.pendingTerminalBackground = this._doBackgroundTerminals(wt);
}));
```

Now step 0 of the next switch awaits both `pendingTerminalRestore` (Phase 2 of previous switch) AND `pendingTerminalBackground` (Phase 1 of previous switch). Combined with the generation counter, no stale work leaks through.

**Lines of code:** ~5 lines changed.

---

## 6. Fix 5: Check applyWorkingSet Return Value

**The problem.** `applyWorkingSet` returns `Promise<boolean>` — `false` when the working set ID isn't found in storage or when a dirty editor vetoes the close (`editorParts.ts:565-567`). The orchestrator ignores this return value, so a failed restore is completely silent. The user sees an empty or partial grid with no indication of what happened.

**The fix.** Log the failure and fall back gracefully.

**File:** `orchestratorService.ts`

```typescript
// Step 5: Restore editors
const savedSet = this._workingSetMap.get(worktree.path);
if (savedSet) {
    await this._waitForGitReady(token);
    if (!isCurrent()) return;

    const applied = await this.editorGroupsService.applyWorkingSet(savedSet);
    if (!applied) {
        this.logService.warn(
            `[OrchestratorService] Working set restore failed for "${worktree.name}". ` +
            `Clearing stale entry.`
        );
        // Remove the stale working set so next switch saves fresh state
        this._workingSetMap.delete(worktree.path);
        this._persistWorkingSetMap();
    }
}
```

**Why delete on failure.** A working set that fails to apply is likely stale (references files/editors that no longer exist). Keeping it means every subsequent switch to this worktree silently fails. Deleting it means the next switch starts fresh — the user loses their tab layout for that worktree once, but all future switches work correctly.

**Lines of code:** ~10 lines changed.

---

## 7. Fix 6: Skip showBackgroundTerminal's ACTIVE_GROUP Placement

**The problem.** Phase 2 calls `showBackgroundTerminal(instance)` which places the terminal in whatever group happens to be active. Then it immediately calls `openEditor(instance, { viewColumn: targetGroupId })` to move it to the correct group. Between those two async calls, the terminal briefly exists in the wrong group, causing a visible layout reflow.

**The fix.** Set the active group BEFORE calling `showBackgroundTerminal`, or call `openEditor` directly without the intermediate placement.

**File:** `orchestratorTerminalContribution.ts`

```typescript
// Before (line 343-351)
const targetGroup = groups[groupIndex] ?? groups[0];
const targetGroupId = targetGroup?.id;
await this._terminalService.showBackgroundTerminal(instance);
if (targetGroupId !== undefined) {
    await this._terminalEditorService.openEditor(instance, { viewColumn: targetGroupId });
}

// After: activate the target group first so showBackgroundTerminal uses it
const targetGroup = groups.find(g => g.id === groupId) ?? groups[0];
if (targetGroup) {
    this._editorGroupsService.activateGroup(targetGroup);
}
await this._terminalService.showBackgroundTerminal(instance);
// No second openEditor needed — terminal landed in the right group
```

**Why this works.** `showBackgroundTerminal` uses `ACTIVE_GROUP` as the target. By activating the correct group first, the terminal lands there directly. No intermediate placement, no reflow.

**Caveat:** If multiple terminals target different groups, we activate each group in sequence. This is fine — `activateGroup` is synchronous and instant.

**Lines of code:** ~10 lines changed.

---

## 8. Fix 7: Preserve Tab Order Within Groups

**The problem.** Only the group index (now group ID) is tracked per terminal. The tab position within a group is lost. Phase 2 calls `openEditor` with no index parameter, so terminals are always appended as the last tab rather than restored to their original position.

**The fix.** Track `tabIndex` in `ITerminalOwnership` (already added in Fix 2) and pass it to `openEditor`.

**File:** `orchestratorTerminalContribution.ts`

```typescript
// Phase 1: save tab position
const group = this._findGroup(instance);
if (group) {
    info.groupId = group.id;
    info.tabIndex = group.getIndexOfEditor(instance.resource);
}

// Phase 2: restore tab position
// Sort terminals by tabIndex before restoring (lower index first)
toShow.sort((a, b) => a.tabIndex - b.tabIndex);

for (const { instance, groupId, tabIndex } of toShow) {
    const targetGroup = groups.find(g => g.id === groupId) ?? groups[0];
    if (targetGroup) {
        this._editorGroupsService.activateGroup(targetGroup);
    }
    await this._terminalService.showBackgroundTerminal(instance);
    // Move to correct tab position if needed
    if (targetGroup && tabIndex >= 0) {
        targetGroup.moveEditor(instance.resource, targetGroup, { index: tabIndex });
    }
}
```

**Why sort first.** If we restore terminals in arbitrary order, each `moveEditor` shifts the indices of subsequent tabs. Restoring in ascending index order avoids this — each terminal lands at or near its original position without disturbing previously restored tabs.

**Lines of code:** ~15 lines changed.

---

## 9. Fix 8: Persist _workingSetMap to Storage

**The problem.** `_workingSetMap` is a plain in-memory `Map<string, IEditorWorkingSet>`. On restart, the map is empty. The working set snapshots exist in SQLite (`StorageScope.WORKSPACE` under key `editor.workingSets`), and each snapshot's `name` field is the worktree path. But the orchestrator has no way to find them because the mapping of path to snapshot ID is lost.

**The fix.** Two options. Option B is simpler.

### Option A: Persist the Map

Save `_workingSetMap` to `StorageService` alongside the repository state.

```typescript
private static readonly WORKING_SET_MAP_KEY = 'orchestrator.workingSetMap';

private _persistWorkingSetMap(): void {
    const serialized: Record<string, { id: string; name: string }> = {};
    for (const [path, ws] of this._workingSetMap) {
        serialized[path] = { id: ws.id, name: ws.name };
    }
    this.storageService.store(
        OrchestratorServiceImpl.WORKING_SET_MAP_KEY,
        JSON.stringify(serialized),
        StorageScope.WORKSPACE,
        StorageTarget.MACHINE
    );
}

private _restoreWorkingSetMap(): void {
    const raw = this.storageService.get(
        OrchestratorServiceImpl.WORKING_SET_MAP_KEY,
        StorageScope.WORKSPACE
    );
    if (raw) {
        const parsed = JSON.parse(raw) as Record<string, { id: string; name: string }>;
        for (const [path, ws] of Object.entries(parsed)) {
            this._workingSetMap.set(path, ws);
        }
    }
}
```

Call `_restoreWorkingSetMap()` in `restoreState()`.

### Option B: Look Up by Name (Zero Persistence)

The working set snapshots already store the worktree path as the `name` field (we verified this in the SQLite data). Instead of maintaining a separate map, look up the snapshot by name at switch time:

```typescript
// In switchTo(), step 5:
let savedSet = this._workingSetMap.get(worktree.path);

// Fallback: search existing working sets by name (survives restart)
if (!savedSet) {
    const allSets = this.editorGroupsService.getWorkingSets();
    savedSet = allSets.find(ws => ws.name === worktree.path);
}
```

This requires zero new persistence code. The `name` field is already the worktree path (set in `saveWorkingSet(previousPath)` at line 327). On restart, `getWorkingSets()` reads from `StorageScope.WORKSPACE` which is persisted.

**Recommendation:** Option B. Zero additional storage, zero migration, works with existing data in SQLite.

**Lines of code:** ~8 lines changed.

---

## 10. Fix 9: Replace 1500ms Delay with Event-Driven Wait

**The problem.** After `updateFolders()`, the code waits 1500ms for the "extension host to settle." But our research confirmed that `updateFolders()` does NOT restart the extension host — there are zero references to `onDidChangeWorkspaceFolders` in the entire extensions service directory. The 1500ms is waiting for the git extension to re-scan the new folder.

**The fix.** Replace the blind delay with a shorter timeout that can be interrupted early.

```typescript
private async _waitForGitReady(token: CancellationToken): Promise<void> {
    // Git extension re-indexes on folder change. Typical time: 200-500ms.
    // Use a short poll with early exit instead of a blind 1500ms wait.
    const MAX_WAIT = 800;  // ms — reduced from 1500
    const POLL_INTERVAL = 100;

    const start = Date.now();
    while (Date.now() - start < MAX_WAIT) {
        if (token.isCancellationRequested) return;

        // Check if git extension has picked up the new folder
        // by verifying the workspace folder exists
        const folders = this.workspaceContextService.getWorkspace().folders;
        if (folders.length > 0) {
            // Give git one more tick to process the folder
            await new Promise(resolve => setTimeout(resolve, 100));
            return;
        }
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }
}
```

**A simpler alternative** if the polling feels fragile: just reduce the timeout to 500ms. The 1500ms was overly conservative. Most git re-scans complete in 200-300ms on modern hardware.

```typescript
// Simple version
if (savedSet) {
    await new Promise(resolve => setTimeout(resolve, 500));  // was 1500
    if (!isCurrent()) return;
    await this.editorGroupsService.applyWorkingSet(savedSet);
}
```

**Lines of code:** ~5-15 lines changed.

---

## 11. Summary of All Changes

| Fix | File | Lines Changed | Impact |
|-----|------|---------------|--------|
| 1. Generation counter | `orchestratorService.ts` | ~20 | Eliminates all race conditions between concurrent switches |
| 2. Group ID tracking | `orchestratorTerminalContribution.ts` | ~15 | Terminals always land in correct group |
| 3. Async Phase 1 | Both files | ~15 | Grid captured after terminal tabs fully removed |
| 4. Guard timing | `orchestratorTerminalContribution.ts` | ~5 | Belt-and-suspenders with Fix 1 |
| 5. Return value check | `orchestratorService.ts` | ~10 | Failed restores detected and handled |
| 6. Skip double placement | `orchestratorTerminalContribution.ts` | ~10 | No intermediate reflow during terminal restore |
| 7. Tab order | `orchestratorTerminalContribution.ts` | ~15 | Terminals restored to exact position |
| 8. Persist map | `orchestratorService.ts` | ~8 | Editor state survives restart |
| 9. Reduce delay | `orchestratorService.ts` | ~5-15 | Switch time reduced by ~1 second |
| **Total** | | **~105-120** | |

**Net effect on switch time:**
- Before: ~2-3 seconds (1500ms delay + async race = unpredictable)
- After: ~500-800ms (reduced delay + no races + no double terminal placement)

---

## 12. Implementation Order

The fixes have dependencies. Implement in this order:

### Sprint 1: Core Safety (Fixes 1, 3, 4)

These three together eliminate all race conditions. Fix 1 (generation counter) is the foundation — every other fix benefits from the `isCurrent()` guard. Fix 3 (async Phase 1) and Fix 4 (guard timing) complement it.

**Test:** Rapid-click between two worktrees 10 times. Grid should never corrupt.

### Sprint 2: Terminal Correctness (Fixes 2, 6, 7)

With races eliminated, fix terminal placement. Fix 2 (group ID) ensures correct group. Fix 6 (skip double placement) removes the visual reflow. Fix 7 (tab order) restores exact layout.

**Test:** Create a complex layout with 3 groups (file | terminal | file+terminal), switch away and back. Layout should be identical.

### Sprint 3: Persistence and Performance (Fixes 5, 8, 9)

These are independent improvements. Fix 5 (return value check) adds logging. Fix 8 (persist map) survives restart. Fix 9 (reduce delay) cuts switch time.

**Test:** Restart the app, switch to a worktree that had open tabs. Tabs should restore. Switch time should be under 1 second.

---

## 13. Risk Assessment

| Risk | Severity | Likelihood | Mitigation |
|------|----------|-----------|------------|
| Generation counter introduces subtle ordering bugs | Medium | Low | Each step checks `isCurrent()` after every await — no stale work continues |
| `setTimeout(0)` in Fix 3 is insufficient for moveToBackground | Low | Medium | Monitor in testing; increase to `setTimeout(50)` if needed |
| Group IDs not stable across applyWorkingSet | Low | Low | Verified: IDs assigned at construction, preserved for reused groups |
| Reducing delay from 1500ms to 500ms breaks git extension | Medium | Low | The delay was never about the extension host. Git re-scan is 200-300ms. 500ms is still 2x margin |
| Option B (lookup by name) breaks if saveWorkingSet changes name format | Low | Very Low | We control the name parameter — it's always the worktree path |

---

## 14. What This Does NOT Fix

- **Switch is not instant.** Still ~500-800ms for folder swap + git re-scan + editor restore. This is inherent to the hot-swap model.
- **Extension re-activation delay.** Extensions with `workspaceContains` activation events re-evaluate on folder change. TypeScript, ESLint, etc. may take 1-2 seconds to fully reinitialize. This happens after the switch completes and doesn't block the UI.
- **Single extension host.** All worktrees still share one extension host. A crash affects all worktrees.
- **Memory efficiency.** Single window = single renderer process = lower memory. This is an advantage of the hot-swap model.

For instant switching, full isolation, and crash containment, see `MigrationPlan.md` (Approach A: per-worktree windows).

---

## 15. Comparison with Per-Worktree Windows (MigrationPlan.md)

| Dimension | This Plan (Fix Hot-Swap) | Per-Worktree Windows |
|-----------|------------------------|---------------------|
| Switch time | ~500-800ms | ~16ms (window focus) |
| Layout corruption | Fixed by this plan | Impossible by design |
| Memory per worktree | +0 MB (shared window) | +230-370 MB (new window + ext host) |
| Crash isolation | None (shared ext host) | Full (separate processes) |
| Restart persistence | Fixed by Fix 8 | Automatic (per-window storage) |
| Implementation effort | ~120 lines changed | ~400 lines new + ~250 deleted |
| Risk | Low (incremental fixes) | Medium (architectural change) |
| Code complexity | Maintains existing model | Simpler model, more infra |
| UX | Single window, no Alt-Tab | Multiple windows in taskbar |

**When to pick this plan:** You want to ship fixes fast, keep memory low, and avoid multi-window UX complexity. Acceptable switch time is under 1 second.

**When to pick MigrationPlan.md:** You want instant switching, crash isolation, and are willing to pay the memory cost. The multi-window UX is acceptable or even preferred (multi-monitor setups).
