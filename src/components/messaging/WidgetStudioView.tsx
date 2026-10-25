import React, { useState } from 'react';
import {
  Code,
  Copy,
  Check,
  Globe,
  Sliders,
  Sparkles,
  Eye,
  Send,
  ExternalLink,
  ShieldCheck,
  Save,
  MessageSquare,
  Laptop,
  Smartphone
} from 'lucide-react';
import { WidgetConfig } from './types';

interface WidgetStudioViewProps {
  widget: WidgetConfig;
  onSaveWidget: (updated: WidgetConfig) => Promise<void>;
  onTestMessageSent?: (content: string) => void;
}

export const WidgetStudioView: React.FC<WidgetStudioViewProps> = ({
  widget,
  onSaveWidget,
  onTestMessageSent
}) => {
  const [config, setConfig] = useState<WidgetConfig>(widget);
  const [copied, setCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Sandbox Live Test State
  const [isSandboxOpen, setIsSandboxOpen] = useState(true);
  const [sandboxInput, setSandboxInput] = useState('');
  const [sandboxMessages, setSandboxMessages] = useState<Array<{ sender: 'agent' | 'visitor'; text: string; time: string }>>([
    {
      sender: 'agent',
      text: config.greetingMessage,
      time: 'Just now'
    }
  ]);
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const embedCode = `<script async src="${origin}/api/widget/embed.js?key=${config.widgetKey}"></script>`;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(embedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSaveWidget(config);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendSandboxMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sandboxInput.trim()) return;

    const userText = sandboxInput.trim();
    setSandboxMessages((prev) => [
      ...prev,
      {
        sender: 'visitor',
        text: userText,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ]);
    setSandboxInput('');

    if (onTestMessageSent) {
      onTestMessageSent(userText);
    }

    // Auto reply simulation in sandbox
    setTimeout(() => {
      setSandboxMessages((prev) => [
        ...prev,
        {
          sender: 'agent',
          text: config.autoReplyMessage || 'Thanks for trying out the widget preview! We received your message.',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    }, 1000);
  };

  const colorPresets = ['#2563eb', '#4f46e5', '#059669', '#d97706', '#dc2626', '#0f172a'];

  return (
    <div className="flex-1 flex flex-col lg:flex-row h-full overflow-y-auto bg-neutral-950/60 backdrop-blur-xl relative">
      {/* Left Settings & Code Generator Column */}
      <div className="w-full lg:w-1/2 p-6 lg:p-8 space-y-8 border-r border-white/5 overflow-y-auto">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 rounded-lg bg-blue-600/20 text-blue-400">
              <Sliders className="w-4 h-4" />
            </span>
            <h2 className="text-xl font-bold text-white tracking-tight">Widget Studio & Embed Code</h2>
          </div>
          <p className="text-xs text-neutral-400">
            Configure your embeddable live chat widget, customize branding, and copy the single script tag.
          </p>
        </div>

        {/* 1-Click Embed Snippet Card */}
        <div className="p-5 rounded-2xl bg-neutral-900/90 border border-white/10 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Code className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-white">Embed Script Tag</h3>
            </div>
            <span className="text-[11px] font-mono text-neutral-400">Key: {config.widgetKey}</span>
          </div>

          <p className="text-xs text-neutral-300">
            Paste this snippet immediately before the closing <code className="text-blue-400 font-mono">&lt;/body&gt;</code> tag on any website (WordPress, Shopify, Next.js, Webflow, or static HTML):
          </p>

          <div className="relative">
            <pre className="p-3.5 rounded-xl bg-neutral-950 border border-white/10 font-mono text-xs text-emerald-400 overflow-x-auto whitespace-pre-wrap leading-relaxed select-all">
              {embedCode}
            </pre>
            <button
              id="btn-copy-widget-embed"
              onClick={handleCopyCode}
              className={`absolute top-2.5 right-2.5 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                copied
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white/10 hover:bg-white/20 text-white'
              }`}
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Snippet</span>
                </>
              )}
            </button>
          </div>

          {/* Quick Integration Tabs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
            {['WordPress', 'Shopify', 'Next.js / React', 'Webflow'].map((platform) => (
              <div key={platform} className="p-2 rounded-lg bg-white/[0.03] border border-white/5 text-center">
                <span className="text-[11px] font-semibold text-neutral-300">{platform}</span>
                <p className="text-[9px] text-neutral-500 mt-0.5">Plug & play script</p>
              </div>
            ))}
          </div>
        </div>

        {/* Visual Customization Form */}
        <div className="space-y-5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
            Appearance & Brand Controls
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Business Name */}
            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1.5">Business Name</label>
              <input
                type="text"
                value={config.businessName}
                onChange={(e) => setConfig({ ...config, businessName: e.target.value })}
                className="w-full bg-neutral-900 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500/50"
              />
            </div>

            {/* Tagline */}
            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1.5">Response Tagline</label>
              <input
                type="text"
                value={config.tagline || ''}
                onChange={(e) => setConfig({ ...config, tagline: e.target.value })}
                className="w-full bg-neutral-900 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500/50"
              />
            </div>
          </div>

          {/* Primary Brand Color */}
          <div>
            <label className="block text-xs font-medium text-neutral-300 mb-2">Primary Brand Color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={config.primaryColor}
                onChange={(e) => setConfig({ ...config, primaryColor: e.target.value })}
                className="w-9 h-9 rounded-xl border-none cursor-pointer bg-transparent"
              />
              <input
                type="text"
                value={config.primaryColor}
                onChange={(e) => setConfig({ ...config, primaryColor: e.target.value })}
                className="w-28 bg-neutral-900 border border-white/10 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none"
              />
              <div className="flex items-center gap-1.5">
                {colorPresets.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => setConfig({ ...config, primaryColor: hex })}
                    className="w-6 h-6 rounded-full border border-white/20 transition-transform hover:scale-110 cursor-pointer"
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Position */}
          <div>
            <label className="block text-xs font-medium text-neutral-300 mb-1.5">Launcher Screen Position</label>
            <div className="grid grid-cols-2 gap-3">
              {(['bottom-right', 'bottom-left'] as const).map((pos) => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => setConfig({ ...config, position: pos })}
                  className={`p-3 rounded-xl border text-xs font-medium capitalize transition-all cursor-pointer ${
                    config.position === pos
                      ? 'bg-blue-600/20 border-blue-500 text-white font-semibold'
                      : 'bg-neutral-900 border-white/10 text-neutral-400 hover:text-white'
                  }`}
                >
                  {pos.replace('-', ' ')}
                </button>
              ))}
            </div>
          </div>

          {/* Welcome Greeting */}
          <div>
            <label className="block text-xs font-medium text-neutral-300 mb-1.5">Welcome Greeting Message</label>
            <textarea
              rows={2}
              value={config.greetingMessage}
              onChange={(e) => setConfig({ ...config, greetingMessage: e.target.value })}
              className="w-full bg-neutral-900 border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-blue-500/50 resize-none"
            />
          </div>

          {/* Auto-reply Message */}
          <div>
            <label className="block text-xs font-medium text-neutral-300 mb-1.5">Instant Auto-Reply</label>
            <input
              type="text"
              value={config.autoReplyMessage}
              onChange={(e) => setConfig({ ...config, autoReplyMessage: e.target.value })}
              className="w-full bg-neutral-900 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500/50"
            />
          </div>

          {/* Require Visitor Email Toggle */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-neutral-900/60 border border-white/5">
            <div>
              <p className="text-xs font-semibold text-white">Require Visitor Email</p>
              <p className="text-[11px] text-neutral-400">Prompt visitor for email address before starting chat</p>
            </div>
            <button
              type="button"
              onClick={() => setConfig({ ...config, requireEmail: !config.requireEmail })}
              className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                config.requireEmail ? 'bg-blue-600' : 'bg-neutral-700'
              }`}
            >
              <span
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  config.requireEmail ? 'right-1' : 'left-1'
                }`}
              />
            </button>
          </div>

          {/* Save Button */}
          <div className="pt-2">
            <button
              id="btn-save-widget-config"
              onClick={handleSave}
              disabled={isSaving}
              className={`flex items-center justify-center gap-2 w-full py-3 rounded-xl font-semibold text-xs shadow-lg transition-all cursor-pointer ${
                savedSuccess
                  ? 'bg-emerald-600 text-white'
                  : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/20'
              }`}
            >
              {savedSuccess ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Widget Settings Saved & Live!</span>
                </>
              ) : isSaving ? (
                <span>Deploying Updates...</span>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>Save & Publish Widget</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Right Column: Interactive Sandbox Preview */}
      <div className="w-full lg:w-1/2 p-6 lg:p-8 flex flex-col justify-between bg-neutral-900/30 overflow-hidden">
        {/* Sandbox Top Bar */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-blue-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-white">
              Live Interactive Website Sandbox
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setPreviewDevice('desktop')}
              className={`p-1.5 rounded-lg text-xs cursor-pointer ${
                previewDevice === 'desktop' ? 'bg-white/10 text-white' : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              <Laptop className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPreviewDevice('mobile')}
              className={`p-1.5 rounded-lg text-xs cursor-pointer ${
                previewDevice === 'mobile' ? 'bg-white/10 text-white' : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              <Smartphone className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Mock Host Website Container */}
        <div className={`flex-1 rounded-2xl border border-white/10 bg-neutral-950/80 shadow-2xl relative overflow-hidden flex flex-col transition-all mx-auto w-full ${
          previewDevice === 'mobile' ? 'max-w-sm h-[640px]' : 'h-[580px]'
        }`}>
          {/* Simulated Browser Address Bar */}
          <div className="h-9 px-4 bg-neutral-900 border-b border-white/5 flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
            </div>
            <div className="flex-1 max-w-xs mx-auto bg-neutral-950 px-3 py-1 rounded-md text-[10px] text-neutral-400 font-mono text-center truncate">
              https://your-company-domain.com/pricing
            </div>
          </div>

          {/* Simulated Website Content (Clean modern SaaS landing) */}
          <div className="flex-1 p-6 overflow-y-auto space-y-6 opacity-60">
            <div className="space-y-2">
              <div className="h-6 w-40 bg-white/20 rounded-md" />
              <div className="h-3 w-64 bg-white/10 rounded" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-white/[0.03] border border-white/5 space-y-2">
                <div className="h-4 w-20 bg-blue-500/40 rounded" />
                <div className="h-3 w-full bg-white/10 rounded" />
                <div className="h-8 w-24 bg-white/15 rounded-lg mt-3" />
              </div>
              <div className="p-4 rounded-xl bg-white/[0.03] border border-white/5 space-y-2">
                <div className="h-4 w-24 bg-emerald-500/40 rounded" />
                <div className="h-3 w-full bg-white/10 rounded" />
                <div className="h-8 w-24 bg-white/15 rounded-lg mt-3" />
              </div>
            </div>

            <p className="text-[11px] text-neutral-400 leading-relaxed">
              This simulated canvas mirrors how your visitors experience the chat bubble on your production website. Try clicking the launcher and typing!
            </p>
          </div>

          {/* Interactive Chat Widget Overlay inside Mockup */}
          <div
            className={`absolute ${
              config.position === 'bottom-left' ? 'bottom-4 left-4' : 'bottom-4 right-4'
            } z-20 flex flex-col items-end`}
          >
            {/* Chatbox Window */}
            {isSandboxOpen && (
              <div className="w-72 sm:w-80 h-96 rounded-2xl bg-neutral-900 border border-white/15 shadow-2xl flex flex-col overflow-hidden mb-3 animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div
                  className="p-3.5 flex items-center justify-between text-white"
                  style={{ backgroundColor: config.primaryColor }}
                >
                  <div className="flex items-center gap-2.5">
                    <img
                      src={config.avatarUrl}
                      alt="Avatar"
                      className="w-8 h-8 rounded-full object-cover ring-2 ring-white/20"
                    />
                    <div>
                      <h4 className="text-xs font-bold leading-tight">{config.businessName}</h4>
                      <p className="text-[10px] opacity-80">{config.tagline || 'Online Support'}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsSandboxOpen(false)}
                    className="p-1 rounded hover:bg-black/20 text-white cursor-pointer"
                  >
                    &times;
                  </button>
                </div>

                {/* Messages Body */}
                <div className="flex-1 p-3 overflow-y-auto space-y-2 bg-neutral-950 text-xs">
                  {sandboxMessages.map((m, i) => (
                    <div
                      key={i}
                      className={`flex flex-col ${
                        m.sender === 'visitor' ? 'items-end' : 'items-start'
                      }`}
                    >
                      <div
                        className={`p-2.5 rounded-xl max-w-[85%] text-xs leading-relaxed ${
                          m.sender === 'visitor'
                            ? 'bg-blue-600 text-white rounded-br-none'
                            : 'bg-neutral-800 text-neutral-100 rounded-bl-none border border-white/5'
                        }`}
                        style={m.sender === 'visitor' ? { backgroundColor: config.primaryColor } : {}}
                      >
                        {m.text}
                      </div>
                      <span className="text-[9px] text-neutral-500 mt-0.5 px-1">{m.time}</span>
                    </div>
                  ))}
                </div>

                {/* Input Form */}
                <form
                  onSubmit={handleSendSandboxMessage}
                  className="p-2.5 bg-neutral-900 border-t border-white/10 flex gap-2"
                >
                  <input
                    type="text"
                    value={sandboxInput}
                    onChange={(e) => setSandboxInput(e.target.value)}
                    placeholder={config.placeholderText}
                    className="flex-1 bg-neutral-950 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="p-2 rounded-lg text-white cursor-pointer"
                    style={{ backgroundColor: config.primaryColor }}
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>
              </div>
            )}

            {/* Launcher Button */}
            <button
              onClick={() => setIsSandboxOpen(!isSandboxOpen)}
              className="w-13 h-13 rounded-full flex items-center justify-center text-white shadow-xl hover:scale-105 transition-transform cursor-pointer"
              style={{ backgroundColor: config.primaryColor }}
            >
              <MessageSquare className="w-6 h-6" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WidgetStudioView;
