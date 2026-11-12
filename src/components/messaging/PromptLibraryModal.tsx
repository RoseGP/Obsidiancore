import React, { useState } from 'react';
import {
  X,
  Sparkles,
  BookOpen,
  Copy,
  Check,
  Send,
  Sliders,
  Layers,
  FileCode,
  Shield,
  HelpCircle,
  Plus,
  ListOrdered,
  ArrowRight
} from 'lucide-react';
import { StructuredPromptData, StructuredInstructionData } from './types';

interface PromptLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  prompts: StructuredPromptData[];
  onSelectPrompt: (prompt: StructuredPromptData, asCard: boolean) => void;
  onSelectInstruction: (instruction: StructuredInstructionData) => void;
  clientContextName?: string;
  companyContextName?: string;
}

export const PromptLibraryModal: React.FC<PromptLibraryModalProps> = ({
  isOpen,
  onClose,
  prompts,
  onSelectPrompt,
  onSelectInstruction,
  clientContextName = '',
  companyContextName = ''
}) => {
  const [activeTab, setActiveTab] = useState<'prompts' | 'sop' | 'custom'>('prompts');
  const [selectedPrompt, setSelectedPrompt] = useState<StructuredPromptData | null>(prompts[0] || null);
  const [copied, setCopied] = useState(false);

  // Custom prompt builder state
  const [customTitle, setCustomTitle] = useState('');
  const [customCategory, setCustomCategory] = useState('Sales');
  const [customGoal, setCustomGoal] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [customTemplate, setCustomTemplate] = useState('');

  // SOP checklist builder state
  const [sopTitle, setSopTitle] = useState('');
  const [sopCategory, setSopCategory] = useState('Client Operations');
  const [sopSteps, setSopSteps] = useState<Array<{ id: string; text: string; completed: boolean; assignee: string }>>([]);
  const [newStepText, setNewStepText] = useState('');

  if (!isOpen) return null;

  const currentTemplateReplaced = selectedPrompt
    ? selectedPrompt.template
        .replace(/\{\{client_name\}\}/g, clientContextName)
        .replace(/\{\{company_name\}\}/g, companyContextName)
        .replace(/\{\{project_name\}\}/g, companyContextName ? `${companyContextName} project` : '{{project_name}}')
        .replace(/\{\{deal_value\}\}/g, '$120,000 ARR')
    : '';

  const handleCopy = () => {
    navigator.clipboard?.writeText(currentTemplateReplaced);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAddSopStep = () => {
    if (!newStepText.trim()) return;
    setSopSteps((prev) => [
      ...prev,
      {
        id: `step_${Date.now()}`,
        text: newStepText.trim(),
        completed: false,
        assignee: ''
      }
    ]);
    setNewStepText('');
  };

  const handleSendCustomPrompt = (asCard: boolean) => {
    if (!customTitle.trim() || !customTemplate.trim()) return;
    const p: StructuredPromptData = {
      title: customTitle.trim(),
      category: customCategory,
      goal: customGoal.trim(),
      instructions: customInstructions.split('\n').filter(Boolean),
      template: customTemplate.trim(),
      modelSuggestion: 'gemini-2.5-flash'
    };
    onSelectPrompt(p, asCard);
    onClose();
  };

  const handleSendSop = () => {
    if (!sopTitle.trim() || sopSteps.length === 0) return;
    onSelectInstruction({
      title: sopTitle,
      sopCategory,
      steps: sopSteps
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--surface)] backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-4xl h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface-sunken)]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-[var(--accent-text)]">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--text)]">Structured Prompts & SOP Instructions</h3>
              <p className="text-xs text-[var(--text-muted)]">
                Enterprise AI blueprints, sales objection guides, and step-by-step collaboration checklists
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center bg-[var(--surface-sunken)] p-1 rounded-xl border border-[var(--border)] text-xs">
              <button
                onClick={() => setActiveTab('prompts')}
                className={`px-3 py-1.5 rounded-lg transition font-medium cursor-pointer ${
                  activeTab === 'prompts' ? 'bg-purple-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                Enterprise Prompts
              </button>
              <button
                onClick={() => setActiveTab('sop')}
                className={`px-3 py-1.5 rounded-lg transition font-medium cursor-pointer ${
                  activeTab === 'sop' ? 'bg-purple-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                SOP Checklists
              </button>
              <button
                onClick={() => setActiveTab('custom')}
                className={`px-3 py-1.5 rounded-lg transition font-medium cursor-pointer ${
                  activeTab === 'custom' ? 'bg-purple-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                Custom Builder
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--border)] transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        {activeTab === 'prompts' && (
          <div className="flex-1 flex overflow-hidden">
            {/* Left list of prompts */}
            <div className="w-80 border-r border-[var(--border)] bg-[var(--surface-sunken)] p-4 space-y-2 overflow-y-auto shrink-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-subtle)] px-2 mb-2">
                Available Templates ({prompts.length})
              </p>
              {prompts.map((p) => {
                const isSelected = selectedPrompt?.title === p.title;
                return (
                  <button
                    key={p.title}
                    onClick={() => setSelectedPrompt(p)}
                    className={`w-full text-left p-3 rounded-xl border transition cursor-pointer ${
                      isSelected
                        ? 'bg-purple-500/10 border-purple-500/30 text-[var(--text)]'
                        : 'bg-[var(--surface-sunken)] border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--border)] hover:border-[var(--border)]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-semibold text-[var(--accent-text)] bg-purple-500/10 px-2 py-0.5 rounded-full border border-purple-500/20">
                        {p.category}
                      </span>
                      {p.modelSuggestion && (
                        <span className="text-[10px] text-[var(--text-muted)] font-mono">{p.modelSuggestion}</span>
                      )}
                    </div>
                    <h4 className="text-xs font-semibold line-clamp-1">{p.title}</h4>
                    <p className="text-[11px] text-[var(--text-muted)] line-clamp-2 mt-1">{p.goal}</p>
                  </button>
                );
              })}
            </div>

            {/* Right preview and actions */}
            {selectedPrompt ? (
              <div className="flex-1 flex flex-col overflow-hidden bg-[var(--surface)]">
                <div className="flex-1 overflow-y-auto p-6 space-y-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-xs font-semibold text-[var(--accent-text)] bg-purple-500/10 px-2.5 py-1 rounded-full border border-purple-500/20">
                        {selectedPrompt.category}
                      </span>
                      <h2 className="text-lg font-bold text-[var(--text)] mt-2">{selectedPrompt.title}</h2>
                      <p className="text-xs text-[var(--text-muted)] mt-1">{selectedPrompt.goal}</p>
                    </div>
                  </div>

                  {/* Instructions */}
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2 flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-[var(--accent-text)]" />
                      Guided Instructions
                    </h4>
                    <ul className="space-y-1.5">
                      {selectedPrompt.instructions.map((inst, i) => (
                        <li key={i} className="text-xs text-[var(--text-muted)] flex items-start gap-2 bg-[var(--surface-sunken)] p-2 rounded-lg">
                          <span className="w-4 h-4 rounded-full bg-purple-500/20 text-[var(--accent-text)] flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                            {i + 1}
                          </span>
                          <span>{inst}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Template Preview */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                        <FileCode className="w-3.5 h-3.5 text-[var(--accent-text)]" />
                        Prompt Template (Populated with CRM Context: {clientContextName})
                      </h4>
                      <button
                        onClick={handleCopy}
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] flex items-center gap-1 px-2 py-1 rounded bg-[var(--surface-sunken)] hover:bg-[var(--border)] transition cursor-pointer"
                      >
                        {copied ? <Check className="w-3.5 h-3.5 text-[var(--success)]" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copied ? 'Copied' : 'Copy Text'}</span>
                      </button>
                    </div>
                    <pre className="p-4 rounded-xl bg-[var(--surface-sunken)] border border-[var(--border)] text-xs font-mono text-[var(--text-muted)] whitespace-pre-wrap leading-relaxed">
                      {currentTemplateReplaced}
                    </pre>
                  </div>
                </div>

                {/* Footer Buttons */}
                <div className="px-6 py-4 border-t border-[var(--border)] bg-[var(--surface-sunken)] flex items-center justify-end gap-3">
                  <button
                    onClick={() => {
                      onSelectPrompt(selectedPrompt, false);
                      onClose();
                    }}
                    className="px-4 py-2 rounded-xl bg-[var(--border)] hover:bg-[var(--border)] text-[var(--text)] text-xs font-medium transition cursor-pointer"
                  >
                    Insert Text in Composer
                  </button>
                  <button
                    onClick={() => {
                      onSelectPrompt(selectedPrompt, true);
                      onClose();
                    }}
                    className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium flex items-center gap-1.5 shadow-lg shadow-purple-600/30 transition cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Send as Structured Prompt Card</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-[var(--text-subtle)] text-xs">
                Select a prompt from the list to view details
              </div>
            )}
          </div>
        )}

        {/* Tab 2: SOP Checklist */}
        {activeTab === 'sop' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[var(--surface)]">
            <div>
              <h3 className="text-base font-bold text-[var(--text)] mb-1">Standard Operating Procedure (SOP) Checklist</h3>
              <p className="text-xs text-[var(--text-muted)]">
                Share an interactive step-by-step checklist card directly into the chat timeline for team members to collaborate on.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">SOP Title</label>
                <input
                  type="text"
                  value={sopTitle}
                  onChange={(e) => setSopTitle(e.target.value)}
                  className="w-full bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Category</label>
                <input
                  type="text"
                  value={sopCategory}
                  onChange={(e) => setSopCategory(e.target.value)}
                  className="w-full bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>

            {/* Steps list */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-2">Checklist Steps ({sopSteps.length})</label>
              <div className="space-y-2 mb-3">
                {sopSteps.map((step, idx) => (
                  <div
                    key={step.id}
                    className="flex items-center justify-between p-3 rounded-xl bg-[var(--surface-sunken)] border border-[var(--border)] text-xs text-[var(--text)]"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-purple-500/20 text-[var(--accent-text)] font-mono flex items-center justify-center text-[10px]">
                        {idx + 1}
                      </span>
                      <span>{step.text}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-[var(--text-muted)] bg-[var(--surface-sunken)] px-2 py-0.5 rounded">
                        {step.assignee}
                      </span>
                      <button
                        onClick={() => setSopSteps((prev) => prev.filter((s) => s.id !== step.id))}
                        className="text-[var(--text-subtle)] hover:text-[var(--danger)] text-xs"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add step input */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newStepText}
                  onChange={(e) => setNewStepText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddSopStep()}
                  placeholder="Enter next verification step and press Enter..."
                  className="flex-1 bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] focus:outline-none focus:border-purple-500"
                />
                <button
                  onClick={handleAddSopStep}
                  className="px-3 py-2 rounded-xl bg-[var(--border)] hover:bg-[var(--border)] text-[var(--text)] text-xs font-medium flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Step</span>
                </button>
              </div>
            </div>

            <div className="pt-4 border-t border-[var(--border)] flex justify-end">
              <button
                onClick={handleSendSop}
                className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center gap-2 shadow-lg shadow-purple-600/30 transition cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send SOP Checklist into Chat</span>
              </button>
            </div>
          </div>
        )}

        {/* Tab 3: Custom Builder */}
        {activeTab === 'custom' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-[var(--surface)]">
            <div>
              <h3 className="text-base font-bold text-[var(--text)] mb-1">Create Custom Prompt Blueprint</h3>
              <p className="text-xs text-[var(--text-muted)]">
                Design reusable enterprise prompts with variables like <code>&#123;&#123;client_name&#125;&#125;</code> and instructions.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Prompt Title</label>
                <input
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="e.g. Enterprise SLA Defense Prompt"
                  className="w-full bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Category</label>
                <select
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  className="w-full bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] focus:outline-none focus:border-purple-500"
                >
                  <option value="Sales">Sales & Deal Closing</option>
                  <option value="Security">Security & Compliance</option>
                  <option value="Customer Success">Customer Success</option>
                  <option value="Technical">Technical Operations</option>
                  <option value="Legal">Legal & Contracts</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Objective / Goal</label>
              <input
                type="text"
                value={customGoal}
                onChange={(e) => setCustomGoal(e.target.value)}
                placeholder="What does this prompt achieve for the CRM workflow?"
                className="w-full bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Instructions (1 per line)</label>
              <textarea
                rows={3}
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                placeholder="1. Reiterate client SLA requirement&#10;2. Offer security briefing with Sarah"
                className="w-full bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] focus:outline-none focus:border-purple-500 resize-none font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Prompt Template Content</label>
              <textarea
                rows={5}
                value={customTemplate}
                onChange={(e) => setCustomTemplate(e.target.value)}
                placeholder="Hi {{client_name}},&#10;&#10;Here are the details regarding your request for {{company_name}}..."
                className="w-full bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] focus:outline-none focus:border-purple-500 font-mono resize-none leading-relaxed"
              />
            </div>

            <div className="pt-4 border-t border-[var(--border)] flex justify-end gap-3">
              <button
                onClick={() => handleSendCustomPrompt(false)}
                className="px-4 py-2 rounded-xl bg-[var(--border)] hover:bg-[var(--border)] text-[var(--text)] text-xs font-medium transition cursor-pointer"
              >
                Insert into Composer
              </button>
              <button
                onClick={() => handleSendCustomPrompt(true)}
                className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center gap-2 shadow-lg shadow-purple-600/30 transition cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send as Prompt Card</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
