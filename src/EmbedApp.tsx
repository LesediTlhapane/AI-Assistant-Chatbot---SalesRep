import React, { useEffect, useRef, useState } from 'react';
import { ChatMessage } from './types';
import { AiAssistantPanel } from './components/assistant/AiAssistantPanel';
import { AiService } from './services/aiService';
import {
  ConversationState,
  createConversation,
  loadConversationState,
  saveConversationState
} from './services/conversationStorage';
import { CrossKnowledgeService } from './services/crossKnowledgeService';
import { QuickActionType, ResponseStyle } from './types/assistant';

function getInitialConversationState(): { state: ConversationState | null; error: string | null } {
  try {
    return { state: loadConversationState(), error: null };
  } catch (error) {
    console.error('[Conversation Storage] Failed to restore saved conversations:', error);
    return {
      state: null,
      error: error instanceof Error ? error.message : 'Saved conversations could not be restored.'
    };
  }
}

function getConversationLabel(messages: ChatMessage[], updatedAt: number): string {
  const firstQuestion = messages.find((message) => message.sender === 'user')?.content.trim();
  if (firstQuestion) {
    return firstQuestion.length > 32 ? `${firstQuestion.slice(0, 29)}...` : firstQuestion;
  }
  return `New conversation · ${new Date(updatedAt).toLocaleDateString()}`;
}

