# Graph Report - apps/desktop/src/vs/sessions  (2026-04-10)

## Corpus Check
- 157 files · ~139,569 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1693 nodes · 2213 edges · 136 communities detected
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 12 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `Workbench` - 77 edges
2. `NewChatWidget` - 45 edges
3. `AgentFeedbackEditorWidget` - 28 edges
4. `RemoteNewSession` - 26 edges
5. `WorkspacePicker` - 26 edges
6. `SessionsManagementService` - 26 edges
7. `ProjectBarPart` - 23 edges
8. `TitlebarPart` - 23 edges
9. `SessionsConfigurationService` - 20 edges
10. `CodeReviewService` - 20 edges

## Surprising Connections (you probably didn't know these)
- `Letterpress Sessions Light SVG (hexagonal product icon, light theme)` --conceptually_related_to--> `AgentSessionsChatWelcomePart`  [INFERRED]
  apps/desktop/src/vs/sessions/contrib/chat/browser/media/letterpress-sessions-light.svg → apps/desktop/src/vs/sessions/browser/widget/AGENTS_CHAT_WIDGET.md
- `Letterpress Sessions Dark SVG (hexagonal product icon, dark theme)` --conceptually_related_to--> `AgentSessionsChatWelcomePart`  [INFERRED]
  apps/desktop/src/vs/sessions/contrib/chat/browser/media/letterpress-sessions-dark.svg → apps/desktop/src/vs/sessions/browser/widget/AGENTS_CHAT_WIDGET.md
- `Copilot Agent Runtime Customization Surface Spec` --semantically_similar_to--> `AI Customizations Design Document`  [INFERRED] [semantically similar]
  apps/desktop/src/vs/sessions/copilot-customizations-spec.md → apps/desktop/src/vs/sessions/AI_CUSTOMIZATIONS.md
- `Agent Sessions E2E Tests (compile-and-replay architecture)` --references--> `E2E Scenario 05: Full Workflow`  [INFERRED]
  apps/desktop/src/vs/sessions/test/e2e/README.md → apps/desktop/src/vs/sessions/test/e2e/scenarios/05-full-workflow.scenario.md
- `Agent Sessions E2E Tests (compile-and-replay architecture)` --references--> `E2E Scenario 04: Navigate Between Sessions`  [INFERRED]
  apps/desktop/src/vs/sessions/test/e2e/README.md → apps/desktop/src/vs/sessions/test/e2e/scenarios/04-navigate-sessions.scenario.md

## Hyperedges (group relationships)
- **AgentSessionsChatWidget Composition Pattern (wrapper + target config + welcome part)** — widget_agent_sessions_chat_widget, widget_agent_target_config, widget_agent_welcome_part [EXTRACTED 1.00]
- **AI Customization Harness + Storage Filter Pipeline** — ai_custom_harness_service, ai_custom_storage_source_filter, ai_custom_workspace_service [EXTRACTED 1.00]
- **E2E Compile-and-Replay Architecture (scenario + generate + test phases)** — e2e_generate_phase, e2e_test_phase, e2e_mock_architecture [EXTRACTED 1.00]

## Communities

### Community 0 - "Workbench Layout"
Cohesion: 0.04
Nodes (1): Workbench

### Community 1 - "New Session Creation"
Cohesion: 0.04
Nodes (3): AgentHostNewSession, CopilotCLISession, RemoteNewSession

### Community 2 - "Chat View Pane"
Cohesion: 0.07
Nodes (2): NewChatViewPane, NewChatWidget

### Community 3 - "Titlebar"
Cohesion: 0.04
Nodes (8): AuxiliaryNativeTitlebarPart, AuxiliaryTitlebarPart, MainNativeTitlebarPart, MainTitlebarPart, NativeTitlebarPart, NativeTitleService, TitlebarPart, TitleService

### Community 4 - "Changes & Diff View"
Cohesion: 0.06
Nodes (10): AllChangesAction, ChangesTreeDelegate, ChangesTreeRenderer, ChangesViewModel, ChangesViewPane, ChangesViewPaneContainer, isChangesFileItem(), LastTurnChangesAction (+2 more)

