/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { Lazy } from '../../../../../base/common/lazy.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { basenameOrAuthority, dirname } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ServicesAccessor } from '../../../../../editor/browser/editorExtensions.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { getIconClasses } from '../../../../../editor/common/services/getIconClasses.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { localize, localize2 } from '../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { CommandsRegistry, ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IResourceEditorInput } from '../../../../../platform/editor/common/editor.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { IQuickInputService, IQuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';
import { registerIcon } from '../../../../../platform/theme/common/iconRegistry.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { EditorResourceAccessor, isEditorInput } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IHistoryService } from '../../../../services/history/common/history.js';
import { QueryBuilder } from '../../../../services/search/common/queryBuilder.js';
import { ISearchService } from '../../../../services/search/common/search.js';
import { getOutOfWorkspaceEditorResources } from '../../../search/common/search.js';
import { IPinnedContextService, MANAGE_PINNED_CONTEXT, PinnedContextItem } from '../../common/pinnedContext.js';
import { CONTEXT_HAS_PINNED_CONTEXT } from '../../common/pinnedContextContextKeys.js';

const PINNED_CONTEXT_CATEGORY = localize2('pinnedContext.category', "Pinned Context");

const clearPinnedContextIcon = registerIcon('clear-pinned-context', Codicon.clearAll, localize('clearPinnedContextIcon', 'Icon for the clear pinned context action.'));

const createQuickPickItem = (resourceOrEditor: URI | EditorInput | IResourceEditorInput, labelService: ILabelService, modelService: IModelService, languageService: ILanguageService): IQuickPickItem & PinnedContextItem => {
	let resource: URI | undefined;
	if (isEditorInput(resourceOrEditor)) {
		resource = EditorResourceAccessor.getOriginalUri(resourceOrEditor);
	} else {
		resource = URI.isUri(resourceOrEditor) ? resourceOrEditor : resourceOrEditor.resource;
	}

	if (!resource) {
		throw new Error('Invalid resource');
	}

	const iconClassesValue = new Lazy(() => getIconClasses(modelService, languageService, resource, undefined, undefined));

	return {
		uri: resource,
		label: basenameOrAuthority(resource),
		description: labelService.getUriLabel(dirname(resource), { relative: true }),
		get iconClasses() { return iconClassesValue.value; },
	};
};

CommandsRegistry.registerCommand(MANAGE_PINNED_CONTEXT, async (accessor) => {
	const contextService = accessor.get(IWorkspaceContextService);
	const historyService = accessor.get(IHistoryService);
	const instantiationService = accessor.get(IInstantiationService);
	const labelService = accessor.get(ILabelService);
	const languageService = accessor.get(ILanguageService);
	const modelService = accessor.get(IModelService);
	const pinnedContextService = accessor.get(IPinnedContextService);
	const quickInputService = accessor.get(IQuickInputService);
	const searchService = accessor.get(ISearchService);

	const disposables = new DisposableStore();
	const cancellationTokenCts = disposables.add(new CancellationTokenSource());
	const fileQueryBuilder = instantiationService.createInstance(QueryBuilder);

	const picker = disposables.add(quickInputService.createQuickPick<IQuickPickItem & PinnedContextItem>());

	const pinnedItems = pinnedContextService.getPinnedContexts().map(uri => createQuickPickItem(uri, labelService, modelService, languageService));
	const historyItems = historyService.getHistory().map(editor => createQuickPickItem(editor, labelService, modelService, languageService));
	const uniqueItems = new Map<string, IQuickPickItem & PinnedContextItem>();

	// Add pinned items first to preserve them
	for (const item of pinnedItems) {
		uniqueItems.set(item.uri.toString(), item);
	}
	// Add history items if not already present
	for (const item of historyItems) {
		if (!uniqueItems.has(item.uri.toString())) {
			uniqueItems.set(item.uri.toString(), item);
		}
	}

	picker.items = Array.from(uniqueItems.values());
	picker.canSelectMany = true;
	picker.hideCheckAll = true;
	picker.matchOnDescription = true;
	picker.matchOnDetail = true;
	picker.matchOnLabel = true;
	picker.placeholder = localize('pinnedContext.placeholder', "Select files to pin as context (press space to toggle)");
	picker.selectedItems = picker.items.filter(item => {
		const pickerItem = item as PinnedContextItem;
		return pinnedContextService.hasContext(pickerItem.uri);
	}) as (IQuickPickItem & PinnedContextItem)[];
	picker.onDidChangeValue(async (query) => {
		// Keep currently selected items by their URIs
		const selectedItemURIs = new Set(picker.selectedItems.map(item => item.uri.toString()));

		// Create a map of unique items from all sources
		const uniqueItems = new Map<string, IQuickPickItem & PinnedContextItem>();

		// Add pinned items first
		for (const item of pinnedItems) {
			uniqueItems.set(item.uri.toString(), item);
		}

		// Add search results if there's a query
		if (query) {
			const files = await searchService.fileSearch(
				fileQueryBuilder.file(
					contextService.getWorkspace().folders,
					{
						extraFileResources: instantiationService.invokeFunction(getOutOfWorkspaceEditorResources),
						filePattern: query,
						sortByScore: true,
						maxResults: 512,
					}
				),
				cancellationTokenCts.token
			);

			for (const result of files.results) {
				const item = createQuickPickItem(result.resource, labelService, modelService, languageService);
				if (!uniqueItems.has(item.uri.toString())) {
					uniqueItems.set(item.uri.toString(), item);
				}
			}
		}

		// Add history items if not already present
		for (const item of historyItems) {
			if (!uniqueItems.has(item.uri.toString())) {
				uniqueItems.set(item.uri.toString(), item);
			}
		}

		// Update picker items
		const newItems = Array.from(uniqueItems.values());
		picker.items = newItems;

		// Restore selection by matching URIs
		picker.selectedItems = newItems.filter(item => selectedItemURIs.has(item.uri.toString()));
	});

	picker.show();

	disposables.add(picker.onDidAccept(() => {
		const selectedItems = picker.selectedItems;
		pinnedContextService.setContexts(selectedItems.map(item => item.uri));

		picker.hide();
		disposables.dispose();
	}));

	disposables.add(picker.onDidHide(() => {
		const selectedItems = picker.selectedItems;
		pinnedContextService.setContexts(selectedItems.map(item => item.uri));

		disposables.dispose();
	}));
});

