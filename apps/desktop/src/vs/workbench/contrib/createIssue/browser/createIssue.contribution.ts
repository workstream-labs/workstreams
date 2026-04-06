/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IsAuxiliaryWindowContext } from '../../../common/contextkeys.js';

registerAction2(class CreateIssueAction extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.createIssue',
			title: localize2('createIssue', "Create Issue"),
			icon: Codicon.issues,
			menu: [{
				id: MenuId.LayoutControlMenu,
				group: '2_pane_toggles',
				order: -2, // Before Send Feedback (-1)
				when: IsAuxiliaryWindowContext.negate(),
			}]
		});
	}

	override async run(_accessor: ServicesAccessor): Promise<void> {
		// TODO: implement create issue functionality
	}
});
