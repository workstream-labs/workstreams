/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IMarkdownRendererService, openLinkFromMarkdown } from '../../../../platform/markdown/browser/markdownRenderer.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { asTextOrError, IRequestService } from '../../../../platform/request/common/request.js';
import { AvailableForDownload, Downloaded, Downloading, Idle, IUpdate, Overwriting, Ready, State, StateType, Updating } from '../../../../platform/update/common/update.js';
import { formatDate, getUpdateInfoUrl, tryParseDate } from '../common/updateUtils.js';
import './media/updateTooltip.css';

/**
 * A stateful tooltip control for the update status.
 */
export class UpdateTooltip extends Disposable {
	public readonly domNode: HTMLElement;

	private readonly dateBadgeNode: HTMLElement;
	private readonly titleNode: HTMLElement;
	private readonly actionsContainer: HTMLElement;
	private readonly updateButton: HTMLButtonElement;
	private readonly markdownContainer: HTMLElement;
	private readonly markdown = this._register(new MutableDisposable());

	private releaseNotesVersion: string | undefined;
	private currentUpdateCommand: string | undefined;

	constructor(
		_hostedByTitleBar: boolean, // kept for createInstance() call-site compat
		@ICommandService private readonly commandService: ICommandService,
		@IHoverService private readonly hoverService: IHoverService,
		@IMarkdownRendererService private readonly markdownRendererService: IMarkdownRendererService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IProductService private readonly productService: IProductService,
		@IRequestService private readonly requestService: IRequestService,
	) {
		super();

		this.domNode = dom.$('.update-tooltip');

		// Header: date badge + close button
		const header = dom.append(this.domNode, dom.$('.header'));
		this.dateBadgeNode = dom.append(header, dom.$('.date-badge'));

		const closeButton = dom.append(header, dom.$('.close-button'));
		closeButton.setAttribute('role', 'button');
		closeButton.setAttribute('tabindex', '0');
		closeButton.setAttribute('aria-label', localize('updateTooltip.close', "Close"));
		const closeIcon = dom.append(closeButton, dom.$('span'));
		closeIcon.classList.add(...ThemeIcon.asClassNameArray(Codicon.close));
		this._register(dom.addDisposableListener(closeButton, 'click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.hoverService.hideHover(true);
		}));

		// Title
		this.titleNode = dom.append(this.domNode, dom.$('.title'));

		// Action buttons
		this.actionsContainer = dom.append(this.domNode, dom.$('.actions'));

		const changelogButton = dom.append(this.actionsContainer, dom.$('button.action-btn.changelog-btn')) as HTMLButtonElement;
		changelogButton.textContent = localize('updateTooltip.changelog', "Changelog");
		this._register(dom.addDisposableListener(changelogButton, 'click', (e) => {
			e.preventDefault();
			if (this.releaseNotesVersion) {
				this.runCommandAndClose('update.showCurrentReleaseNotes', this.releaseNotesVersion);
			}
		}));

		this.updateButton = dom.append(this.actionsContainer, dom.$('button.action-btn.update-btn')) as HTMLButtonElement;
		this._register(dom.addDisposableListener(this.updateButton, 'click', (e) => {
			e.preventDefault();
			if (this.currentUpdateCommand) {
				this.runCommandAndClose(this.currentUpdateCommand);
			}
		}));