### Community 5 - "Agent Feedback Widget"
Cohesion: 0.08
Nodes (2): AgentFeedbackEditorWidget, AgentFeedbackEditorWidgetContribution

### Community 6 - "AI Customization Tree"
Cohesion: 0.06
Nodes (6): AICustomizationCategoryRenderer, AICustomizationFileRenderer, AICustomizationGroupRenderer, AICustomizationTreeDelegate, AICustomizationViewPane, UnifiedAICustomizationDataSource

### Community 7 - "AI Customization Tests"
Cohesion: 0.08
Nodes (37): AgenticPromptsService (Sessions Override), Built-in Prompts (vs/sessions/prompts/), Customization Count Consistency (customizationCounts.ts), AI Customizations Debug Panel (4-stage pipeline), AI Customizations Design Document, Claude Harness, CLI Harness (Copilot CLI), ICustomizationHarnessService (+29 more)

### Community 8 - "File Tree View"
Cohesion: 0.08
Nodes (6): FileTreeCompressionDelegate, FileTreeDataSource, FileTreeDelegate, FileTreeRenderer, FileTreeViewPane, FileTreeViewPaneContainer

### Community 9 - "Feedback Editor Input"
Cohesion: 0.11
Nodes (2): AgentFeedbackEditorInputContribution, AgentFeedbackInputWidget

### Community 10 - "CI Status Widget"
Cohesion: 0.09
Nodes (8): CICheckListDelegate, CICheckListRenderer, CIStatusWidget, getCheckCounts(), getCheckIcon(), getChecksSummary(), getCheckStatusClass(), getHeaderIconAndClass()

### Community 11 - "Web Tests"
Cohesion: 0.09
Nodes (6): MockChatAgentContribution, MockChatEntitlementService, MockDefaultAccountService, MockGitService, registerMockFileSystemProvider(), TestSessionsBrowserMain

### Community 12 - "Code Review Service"
Cohesion: 0.11
Nodes (4): CodeReviewService, isRawCodeReviewRangeTuple(), isRawCodeReviewRangeWithPositions(), normalizeCodeReviewRange()

### Community 13 - "Workspace Picker"
Cohesion: 0.16
Nodes (1): WorkspacePicker

### Community 14 - "Sessions Management"
Cohesion: 0.14
Nodes (1): SessionsManagementService

### Community 15 - "Community 15"
Cohesion: 0.11
Nodes (2): ConfigurationEditing, ConfigurationService

### Community 16 - "Community 16"
Cohesion: 0.12
Nodes (7): ChevronActionWidgetDropdown, getPrimaryTask(), getTaskCommandPreview(), getTaskDisplayLabel(), RunScriptActionViewItem, RunScriptContribution, RunScriptNotAvailableAction

### Community 17 - "Community 17"
Cohesion: 0.15
Nodes (1): ProjectBarPart

### Community 18 - "Community 18"
Cohesion: 0.13
Nodes (2): IsolationPicker, SessionTypePicker

### Community 19 - "Community 19"
Cohesion: 0.15
Nodes (3): AgenticPromptFilesLocator, AgenticPromptsService, sanitizeSkillText()

### Community 20 - "Community 20"
Cohesion: 0.13
Nodes (22): Letterpress Sessions Dark SVG (hexagonal product icon, dark theme), Letterpress Sessions Light SVG (hexagonal product icon, light theme), Account Widget (Sidebar Footer), Agent Sessions Workbench Layout Specification, SerializableGrid Layout Tree, Modal Editor Part (workbench.editor.useModal), SessionsTitleBarWidget, Sessions Titlebar Part (+14 more)

### Community 21 - "Community 21"
Cohesion: 0.2
Nodes (1): SessionsConfigurationService

### Community 22 - "Community 22"
Cohesion: 0.15
Nodes (5): DumpTerminalTrackingAction, getSessionCwd(), OpenSessionInTerminalAction, SessionsTerminalContribution, ShowAllTerminalsAction

