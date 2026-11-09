import React, { useState, useRef, useEffect } from 'react';
import { 
  Sparkles, Send, Bot, User, ArrowRight, 
  CheckCircle2, ShieldCheck, RefreshCw, X, MessageSquare 
} from 'lucide-react';
import { Drawer } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { AiChatMessage, LocalPilotRoute } from '../types';
import { useOptionalLocalSeo } from '../live/localSeoClient';

export interface AiAssistantDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (route: LocalPilotRoute, locId?: string) => void;
}

export const AiAssistantDrawer: React.FC<AiAssistantDrawerProps> = ({
  isOpen,
  onClose,
  onNavigate
}) => {
  // Answers come only from the data synced from Google (no invented numbers, no simulated AI).
  const seo = useOptionalLocalSeo();
  const [messages, setMessages] = useState<AiChatMessage[]>([]);

  const [input, setInput] = useState('');
  const [isTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const suggestedPrompts = [
    'Which locations need attention?',
    'Which reviews need a reply?',
    'What should I fix first?',
  ];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const answer = (promptText: string): { text: string; recs?: AiChatMessage['actionableRecommendations'] } => {
    const locations = seo?.locations || [];
    const reviews = seo?.reviews || [];
    const opps = seo?.opportunities || [];
    if (!locations.length) return { text: 'No locations are connected yet. Connect Google Business Profile and choose your locations first.' };
    const lower = promptText.toLowerCase();
    if (lower.includes('review') || lower.includes('reply')) {
      const waiting = reviews.filter((r) => r.status === 'unanswered');
      if (!waiting.length) return { text: `All ${reviews.length} synced review${reviews.length === 1 ? ' has' : 's have'} a reply.` };
      const low = waiting.filter((r) => r.rating <= 3).length;
      return {
        text: `${waiting.length} review${waiting.length === 1 ? '' : 's'} without a reply${low ? `, including ${low} rated 3 stars or less` : ''}. You can draft a reply for each one and publish the ones you approve.`,
        recs: [{ id: 'r1', title: 'Open reviews', impact: 'High', buttonLabel: 'Open reviews', actionType: 'reviews' }],
      };
    }
    if (lower.includes('fix') || lower.includes('problem') || lower.includes('improve') || lower.includes('seo')) {
      if (!opps.length) return { text: 'All profile checks pass for your connected locations.' };
      const top = [...opps].sort((a, b) => ['High', 'Medium', 'Low'].indexOf(a.impact) - ['High', 'Medium', 'Low'].indexOf(b.impact)).slice(0, 3);
      return {
        text: `Start with: ${top.map((o, n) => `${n + 1}) ${o.title}${o.locationName ? ` (${o.locationName})` : ''}`).join(' ')}`,
        recs: [{ id: 's1', title: 'See all fixes', impact: top[0].impact, buttonLabel: 'Open Local SEO', actionType: 'seo' }],
      };
    }
    if (lower.includes('location') || lower.includes('attention')) {
      const weak = locations.filter((l) => l.status !== 'Healthy');
      if (!weak.length) return { text: `All ${locations.length} location${locations.length === 1 ? ' passes' : 's pass'} most profile checks.` };
      return {
        text: `${weak.length} location${weak.length === 1 ? ' needs' : 's need'} attention: ${weak.slice(0, 5).map((l) => `${l.name} (profile health ${l.visibilityScore}/100, ${l.unansweredReviewsCount} review${l.unansweredReviewsCount === 1 ? '' : 's'} without a reply)`).join('; ')}.`,
        recs: [{ id: 'l1', title: 'Open locations', impact: 'High', buttonLabel: 'Open locations', actionType: 'locations' }],
      };
    }
    return { text: 'I can answer questions about locations that need attention, reviews that need a reply, and what to fix first, using your synced Google data. For other questions, use the AI assistant in the main app.' };
  };

  const handleSendPrompt = (promptText: string) => {
    if (!promptText.trim()) return;
    const { text, recs } = answer(promptText);
    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, sender: 'user', timestamp: new Date().toLocaleTimeString(), text: promptText },
      { id: `bot-${Date.now()}`, sender: 'assistant', timestamp: new Date().toLocaleTimeString(), text, actionableRecommendations: recs },
    ]);
    setInput('');
  };

  const handleActionClick = (actionType: string) => {
    onClose();
    if (actionType === 'reviews') onNavigate('reviews');
    else if (actionType === 'seo') onNavigate('seo');
    else if (actionType === 'posts') onNavigate('posts');
    else if (actionType === 'locations') onNavigate('locations');
    else onNavigate('dashboard');
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Local SEO helper"
      description="Quick answers from your synced Google data."
      icon={<Sparkles className="h-4 w-4" />}
      width="md"
      footer={
        <div className="space-y-2">
          {/* Quick Prompt Pills */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 text-[11px] no-scrollbar">
            {suggestedPrompts.slice(0, 3).map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => handleSendPrompt(prompt)}
                className="px-2.5 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 whitespace-nowrap transition cursor-pointer font-medium"
              >
                {prompt}
              </button>
            ))}
          </div>

          {/* Chat input box */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendPrompt(input);
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              placeholder="Ask about locations, reviews or fixes…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="flex-1 px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-blue-500 shadow-2xs"
            />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={!input.trim() || isTyping}
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          </form>

          <div className="flex items-center justify-center gap-1 text-[10px] text-slate-400 pt-1">
            <ShieldCheck className="h-3 w-3 text-emerald-600" />
            <span>Nothing is changed on Google without your approval</span>
          </div>
        </div>
      }
    >
      <div className="space-y-4 text-xs">
        {messages.length === 0 && (
          <p className="text-slate-500">Pick a question below. Answers use the locations and reviews synced from Google.</p>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-2.5 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.sender === 'assistant' && (
              <div className="h-7 w-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-100 mt-0.5">
                <Bot className="h-4 w-4" />
              </div>
            )}

            <div
              className={`max-w-[85%] rounded-2xl p-3.5 space-y-2.5 leading-relaxed ${
                msg.sender === 'user'
                  ? 'bg-blue-600 text-white rounded-br-xs'
                  : 'bg-slate-50 border border-slate-200/80 text-slate-900 rounded-bl-xs shadow-2xs'
              }`}
            >
              <p>{msg.text}</p>

              {/* Actionable buttons if assistant message */}
              {msg.actionableRecommendations && (
                <div className="space-y-2 pt-1 border-t border-slate-200/60">
                  {msg.actionableRecommendations.map((rec) => (
                    <div
                      key={rec.id}
                      className="p-2.5 rounded-lg bg-white border border-slate-200 shadow-2xs flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-slate-900 truncate">
                          {rec.title}
                        </div>
                        <span className="text-[10px] text-emerald-600 font-medium">
                          Impact: {rec.impact}
                        </span>
                      </div>

                      <Button
                        variant="subtle"
                        size="xs"
                        onClick={() => handleActionClick(rec.actionType)}
                        className="shrink-0 text-xs font-semibold"
                      >
                        {rec.buttonLabel}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {msg.sender === 'user' && (
              <div className="h-7 w-7 rounded-full bg-slate-200 flex items-center justify-center shrink-0 mt-0.5">
                <User className="h-4 w-4 text-slate-600" />
              </div>
            )}
          </div>
        ))}

        {isTyping && (
          <div className="flex items-center gap-2 text-slate-400 text-xs pl-9">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-600 animate-bounce" />
            <span className="h-1.5 w-1.5 rounded-full bg-blue-600 animate-bounce [animation-delay:0.2s]" />
            <span className="h-1.5 w-1.5 rounded-full bg-blue-600 animate-bounce [animation-delay:0.4s]" />
            <span className="text-[11px]">LocalPilot Assistant analyzing...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </Drawer>
  );
};

export default AiAssistantDrawer;
