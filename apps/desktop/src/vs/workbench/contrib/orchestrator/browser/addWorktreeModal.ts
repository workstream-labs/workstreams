/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, DragAndDropObserver, EventType } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';
import { validateWorktreeName } from '../../../browser/parts/orchestrator/orchestratorService.js';

export interface DroppedImage {
	readonly name: string;
	readonly data: Uint8Array;
	readonly mimeType: string;
}

export interface AddWorktreeResult {
	readonly name: string;
	readonly featureName: string;
	readonly prompt: string;
	readonly agent: string;
	readonly baseBranch: string;
	readonly images: DroppedImage[];
}

export interface AgentOption {
	readonly id: string;
	readonly label: string;
	readonly icon: ThemeIcon;
}

export interface AddWorktreeModalOptions {
	readonly branches: string[];
	readonly agents: AgentOption[];
	readonly defaultBranch: string;
	readonly defaultAgent: string;
	readonly agentCommands: Record<string, string>;
	readonly onAgentCommandChange?: (agentId: string, command: string) => void;
}

export const TERMINAL_AGENT_ID = 'terminal';

const KNOWN_AGENTS: ReadonlyMap<string, AgentOption> = new Map([
	['claude', { id: 'claude', label: 'Claude', icon: Codicon.claude }],
	['codex', { id: 'codex', label: 'Codex', icon: Codicon.openai }],
	['terminal', { id: 'terminal', label: 'Terminal', icon: Codicon.terminal }],
]);

export function agentsFromIds(ids: string[]): AgentOption[] {
	const result: AgentOption[] = [];
	for (const id of ids) {
		const opt = KNOWN_AGENTS.get(id);
		if (opt) {
			result.push(opt);
		}
	}
	return result;
}