### Community 23 - "Community 23"
Cohesion: 0.11
Nodes (5): AgentFeedbackHover, FeedbackCommentRenderer, FeedbackFileRenderer, FeedbackTreeDelegate, isFeedbackFileElement()

### Community 24 - "Community 24"
Cohesion: 0.16
Nodes (1): NewChatContextAttachments

### Community 25 - "Community 25"
Cohesion: 0.13
Nodes (1): SidebarPart

### Community 26 - "Community 26"
Cohesion: 0.15
Nodes (1): AgentFeedbackService

### Community 27 - "Community 27"
Cohesion: 0.18
Nodes (1): GitHubFileSystemProvider

### Community 28 - "Community 28"
Cohesion: 0.13
Nodes (1): SessionsWorkspaceContextService

### Community 29 - "Community 29"
Cohesion: 0.12
Nodes (3): createTerminal(), makeTerminalInstance(), TestLogService

### Community 30 - "Community 30"
Cohesion: 0.15
Nodes (2): AccountWidget, AccountWidgetContribution

### Community 31 - "Community 31"
Cohesion: 0.17
Nodes (2): AgenticSessionsViewPane, run()

### Community 32 - "Community 32"
Cohesion: 0.21
Nodes (1): AgenticPaneCompositePartService

### Community 33 - "Community 33"
Cohesion: 0.2
Nodes (1): FolderPicker

### Community 34 - "Community 34"
Cohesion: 0.14
Nodes (4): AgentFeedbackActionViewItem, AgentFeedbackEditorOverlay, AgentFeedbackOverlayController, AgentFeedbackOverlayWidget

### Community 35 - "Community 35"
Cohesion: 0.13
Nodes (5): ClearAllFeedbackAction, NavigateFeedbackAction, run(), SubmitActiveSessionFeedbackAction, SubmitFeedbackAction

### Community 36 - "Community 36"
Cohesion: 0.15
Nodes (5): makeComment(), makeThread(), MockCIFetcher, MockPRFetcher, MockRepositoryFetcher

### Community 37 - "Community 37"
Cohesion: 0.13
Nodes (0): 

### Community 38 - "Community 38"
Cohesion: 0.13
Nodes (2): MockAgentSessionsService, MockCommandService

### Community 39 - "Community 39"
Cohesion: 0.15
Nodes (5): createMockPromptsService(), createMockPromptsServiceWithCounts(), FixtureActionViewItemService, FixtureMenuService, renderWidget()

### Community 40 - "Community 40"
Cohesion: 0.17
Nodes (2): SessionsTitleBarContribution, SessionsTitleBarWidget

### Community 41 - "Community 41"
Cohesion: 0.22
Nodes (5): e(), GitHubPRFetcher, mapPullRequest(), mapReviewComment(), mapUser()

### Community 42 - "Community 42"
Cohesion: 0.15
Nodes (1): AuxiliaryBarPart

### Community 43 - "Community 43"
Cohesion: 0.19
Nodes (1): SessionsAICustomizationWorkspaceService

### Community 44 - "Community 44"
Cohesion: 0.23
Nodes (1): RepoPicker

### Community 45 - "Community 45"
Cohesion: 0.21
Nodes (2): ConnectionState, RemoteAgentHostContribution

### Community 46 - "Community 46"
Cohesion: 0.18
Nodes (1): GitHubPullRequestModel

### Community 47 - "Community 47"
Cohesion: 0.25
Nodes (2): main(), SessionsMain

### Community 48 - "Community 48"
Cohesion: 0.23
Nodes (1): BranchPicker

### Community 49 - "Community 49"
Cohesion: 0.23
Nodes (1): SlashCommandHandler

### Community 50 - "Community 50"
Cohesion: 0.23
Nodes (2): SessionsWelcomeContribution, SessionsWelcomeOverlay

### Community 51 - "Community 51"
Cohesion: 0.23
Nodes (6): createAgentFeedbackContext(), getCodeSelection(), getContainingDiffEditor(), getDiffHunks(), getModelForResource(), groupChanges()

### Community 52 - "Community 52"
Cohesion: 0.17
Nodes (0): 

### Community 53 - "Community 53"
Cohesion: 0.24
Nodes (1): CloudModelPicker