export const EmbedApp: React.FC = () => {
  const [initialState] = useState(getInitialConversationState);
  const [conversationState, setConversationState] = useState<ConversationState | null>(initialState.state);
  const [persistenceError, setPersistenceError] = useState<string | null>(initialState.error);
  const [isThinking, setIsThinking] = useState(false);
  const conversationStateRef = useRef(conversationState);
  conversationStateRef.current = conversationState;

  useEffect(() => {
    if (!conversationState || initialState.error) return;
    try {
      saveConversationState(conversationState);
      setPersistenceError(null);
    } catch (error) {
      console.error('[Conversation Storage] Failed to save conversations:', error);
      setPersistenceError(error instanceof Error ? error.message : 'Conversation changes could not be saved.');
    }
  }, [conversationState, initialState.error]);

  useEffect(() => {
    const saveBeforePageClose = () => {
      if (!conversationStateRef.current || initialState.error) return;
      try {
        saveConversationState(conversationStateRef.current);
      } catch (error) {
        console.error('[Conversation Storage] Final save before page close failed:', error);
      }
    };

    window.addEventListener('pagehide', saveBeforePageClose);
    return () => window.removeEventListener('pagehide', saveBeforePageClose);
  }, [initialState.error]);

  const activeConversation = conversationState?.conversations.find(
    (conversation) => conversation.id === conversationState.activeConversationId
  );

  useEffect(() => {
    const handlePostMessage = (event: MessageEvent) => {
      const allowedOrigins = (window as any).ESTUDY_ALLOWED_ORIGINS || [];
      if (allowedOrigins.length > 0 && !allowedOrigins.includes(event.origin) && !event.origin.includes('localhost')) {
        console.warn(`[eStudy AI Embed] Discarded message from unapproved origin: ${event.origin}`);
        return;
      }

      if (event.data && event.data.type === 'ESTUDY_CONTEXT' && event.data.payload) {
        const normalized = CrossKnowledgeService.normalizeContext(event.data.payload);
        setConversationState((previous) => {
          if (!previous) return previous;
          const currentId = previous.activeConversationId;
          const lessonContext = normalized.lessonTitle
            ? `Viewing **${normalized.lessonTitle}**${normalized.moduleName ? ` in ${normalized.moduleName}` : ''}.`
            : 'Your learning context has been synced.';
          return {
            ...previous,
            conversations: previous.conversations.map((conversation) =>
              conversation.id === currentId
                ? {
                    ...conversation,
                    context: normalized,
                    updatedAt: Date.now(),
                    messages: [
                      ...conversation.messages,
                      {
                        id: `msg-sync-${Date.now()}`,
                        sender: 'assistant',
                        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        content: `🔄 **LMS Context Updated:** ${lessonContext}\n\nHow can I help?`,
                        contextLessonId: normalized.lessonId,
                        contextLessonTitle: normalized.lessonTitle,
                        suggestions: ['Explain this lesson', 'Give me an example', 'Summarise this lesson']
                      }
                    ]
                  }
                : conversation
            )
          };
        });
      }
    };

    window.addEventListener('message', handlePostMessage);
    return () => window.removeEventListener('message', handlePostMessage);
  }, []);

  const updateConversation = (
    conversationId: string,
    update: (messages: ChatMessage[]) => ChatMessage[]
  ) => {
    setConversationState((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        conversations: previous.conversations.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, messages: update(conversation.messages), updatedAt: Date.now() }
            : conversation
        )
      };
    });
  };

  const handleSendMessage = async (
    query: string,
    actionType: QuickActionType = 'general',
    responseStyle: ResponseStyle = 'concise',
    topic?: string
  ) => {
    if (!activeConversation || !query.trim()) return;

    const targetConversation = activeConversation;
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content: query
    };

    updateConversation(targetConversation.id, (messages) => [...messages, userMsg]);
    setIsThinking(true);

    try {
      const responseMsg = await AiService.sendMessage({
        message: query,
        actionType,
        responseStyle,
        topic,
        context: targetConversation.context,
        conversationHistory: targetConversation.messages
      });

      updateConversation(targetConversation.id, (messages) => [...messages, responseMsg]);
    } catch (err) {
      console.error('[Assistant] Failed to send message:', err);
      updateConversation(targetConversation.id, (messages) => [
        ...messages,
        {
          id: `msg-err-${Date.now()}`,
          sender: 'assistant',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: 'Sorry, I ran into an issue connecting to the AI service. Please try again.',
          isError: true,
          suggestions: ['Retry question', 'Explain this lesson']
        }
      ]);
    } finally {
      setIsThinking(false);
    }
  };

  const handleNewConversation = () => {
    setConversationState((previous) => {
      if (!previous) return previous;
      const conversation = createConversation(activeConversation?.context || {});
      return {
        conversations: [...previous.conversations, conversation],
        activeConversationId: conversation.id
      };
    });
  };

  const handleClearCurrentConversation = () => {
    if (!activeConversation) return;
    updateConversation(activeConversation.id, () => []);
  };

  const handleUpdateMessage = (message: ChatMessage) => {
    if (!activeConversation) return;
    updateConversation(activeConversation.id, (messages) =>
      messages.map((existing) => existing.id === message.id ? message : existing)
    );
  };

  const handleAppendMessage = (message: ChatMessage) => {
    if (!activeConversation) return;
    updateConversation(activeConversation.id, (messages) => [...messages, message]);
  };

  if (!conversationState || !activeConversation) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F7FA] p-6 text-center">
        <div className="max-w-lg rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
          <h1 className="text-base font-bold text-rose-900">Conversation history could not be restored</h1>
          <p className="mt-2 text-sm text-gray-700">{persistenceError}</p>
          <p className="mt-2 text-xs text-gray-500">The assistant is paused to avoid overwriting your saved conversations.</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-[#052B66] px-4 py-2 text-sm font-semibold text-white"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const conversationOptions = [...conversationState.conversations]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((conversation) => ({
      id: conversation.id,
      label: getConversationLabel(conversation.messages, conversation.updatedAt)
    }));

  return (
    <div id="estudy-ai-embed-root" className="w-full h-screen bg-white overflow-hidden flex flex-col font-sans">
      <AiAssistantPanel
        context={activeConversation.context}
        messages={activeConversation.messages}
        isThinking={isThinking}
        onSendMessage={handleSendMessage}
        onAppendMessage={handleAppendMessage}
        onUpdateMessage={handleUpdateMessage}
        onNewConversation={handleNewConversation}
        conversations={conversationOptions}
        activeConversationId={activeConversation.id}
        onSelectConversation={(id) => {
          setConversationState((previous) => previous
            ? { ...previous, activeConversationId: id }
            : previous);
        }}
        persistenceError={persistenceError}
        onCollapse={window.parent !== window
          ? () => window.parent.postMessage({ type: 'ESTUDY_CLOSE_WIDGET' }, '*')
          : undefined}
        onResetConversation={handleClearCurrentConversation}
      />
    </div>
  );
};
