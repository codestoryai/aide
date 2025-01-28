/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
const INDENT_REGEX = /^(?:( )+|\t+)/;

const INDENT_TYPE_SPACE = 'space';
const INDENT_TYPE_TAB = 'tab';

/**
Make a Map that counts how many indents/unindents have occurred for a given size and how many lines follow a given indentation.

The key is a concatenation of the indentation type (s = space and t = tab) and the size of the indents/unindents.

```
indents = {
	t3: [1, 0],
	t4: [1, 5],
	s5: [1, 0],
	s12: [1, 0],
}
```
*/
function makeIndentsMap(string: string, ignoreSingleSpaces: boolean): Map<string, number[]> {
	const indents = new Map();

	// Remember the size of previous line's indentation
	let previousSize = 0;
	let previousIndentType;

	// Indents key (ident type + size of the indents/unindents)
	let key;

	for (const line of string.split(/\n/g)) {
		if (!line) {
			// Ignore empty lines
			continue;
		}

		let indent;
		let indentType;
		let use;
		let weight;
		let entry;
		const matches = line.match(INDENT_REGEX);

		if (matches === null) {
			previousSize = 0;
			previousIndentType = '';
		} else {
			indent = matches[0].length;
			indentType = matches[1] ? INDENT_TYPE_SPACE : INDENT_TYPE_TAB;

			// Ignore single space unless it's the only indent detected to prevent common false positives
			if (ignoreSingleSpaces && indentType === INDENT_TYPE_SPACE && indent === 1) {
				continue;
			}

			if (indentType !== previousIndentType) {
				previousSize = 0;
			}

			previousIndentType = indentType;

			use = 1;
			weight = 0;

			const indentDifference = indent - previousSize;
			previousSize = indent;

			// Previous line have same indent?
			if (indentDifference === 0) {
				// Not a new "use" of the current indent:
				use = 0;
				// But do add a bit to it for breaking ties:
				weight = 1;
				// We use the key from previous loop
			} else {
				const absoluteIndentDifference = indentDifference > 0 ? indentDifference : -indentDifference;
				key = encodeIndentsKey(indentType, absoluteIndentDifference);
			}

			// Update the stats
			entry = indents.get(key);
			entry = entry === undefined ? [1, 0] : [entry[0] + use, entry[1] + weight];

			indents.set(key, entry);
		}
	}

	return indents;
}

// Encode the indent type and amount as a string (e.g. 's4') for use as a compound key in the indents Map.
function encodeIndentsKey(indentType: string, indentAmount: number) {
	const typeCharacter = indentType === INDENT_TYPE_SPACE ? 's' : 't';
	return typeCharacter + String(indentAmount);
}

// Extract the indent type and amount from a key of the indents Map.
function decodeIndentsKey(indentsKey: string) {
	const keyHasTypeSpace = indentsKey[0] === 's';
	const type = keyHasTypeSpace ? INDENT_TYPE_SPACE : INDENT_TYPE_TAB;

	const amount = Number(indentsKey.slice(1));

	return { type, amount };
}

// Return the key (e.g. 's4') from the indents Map that represents the most common indent,
// or return undefined if there are no indents.
function getMostUsedKey(indents: Map<string, number[]>) {
	let result;
	let maxUsed = 0;
	let maxWeight = 0;

	for (const [key, [usedCount, weight]] of indents) {
		if (usedCount > maxUsed || (usedCount === maxUsed && weight > maxWeight)) {
			maxUsed = usedCount;
			maxWeight = weight;
			result = key;
		}
	}

	return result;
}

function makeIndentString(type: string, amount: number) {
	const indentCharacter = type === INDENT_TYPE_SPACE ? ' ' : '\t';
	return indentCharacter.repeat(amount);
}

export default function detectIndent(string: string) {
	if (typeof string !== 'string') {
		throw new TypeError('Expected a string');
	}

	// Identify indents while skipping single space indents to avoid common edge cases (e.g. code comments)
	// If no indents are identified, run again and include all indents for comprehensive detection
	let indents = makeIndentsMap(string, true);
	if (indents.size === 0) {
		indents = makeIndentsMap(string, false);
	}

	const keyOfMostUsedIndent = getMostUsedKey(indents);

	let type;
	let amount = 0;
	let indent = '';

	if (keyOfMostUsedIndent !== undefined) {
		({ type, amount } = decodeIndentsKey(keyOfMostUsedIndent));
		indent = makeIndentString(type, amount);
	}

	return {
		amount,
		type,
		indent,
	};
}