### Community 54 - "Community 54"
Cohesion: 0.26
Nodes (1): ModePicker

### Community 55 - "Community 55"
Cohesion: 0.17
Nodes (1): PanelPart

### Community 56 - "Community 56"
Cohesion: 0.25
Nodes (7): ActiveSessionFailedCIChecksContextContribution, buildFixChecksPrompt(), FixCIChecksAction, getCheckGroup(), getCheckStateLabel(), getFailedChecks(), isFailedConclusion()

### Community 57 - "Community 57"
Cohesion: 0.24
Nodes (3): ChangesTitleBarActionViewItem, ChangesTitleBarContribution, run()

### Community 58 - "Community 58"
Cohesion: 0.2
Nodes (3): makeGraphQLReviewComment(), makeGraphQLReviewThread(), MockApiClient

### Community 59 - "Community 59"
Cohesion: 0.33
Nodes (1): SyncIndicator

### Community 60 - "Community 60"
Cohesion: 0.31
Nodes (1): UpdateHoverWidget

### Community 61 - "Community 61"
Cohesion: 0.29
Nodes (5): e(), GitHubPRCIFetcher, mapCheckConclusion(), mapCheckRun(), mapCheckStatus()

### Community 62 - "Community 62"
Cohesion: 0.2
Nodes (3): TogglePanelVisibilityAction, ToggleSecondarySidebarVisibilityAction, ToggleSidebarVisibilityAction

### Community 63 - "Community 63"
Cohesion: 0.2
Nodes (1): ChatBarPart

### Community 64 - "Community 64"
Cohesion: 0.33
Nodes (7): fileUriFromPath(), load(), onUnexpectedError(), registerDeveloperKeybindings(), setupCSSImportMaps(), setupDeveloperKeybindings(), setupNLS()

### Community 65 - "Community 65"
Cohesion: 0.33
Nodes (1): AICustomizationOverviewView

### Community 66 - "Community 66"
Cohesion: 0.22
Nodes (3): NewChatInSessionsWindowAction, OpenSessionWorktreeInVSCodeAction, RegisterChatViewContainerContribution

### Community 67 - "Community 67"
Cohesion: 0.28
Nodes (1): NewChatPermissionPicker

### Community 68 - "Community 68"
Cohesion: 0.22
Nodes (1): MockChatEntitlementService

### Community 69 - "Community 69"
Cohesion: 0.36
Nodes (7): createFeedbackComment(), createMockAgentFeedbackService(), createMockCodeReviewService(), createPRReviewComment(), createRange(), ensureTokenColorMap(), renderWidget()

### Community 70 - "Community 70"
Cohesion: 0.31
Nodes (4): getCodeReviewComments(), getPRReviewComments(), getSessionEditorComments(), toSessionEditorCommentId()

### Community 71 - "Community 71"
Cohesion: 0.22
Nodes (0): 

### Community 72 - "Community 72"
Cohesion: 0.28
Nodes (2): CustomizationLinkViewItem, CustomizationsToolbarContribution

### Community 73 - "Community 73"
Cohesion: 0.28
Nodes (3): GitHubApiClient, GitHubApiError, parseRateLimitHeader()

### Community 74 - "Community 74"
Cohesion: 0.25
Nodes (1): GitHubPullRequestCIModel

### Community 75 - "Community 75"
Cohesion: 0.25
Nodes (9): E2E Data Flow (ChatWidget → ChatService → MockAgent → ChatEditingService), E2E Generate Phase (LLM-powered scenario compilation), E2E Minimal Mock Architecture, mock-fs:// InMemoryFileSystemProvider, Agent Sessions E2E Tests (compile-and-replay architecture), E2E Test Phase (deterministic replay), E2E Scenario 05: Full Workflow, E2E Scenario 04: Navigate Between Sessions (+1 more)

### Community 76 - "Community 76"
Cohesion: 0.39
Nodes (1): CustomizationsDebugLogContribution

### Community 77 - "Community 77"
Cohesion: 0.25
Nodes (1): FixtureMenuService

