import React from 'react';
import { 
  Sparkles, 
  X, 
  RotateCcw, 
  Volume2, 
  VolumeX, 
  Settings, 
  Maximize2, 
  Minimize2,
  ChevronRight 
} from 'lucide-react';
import { AssistantLogo } from './AssistantLogo';
import { ResponseStyle } from '../../types/assistant';

interface AssistantHeaderProps {
  onCollapse?: () => void;
  onNewConversation: () => void;
  onOpenSettings: () => void;
  isVoiceEnabled: boolean;
  onToggleVoice: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  conversations?: { id: string; label: string }[];
  activeConversationId?: string;
  onSelectConversation?: (id: string) => void;
  responseStyle: ResponseStyle;
  onChangeResponseStyle: (style: ResponseStyle) => void;
}

export const AssistantHeader: React.FC<AssistantHeaderProps> = ({
  onCollapse,
  onNewConversation,
  onOpenSettings,
  isVoiceEnabled,
  onToggleVoice,
  isExpanded = false,
  onToggleExpand,
  conversations = [],
  activeConversationId,
  onSelectConversation,
  responseStyle,
  onChangeResponseStyle
}) => {
  return (
    <div id="ai-assistant-header" className="p-3 sm:p-3.5 bg-white border-b border-gray-200 shrink-0">
      <div className="flex items-center justify-between gap-2">
        {/* Left: AI Avatar & Title & Tagline */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative">
            <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center shadow-2xs overflow-hidden">
              <AssistantLogo className="w-full h-full" />
            </div>
            {/* Online Indicator */}
            <span
              className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-[#45CC42] border-2 border-white rounded-full"
              title="Assistant online"
            />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="text-xs sm:text-sm font-bold text-[#101828] truncate leading-tight">
                eStudy AI Assistant
              </h2>
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded-full border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-[#45CC42] animate-pulse" />
                Online
              </span>
            </div>
            <p className="text-[11px] text-gray-500 font-medium truncate">
              Your learning companion
            </p>
          </div>
        </div>

        {conversations.length > 0 && onSelectConversation && (
          <select
            aria-label="Conversation history"
            title="Switch conversation"
            value={activeConversationId}
            onChange={(event) => onSelectConversation(event.target.value)}
            className="min-w-0 max-w-28 sm:max-w-40 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-[10px] text-gray-600"
          >
            {conversations.map((conversation) => (
              <option key={conversation.id} value={conversation.id}>
                {conversation.label}
              </option>
            ))}
          </select>
        )}

        {/* Right: Header controls (🔊 ↻ ⚙ ↗ ✕) */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Audio / Read-aloud toggle */}
          <button
            onClick={onToggleVoice}
            className={`p-1.5 rounded-lg text-xs transition-colors ${
              isVoiceEnabled
                ? 'bg-blue-50 text-[#052B66]'
                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
            }`}
            title={isVoiceEnabled ? 'Voice read-aloud: Active' : 'Voice read-aloud: Off'}
            aria-label="Toggle voice"
          >
            {isVoiceEnabled ? <Volume2 className="w-4 h-4 text-[#052B66]" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* New conversation */}
          <button
            onClick={onNewConversation}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title="Start a new conversation. Previous conversations are saved."
            aria-label="Start a new conversation"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* Settings */}
          <button
            onClick={onOpenSettings}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title="Assistant settings"
            aria-label="Open settings"
          >
            <Settings className="w-4 h-4" />
          </button>

          {/* Expand / Narrow Width toggle on desktop (↗) */}
          {onToggleExpand && (
            <button
              onClick={onToggleExpand}
              className="hidden lg:flex p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title={isExpanded ? 'Standard width (380px)' : 'Expand width (580px)'}
              aria-label="Toggle expanded width"
            >
              {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          )}

          {onCollapse && (
            <button
              onClick={onCollapse}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors ml-0.5"
              title="Collapse assistant"
              aria-label="Collapse assistant"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        <label htmlFor="header-response-style" className="text-[10px] font-semibold text-gray-500">
          Explanation depth
        </label>
        <select
          id="header-response-style"
          value={responseStyle}
          onChange={(event) => onChangeResponseStyle(event.target.value as ResponseStyle)}
          className="max-w-40 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[10px] font-medium text-gray-700 focus:border-[#052B66] focus:outline-none focus:ring-2 focus:ring-[#052B66]/15"
        >
          <option value="concise">Executive &amp; Concise</option>
          <option value="detailed">Comprehensive &amp; In-Depth</option>
        </select>
      </div>
    </div>
  );
};
