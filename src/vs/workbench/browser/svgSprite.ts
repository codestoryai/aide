/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import dompurify from '../../base/browser/dompurify/dompurify.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { AppResourcePath, FileAccess } from '../../base/common/network.js';
import { IFileService } from '../../platform/files/common/files.js';
import { createDecorator } from '../../platform/instantiation/common/instantiation.js';

export interface ISVGSpriteService {
	_serviceBrand: undefined;
	addSpritesheet(href: AppResourcePath, namespace: string): Promise<SVGSVGElement | undefined>;
}

export const ISVGSpriteService = createDecorator<ISVGSpriteService>('ISVGSpriteService');

export class SvgSpriteService extends Disposable implements ISVGSpriteService {
	_serviceBrand: undefined;

	constructor(@IFileService protected readonly fileService: IFileService) {
		super();
	}

	async addSpritesheet(href: AppResourcePath, namespace: string) {
		try {
			const fileUri = FileAccess.asFileUri(href);
			const file = await this.fileService.readFile(fileUri);
			const content = file.value.toString();
			const sanitizedContent = dompurify.sanitize(content, { RETURN_TRUSTED_TYPE: true });
			const xmlDoc = new DOMParser().parseFromString(sanitizedContent as unknown as string, 'image/svg+xml');
			const svg = xmlDoc.querySelector('svg');

			if (svg) {
				const sprites = svg.querySelectorAll('defs svg[id]');
				for (const sprite of sprites) {
					const id = sprite.getAttribute('id');
					if (id) {
						sprite.setAttribute('id', `${namespace}:${id}`);
					}
				}
				svg.style.display = 'none';
				return svg;
			}
			return undefined;
		} catch (err) {
			console.error(err);
			return undefined;
		}
	}
}

export class SVGSprite extends Disposable {

	svg: SVGSVGElement;

	constructor(parent: HTMLElement, href: string, deferredAttributes?: Record<string, string>) {
		super();
		const svg = this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('overflow', 'visible');
		if (deferredAttributes) {
			for (const [key, value] of Object.entries(deferredAttributes)) {
				svg.setAttribute(key, value);
			}
		}
		const use = svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'use'));
		use.setAttribute('href', `#${href}`);

		parent.appendChild(svg);
	}

	public override dispose(): void {
		super.dispose();
		this.svg.remove();
	}
}