### Community 78 - "Community 78"
Cohesion: 0.43
Nodes (1): RunScriptCustomTaskWidget

### Community 79 - "Community 79"
Cohesion: 0.43
Nodes (1): WorkspaceFolderManagementContribution

### Community 80 - "Community 80"
Cohesion: 0.29
Nodes (1): SessionWorkspace

### Community 81 - "Community 81"
Cohesion: 0.33
Nodes (1): NullInlineChatSessionService

### Community 82 - "Community 82"
Cohesion: 0.33
Nodes (2): ChangesViewActionsContribution, OpenChangesViewAction

### Community 83 - "Community 83"
Cohesion: 0.4
Nodes (1): AgentFeedbackAttachmentContribution

### Community 84 - "Community 84"
Cohesion: 0.47
Nodes (1): AgentFeedbackOverviewRulerContribution

### Community 85 - "Community 85"
Cohesion: 0.33
Nodes (2): ApplyChangesToParentRepoAction, ApplyChangesToParentRepoContribution

### Community 86 - "Community 86"
Cohesion: 0.6
Nodes (5): pickFolderOnRemote(), pickRemoteAgentHostFolder(), promptForRemoteAddress(), promptForRemoteName(), promptToAddRemoteAgentHost()

### Community 87 - "Community 87"
Cohesion: 0.33
Nodes (1): GitHubService

### Community 88 - "Community 88"
Cohesion: 0.4
Nodes (2): ActiveSessionFeedbackContextContribution, AgentFeedbackAttachmentWidgetContribution

### Community 89 - "Community 89"
Cohesion: 0.4
Nodes (1): RegisterFilesViewContribution

### Community 90 - "Community 90"
Cohesion: 0.83
Nodes (3): activate(), registerMockAuth(), registerMockCommands()

### Community 91 - "Community 91"
Cohesion: 0.67
Nodes (2): extractURI(), run()

### Community 92 - "Community 92"
Cohesion: 0.67
Nodes (1): RegisterChatDebugViewContribution

### Community 93 - "Community 93"
Cohesion: 0.5
Nodes (1): BranchChatSessionAction

### Community 94 - "Community 94"
Cohesion: 0.5
Nodes (1): ChangesViewController

### Community 95 - "Community 95"
Cohesion: 0.5
Nodes (1): CodeReviewToolbarContribution

### Community 96 - "Community 96"
Cohesion: 0.67
Nodes (1): AICustomizationShortcutsWidget

### Community 97 - "Community 97"
Cohesion: 0.5
Nodes (0): 

### Community 98 - "Community 98"
Cohesion: 0.83
Nodes (3): createMockDefaultAccountService(), createMockUpdateService(), renderAccountWidget()

### Community 99 - "Community 99"
Cohesion: 0.5
Nodes (1): GitHubRepositoryFetcher

### Community 100 - "Community 100"
Cohesion: 0.5
Nodes (1): GitHubRepositoryModel

### Community 101 - "Community 101"
Cohesion: 0.67
Nodes (0): 

### Community 102 - "Community 102"
Cohesion: 0.67
Nodes (1): SessionsCustomizationHarnessService

### Community 103 - "Community 103"
Cohesion: 0.67
Nodes (0): 

### Community 104 - "Community 104"
Cohesion: 0.67
Nodes (1): AgentFeedbackAttachmentWidget

### Community 105 - "Community 105"
Cohesion: 0.67
Nodes (1): GitHubFileSystemProviderContribution

### Community 106 - "Community 106"
Cohesion: 0.67
Nodes (0): 

### Community 107 - "Community 107"
Cohesion: 0.67
Nodes (1): RegisterLogsViewContainerContribution

### Community 108 - "Community 108"
Cohesion: 1.0
Nodes (2): createMockUpdateService(), renderHoverWidget()

### Community 109 - "Community 109"
Cohesion: 0.67
Nodes (1): GitHubActiveSessionRefreshContribution

### Community 110 - "Community 110"
Cohesion: 0.67
Nodes (1): SessionsBrowserMain

### Community 111 - "Community 111"
Cohesion: 1.0
Nodes (0): 

