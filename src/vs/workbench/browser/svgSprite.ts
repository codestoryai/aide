/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { AppResourcePath, FileAccess } from 'vs/base/common/network';
import { IFileService } from 'vs/platform/files/common/files';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { sanitize } from 'vs/base/browser/dompurify/dompurify';


export interface ISVGSpriteService {
	_serviceBrand: undefined;
	addSpritesheet(href: AppResourcePath): Promise<SVGSVGElement | undefined>;
}

export const ISVGSpriteService = createDecorator<ISVGSpriteService>('ISVGSpriteService');

export class SvgSpriteService extends Disposable implements ISVGSpriteService {
	_serviceBrand: undefined;

	constructor(@IFileService protected readonly fileService: IFileService) {
		super();
	}

	async addSpritesheet(href: AppResourcePath) {
		try {
			const fileUri = FileAccess.asFileUri(href);
			const file = await this.fileService.readFile(fileUri);
			const content = file.value.toString();
			const sanitizedContent = sanitize(content, { RETURN_TRUSTED_TYPE: true });
			const xmlDoc = new DOMParser().parseFromString(sanitizedContent as unknown as string, 'image/svg+xml');
			const svg = xmlDoc.querySelector('svg');
			if (svg) {
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