		// Markdown content
		this.markdownContainer = dom.append(this.domNode, dom.$('.update-markdown'));
	}

	private hideAll() {
		this.dateBadgeNode.style.display = 'none';
		this.actionsContainer.style.display = 'none';
		this.markdownContainer.style.display = 'none';
		this.markdown.clear();
		this.currentUpdateCommand = undefined;
		this.updateButton.classList.remove('loading');
		this.updateButton.style.display = 'none';
		this.updateButton.disabled = false;
	}

	public renderState(state: State) {
		this.hideAll();
		switch (state.type) {
			case StateType.Uninitialized:
			case StateType.CheckingForUpdates:
				this.renderInfo(localize('updateTooltip.checkingTitle', "Checking for Updates"));
				break;
			case StateType.Disabled:
				this.renderInfo(localize('updateTooltip.disabledTitle', "Updates Disabled"));
				break;
			case StateType.Idle:
				this.renderIdle(state);
				break;
			case StateType.AvailableForDownload:
				this.renderAvailableForDownload(state);
				break;
			case StateType.Downloading:
				this.renderDownloading(state);
				break;
			case StateType.Downloaded:
				this.renderDownloaded(state);
				break;
			case StateType.Updating:
				this.renderUpdating(state);
				break;
			case StateType.Ready:
				this.renderReady(state);
				break;
			case StateType.Overwriting:
				this.renderOverwriting(state);
				break;
		}
	}

	private renderIdle({ error, notAvailable }: Idle) {
		if (error) {
			this.renderInfo(localize('updateTooltip.errorTitle', "Update Error"));
		} else if (notAvailable) {
			this.renderInfo(localize('updateTooltip.noUpdateTitle', "No Update Available"));
		} else {
			this.renderInfo(localize('updateTooltip.upToDateTitle', "Up to Date"));
		}
	}

	private renderAvailableForDownload({ update }: AvailableForDownload) {
		this.renderInfo(undefined, update);
		this.showUpdateButton(localize('updateTooltip.update', "Update"), 'update.downloadNow');
	}

	private renderDownloading({ update }: Downloading) {
		this.renderInfo(undefined, update);
		this.showUpdateButton(localize('updateTooltip.downloading', "Downloading..."), undefined, true);
	}

	private renderDownloaded({ update }: Downloaded) {
		this.renderInfo(undefined, update);
		this.showUpdateButton(localize('updateTooltip.restart', "Restart"), 'update.install');
	}

	private renderUpdating({ update }: Updating) {
		this.renderInfo(undefined, update);
		this.showUpdateButton(localize('updateTooltip.installing', "Installing..."), undefined, true);
	}

	private renderReady({ update }: Ready) {
		this.renderInfo(undefined, update);
		this.showUpdateButton(localize('updateTooltip.restart', "Restart"), 'update.restart');
	}

	private renderOverwriting({ update }: Overwriting) {
		this.renderInfo(undefined, update);
		this.showUpdateButton(localize('updateTooltip.downloading', "Downloading..."), undefined, true);
	}

	public async renderPostInstall() {
		this.hideAll();
		const version = this.productService.version;
		this.renderInfo(undefined, undefined, version);

		let text = null;
		try {
			const url = getUpdateInfoUrl(version);
			const context = await this.requestService.request({ url, callSite: 'updateTooltip' }, CancellationToken.None);
			text = await asTextOrError(context);
		} catch { }

		if (!text) {
			return;
		}

		const rendered = this.markdownRendererService.render(
			new MarkdownString(text, {
				isTrusted: true,
				supportHtml: true,
				supportThemeIcons: true,
			}),
			{
				actionHandler: (link, mdStr) => {
					openLinkFromMarkdown(this.openerService, link, mdStr.isTrusted);
					this.hoverService.hideHover(true);
				},
			});

		this.markdown.value = rendered;
		dom.clearNode(this.markdownContainer);
		this.markdownContainer.appendChild(rendered.element);
		this.markdownContainer.style.display = '';
	}

	private renderInfo(titleOverride?: string, update?: IUpdate, versionOverride?: string) {
		const version = versionOverride ?? update?.productVersion ?? this.productService.version;

		this.titleNode.textContent = titleOverride ?? localize(
			'updateTooltip.whatsNew',
			"What's new in {0} v{1}",
			this.productService.nameShort,
			version
		);

		const releaseDate = update?.timestamp ?? tryParseDate(this.productService.date);
		if (typeof releaseDate === 'number' && releaseDate > 0) {
			this.dateBadgeNode.textContent = formatDate(releaseDate);
			this.dateBadgeNode.style.display = '';
		}

		this.releaseNotesVersion = version;
		this.actionsContainer.style.display = '';
	}

	private showUpdateButton(label: string, command?: string, loading = false) {
		this.updateButton.textContent = label;
		this.currentUpdateCommand = command;
		this.updateButton.disabled = !command;
		this.updateButton.classList.toggle('loading', loading);
		this.updateButton.style.display = '';
	}

	private runCommandAndClose(command: string, ...args: unknown[]) {
		this.commandService.executeCommand(command, ...args);
		this.hoverService.hideHover(true);
	}
}
