import React, { useState } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { 
  AssistantContext, 
  ChatMessage, 
  QuickActionType,
  ResponseStyle
} from '../../types/assistant';
import { aiService } from '../../services/aiService';
import { AssistantHeader } from './AssistantHeader';
import { LearnerContextBadge } from './LearnerContextBadge';
import { QuickActions } from './QuickActions';
import { WelcomeView } from './WelcomeView';
import { ChatMessageList } from '../chat/ChatMessageList';
import { ChatInput } from './ChatInput';
import { SettingsModal } from './SettingsModal';

export interface AiAssistantPanelProps {
  /**
   * LMS context passed from the host LMS (CrossKnowledge / eStudy)
   */
  context?: AssistantContext;
  
  /**
   * Optional initial message list
   */
  initialMessages?: ChatMessage[];

  /**
   * Callback when user closes or collapses the panel
   */
  onCollapse?: () => void;

  /**
   * Controlled messages (optional; if not provided, panel maintains internal state)
   */
  messages?: ChatMessage[];

  /**
   * Controlled message handler (optional)
   */
  onSendMessage?: (query: string, actionType?: QuickActionType, responseStyle?: ResponseStyle, topic?: string) => void;
  onAppendMessage?: (message: ChatMessage) => void;
  onUpdateMessage?: (message: ChatMessage) => void;
  onNewConversation?: () => void;
  conversations?: { id: string; label: string }[];
  activeConversationId?: string;
  onSelectConversation?: (id: string) => void;

  /**
   * Whether the panel is being rendered in full screen / mobile drawer
   */
  isMobileDrawer?: boolean;

  /**
   * Whether panel width is currently expanded
   */
  isExpanded?: boolean;

  /**
   * Callback to toggle expanded width
   */
  onToggleExpand?: () => void;

  /**
   * Extra container class names
   */
  className?: string;

  // Backward compatibility props
  learner?: any;
  module?: any;
  lesson?: any;
  isThinking?: boolean;
  onResetConversation?: () => void;
  persistenceError?: string | null;
}

