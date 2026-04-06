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
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { type FeedbackType, type IFeedbackResult, submitFeedback, tryAcquireFeedback } from './feedbackService.js';

function showFeedbackDialog(container: HTMLElement): Promise<IFeedbackResult | undefined> {
	return new Promise(resolve => {
		const disposables = new DisposableStore();
		let resolved = false;
		let selectedType: FeedbackType = 'bug';

		const dismiss = (result?: IFeedbackResult) => {
			if (resolved) {
				return;
			}
			resolved = true;
			modalBlock.remove();
			disposables.dispose();
			resolve(result);
		};

		const trySubmit = () => {
			const text = textArea.value.trim();
			if (!text) {
				textArea.focus();
				return;
			}
			dismiss({ type: selectedType, text });
		};

		const updateHint = () => {
			const hasText = textArea.value.trim().length > 0;
			hint.classList.toggle('ready', hasText);
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

		// Separator
		dialog.appendChild($('.ask-feedback-separator'));

		// Type pills
		const typeRow = dialog.appendChild($('.ask-feedback-type-row'));
		typeRow.setAttribute('role', 'radiogroup');
		typeRow.setAttribute('aria-label', localize('feedbackDialog.typeLabel', "Type"));

		const typeOptions: { value: FeedbackType; label: string; icon: string }[] = [
			{ value: 'bug', label: localize('feedbackType.bug', "Bug"), icon: 'codicon-bug' },
			{ value: 'feature', label: localize('feedbackType.featureRequest', "Feature Request"), icon: 'codicon-lightbulb' },
			{ value: 'other', label: localize('feedbackType.other', "Other"), icon: 'codicon-comment' },
		];

		const pillElements: HTMLButtonElement[] = [];
		for (const opt of typeOptions) {
			const pill = typeRow.appendChild($('button.ask-feedback-type-pill')) as HTMLButtonElement;
			pill.setAttribute('role', 'radio');
			pill.setAttribute('aria-checked', opt.value === selectedType ? 'true' : 'false');

			const icon = pill.appendChild($(`span.codicon.${opt.icon}`));
			icon.setAttribute('aria-hidden', 'true');
			pill.appendChild(document.createTextNode(opt.label));

			if (opt.value === selectedType) {
				pill.classList.add('selected');
			}

			disposables.add(addDisposableListener(pill, EventType.CLICK, () => {
				selectedType = opt.value;
				for (const p of pillElements) {
					p.classList.remove('selected');
					p.setAttribute('aria-checked', 'false');
				}
				pill.classList.add('selected');
				pill.setAttribute('aria-checked', 'true');
				textArea.focus();
			}));

			pillElements.push(pill);
		}

		// Textarea
		const textArea = dialog.appendChild($('textarea.ask-feedback-textarea')) as HTMLTextAreaElement;
		textArea.id = 'ask-feedback-text';
		textArea.placeholder = localize('feedbackDialog.placeholder', "Tell us what's on your mind...");
		textArea.rows = 5;
		disposables.add(addDisposableListener(textArea, EventType.INPUT, updateHint));

		// Footer
		const footer = dialog.appendChild($('.ask-feedback-footer'));

		const footerLeft = footer.appendChild($('.ask-feedback-footer-left'));
		const hint = footerLeft.appendChild($('span.ask-feedback-hint'));
		const isMac = navigator.userAgent.includes('Mac');
		hint.textContent = isMac
			? localize('feedbackDialog.hintMac', "\u2318\u21A9 to submit")
			: localize('feedbackDialog.hintWin', "Ctrl+Enter to submit");

		const footerRight = footer.appendChild($('.ask-feedback-footer-right'));

		const cancelButton = footerRight.appendChild($('button.ask-feedback-button.ask-feedback-button-cancel'));
		cancelButton.textContent = localize('feedbackDialog.cancel', "Cancel");
		disposables.add(addDisposableListener(cancelButton, EventType.CLICK, () => dismiss()));

		const submitButton = footerRight.appendChild($('button.ask-feedback-button.ask-feedback-button-submit'));
		submitButton.textContent = localize('feedbackDialog.submit', "Submit");
		disposables.add(addDisposableListener(submitButton, EventType.CLICK, trySubmit));

		// Keyboard handling
		disposables.add(addDisposableListener(dialog, EventType.KEY_DOWN, (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);
			if (event.keyCode === KeyCode.Escape) {
				dismiss();
			} else if (event.keyCode === KeyCode.Enter && (event.ctrlKey || event.metaKey)) {
				trySubmit();
			}
		}));

		// Focus the textarea initially
		textArea.focus();
	});
}

registerAction2(class AskFeedbackAction extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.askFeedback',
			title: localize2('askFeedback', "Send Feedback"),
			icon: Codicon.comment,
			menu: []
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const layoutService = accessor.get(ILayoutService);
		const notificationService = accessor.get(INotificationService);

		if (!tryAcquireFeedback()) {
			notificationService.notify({
				severity: Severity.Warning,
				message: localize('feedbackRateLimited', "You're sending feedback too quickly. Please wait a moment and try again."),
			});
			return;
		}

		const result = await showFeedbackDialog(layoutService.activeContainer);
		if (!result) {
			return;
		}

		try {
			await submitFeedback(result);
			notificationService.info(localize('feedbackSent', "Thank you for your feedback!"));
		} catch {
			notificationService.notify({
				severity: Severity.Error,
				message: localize('feedbackError', "Failed to send feedback. Please try again later."),
			});
		}
	}
});
