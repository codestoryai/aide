/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SVGSprite } from './svgSprite.js';

function assignSize(id: string) {
	const size = id.split('/').at(0);
	switch (size) {
		case 'micro':
			return 16;
		case 'mini':
			return 20;
		default:
			return 24;
	}
}

export class Heroicon extends SVGSprite {
	constructor(parent: HTMLElement, id: string, deferredAttributes?: Record<string, string>) {
		const size = assignSize(id).toString();
		super(parent, `heroicons:${id}`, { width: size, height: size, ...deferredAttributes });
	}
}
