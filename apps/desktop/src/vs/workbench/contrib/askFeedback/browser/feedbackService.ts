/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const SLACK_WEBHOOK_URL = 'REDACTED_SLACK_WEBHOOK';

// ── Types ──────────────────────────────────────────────────────────────────────

export type FeedbackType = 'bug' | 'feature' | 'other';

export interface IFeedbackResult {
	type: FeedbackType;
	text: string;
}

// ── Sliding Window Rate Limiter ────────────────────────────────────────────────
// Allows maxRequests within windowMs. Tracks timestamps and evicts expired ones.

class SlidingWindowRateLimiter {
	private readonly timestamps: number[] = [];

	constructor(
		private readonly maxRequests: number,
		private readonly windowMs: number,
	) { }

	tryAcquire(): boolean {
		const now = Date.now();
		while (this.timestamps.length > 0 && now - this.timestamps[0] >= this.windowMs) {
			this.timestamps.shift();
		}
		if (this.timestamps.length >= this.maxRequests) {
			return false;
		}
		this.timestamps.push(now);
		return true;
	}
}

// 5 submissions per 5-minute window
const rateLimiter = new SlidingWindowRateLimiter(5, 5 * 60 * 1000);

export function tryAcquireFeedback(): boolean {
	return rateLimiter.tryAcquire();
}

// ── Slack Integration ──────────────────────────────────────────────────────────

const TYPE_LABELS: Record<FeedbackType, string> = {
	bug: 'Bug',
	feature: 'Feature Request',
	other: 'Other',
};

const TYPE_EMOJI: Record<FeedbackType, string> = {
	bug: ':beetle:',
	feature: ':bulb:',
	other: ':thought_balloon:',
};

export async function submitFeedback(feedback: IFeedbackResult): Promise<void> {
	const payload = {
		blocks: [
			{
				type: 'header',
				text: {
					type: 'plain_text',
					text: `${TYPE_LABELS[feedback.type]} ${TYPE_EMOJI[feedback.type]}`,
				},
			},
			{
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: feedback.text,
				},
			},
			{
				type: 'context',
				elements: [
					{
						type: 'mrkdwn',
						text: `Submitted at <!date^${Math.floor(Date.now() / 1000)}^{date_short_pretty} {time}|${new Date().toISOString()}>`,
					},
				],
			},
		],
	};

	const response = await fetch(SLACK_WEBHOOK_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		throw new Error(`Slack webhook returned ${response.status}`);
	}
}
