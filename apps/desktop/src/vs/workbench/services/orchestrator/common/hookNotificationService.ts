/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface IHookNotificationEvent {
	readonly worktreePath: string;
	readonly eventType: 'Start' | 'Stop' | 'PermissionRequest';
}

export const IHookNotificationService = createDecorator<IHookNotificationService>('hookNotificationService');

export interface IHookNotificationService {
	readonly _serviceBrand: undefined;
	readonly onDidReceiveNotification: Event<IHookNotificationEvent>;
	readonly port: number;
}
