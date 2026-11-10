import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import axios from 'axios';

export type SemanticView = 
  | 'greet'
  | 'welcome'
  | 'meet_and_greet'
  | 'home' 
  | 'email_assistant'
  | 'chat' // legacy link target: opens Email & Messaging
  | 'voice_hub' 
  | 'video_call' 
  | 'enterprise_proposals'
  | 'dashboard' 
  | 'leads'
  | 'messages' 
  | 'voice_dialer' 
  | 'call_canvas' 
  | 'proposals'
  | 'calendar' 
  | 'analytics' 
  | 'settings' 
  | 'gbp' 
  | 'social_planner'
  | 'deals'
  | 'sales_pipelines'
  | 'public_scheduling'
  | 'voice_messages'      // Phone → WhatsApp & SMS (inbound messages and voicemail)
  | 'voice_receptionist'; // Phone → AI voice receptionist

export interface EmailDraft {
  recipient?: string;
  subject?: string;
  body?: string;
}

export interface NotificationMessage {
  id: string;
  type: 'text' | 'command';
  text: string;
  timestamp: string;
}

interface CommandContextType {
  activeView: SemanticView;
  setActiveView: (view: SemanticView) => void;
  notifications: NotificationMessage[];
  addNotification: (text: string, type?: 'text' | 'command') => void;
  isProcessingCommand: boolean;
  currentDraft: EmailDraft | null;
  setCurrentDraft: (draft: EmailDraft | null) => void;
  clearDraft: () => void;
  isVoiceAssistantActive: boolean;
  setIsVoiceAssistantActive: (active: boolean) => void;
  handleUserCommand: (textInput: string, activeLead?: any) => Promise<{ success: boolean; data?: any; error?: string }>;
  activeVideoCallContactId: string | null;
  setActiveVideoCallContactId: (id: string | null) => void;
  speakText: (text: string) => void;
}

const CommandContext = createContext<CommandContextType | undefined>(undefined);

// Helper function to map view names to standard routing names
export function mapSemanticToView(view: SemanticView): string {
  switch (view) {
    case 'welcome':
    case 'meet_and_greet':
    case 'greet':
      return 'greet';
    case 'home':
      return 'dashboard';
    case 'email_assistant':
      return 'messages';
    case 'voice_hub':
      return 'voice_dialer';
    case 'video_call':
      return 'call_canvas';
    case 'enterprise_proposals':
      return 'proposals';
    case 'sales_pipelines':
    case 'deals':
      return 'deals';
    default:
      return view;
  }
}

