/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from 'http';
import * as crypto from 'crypto';
import { parse as parseUrl } from 'url';
import { parse as parseQueryString } from 'querystring';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IHookNotificationEvent, IHookNotificationService } from '../common/hookNotificationService.js';

/**
 * Maps raw Claude Code hook event names to normalized states.
 * See: https://code.claude.com/docs/en/hooks.md
 *
 * Returns `undefined` for unknown/unmapped events (forward compatible — ignored).
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
		// Synthetic event sent by the hook script when PostToolUseFailure
		// has is_interrupt: true (user pressed ESC to interrupt a tool).
		// Stop hooks do not fire on user interrupts, so this is the only
		// signal that the agent has stopped working.
		case 'PostToolUseInterrupt':
			return 'Stop';
		case 'PermissionRequest':
			return 'PermissionRequest';
		// 'Notification' is deliberately unmapped — it fires for informational
		// events like "Session auto-compacted" that do not indicate a state
		// change. Real permission requests fire 'PermissionRequest'; real
		// stops fire 'Stop'. Mapping 'Notification' to either causes false
		// state transitions.
		default:
			return undefined;
	}
}

export class HookNotificationServer extends Disposable implements IHookNotificationService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidReceiveNotification = this._register(new Emitter<IHookNotificationEvent>());
	readonly onDidReceiveNotification = this._onDidReceiveNotification.event;

	private _port: number = 0;
	private readonly _token: string;
	private _server: http.Server | undefined;

	readonly whenReady: Promise<void>;

	get port(): number { return this._port; }
	get token(): string { return this._token; }

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
		this._token = crypto.randomUUID();
		this.whenReady = this._startServer();
	}

	private _startServer(): Promise<void> {
		return new Promise<void>((resolve) => {
			this._server = http.createServer((req, res) => {
				const parsed = parseUrl(req.url || '');

				if (parsed.pathname === '/health' && req.method === 'GET') {
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ status: 'ok', port: this._port }));
					return;
				}

				if (parsed.pathname === '/hook/complete' && req.method === 'GET') {
					const query = parseQueryString(parsed.query || '');

					// Token validation: reject requests without a valid token
					const requestToken = typeof query['token'] === 'string' ? query['token'] : '';
					if (requestToken !== this._token) {
						this.logService.warn(`[HookNotification] Rejected request with invalid token`);
						res.writeHead(403, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: 'invalid token' }));
						return;
					}

					const worktreePath = typeof query['worktreePath'] === 'string' ? query['worktreePath'] : '';
					const rawEventType = typeof query['eventType'] === 'string' ? query['eventType'] : '';

					const eventType = mapEventType(rawEventType);
					console.warn(`[LIFECYCLE DEBUG SERVER] raw="${rawEventType}" mapped="${eventType ?? 'IGNORED'}" path="${worktreePath}"`);

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

			// Port 0 = OS assigns a free port (eliminates collision risk)
			this._server.listen(0, '127.0.0.1', () => {
				const addr = this._server!.address();
				if (addr && typeof addr === 'object') {
					this._port = addr.port;
				}
				this.logService.info(`[HookNotification] Listening on http://127.0.0.1:${this._port}`);
				resolve();
			});

			this._server.on('error', (err) => {
				this.logService.warn(`[HookNotification] Server error: ${err.message}`);
				// Resolve even on error so callers don't hang indefinitely
				resolve();
			});
		});
	}

	override dispose(): void {
		this._server?.close();
		super.dispose();
	}
}