class PinFileToContext extends Action2 {
	static readonly ID = 'workbench.action.pinFileToContext';

	constructor() {
		super({
			id: PinFileToContext.ID,
			title: localize2('pinnedContext.pinFile', "Pin File to Context"),
			category: PINNED_CONTEXT_CATEGORY,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const pinnedContextService = accessor.get(IPinnedContextService);
		const editorService = accessor.get(IEditorService);

		const activeEditor = editorService.activeEditor;
		if (activeEditor && activeEditor.resource) {
			pinnedContextService.addContext(activeEditor.resource);
		}
	}
}

class UnpinFileFromContext extends Action2 {
	static readonly ID = 'workbench.action.unpinFileFromContext';

	constructor() {
		super({
			id: UnpinFileFromContext.ID,
			title: localize2('pinnedContext.unpinFile', "Unpin File from Context"),
			category: PINNED_CONTEXT_CATEGORY,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const pinnedContextService = accessor.get(IPinnedContextService);
		const editorService = accessor.get(IEditorService);

		const activeEditor = editorService.activeEditor;
		if (activeEditor && activeEditor.resource) {
			pinnedContextService.removeContext(activeEditor.resource);
		}
	}
}

class ClearPinnedContext extends Action2 {
	static readonly ID = 'workbench.action.clearPinnedContext';

	constructor() {
		super({
			id: ClearPinnedContext.ID,
			title: localize2('pinnedContext.clear', "Clear Pinned Context"),
			category: PINNED_CONTEXT_CATEGORY,
			f1: true,
			icon: clearPinnedContextIcon,
			precondition: CONTEXT_HAS_PINNED_CONTEXT,
			menu: {
				id: MenuId.PinnedContextTitle,
				group: 'navigation',
				order: 1,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const pinnedContextService = accessor.get(IPinnedContextService);
		pinnedContextService.clearContexts();
	}
}

export class ManagePinnedContext extends Action2 {
	static readonly ID = 'workbench.action.managePinnedContext';

	constructor() {
		super({
			id: ManagePinnedContext.ID,
			title: localize2('pinnedContext.manage', "Manage Pinned Context"),
			category: PINNED_CONTEXT_CATEGORY,
			f1: true,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyC,
				weight: KeybindingWeight.WorkbenchContrib + 1,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const commandService = accessor.get(ICommandService);
		commandService.executeCommand(MANAGE_PINNED_CONTEXT);
	}
}

export function registerPinnedContextActions() {
	registerAction2(PinFileToContext);
	registerAction2(UnpinFileFromContext);
	registerAction2(ClearPinnedContext);
	registerAction2(ManagePinnedContext);
}
