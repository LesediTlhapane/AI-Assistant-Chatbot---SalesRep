import type { ChatMessage } from '../types/assistant';
import type { CrossKnowledgeContext } from './crossKnowledgeService';

const STORAGE_KEY = 'estudy-assistant-conversations-v1';

export interface SavedConversation {
  id: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  context: CrossKnowledgeContext;
}

export interface ConversationState {
  conversations: SavedConversation[];
  activeConversationId: string;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<ChatMessage>;
  return typeof message.id === 'string'
    && (message.sender === 'user' || message.sender === 'assistant' || message.sender === 'system')
    && typeof message.timestamp === 'string'
    && typeof message.content === 'string';
}

export function createConversation(context: CrossKnowledgeContext = {}): SavedConversation {
  return {
    id: globalThis.crypto?.randomUUID?.() || `conversation-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    context: { ...context }
  };
}

function isConversationState(value: unknown): value is ConversationState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<ConversationState>;
  return Array.isArray(state.conversations)
    && typeof state.activeConversationId === 'string'
    && state.conversations.every((conversation) =>
      conversation
      && typeof conversation.id === 'string'
      && typeof conversation.createdAt === 'number'
      && typeof conversation.updatedAt === 'number'
      && Array.isArray(conversation.messages)
      && conversation.messages.every(isChatMessage)
      && conversation.context !== null
      && typeof conversation.context === 'object'
    )
    && state.conversations.some((conversation) => conversation.id === state.activeConversationId);
}

export function loadConversationState(): ConversationState {
  const storedState = window.localStorage.getItem(STORAGE_KEY);
  if (storedState) {
    const parsed: unknown = JSON.parse(storedState);
    if (!isConversationState(parsed)) {
      throw new Error('Saved conversation data is invalid and could not be restored safely.');
    }
    return parsed;
  }

  const initialConversation = createConversation();
  return {
    conversations: [initialConversation],
    activeConversationId: initialConversation.id
  };
}

export function saveConversationState(state: ConversationState): void {
  if (!isConversationState(state)) {
    throw new Error('Conversation data could not be saved because its state is invalid.');
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
