/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { PreviewPartService } from '../../../browser/parts/preview/previewPartService.js';
import { IPreviewPartService } from '../browser/previewPartService.js';

registerSingleton(IPreviewPartService, PreviewPartService, InstantiationType.Eager);