export function showAddWorktreeModal(options: AddWorktreeModalOptions): Promise<AddWorktreeResult | undefined> {
	return new Promise(resolve => {
		const disposables = new DisposableStore();
		let selectedAgent = options.defaultAgent;
		let selectedBranch = options.defaultBranch;
		let activeDropdown: HTMLElement | null = null;

		// --- Overlay ---
		const overlay = document.createElement('div');
		overlay.className = 'add-worktree-overlay';

		const modal = document.createElement('div');
		modal.className = 'add-worktree-modal';
		overlay.appendChild(modal);

		// --- Card container ---
		const card = document.createElement('div');
		card.className = 'add-worktree-card';
		modal.appendChild(card);

		// --- Preset panel (created early, appended to agentContainer later) ---
		const presetPanel = document.createElement('div');
		presetPanel.className = 'add-worktree-preset-panel';
		disposables.add(addDisposableListener(presetPanel, EventType.CLICK, (e) => {
			e.stopPropagation();
		}));

		let activePresetAgent: string | null = null;
		const presetDisposables = new DisposableStore();
		disposables.add(presetDisposables);

		function showPresetPanel(agentId: string): void {
			const agent = options.agents.find(a => a.id === agentId);
			if (!agent) {
				return;
			}

			presetDisposables.clear();
			presetPanel.textContent = '';
			activePresetAgent = agentId;

			const header = document.createElement('div');
			header.className = 'add-worktree-preset-header';

			const iconEl = document.createElement('span');
			iconEl.className = `add-worktree-preset-icon codicon ${ThemeIcon.asClassName(agent.icon)}`;
			header.appendChild(iconEl);

			const titleEl = document.createElement('span');
			titleEl.className = 'add-worktree-preset-title';
			titleEl.textContent = agent.label;
			header.appendChild(titleEl);

			const closeBtn = document.createElement('span');
			closeBtn.className = 'add-worktree-preset-close codicon codicon-close';
			closeBtn.title = localize('closePresets', "Close");
			header.appendChild(closeBtn);

			presetPanel.appendChild(header);

			const labelEl = document.createElement('label');
			labelEl.className = 'add-worktree-preset-label';
			labelEl.textContent = localize('command', "Command");
			presetPanel.appendChild(labelEl);

			const commandInput = document.createElement('input');
			commandInput.type = 'text';
			commandInput.className = 'add-worktree-preset-input';
			commandInput.value = options.agentCommands[agentId] || agentId;
			commandInput.spellcheck = false;
			commandInput.autocomplete = 'off';
			commandInput.placeholder = agentId;
			presetPanel.appendChild(commandInput);

			const descEl = document.createElement('div');
			descEl.className = 'add-worktree-preset-desc';
			descEl.textContent = localize('commandDesc', "Command to execute in terminal");
			presetPanel.appendChild(descEl);

			presetDisposables.add(addDisposableListener(commandInput, EventType.INPUT, () => {
				const value = commandInput.value.trim();
				if (value) {
					options.agentCommands[agentId] = value;
					options.onAgentCommandChange?.(agentId, value);
				}
			}));

			presetDisposables.add(addDisposableListener(commandInput, EventType.KEY_DOWN, (e: KeyboardEvent) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					e.stopPropagation();
					commandInput.blur();
				}
			}));

			presetDisposables.add(addDisposableListener(closeBtn, EventType.CLICK, (e) => {
				e.stopPropagation();
				hidePresetPanel();
			}));

			presetPanel.classList.add('visible');
			commandInput.focus();
			commandInput.select();
		}

		function hidePresetPanel(): void {
			presetPanel.classList.remove('visible');
			activePresetAgent = null;
		}

		// --- Name input row (input + branch preview on same line) ---
		const nameRow = document.createElement('div');
		nameRow.className = 'add-worktree-name-row';
		card.appendChild(nameRow);

		const nameInput = document.createElement('input');
		nameInput.type = 'text';
		nameInput.className = 'add-worktree-name-input';
		nameInput.placeholder = localize('featureName', "Feature name *");
		nameInput.spellcheck = false;
		nameInput.autocomplete = 'off';
		nameRow.appendChild(nameInput);

		const branchInput = document.createElement('input');
		branchInput.type = 'text';
		branchInput.className = 'add-worktree-branch-input';
		branchInput.placeholder = localize('branchName', "branch-name *");
		branchInput.spellcheck = false;
		branchInput.autocomplete = 'off';
		nameRow.appendChild(branchInput);

		// --- Validation message ---
		const validationMsg = document.createElement('div');
		validationMsg.className = 'add-worktree-validation';
		card.appendChild(validationMsg);

		// --- Separator ---
		const separator = document.createElement('div');
		separator.className = 'add-worktree-separator';
		card.appendChild(separator);

		// --- Prompt textarea ---
		const hasAgents = options.agents.length > 0;
		const textarea = document.createElement('textarea');
		textarea.className = 'add-worktree-prompt';
		textarea.placeholder = localize('whatToDo', "What do you want to do?");
		textarea.rows = 4;
		if (!hasAgents) {
			textarea.disabled = true;
			textarea.classList.add('disabled');
		}
		card.appendChild(textarea);

		// --- Image attachments ---
		const droppedImages: DroppedImage[] = [];

		const imageStrip = document.createElement('div');
		imageStrip.className = 'add-worktree-image-strip';
		card.appendChild(imageStrip);

		function addImageToStrip(image: DroppedImage): void {
			droppedImages.push(image);

			const thumb = document.createElement('div');
			thumb.className = 'add-worktree-image-thumb';

			const img = document.createElement('img');
			const blob = new Blob([new Uint8Array(image.data)], { type: image.mimeType });
			img.src = URL.createObjectURL(blob);
			img.alt = image.name;
			disposables.add({ dispose: () => URL.revokeObjectURL(img.src) });
			thumb.appendChild(img);

			const nameLabel = document.createElement('span');
			nameLabel.className = 'add-worktree-image-name';
			nameLabel.textContent = image.name;
			nameLabel.title = image.name;
			thumb.appendChild(nameLabel);

			const removeBtn = document.createElement('span');
			removeBtn.className = 'add-worktree-image-remove codicon codicon-close';
			removeBtn.title = localize('removeImage', "Remove image");
			thumb.appendChild(removeBtn);

			disposables.add(addDisposableListener(removeBtn, EventType.CLICK, (e) => {
				e.stopPropagation();
				const idx = droppedImages.indexOf(image);
				if (idx >= 0) {
					droppedImages.splice(idx, 1);
				}
				thumb.remove();
				if (droppedImages.length === 0) {
					imageStrip.classList.remove('has-images');
				}
			}));

			imageStrip.appendChild(thumb);
			imageStrip.classList.add('has-images');
		}

		// --- Drop overlay ---
		const dropOverlay = document.createElement('div');
		dropOverlay.className = 'add-worktree-drop-overlay';
		dropOverlay.textContent = localize('dropImages', "Drop images here");
		card.appendChild(dropOverlay);

		// --- Drag and drop ---
		const SUPPORTED_IMAGE_TYPES = new Set([
			'image/png', 'image/jpeg', 'image/jpg', 'image/gif',
			'image/webp', 'image/bmp', 'image/tiff',
		]);

		function containsImageFiles(e: DragEvent): boolean {
			if (!e.dataTransfer) {
				return false;
			}
			const items = e.dataTransfer.items;
			if (items && items.length > 0) {
				return Array.from(items).some(item =>
					item.kind === 'file' && SUPPORTED_IMAGE_TYPES.has(item.type)
				);
			}
			return false;
		}

		disposables.add(new DragAndDropObserver(card, {
			onDragOver: (e) => {
				if (containsImageFiles(e)) {
					e.preventDefault();
					e.stopPropagation();
					if (e.dataTransfer) {
						e.dataTransfer.dropEffect = 'copy';
					}
					dropOverlay.classList.add('visible');
				}
			},
			onDragLeave: () => {
				dropOverlay.classList.remove('visible');
			},
			onDrop: (e) => {
				dropOverlay.classList.remove('visible');
				if (!e.dataTransfer?.files) {
					return;
				}
				e.preventDefault();
				e.stopPropagation();

				const files = Array.from(e.dataTransfer.files).filter(
					f => SUPPORTED_IMAGE_TYPES.has(f.type)
				);
				for (const file of files) {
					file.arrayBuffer().then(buffer => {
						addImageToStrip({
							name: file.name,
							data: new Uint8Array(buffer),
							mimeType: file.type,
						});
					});
				}
			},
		}));

		// --- Also support paste ---
		disposables.add(addDisposableListener(overlay, EventType.PASTE, (e: ClipboardEvent) => {
			const items = e.clipboardData?.items;
			if (!items) {
				return;
			}
			for (const item of Array.from(items)) {
				if (item.kind === 'file' && SUPPORTED_IMAGE_TYPES.has(item.type)) {
					const file = item.getAsFile();
					if (file) {
						e.preventDefault();
						file.arrayBuffer().then(buffer => {
							addImageToStrip({
								name: file.name || localize('pastedImage', "pasted-image.png"),
								data: new Uint8Array(buffer),
								mimeType: file.type,
							});
						});
					}
				}
			}
		}));

		// --- Footer (inside card) ---
		const footer = document.createElement('div');
		footer.className = 'add-worktree-footer';
		card.appendChild(footer);

		const footerLeft = document.createElement('div');
		footerLeft.className = 'add-worktree-footer-left';
		footer.appendChild(footerLeft);

		const footerRight = document.createElement('div');
		footerRight.className = 'add-worktree-footer-right';
		footer.appendChild(footerRight);

		// --- Agent selector ---
		const agentContainer = document.createElement('div');
		agentContainer.className = 'add-worktree-select-container';
		footerLeft.appendChild(agentContainer);

		const agentBtn = document.createElement('button');
		agentBtn.className = 'add-worktree-select-btn';
		agentBtn.type = 'button';
		agentContainer.appendChild(agentBtn);
		agentContainer.appendChild(presetPanel);

		function updateAgentButton(): void {
			agentBtn.textContent = '';
			if (!hasAgents) {
				const icon = document.createElement('span');
				icon.className = `add-worktree-agent-icon codicon ${ThemeIcon.asClassName(Codicon.agent)}`;
				agentBtn.appendChild(icon);
				const label = document.createElement('span');
				label.className = 'add-worktree-no-agent-label';
				label.textContent = localize('noAgents', "No agents found");
				agentBtn.appendChild(label);
				agentBtn.disabled = true;
				agentBtn.classList.add('disabled');
				return;
			}
			const opt = options.agents.find(a => a.id === selectedAgent) || options.agents[0];
			const icon = document.createElement('span');
			icon.className = `add-worktree-agent-icon codicon ${ThemeIcon.asClassName(opt.icon)}`;
			agentBtn.appendChild(icon);
			const label = document.createElement('span');
			label.textContent = opt.label;
			agentBtn.appendChild(label);
			const arrow = document.createElement('span');
			arrow.className = 'add-worktree-select-arrow';
			arrow.textContent = '\u25BE'; // ▾
			agentBtn.appendChild(arrow);
		}
		updateAgentButton();

		// --- Branch selector ---
		const branchContainer = document.createElement('div');
		branchContainer.className = 'add-worktree-select-container';
		footerLeft.appendChild(branchContainer);

		const branchBtn = document.createElement('button');
		branchBtn.className = 'add-worktree-select-btn';
		branchBtn.type = 'button';
		branchContainer.appendChild(branchBtn);

		function updateBranchButton(): void {
			branchBtn.textContent = '';
			const icon = document.createElement('span');
			icon.className = 'icon-git-branch-png';
			branchBtn.appendChild(icon);
			const label = document.createElement('span');
			label.textContent = selectedBranch;
			branchBtn.appendChild(label);
			const arrow = document.createElement('span');
			arrow.className = 'add-worktree-select-arrow';
			arrow.textContent = '\u25BE'; // ▾
			branchBtn.appendChild(arrow);
		}
		updateBranchButton();

		// --- Submit hint ---
		const hint = document.createElement('span');
		hint.className = 'add-worktree-hint';
		hint.textContent = isMacintosh
			? localize('submitHintMac', "\u2318\u21A9 to create")
			: localize('submitHintOther', "Ctrl+Enter to create");
		footerRight.appendChild(hint);

		// --- Dropdown helper ---
		interface DropdownItem {
			id: string;
			label: string;
			icon?: ThemeIcon;
			selected: boolean;
			hasSettings?: boolean;
		}

		function showDropdown(container: HTMLElement, items: DropdownItem[], onSelect: (id: string) => void, onSettings?: (id: string) => void): void {
			closeActiveDropdown();

			const menu = document.createElement('div');
			menu.className = 'add-worktree-dropdown';
			menu.style.width = '200px';

			for (const item of items) {
				const option = document.createElement('div');
				option.className = 'add-worktree-dropdown-item';
				if (item.selected) {
					option.classList.add('selected');
				}
				if (item.icon) {
					const iconEl = document.createElement('span');
					iconEl.className = `add-worktree-dropdown-icon codicon ${ThemeIcon.asClassName(item.icon)}`;
					option.appendChild(iconEl);
					const labelEl = document.createElement('span');
					labelEl.textContent = item.label;
					option.appendChild(labelEl);
				} else {
					option.textContent = item.label;
				}

				if (item.hasSettings) {
					const spacer = document.createElement('span');
					spacer.className = 'add-worktree-dropdown-spacer';
					option.appendChild(spacer);

					const settingsIcon = document.createElement('span');
					settingsIcon.className = 'add-worktree-dropdown-settings codicon codicon-settings';
					settingsIcon.title = localize('agentPresets', "Agent presets");
					option.appendChild(settingsIcon);

					disposables.add(addDisposableListener(settingsIcon, EventType.CLICK, (e) => {
						e.stopPropagation();
						onSettings?.(item.id);
					}));
				}

				disposables.add(addDisposableListener(option, EventType.CLICK, (e) => {
					e.stopPropagation();
					onSelect(item.id);
					closeActiveDropdown();
				}));
				menu.appendChild(option);
			}

			container.appendChild(menu);
			activeDropdown = menu;
		}

		function closeActiveDropdown(): void {
			if (activeDropdown) {
				activeDropdown.remove();
				activeDropdown = null;
			}
			hidePresetPanel();
		}

		// --- Agent dropdown ---
		disposables.add(addDisposableListener(agentBtn, EventType.CLICK, (e) => {
			e.stopPropagation();
			if (activeDropdown?.parentElement === agentContainer) {
				closeActiveDropdown();
				return;
			}
			showDropdown(
				agentContainer,
				options.agents.map(a => ({ id: a.id, label: a.label, icon: a.icon, selected: a.id === selectedAgent, hasSettings: a.id !== 'terminal' })),
				(id) => { selectedAgent = id; updateAgentButton(); },
				(agentId) => {
				if (activePresetAgent === agentId) {
					hidePresetPanel();
				} else {
					showPresetPanel(agentId);
				}
			}
			);
		}));

		// --- Branch dropdown ---
		disposables.add(addDisposableListener(branchBtn, EventType.CLICK, (e) => {
			e.stopPropagation();
			if (activeDropdown?.parentElement === branchContainer) {
				closeActiveDropdown();
				return;
			}
			showDropdown(
				branchContainer,
				options.branches.map(b => ({ id: b, label: b, selected: b === selectedBranch })),
				(id) => { selectedBranch = id; updateBranchButton(); }
			);
		}));

		// --- Readiness: update hint when required fields change ---
		function updateReadiness(): void {
			const ready = nameInput.value.trim().length > 0
				&& branchInput.value.trim().length > 0
				&& !validateWorktreeName(branchInput.value.trim());
			hint.classList.toggle('ready', ready);
		}

		disposables.add(addDisposableListener(nameInput, EventType.INPUT, updateReadiness));

		disposables.add(addDisposableListener(branchInput, EventType.INPUT, () => {
			const value = branchInput.value.trim();
			if (value) {
				const error = validateWorktreeName(value);
				validationMsg.textContent = error || '';
				validationMsg.style.display = error ? 'block' : 'none';
			} else {
				validationMsg.textContent = '';
				validationMsg.style.display = 'none';
			}
			updateReadiness();
		}));

		// --- Close on overlay backdrop click ---
		disposables.add(addDisposableListener(overlay, EventType.CLICK, (e) => {
			if (e.target === overlay) {
				close();
			}
		}));

		// --- Close dropdown on card click ---
		disposables.add(addDisposableListener(card, EventType.CLICK, () => {
			closeActiveDropdown();
		}));

		// --- Keyboard ---
		disposables.add(addDisposableListener(overlay, EventType.KEY_DOWN, (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				if (activeDropdown) {
					closeActiveDropdown();
				} else {
					close();
				}
			}
			if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				submit();
			}
		}));

		// --- Submit ---
		function submit(): void {
			const feature = nameInput.value.trim();
			if (!feature) {
				validationMsg.textContent = localize('featureRequired', "Feature name is required");
				validationMsg.style.display = 'block';
				nameInput.focus();
				return;
			}
			const branch = branchInput.value.trim();
			if (!branch) {
				validationMsg.textContent = localize('branchRequired', "Branch name is required");
				validationMsg.style.display = 'block';
				branchInput.focus();
				return;
			}
			const error = validateWorktreeName(branch);
			if (error) {
				validationMsg.textContent = error;
				validationMsg.style.display = 'block';
				branchInput.focus();
				return;
			}
			close({
				name: branch,
				featureName: feature,
				prompt: textarea.value.trim(),
				agent: selectedAgent,
				baseBranch: selectedBranch,
				images: [...droppedImages],
			});
		}

		function close(result?: AddWorktreeResult): void {
			overlay.remove();
			disposables.dispose();
			resolve(result);
		}

		// --- Mount & focus ---
		// Append inside .monaco-workbench so VS Code CSS variables resolve.
		// document.body doesn't have --vscode-* vars, making backgrounds transparent.
		const workbench = document.querySelector('.monaco-workbench') ?? document.body;
		workbench.appendChild(overlay);
		nameInput.focus();
	});
}
