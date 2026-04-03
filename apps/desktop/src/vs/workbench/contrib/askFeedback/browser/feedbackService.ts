/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Azure Function proxy — forwards feedback to Slack + Google Sheets.
// The actual webhook secrets live in Azure App Settings, never in source.
const FEEDBACK_PROXY_URL = 'https://workstreams-feedback.azurewebsites.net/api/submitFeedback';

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
		type: TYPE_LABELS[feedback.type],
		emoji: TYPE_EMOJI[feedback.type],
		text: feedback.text,
		timestamp: Math.floor(Date.now() / 1000),
	};

	// The Azure Function handles Slack formatting + Google Sheets logging.
	await fetch(FEEDBACK_PROXY_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload),
	});
}