export const AiAssistantPanel: React.FC<AiAssistantPanelProps> = ({
  context,
  initialMessages = [],
  onCollapse,
  messages: externalMessages,
  onSendMessage: externalSendMessage,
  onAppendMessage: externalAppendMessage,
  onUpdateMessage: externalUpdateMessage,
  onNewConversation,
  conversations,
  activeConversationId,
  onSelectConversation,
  isMobileDrawer = false,
  isExpanded = false,
  onToggleExpand,
  className = '',
  learner,
  module,
  lesson,
  isThinking: externalThinking,
  onResetConversation,
  persistenceError
}) => {
  // Derive effective context if legacy props passed
  const activeContext: AssistantContext = context || {
    moduleId: module?.id,
    moduleOrder: module?.order,
    moduleTitle: module?.title,
    lessonId: lesson?.id,
    lessonTitle: lesson?.title,
    learnerId: learner?.id,
    learnerName: learner?.name,
    courseProgress: learner?.courseProgress,
    moduleProgress: module?.progress
  };

  // Internal state when not externally controlled
  const [internalMessages, setInternalMessages] = useState<ChatMessage[]>(initialMessages);
  const [localPromptMessages, setLocalPromptMessages] = useState<ChatMessage[]>([]);
  const [pendingTopicAction, setPendingTopicAction] = useState<QuickActionType | null>(null);
  const [activeTopic, setActiveTopic] = useState('');
  const [isInternallyThinking, setIsInternallyThinking] = useState(false);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [responseStyle, setResponseStyle] = useState<ResponseStyle>(() => {
    const saved = localStorage.getItem('estudy-assistant-response-style');
    return saved === 'concise' || saved === 'detailed' ? saved : 'concise';
  });
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    localStorage.getItem('estudy-assistant-theme') === 'dark' ? 'dark' : 'light'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  React.useEffect(() => {
    localStorage.setItem('estudy-assistant-theme', theme);
  }, [theme]);

  React.useEffect(() => {
    localStorage.setItem('estudy-assistant-response-style', responseStyle);
  }, [responseStyle]);

  const isControlled = externalMessages !== undefined && externalSendMessage !== undefined;
  React.useEffect(() => {
    setActiveTopic('');
    setLocalPromptMessages([]);
    const lastMessage = externalMessages?.[externalMessages.length - 1];
    setPendingTopicAction(
      lastMessage?.sender === 'assistant'
      && lastMessage.content.startsWith('What topic would you like me to ')
        ? lastMessage.actionType || null
        : null
    );
  }, [activeConversationId]);

  const handleUpdateMessage = (updatedMessage: ChatMessage) => {
    if (isControlled) {
      externalUpdateMessage?.(updatedMessage);
    } else {
      setInternalMessages((previous) =>
        previous.map((message) => message.id === updatedMessage.id ? updatedMessage : message)
      );
    }
  };

  const messages = isControlled
    ? [...externalMessages, ...localPromptMessages]
    : internalMessages;
  const conversationTopic = activeTopic
    || activeContext.lessonTitle
    || activeContext.moduleName
    || activeContext.moduleTitle
    || [...messages].reverse().find((message) => message.sender === 'user' && message.content.trim())?.content
    || '';

  React.useEffect(() => {
    const contextTopic = activeContext.lessonTitle || activeContext.moduleName || activeContext.moduleTitle;
    if (contextTopic) setActiveTopic(contextTopic);
  }, [activeContext.lessonTitle, activeContext.moduleName, activeContext.moduleTitle]);
  const isThinking = externalThinking ?? isInternallyThinking;
  const hasMessages = messages.length > 0;

  const handleSendMessage = async (query: string, actionType: QuickActionType = 'general') => {
    const effectiveActionType = pendingTopicAction || actionType;
    const topic = conversationTopic || query.trim();
    setActiveTopic(topic);
    setPendingTopicAction(null);
    setLocalPromptMessages([]);

    if (isControlled && externalSendMessage) {
      externalSendMessage(query, effectiveActionType, responseStyle, topic);
      return;
    }

    if (!query.trim()) return;

    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      sender: 'user',
      role: 'learner',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content: query,
      actionType: effectiveActionType,
      contextLessonId: activeContext.lessonId,
      contextLessonTitle: activeContext.lessonTitle
    };

    setInternalMessages((prev) => [...prev, userMsg]);
    setIsInternallyThinking(true);
    setErrorMessage(null);

    try {
      const assistantMsg = await aiService.sendMessage(
        query,
        activeContext,
        effectiveActionType,
        [...internalMessages, userMsg],
        responseStyle,
        topic
      );
      setInternalMessages((prev) => [...prev, assistantMsg]);

      // Voice read-aloud if enabled
      if (isVoiceEnabled && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const cleanSpeech = assistantMsg.content.replace(/[#*`_]/g, '');
        const utterance = new SpeechSynthesisUtterance(cleanSpeech);
        utterance.rate = 1.0;
        window.speechSynthesis.speak(utterance);
      }
    } catch (err: any) {
      console.error('Error getting AI response:', err);
      setErrorMessage('Unable to connect to AI Assistant service. Please try again.');
    } finally {
      setIsInternallyThinking(false);
    }
  };

  const handleResetConversation = () => {
    setInternalMessages([]);
    setLocalPromptMessages([]);
    setPendingTopicAction(null);
    setActiveTopic('');
    setErrorMessage(null);
    onResetConversation?.();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  const handleNewConversation = () => {
    setLocalPromptMessages([]);
    setPendingTopicAction(null);
    setActiveTopic('');
    setErrorMessage(null);
    if (onNewConversation) onNewConversation();
    else handleResetConversation();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  const handleActionSelect = (actionType: QuickActionType, promptText?: string) => {
    const hasTopicContext = Boolean(conversationTopic);
    const hasLearnerTopic = messages.some((message) => message.sender === 'user' && message.content.trim());

    if (!hasTopicContext && !hasLearnerTopic) {
      setPendingTopicAction(actionType);
      const actionLabel: Record<QuickActionType, string> = {
        explain: 'explain',
        simplify: 'simplify',
        example: 'give an example for',
        summarise: 'summarise',
        quiz: 'create a quiz about',
        challenge: 'create a challenge about',
        general: 'help you with'
      };
      const clarification: ChatMessage = {
        id: `topic-prompt-${Date.now()}`,
        sender: 'assistant',
        actionType,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: `What topic would you like me to ${actionLabel[actionType]}? Type the topic below and I’ll get started.`
      };

      if (isControlled) {
        if (externalAppendMessage) externalAppendMessage(clarification);
        else setLocalPromptMessages([clarification]);
      } else {
        setInternalMessages((previous) => [...previous, clarification]);
      }
      return;
    }

    const topic = conversationTopic || activeContext.lessonTitle || activeContext.moduleTitle || 'the selected topic';
    const actionPrompts: Record<QuickActionType, string> = {
      explain: `Explain ${topic} in structured detail.`,
      simplify: `Simplify ${topic} in plain, easy-to-understand terms.`,
      example: `Give a practical example specifically about ${topic}.`,
      summarise: `Summarise the key points about ${topic}.`,
      quiz: `Test my knowledge of ${topic} with a 5-question quiz.`,
      challenge: `Create a practical challenge about ${topic}.`,
      general: `Help me understand ${topic}.`
    };
    const query = promptText
      ? `${promptText} Focus only on this topic: ${topic}.`
      : actionPrompts[actionType];
    handleSendMessage(query, actionType);
  };

  return (
    <aside
      id="ai-assistant-side-panel"
      className={`h-full flex flex-col bg-white border-l border-gray-200 overflow-hidden text-left relative ${
        theme === 'dark' ? 'ai-assistant-dark' : ''
      } ${
        isMobileDrawer ? 'w-full' : 'w-full'
      } ${className}`}
      aria-label="eStudy AI Learning Assistant Panel"
    >
      {/* 1. Header with Controls */}
      <AssistantHeader
        onCollapse={onCollapse}
        onNewConversation={handleNewConversation}
        onOpenSettings={() => setIsSettingsOpen(true)}
        isVoiceEnabled={isVoiceEnabled}
        onToggleVoice={() => setIsVoiceEnabled(!isVoiceEnabled)}
        isExpanded={isExpanded}
        onToggleExpand={onToggleExpand}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={onSelectConversation}
        responseStyle={responseStyle}
        onChangeResponseStyle={setResponseStyle}
      />

      {/* 2. Learner Context Badge (Sync indicator) */}
      <LearnerContextBadge context={activeContext} />

      {/* 3. Quick Action Tools Bar */}
      <QuickActions
        onSelectAction={handleActionSelect}
        disabled={isThinking}
      />

      {/* 4. Main Scrollable Conversation & Content Area */}
      <div className="flex-1 overflow-y-auto flex flex-col custom-scrollbar bg-[#F5F7FA]/30">
        {errorMessage && (
          <div className="m-3 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center justify-between gap-2 animate-in fade-in duration-200">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              onClick={() => setErrorMessage(null)}
              className="p-1 text-rose-600 hover:bg-rose-100 rounded cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {persistenceError && (
          <div role="alert" className="m-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            Conversation saving failed: {persistenceError} Keep this tab open and copy any unsaved messages.
          </div>
        )}

        {!hasMessages ? (
          <WelcomeView
            context={activeContext}
            onSelectAction={handleActionSelect}
          />
        ) : (
          <ChatMessageList
            messages={messages}
            isThinking={isThinking}
            context={activeContext}
            onSelectSuggestion={(sug) => handleSendMessage(sug, 'general')}
            isVoiceEnabled={isVoiceEnabled}
            onUpdateMessage={handleUpdateMessage}
          />
        )}
      </div>

      {/* 5. Fixed Chat Input */}
      <ChatInput
        onSendMessage={(text) => handleSendMessage(text, pendingTopicAction || 'general')}
        disabled={false}
        isThinking={isThinking}
        lessonTitle={activeContext.lessonTitle}
      />

      {/* 6. Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onClearHistory={handleResetConversation}
        responseStyle={responseStyle}
        onChangeResponseStyle={setResponseStyle}
        theme={theme}
        onChangeTheme={setTheme}
        isVoiceEnabled={isVoiceEnabled}
        onToggleVoice={() => setIsVoiceEnabled(!isVoiceEnabled)}
      />
    </aside>
  );
};