### Community 112 - "Community 112"
Cohesion: 1.0
Nodes (0): 

### Community 113 - "Community 113"
Cohesion: 1.0
Nodes (0): 

### Community 114 - "Community 114"
Cohesion: 1.0
Nodes (0): 

### Community 115 - "Community 115"
Cohesion: 1.0
Nodes (0): 

### Community 116 - "Community 116"
Cohesion: 1.0
Nodes (0): 

### Community 117 - "Community 117"
Cohesion: 1.0
Nodes (0): 

### Community 118 - "Community 118"
Cohesion: 1.0
Nodes (0): 

### Community 119 - "Community 119"
Cohesion: 1.0
Nodes (0): 

### Community 120 - "Community 120"
Cohesion: 1.0
Nodes (0): 

### Community 121 - "Community 121"
Cohesion: 1.0
Nodes (0): 

### Community 122 - "Community 122"
Cohesion: 1.0
Nodes (0): 

### Community 123 - "Community 123"
Cohesion: 1.0
Nodes (0): 

### Community 124 - "Community 124"
Cohesion: 1.0
Nodes (0): 

### Community 125 - "Community 125"
Cohesion: 1.0
Nodes (0): 

### Community 126 - "Community 126"
Cohesion: 1.0
Nodes (0): 

### Community 127 - "Community 127"
Cohesion: 1.0
Nodes (0): 

### Community 128 - "Community 128"
Cohesion: 1.0
Nodes (0): 

### Community 129 - "Community 129"
Cohesion: 1.0
Nodes (0): 

### Community 130 - "Community 130"
Cohesion: 1.0
Nodes (0): 

### Community 131 - "Community 131"
Cohesion: 1.0
Nodes (0): 

### Community 132 - "Community 132"
Cohesion: 1.0
Nodes (0): 

### Community 133 - "Community 133"
Cohesion: 1.0
Nodes (0): 

### Community 134 - "Community 134"
Cohesion: 1.0
Nodes (0): 

### Community 135 - "Community 135"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **21 isolated node(s):** `vs/sessions Layering Constraint (no reverse imports)`, `Agentic Workbench Class`, `Sessions Contrib Structure`, `SerializableGrid Layout Tree`, `Modal Editor Part (workbench.editor.useModal)` (+16 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 111`** (2 nodes): `web.test.factory.ts`, `create()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 112`** (2 nodes): `sessionEditorComments.test.ts`, `reviewState()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 113`** (2 nodes): `githubService.test.ts`, `makeSession()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 114`** (2 nodes): `web.factory.ts`, `create()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 115`** (1 nodes): `sessions.web.main.internal.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 116`** (1 nodes): `sessions.web.main.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 117`** (1 nodes): `sessions.common.main.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 118`** (1 nodes): `sessions.desktop.main.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 119`** (1 nodes): `sessions.web.test.internal.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 120`** (1 nodes): `layoutActions.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 121`** (1 nodes): `aiCustomizationTreeView.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 122`** (1 nodes): `configuration.contribution.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 123`** (1 nodes): `builtinPromptsStorage.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 124`** (1 nodes): `changesView.contribution.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 125`** (1 nodes): `changes.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 126`** (1 nodes): `workspace.contribution.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 127`** (1 nodes): `sessionWorkspace.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 128`** (1 nodes): `types.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 129`** (1 nodes): `menus.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 130`** (1 nodes): `parts.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 131`** (1 nodes): `categories.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 132`** (1 nodes): `theme.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 133`** (1 nodes): `contextkeys.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 134`** (1 nodes): `configurationService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 135`** (1 nodes): `titleService.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AI Customizations Design Document` connect `AI Customization Tests` to `Community 20`?**
  _High betweenness centrality (0.001) - this node is a cross-community bridge._
- **What connects `vs/sessions Layering Constraint (no reverse imports)`, `Agentic Workbench Class`, `Sessions Contrib Structure` to the rest of the system?**
  _21 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Workbench Layout` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._
- **Should `New Session Creation` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._
- **Should `Chat View Pane` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `Titlebar` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._
- **Should `Changes & Diff View` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._