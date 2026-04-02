/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, EventType } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';
import { validateWorktreeName } from '../../../browser/parts/orchestrator/orchestratorService.js';

export interface AddWorktreeResult {
	readonly name: string;
	readonly prompt: string;
	readonly agent: string;
	readonly baseBranch: string;
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
}

export const KNOWN_AGENTS: ReadonlyMap<string, AgentOption> = new Map([
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
		let activeDropdownTrigger: HTMLElement | null = null;

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

		// --- Name input row (input + branch preview on same line) ---
		const nameRow = document.createElement('div');
		nameRow.className = 'add-worktree-name-row';
		card.appendChild(nameRow);

		const nameInput = document.createElement('input');
		nameInput.type = 'text';
		nameInput.className = 'add-worktree-name-input';
		nameInput.placeholder = localize('workspaceName', "Workspace name");
		nameInput.spellcheck = false;
		nameInput.autocomplete = 'off';
		nameRow.appendChild(nameInput);

		const branchPreview = document.createElement('span');
		branchPreview.className = 'add-worktree-branch-preview';
		branchPreview.textContent = localize('branchName', "branch name");
		branchPreview.classList.add('placeholder');
		nameRow.appendChild(branchPreview);

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
			icon.className = 'codicon codicon-git-branch';
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

		// --- Dropdown helper (rendered on document.body to escape backdrop-filter) ---
		function showDropdown(trigger: HTMLElement, items: { id: string; label: string; icon?: ThemeIcon; selected: boolean }[], onSelect: (id: string) => void): void {
			closeActiveDropdown();

			const menu = document.createElement('div');
			menu.className = 'add-worktree-dropdown';

			// Position below the trigger button using fixed coords
			const rect = trigger.getBoundingClientRect();
			menu.style.position = 'fixed';
			menu.style.top = `${rect.bottom + 4}px`;
			menu.style.left = `${rect.left}px`;
			menu.style.minWidth = `${Math.max(rect.width, 150)}px`;

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
				disposables.add(addDisposableListener(option, EventType.CLICK, (e) => {
					e.stopPropagation();
					onSelect(item.id);
					closeActiveDropdown();
				}));
				menu.appendChild(option);
			}

			document.body.appendChild(menu);
			activeDropdown = menu;
		}

		function closeActiveDropdown(): void {
			if (activeDropdown) {
				activeDropdown.remove();
				activeDropdown = null;
				activeDropdownTrigger = null;
			}
		}

		// --- Agent dropdown ---
		disposables.add(addDisposableListener(agentBtn, EventType.CLICK, (e) => {
			e.stopPropagation();
			if (activeDropdownTrigger === agentBtn) {
				closeActiveDropdown();
				return;
			}
			showDropdown(
				agentBtn,
				options.agents.map(a => ({ id: a.id, label: a.label, icon: a.icon, selected: a.id === selectedAgent })),
				(id) => { selectedAgent = id; updateAgentButton(); }
			);
			activeDropdownTrigger = agentBtn;
		}));

		// --- Branch dropdown ---
		disposables.add(addDisposableListener(branchBtn, EventType.CLICK, (e) => {
			e.stopPropagation();
			if (activeDropdownTrigger === branchBtn) {
				closeActiveDropdown();
				return;
			}
			showDropdown(
				branchBtn,
				options.branches.map(b => ({ id: b, label: b, selected: b === selectedBranch })),
				(id) => { selectedBranch = id; updateBranchButton(); }
			);
			activeDropdownTrigger = branchBtn;
		}));

		// --- Name input → branch preview ---
		disposables.add(addDisposableListener(nameInput, EventType.INPUT, () => {
			const value = nameInput.value.trim();
			if (value) {
				branchPreview.textContent = value;
				branchPreview.classList.remove('placeholder');
			} else {
				branchPreview.textContent = localize('branchName', "branch name");
				branchPreview.classList.add('placeholder');
			}
			if (value) {
				const error = validateWorktreeName(value);
				validationMsg.textContent = error || '';
				validationMsg.style.display = error ? 'block' : 'none';
			} else {
				validationMsg.textContent = '';
				validationMsg.style.display = 'none';
			}
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
			const name = nameInput.value.trim();
			if (!name) {
				validationMsg.textContent = localize('nameRequired', "Name is required");
				validationMsg.style.display = 'block';
				nameInput.focus();
				return;
			}
			const error = validateWorktreeName(name);
			if (error) {
				validationMsg.textContent = error;
				validationMsg.style.display = 'block';
				nameInput.focus();
				return;
			}
			close({
				name,
				prompt: textarea.value.trim(),
				agent: selectedAgent,
				baseBranch: selectedBranch,
			});
		}

		function close(result?: AddWorktreeResult): void {
			overlay.remove();
			disposables.dispose();
			resolve(result);
		}

		// --- Mount & focus ---
		document.body.appendChild(overlay);
		nameInput.focus();
	});
}
