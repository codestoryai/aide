/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
export interface LatencyFeatureFlags {
	user?: boolean;
}

const defaultLatencies = {
	user: 50,
	lowPerformance: 1000,
	max: 1400,
};

// Languages with lower performance get additional latency to avoid spamming users with unhelpful
// suggestions
export const lowPerformanceLanguageIds = new Set([
	'css',
	'html',
	'scss',
	'vue',
	'dart',
	'json',
	'yaml',
	'postcss',
	'markdown',
	'plaintext',
	'xml',
	'twig',
	'jsonc',
	'handlebars',
]);

let userMetrics = {
	sessionTimestamp: 0,
	currentLatency: 0,
	suggested: 0,
	uri: '',
};

/**
 * Completion intents sorted by priority.
 * Top-most items are used if capture group ranges are identical.
 */
export const intentPriority = [
	'function.name',
	'function.parameters',
	'function.body',
	'type_declaration.name',
	'type_declaration.body',
	'arguments',
	'import.source',
	'comment',
	'pair.value',
	'argument',
	'parameter',
	'parameters',
	'jsx_attribute.value',
	'return_statement.value',
	'return_statement',
	'string',
] as const;

/**
 * Completion intent label derived from the AST nodes before the cursor.
 */
export type CompletionIntent = (typeof intentPriority)[number];


// Adjust the minimum latency based on user actions and env Start when the last 5 suggestions were
// not accepted Increment latency by 200ms linearly up to max latency Reset every 5 minutes, or on
// file change, or on accepting a suggestion
export function getArtificialDelay(
	featureFlags: LatencyFeatureFlags,
	uri: string,
	languageId: string,
	_completionIntent?: CompletionIntent
): number {
	let baseline = 0;

	const isLowPerformanceLanguageId = lowPerformanceLanguageIds.has(languageId);
	const isLowPerformanceCompletionIntent = false;
	// TODO(skcd): Fix this later on
	// const isLowPerformanceCompletionIntent =
	// 	completionIntent && lowPerformanceCompletionIntents.has(completionIntent)
	if (isLowPerformanceLanguageId || isLowPerformanceCompletionIntent) {
		baseline = defaultLatencies.lowPerformance;
	}

	const timestamp = Date.now();
	if (!userMetrics.sessionTimestamp) {
		userMetrics.sessionTimestamp = timestamp;
	}

	const elapsed = timestamp - userMetrics.sessionTimestamp;
	// reset metrics and timer after 5 minutes or file change
	if (elapsed >= 5 * 60 * 1000 || userMetrics.uri !== uri) {
		resetArtificialDelay(timestamp);
	}

	userMetrics.suggested++;
	userMetrics.uri = uri;

	const total = Math.max(
		baseline,
		Math.min(baseline + userMetrics.currentLatency, defaultLatencies.max)
	);

	// Increase latency linearly up to max after 5 rejected suggestions
	if (userMetrics.suggested >= 5 && userMetrics.currentLatency < defaultLatencies.max) {
		userMetrics.currentLatency += featureFlags.user ? defaultLatencies.user : 0;
	}

	if (total > 0) {
		// console.log('Aide:latency', `Delay added: ${total}`);
	}

	return total;
}

// reset user latency and counter:
// - on acceptance
// - every 5 minutes
// - on file change
export function resetArtificialDelay(timestamp = 0): void {
	userMetrics = {
		sessionTimestamp: timestamp,
		currentLatency: 0,
		suggested: 0,
		uri: '',
	};
}
