/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from 'http';
import { parse as parseUrl } from 'url';
import { parse as parseQueryString } from 'querystring';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IHookNotificationEvent, IHookNotificationService } from '../common/hookNotificationService.js';

export const HOOK_NOTIFICATION_PORT = 51742;

/**
 * Maps raw Claude Code hook event names to normalized states.
 */
/**
 * Maps raw Claude Code hook event names to normalized states.
 * See: https://code.claude.com/docs/en/hooks.md
 */
function mapEventType(raw: string): IHookNotificationEvent['eventType'] | undefined {
	switch (raw) {
		case 'Start':
		case 'UserPromptSubmit':
		case 'PostToolUse':
		case 'PostToolUseFailure':
			return 'Start';
		case 'Stop':
		case 'SessionEnd':
		case 'Notification':
		// Synthetic event sent by the hook script when PostToolUseFailure
		// has is_interrupt: true (user pressed ESC to interrupt a tool).
		// Stop hooks do not fire on user interrupts, so this is the only
		// signal that the agent has stopped working.
		case 'PostToolUseInterrupt':
			return 'Stop';
		case 'PermissionRequest':
			return 'PermissionRequest';
		default:
			return undefined;
	}
}

export class HookNotificationServer extends Disposable implements IHookNotificationService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidReceiveNotification = this._register(new Emitter<IHookNotificationEvent>());
	readonly onDidReceiveNotification = this._onDidReceiveNotification.event;

	readonly port = HOOK_NOTIFICATION_PORT;

	private _server: http.Server | undefined;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
		this._startServer();
	}

	private _startServer(): void {
		this._server = http.createServer((req, res) => {
			const parsed = parseUrl(req.url || '');

			if (parsed.pathname === '/hook/complete' && req.method === 'GET') {
				const query = parseQueryString(parsed.query || '');

				const worktreePath = typeof query['worktreePath'] === 'string' ? query['worktreePath'] : '';
				const rawEventType = typeof query['eventType'] === 'string' ? query['eventType'] : '';

				const eventType = mapEventType(rawEventType);

				if (eventType && worktreePath) {
					this.logService.info(`[HookNotification] ${eventType} for "${worktreePath}"`);
					this._onDidReceiveNotification.fire({ worktreePath, eventType });
				}

				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ success: true }));
			} else {
				res.writeHead(404);
				res.end();
			}
		});

		this._server.listen(this.port, '127.0.0.1', () => {
			this.logService.info(`[HookNotification] Listening on http://127.0.0.1:${this.port}`);
		});

		this._server.on('error', (err) => {
			this.logService.warn(`[HookNotification] Server error: ${err.message}`);
		});
	}

	override dispose(): void {
		this._server?.close();
		super.dispose();
	}
}
