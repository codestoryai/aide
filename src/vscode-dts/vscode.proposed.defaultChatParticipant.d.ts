/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// version: 2

declare module 'vscode' {

	export interface ChatWelcomeMessageContent {
		icon: ThemeIcon;
		title: string;
		message: MarkdownString;
	}

	export interface ChatWelcomeMessageProvider {
		provideWelcomeMessage?(token: CancellationToken): ProviderResult<ChatWelcomeMessageContent>;
		provideSampleQuestions?(location: ChatLocation, token: CancellationToken): ProviderResult<ChatFollowup[]>;
	}

	export interface ChatRequesterInformation {
		name: string;

		/**
		 * A full URI for the icon of the request.
		 */
		icon?: Uri;
	}

	export interface ChatTitleProvider {
		/**
		 * TODO@API Should this take a ChatResult like the followup provider, or just take a new ChatContext that includes the current message as history?
		 */
		provideChatTitle(context: ChatContext, token: CancellationToken): ProviderResult<string>;
	}

	export interface ChatParticipant {
		/**
		 * When true, this participant is invoked when the user submits their query using ctrl/cmd+enter
		 * TODO@API name
		 */
		isSecondary?: boolean;

		/**
		 * A string that will be added before the listing of chat participants in `/help`.
		 */
		helpTextPrefix?: string | MarkdownString;

		/**
		 * A string that will be added before the listing of chat variables in `/help`.
		 */
		helpTextVariablesPrefix?: string | MarkdownString;

		/**
		 * A string that will be appended after the listing of chat participants in `/help`.
		 */
		helpTextPostfix?: string | MarkdownString;

		welcomeMessageProvider?: ChatWelcomeMessageProvider;
		titleProvider?: ChatTitleProvider;
		requester?: ChatRequesterInformation;
	}

	export interface CSChatCodeblockContext {
		code: string;
		languageId?: string;
		codeBlockIndex: number;
	}

	export interface CSChatAgentEditRequest {
		threadId: string;
		response: string;

		/**
		 * List of code blocks to be exported to the codebase.
		 */
		context: CSChatCodeblockContext[];
	}

	export interface CSChatAgentEditResponse {
		edits: WorkspaceEdit;
		codeBlockIndex: number;
	}

	/**
	 * Will be invoked when the export to codebase action is triggered.
	 */
	export interface ChatEditsProvider {
		/**
		 *
		 * @param result The same instance of the result object that was returned by the chat agent, and it can be extended with arbitrary properties if needed.
		 * @param token A cancellation token.
		 */
		provideEdits(request: CSChatAgentEditRequest, progress: Progress<CSChatAgentEditResponse>, token: CancellationToken): ProviderResult<CSChatAgentEditResponse>;
	}

	export interface ChatParticipant {
		/**
		 * This provider will be called
		 */
		editsProvider?: ChatEditsProvider;
	}
}
