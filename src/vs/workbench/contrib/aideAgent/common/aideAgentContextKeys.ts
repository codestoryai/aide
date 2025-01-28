/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { ChatAgentLocation } from './aideAgentAgents.js';

export const CONTEXT_RESPONSE_VOTE = new RawContextKey<string>('aideAgentSessionResponseVote', '', { type: 'string', description: localize('interactiveSessionResponseVote', "When the response has been voted up, is set to 'up'. When voted down, is set to 'down'. Otherwise an empty string.") });
export const CONTEXT_VOTE_UP_ENABLED = new RawContextKey<boolean>('aideAgentVoteUpEnabled', false, { type: 'boolean', description: localize('chatVoteUpEnabled', "True when the chat vote up action is enabled.") });
export const CONTEXT_RESPONSE_DETECTED_AGENT_COMMAND = new RawContextKey<boolean>('aideAgentSessionResponseDetectedAgentOrCommand', false, { type: 'boolean', description: localize('chatSessionResponseDetectedAgentOrCommand', "When the agent or command was automatically detected") });
export const CONTEXT_CHAT_RESPONSE_SUPPORT_ISSUE_REPORTING = new RawContextKey<boolean>('aideAgentResponseSupportsIssueReporting', false, { type: 'boolean', description: localize('chatResponseSupportsIssueReporting', "True when the current chat response supports issue reporting.") });
export const CONTEXT_RESPONSE_FILTERED = new RawContextKey<boolean>('aideAgentSessionResponseFiltered', false, { type: 'boolean', description: localize('chatResponseFiltered', "True when the chat response was filtered out by the server.") });
export const CONTEXT_RESPONSE_ERROR = new RawContextKey<boolean>('aideAgentSessionResponseError', false, { type: 'boolean', description: localize('chatResponseErrored', "True when the chat response resulted in an error.") });
export const CONTEXT_CHAT_REQUEST_IN_PROGRESS = new RawContextKey<boolean>('aideAgentSessionRequestInProgress', false, { type: 'boolean', description: localize('interactiveSessionRequestInProgress', "True when the current request is still in progress.") });

export const CONTEXT_RESPONSE = new RawContextKey<boolean>('aideAgentResponse', false, { type: 'boolean', description: localize('chatResponse', "The chat item is a response.") });
export const CONTEXT_REQUEST = new RawContextKey<boolean>('aideAgentRequest', false, { type: 'boolean', description: localize('chatRequest', "The chat item is a request") });

export const CONTEXT_CHAT_EDIT_APPLIED = new RawContextKey<boolean>('aideAgentEditApplied', false, { type: 'boolean', description: localize('chatEditApplied', "True when the chat text edits have been applied.") });

export const CONTEXT_CHAT_INPUT_HAS_TEXT = new RawContextKey<boolean>('aideAgentInputHasText', false, { type: 'boolean', description: localize('interactiveInputHasText', "True when the chat input has text.") });
export const CONTEXT_CHAT_INPUT_HAS_FOCUS = new RawContextKey<boolean>('aideAgentInputHasFocus', false, { type: 'boolean', description: localize('interactiveInputHasFocus', "True when the chat input has focus.") });
export const CONTEXT_IN_CHAT_INPUT = new RawContextKey<boolean>('inAideAgentInput', false, { type: 'boolean', description: localize('inInteractiveInput', "True when focus is in the chat input, false otherwise.") });
export const CONTEXT_IN_CHAT_SESSION = new RawContextKey<boolean>('inAideAgent', false, { type: 'boolean', description: localize('inChat', "True when focus is in the chat widget, false otherwise.") });
export const CONTEXT_CHAT_MODE = new RawContextKey<string>('aideAgentMode', 'Plan', { type: 'string', description: localize('chatMode', "The current chat mode.") });
export const CONTEXT_CHAT_IS_PLAN_VISIBLE = new RawContextKey<boolean>('aideAgentIsPlanVisible', false, { type: 'boolean', description: localize('chatIsPlanVisible', "True when the plan is visible.") });
export const CONTEXT_CHAT_LAST_ITEM_ID = new RawContextKey<string[]>('aideAgentLastItemId', [], { type: 'string', description: localize('chatLastItemId', "The id of the last chat item.") });
export const CONTEXT_CHAT_LAST_EXCHANGE_COMPLETE = new RawContextKey<boolean>('aideAgentLastExchangeComplete', false, { type: 'boolean', description: localize('chatLastExchangeComplete', "True when the last exchange is complete.") });
export const CONTEXT_CHAT_SESSION_WITH_EDITS = new RawContextKey<boolean>('aideAgentSessionWithEdits', false, { type: 'boolean', description: localize('chatSessionWithEdits', "True when the chat session has edits.") });
export const CONTEXT_CHAT_HAS_FILE_ATTACHMENTS = new RawContextKey<boolean>('aideAgentHasFileAttachments', false, { type: 'boolean', description: localize('chatHasFileAttachments', "True when the chat has file attachments.") });

export const CONTEXT_CHAT_ENABLED = new RawContextKey<boolean>('aideAgentIsEnabled', false, { type: 'boolean', description: localize('chatIsEnabled', "True when chat is enabled because a default chat participant is activated with an implementation.") });
export const CONTEXT_CHAT_PANEL_PARTICIPANT_REGISTERED = new RawContextKey<boolean>('aideAgentPanelParticipantRegistered', false, { type: 'boolean', description: localize('chatParticipantRegistered', "True when a default chat participant is registered for the panel.") });
export const CONTEXT_CHAT_EXTENSION_INVALID = new RawContextKey<boolean>('aideAgentExtensionInvalid', false, { type: 'boolean', description: localize('chatExtensionInvalid', "True when the installed chat extension is invalid and needs to be updated.") });
export const CONTEXT_CHAT_INPUT_CURSOR_AT_TOP = new RawContextKey<boolean>('aideAgentCursorAtTop', false);
export const CONTEXT_CHAT_INPUT_HAS_AGENT = new RawContextKey<boolean>('aideAgentInputHasAgent', false);
export const CONTEXT_CHAT_LOCATION = new RawContextKey<ChatAgentLocation>('aideAgentLocation', undefined);

export const CONTEXT_LANGUAGE_MODELS_ARE_USER_SELECTABLE = new RawContextKey<boolean>('aideAgentModelsAreUserSelectable', false, { type: 'boolean', description: localize('chatModelsAreUserSelectable', "True when the chat model can be selected manually by the user.") });
export const CONTEXT_PARTICIPANT_SUPPORTS_MODEL_PICKER = new RawContextKey<boolean>('aideAgentParticipantSupportsModelPicker', true, { type: 'boolean', description: localize('chatParticipantSupportsModelPicker', "True when the current chat participant supports picking the model manually.") });

export const CONTEXT_CHAT_FLOATING_WIDGET_VISIBLE = new RawContextKey<boolean>('aideAgentFloatingWidgetVisible', false, { type: 'boolean', description: localize('chatFloatingWidgetVisible', "True when the chat floating widget is visible.") });
export const CONTEXT_CHAT_FLOATING_WIDGET_FOCUSED = new RawContextKey<boolean>('aideAgentFloatingWidgetFocused', false, { type: 'boolean', description: localize('chatFloatingWidgetFocused', "True when the chat floating widget is focused.") });
export const CONTEXT_CHAT_IN_PASSTHROUGH_WIDGET = new RawContextKey<boolean>('aideAgentInPassthroughWidget', false, { type: 'boolean', description: localize('chatInPassthroughWidget', "True when the chat is in a passthrough widget.") });
