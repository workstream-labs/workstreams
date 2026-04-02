/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './askFeedback.css';
import { $, addDisposableListener, EventType } from '../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IsAuxiliaryWindowContext } from '../../../../workbench/common/contextkeys.js';

type FeedbackType = 'bug' | 'feature' | 'other';

interface IFeedbackResult {
	type: FeedbackType;
	text: string;
}

function showFeedbackDialog(container: HTMLElement): Promise<IFeedbackResult | undefined> {
	return new Promise(resolve => {
		const disposables = new DisposableStore();
		let resolved = false;

		const dismiss = (result?: IFeedbackResult) => {
			if (resolved) {
				return;
			}
			resolved = true;
			modalBlock.remove();
			disposables.dispose();
			resolve(result);
		};

		// Modal backdrop
		const modalBlock = container.appendChild($('.ask-feedback-modal-block'));
		disposables.add({ dispose: () => modalBlock.remove() });
		disposables.add(addDisposableListener(modalBlock, EventType.CLICK, e => {
			if (e.target === modalBlock) {
				dismiss();
			}
		}));

		// Dialog box
		const dialog = modalBlock.appendChild($('.ask-feedback-dialog'));
		dialog.setAttribute('role', 'dialog');
		dialog.setAttribute('aria-modal', 'true');
		dialog.setAttribute('aria-label', localize('feedbackDialog.ariaLabel', "Send Feedback"));

		// Title
		const title = dialog.appendChild($('.ask-feedback-title'));
		title.textContent = localize('feedbackDialog.title', "Send Feedback");

		// Feedback type
		const typeLabel = dialog.appendChild($('label.ask-feedback-label'));
		typeLabel.textContent = localize('feedbackDialog.typeLabel', "Type");
		typeLabel.setAttribute('for', 'ask-feedback-type');

		const typeSelect = dialog.appendChild($('select.ask-feedback-select')) as HTMLSelectElement;
		typeSelect.id = 'ask-feedback-type';
		for (const [value, label] of [
			['bug', localize('feedbackType.bug', "Bug")],
			['feature', localize('feedbackType.featureRequest', "Feature Request")],
			['other', localize('feedbackType.other', "Other")],
		] as const) {
			const option = document.createElement('option');
			option.value = value;
			option.textContent = label;
			typeSelect.appendChild(option);
		}

		// Feedback text
		const textLabel = dialog.appendChild($('label.ask-feedback-label'));
		textLabel.textContent = localize('feedbackDialog.textLabel', "Description");
		textLabel.setAttribute('for', 'ask-feedback-text');

		const textArea = dialog.appendChild($('textarea.ask-feedback-textarea')) as HTMLTextAreaElement;
		textArea.id = 'ask-feedback-text';
		textArea.placeholder = localize('feedbackDialog.placeholder', "Tell us what's on your mind...");
		textArea.rows = 5;

		// Buttons
		const buttonsRow = dialog.appendChild($('.ask-feedback-buttons'));

		const cancelButton = buttonsRow.appendChild($('button.ask-feedback-button.ask-feedback-button-cancel'));
		cancelButton.textContent = localize('feedbackDialog.cancel', "Cancel");
		disposables.add(addDisposableListener(cancelButton, EventType.CLICK, () => dismiss()));

		const submitButton = buttonsRow.appendChild($('button.ask-feedback-button.ask-feedback-button-submit'));
		submitButton.textContent = localize('feedbackDialog.submit', "Submit");
		disposables.add(addDisposableListener(submitButton, EventType.CLICK, () => {
			const text = textArea.value.trim();
			if (!text) {
				textArea.focus();
				return;
			}
			dismiss({ type: typeSelect.value as FeedbackType, text });
		}));

		// Keyboard handling
		disposables.add(addDisposableListener(dialog, EventType.KEY_DOWN, (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);
			if (event.keyCode === KeyCode.Escape) {
				dismiss();
			} else if (event.keyCode === KeyCode.Enter && event.ctrlKey) {
				const text = textArea.value.trim();
				if (text) {
					dismiss({ type: typeSelect.value as FeedbackType, text });
				}
			}
		}));

		// Focus the select initially
		typeSelect.focus();
	});
}

registerAction2(class AskFeedbackAction extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.askFeedback',
			title: localize2('askFeedback', "Send Feedback"),
			icon: Codicon.comment,
			menu: [{
				id: MenuId.LayoutControlMenu,
				group: '2_pane_toggles',
				order: -1, // Before Terminal (0)
				when: IsAuxiliaryWindowContext.negate(),
			}]
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const layoutService = accessor.get(ILayoutService);
		const notificationService = accessor.get(INotificationService);

		const result = await showFeedbackDialog(layoutService.activeContainer);
		if (!result) {
			return;
		}

		// TODO: Send feedback to backend
		notificationService.info(localize('feedbackSent', "Thank you for your feedback!"));
	}
});
