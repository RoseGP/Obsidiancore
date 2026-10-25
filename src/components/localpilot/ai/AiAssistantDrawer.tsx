import React, { useState, useRef, useEffect } from 'react';
import { 
  Sparkles, Send, Bot, User, ArrowRight, 
  CheckCircle2, ShieldCheck, RefreshCw, X, MessageSquare 
} from 'lucide-react';
import { Drawer } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { AiChatMessage, LocalPilotRoute } from '../types';

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
  // TO COMPLETE: the assistant starts empty; replies should come from a real model (see components/assistant/UnifiedAssistant.tsx).
  const [messages, setMessages] = useState<AiChatMessage[]>([]);

  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const suggestedPrompts = [
    "How can I improve my visibility?",
    "Which locations need attention?",
    "Find my biggest SEO problems.",
    "Draft responses to unanswered reviews.",
    "Create this week's posts.",
    "Why did my visibility change?"
  ];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSendPrompt = (promptText: string) => {
    if (!promptText.trim()) return;

    const userMsg: AiChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      timestamp: 'Just now',
      text: promptText
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    setTimeout(() => {
      let botResponse = '';
      let recs: AiChatMessage['actionableRecommendations'] = undefined;

      const lower = promptText.toLowerCase();
      if (lower.includes('visibility') || lower.includes('improve')) {
        botResponse = 'To improve overall visibility from 92 to 96+, I recommend: 1) adding missing specialty services to your Downtown and Westside profiles, 2) replying to all remaining 23 customer reviews within 24 hours, and 3) uploading 5+ fresh customer-centric photos weekly.';
        recs = [
          { id: 'v1', title: 'Open Local SEO Opportunities', impact: 'High', buttonLabel: 'View SEO Plan', actionType: 'seo' },
          { id: 'v2', title: 'Respond to Reviews', impact: 'High', buttonLabel: 'Open Inbox', actionType: 'reviews' }
        ];
      } else if (lower.includes('which location') || lower.includes('attention')) {
        botResponse = 'Currently, 2 locations require immediate attention: South Beach Oceanfront Lounge (score 68, 18 unanswered reviews, critical issue) and Northside Coastal Kitchen (score 76, 7 unanswered reviews).';
        recs = [
          { id: 'l1', title: 'Open South Beach Lounge Profile', impact: 'High', buttonLabel: 'Inspect Location', actionType: 'locations' }
        ];
      } else if (lower.includes('post') || lower.includes('content')) {
        botResponse = 'I drafted a high-converting announcement post for your Labor Day weekend brunch and live jazz sessions. You can review, customize, and approve it before scheduling to Google.';
        recs = [
          { id: 'p1', title: 'Review AI Post Draft', impact: 'Medium', buttonLabel: 'Open Post Studio', actionType: 'posts' }
        ];
      } else {
        botResponse = `I conducted a sweep for "${promptText}". All location profiles are synchronized with Google Business Profile APIs. You have 108 healthy locations and 19 optimizations available.`;
        recs = [
          { id: 'g1', title: 'Inspect Dashboard Overview', impact: 'Medium', buttonLabel: 'Go to Dashboard', actionType: 'dashboard' }
        ];
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `bot-${Date.now()}`,
          sender: 'assistant',
          timestamp: 'Just now',
          text: botResponse,
          actionableRecommendations: recs
        }
      ]);
      setIsTyping(false);
    }, 700);
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
      title="✨ Local SEO Assistant"
      description="Your AI-powered local growth assistant."
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
              placeholder="Ask anything about your local rankings, reviews..."
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
            <span>AI recommendations require manual confirmation prior to Google publication</span>
          </div>
        </div>
      }
    >
      <div className="space-y-4 text-xs">
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
