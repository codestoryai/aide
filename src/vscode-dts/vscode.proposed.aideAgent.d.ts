/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {
	export enum AideAgentMode {
		Edit = 1,
		Chat = 2,
		Plan = 3,
		Agentic = 4
	}

	export enum AideAgentScope {
		Selection = 1,
		PinnedContext = 2,
		Codebase = 3
	}

	export enum AideAgentReferenceKind {
		File = 1,
		Code = 2
	}

	export interface AideAgentFileReference extends ChatPromptReference {
		readonly kind: AideAgentReferenceKind.File;
		readonly value: {
			uri: Uri;
			range: Range;
		};
	}

	export interface AideAgentCodeReference extends ChatPromptReference {
		readonly kind: AideAgentReferenceKind.Code;
		readonly value: {
			uri: Uri;
			range: Range;
		};
	}

	export interface AideAgentImageAttachmentValue {
		mimeType: string;
		data: () => Thenable<Uint8Array>;
	}

	// This is a cool looking type, but TypeScript currently doesn't enforce it. But it helps understand
	// the intent for us to use it correctly.
	export type AideAgentPromptReference =
		| AideAgentFileReference
		| AideAgentCodeReference
		| (Omit<ChatPromptReference, 'id'> & { id: string });

	export interface AideAgentRequest {
		readonly exchangeId: string;
		readonly sessionId: string;
		readonly mode: AideAgentMode;
		readonly scope: AideAgentScope;
		readonly prompt: string;
		readonly command: string | undefined;
		readonly references: readonly AideAgentPromptReference[];
		readonly attempt: number;
		/**
		 * @deprecated
		 */
		readonly location: ChatLocation;
		readonly location2: ChatRequestEditorData | ChatRequestNotebookData | undefined;
		readonly isDevtoolsContext: boolean;
	}

	export class ChatResponseCodeEditPart {
		edits: WorkspaceEdit;
		constructor(edits: WorkspaceEdit);
	}

	export interface AideAgentPlanStepPart {
		/**
		 * The index of the step in the plan
		 */
		readonly index: number;
		/**
		 * Progressive update on the description over here
		 */
		readonly description: string | MarkdownString;
	}

	export interface AideAgentProgressStagePart {
		readonly message: string;
	}

	export interface AideAgentToolTypeError {
		readonly message: string;
	}

	export type AideAgentResponsePart = ExtendedChatResponsePart | ChatResponseCodeEditPart;

	export interface AideAgentResponseStream extends ChatResponseStream {
		codeEdit(edits: WorkspaceEdit): void;
		push(part: AideAgentResponsePart): void;
		step(step: AideAgentPlanStepPart): void;
		stage(stage: AideAgentProgressStagePart): void;
		close(): void;
		markLastMessageAsComplete(): void;
		toolTypeError(message: AideAgentToolTypeError): void;
	}

	export interface AideAgentEventSenderResponse {
		exchangeId: string;
		stream: AideAgentResponseStream;
		token: CancellationToken;
	}

	export type AideSessionHandler = (id: string) => void;
	export type AideSessionEventHandler = (event: AideAgentRequest, token: CancellationToken) => ProviderResult<ChatResult | void>;
	export type AideSessionEventSender = (sessionId: string) => Thenable<AideAgentEventSenderResponse | undefined>;

	export interface AideSessionParticipant {
		newSession: AideSessionHandler;
		handleEvent: AideSessionEventHandler;
	}

	interface AideSessionAgent extends Omit<ChatParticipant, 'requestHandler'> {
		requestHandler: AideSessionEventHandler;
		readonly initResponse: AideSessionEventSender;
	}

	export interface AideAgentParticipantDetectionProvider {
		provideParticipantDetection(chatRequest: AideAgentRequest, context: ChatContext, options: { participants?: ChatParticipantMetadata[]; location: ChatLocation }, token: CancellationToken): ProviderResult<ChatParticipantDetectionResult>;
	}

	export namespace aideAgent {
		export function createChatParticipant(id: string, resolver: AideSessionParticipant): AideSessionAgent;
		export function registerChatParticipantDetectionProvider(participantDetectionProvider: AideAgentParticipantDetectionProvider): Disposable;
		export function registerChatVariableResolver(id: string, name: string, userDescription: string, modelDescription: string | undefined, isSlow: boolean | undefined, resolver: ChatVariableResolver, fullName?: string, icon?: ThemeIcon): Disposable;
		export function registerMappedEditsProvider2(provider: MappedEditsProvider2): Disposable;
	}
}
