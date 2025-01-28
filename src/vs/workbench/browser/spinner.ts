/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SVGSprite } from './svgSprite.js';

export class Spinner extends SVGSprite {
	constructor(parent: HTMLElement, deferredAttributes?: Record<string, string>) {
		super(parent, 'special:spinner', { width: '20', height: '20', ...deferredAttributes });
	}
}
