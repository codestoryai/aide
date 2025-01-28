/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const path = require('path');

const srcDir = path.join(__dirname, 'preview-src');
const outDir = path.join(__dirname, 'media');

require('../esbuild-webview-common').run({
	entryPoints: {
		'index': path.join(srcDir, 'index.ts'),
	},
	srcDir,
	outdir: outDir,
	additionalOptions: {
		loader: {
			'.ttf': 'dataurl',
		}
	},
}, process.argv);
