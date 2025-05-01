import * as assert from 'assert';
import 'mocha';
import * as vscode from 'vscode';
import { AideAgentSessionProvider } from '../completions/providers/aideAgentProvider';
import { SideCarClient, RepoRef, RepoRefBackend } from '../sidecar/client';
import { CSEventHandler } from '../csEvents/csEventHandler';
import { RecentEditsRetriever } from '../server/editedFiles';
import { SideCarAgentEvent } from '../server/types';
import { ProjectContext } from '../utilities/workspaceContext';

suite('AideAgentSessionProvider', () => {
    let provider: AideAgentSessionProvider;
    let mockSidecarClient: Partial<SideCarClient>;
    let mockEventHandler: Partial<CSEventHandler>;
    let mockRecentEditsRetriever: Partial<RecentEditsRetriever>;
    let mockExtensionContext: Partial<vscode.ExtensionContext>;
    let mockProjectContext: ProjectContext;

    setup(() => {
        mockSidecarClient = {
            agentSessionChat: (_query: string, _sessionId: string, _exchangeId: string, _editorUrl: string, _agentMode: vscode.AideAgentMode, _variables: readonly vscode.ChatPromptReference[], _repoRef: RepoRef, _projectLabels: string[], _workosAccessToken: string): AsyncIterableIterator<SideCarAgentEvent> => {
                return {
                    [Symbol.asyncIterator]() { return this; },
                    async next() { return { done: true, value: undefined }; }
                };
            },
            cancelRunningEvent: (_sessionId: string, _exchangeId: string, _editorUrl: string, _accessToken: string): AsyncIterableIterator<SideCarAgentEvent> => {
                return {
                    [Symbol.asyncIterator]() { return this; },
                    async next() { return { done: true, value: undefined }; }
                };
            }
        };

        mockEventHandler = {};
        mockRecentEditsRetriever = {
            retrieveSidecar: async () => ({
                success: true,
                changed_files: []
            })
        };
        mockExtensionContext = {
            subscriptions: []
        };

        mockProjectContext = new ProjectContext();

        provider = new AideAgentSessionProvider(
            new RepoRef('/test', RepoRefBackend.local),
            mockProjectContext,
            mockSidecarClient as SideCarClient,
            mockEventHandler as CSEventHandler,
            mockRecentEditsRetriever as RecentEditsRetriever,
            mockExtensionContext as vscode.ExtensionContext
        );
    });

    suite('Session Restoration', () => {
        test('should handle restored session events correctly', async () => {
            const sessionId = 'test-session';
            const events = [
                { session_id: sessionId, started: false },
                { event: { Delta: 'test content' } }
            ];

            const mockStream: AsyncIterableIterator<SideCarAgentEvent> = {
                [Symbol.asyncIterator]() {
                    return this;
                },
                async next() {
                    const event = events.shift();
                    return event ? { value: event as SideCarAgentEvent, done: false } : { value: undefined, done: true };
                }
            };

            let errorCalled = false;
            const onError = () => {
                errorCalled = true;
            };

            await provider.reportAgentEventsToChat(sessionId, mockStream, onError);
            assert.strictEqual(errorCalled, true, 'Error callback should be called for unstarted session');
        });

        test('should skip initial events for restored sessions', async () => {
            const sessionId = 'test-session';
            const events = [
                { session_id: sessionId, started: true },
                { event: { Delta: 'test content' } }
            ];

            const mockStream: AsyncIterableIterator<SideCarAgentEvent> = {
                [Symbol.asyncIterator]() {
                    return this;
                },
                async next() {
                    const event = events.shift();
                    return event ? { value: event as SideCarAgentEvent, done: false } : { value: undefined, done: true };
                }
            };

            let errorCalled = false;
            const onError = () => {
                errorCalled = true;
            };

            await provider.reportAgentEventsToChat(sessionId, mockStream, onError);
            assert.strictEqual(errorCalled, false, 'Error callback should not be called for started session');
        });

        test('should handle keep-alive events during restoration', async () => {
            const sessionId = 'test-session';
            const events = [
                { keep_alive: true },
                { session_id: sessionId, started: true },
                { event: { Delta: 'test content' } }
            ];

            const mockStream: AsyncIterableIterator<SideCarAgentEvent> = {
                [Symbol.asyncIterator]() {
                    return this;
                },
                async next() {
                    const event = events.shift();
                    return event ? { value: event as SideCarAgentEvent, done: false } : { value: undefined, done: true };
                }
            };

            let errorCalled = false;
            const onError = () => {
                errorCalled = true;
            };

            await provider.reportAgentEventsToChat(sessionId, mockStream, onError);
            assert.strictEqual(errorCalled, false, 'Error callback should not be called when handling keep-alive events');
        });
    });
});