export function CommandProvider({ children }: { children: ReactNode }) {
  const [activeView, setActiveViewState] = useState<SemanticView>(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash.replace('#', '') as SemanticView : '';
    if (hash && ['greet', 'dashboard', 'messages', 'calendar', 'analytics', 'settings', 'gbp', 'proposals', 'social_planner', 'deals', 'sales_pipelines', 'voice_dialer', 'call_canvas', 'public_scheduling'].includes(hash)) {
      return hash;
    }
    return 'messages';
  });

  const [notifications, setNotifications] = useState<NotificationMessage[]>([
    {
      id: 'init',
      type: 'text',
      text: 'Obsidian Command Layer activated. Ready to coordinate multi-channel campaigns.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);

  const [isProcessingCommand, setIsProcessingCommand] = useState(false);
  const [currentDraft, setCurrentDraft] = useState<EmailDraft | null>(null);
  const [isVoiceAssistantActive, setIsVoiceAssistantActive] = useState<boolean>(true);
  const [activeVideoCallContactId, setActiveVideoCallContactId] = useState<string | null>(null);

  const setActiveView = (view: SemanticView) => {
    const mapped = mapSemanticToView(view) as SemanticView;
    setActiveViewState(mapped);
    // Only write the hash when it changes: rewriting the same value fires hashchange/navigation
    // events and re-renders the shell (this caused a loop on the Social Planner).
    if (typeof window !== 'undefined' && window.location.hash !== `#${mapped}`) {
      window.location.hash = mapped;
    }
  };

  const addNotification = (text: string, type: 'text' | 'command' = 'text') => {
    const newNotif: NotificationMessage = {
      id: `notif-${Date.now()}`,
      type,
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setNotifications(prev => [newNotif, ...prev].slice(0, 50));
  };

  const clearDraft = () => {
    setCurrentDraft(null);
  };

  const speakText = (text: string) => {
    if (!isVoiceAssistantActive) return;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        // Strip markdown elements for clean speech synthesis
        const cleanText = text
          .replace(/###/g, '')
          .replace(/\*\*/g, '')
          .replace(/\*/g, '')
          .replace(/`/g, '')
          .replace(/- /g, '')
          .substring(0, 300); // Limit speech length to keep it responsive

        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.rate = 1.05;
        utterance.pitch = 1.0;
        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn('[SpeechSynthesis Error]:', err);
      }
    }
  };

  const handleUserCommand = async (textInput: string, activeLead?: any): Promise<{ success: boolean; data?: any; error?: string }> => {
    if (!textInput.trim() || isProcessingCommand) {
      return { success: false, error: 'Empty or busy command dispatcher' };
    }

    setIsProcessingCommand(true);
    try {
      addNotification(`User Command: "${textInput}"`, 'text');
      const response = await axios.post('/api/chat', {
        message: textInput,
        prompt: textInput,
        sessionId: 'crm-main-session',
        userId: 'demo-user-123',
        activeLead: activeLead || null,
      });
      const data = response.data;

      if (data) {
        const { type, message, action, params } = data;

        // 1. Append response message to local notifications feed
        addNotification(message || 'Command parsed.', type || 'text');

        // 2. Synthesize audio voice reply if text mode
        if (message) {
          speakText(message);
        }

        // 3. Handle specific action routines
        if (type === 'command' && action) {
          switch (action) {
            case 'email_draft':
              if (params) {
                setCurrentDraft({
                  recipient: params.recipient || '',
                  subject: params.subject || '',
                  body: params.body || ''
                });
              }
              setActiveView('messages');
              addNotification('Transitioning active workspace to AI Email Assistant Composer.', 'command');
              break;

            case 'initialize_video_call':
              if (params && params.contactId) {
                setActiveVideoCallContactId(params.contactId);
              } else {
                setActiveVideoCallContactId('1'); // default to Sarah Jenkins
              }
              setActiveView('call_canvas');
              addNotification('Initializing Peer-to-Peer WebRTC consultation overlay.', 'command');
              break;

            case 'voice_hub':
              setActiveView('voice_dialer');
              addNotification('Transitioning active workspace to AI Voice Hub.', 'command');
              break;

            case 'enterprise_proposals':
              setActiveView('proposals');
              addNotification('Transitioning active workspace to Enterprise SLA Proposals Dashboard.', 'command');
              break;

            case 'home':
              setActiveView('dashboard');
              addNotification('Returning dashboard view back to overview cockpit.', 'command');
              break;

            default:
              console.warn(`Unrecognized dashboard action transition: ${action}`);
          }
        }

        return { success: true, data };
      }

      return { success: false, error: 'Empty dispatcher response' };
    } catch (err: any) {
      console.error('[Command Dispatcher API Error]:', err);
      const errMsg = `Connection to Obsidian command nodes failed: ${err.message}`;
      addNotification(`⚠️ Error: ${errMsg}`, 'text');
      return { success: false, error: errMsg };
    } finally {
      setIsProcessingCommand(false);
    }
  };

  // Synchronize with URL hash changes manually for clean layout state coordination
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '') as SemanticView;
      if (hash && hash !== activeView) {
        setActiveViewState(hash);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, [activeView]);

  return (
    <CommandContext.Provider value={{
      activeView,
      setActiveView,
      notifications,
      addNotification,
      isProcessingCommand,
      currentDraft,
      setCurrentDraft,
      clearDraft,
      isVoiceAssistantActive,
      setIsVoiceAssistantActive,
      handleUserCommand,
      activeVideoCallContactId,
      setActiveVideoCallContactId,
      speakText
    }}>
      {children}
    </CommandContext.Provider>
  );
}

export function useCommand() {
  const context = useContext(CommandContext);
  if (context === undefined) {
    throw new Error('useCommand must be used within a CommandProvider');
  }
  return context;
}
