/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const SLACK_WEBHOOK_URL = 'REDACTED_SLACK_WEBHOOK';
const GOOGLE_SHEETS_URL = 'https://script.google.com/macros/s/AKfycbzO_-j2fyvhzBnK6-ItltmbeKsg1ryOh09cka_N3PQJq-TI2d0lyD38ZUsPVc17thEmew/exec';

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

	// Use application/x-www-form-urlencoded with payload= to avoid CORS preflight.
	// Slack webhooks accept this format natively. Combined with no-cors mode,
	// the request bypasses browser CORS restrictions entirely.
	const body = 'payload=' + encodeURIComponent(JSON.stringify(payload));

	await fetch(SLACK_WEBHOOK_URL, {
		method: 'POST',
		mode: 'no-cors',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body,
	});

	// Response is opaque in no-cors mode — we can't read the status.
	// The request is fire-and-forget; errors throw from fetch itself (network failure).

	// Also log to Google Sheets for durable record
	await fetch(GOOGLE_SHEETS_URL, {
		method: 'POST',
		mode: 'no-cors',
		body: JSON.stringify({ type: TYPE_LABELS[feedback.type], text: feedback.text }),
	});
}
