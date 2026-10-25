import React, { useState, useEffect } from "react";
import { Building2, Clock, MapPin, DollarSign, ShieldCheck, PhoneForwarded, Sparkles, BookOpen, Plus } from "lucide-react";
import { ReceptionistQA } from "../../utils/receptionistKnowledgeDb";

interface ReceptionistFAQKnowledgeProps {
  onSelectPrompt: (prompt: string) => void;
  onOpenTrainingStudio?: () => void;
}

export default function ReceptionistFAQKnowledge({
  onSelectPrompt,
  onOpenTrainingStudio
}: ReceptionistFAQKnowledgeProps) {
  const [qas, setQAs] = useState<ReceptionistQA[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const fetchTrainedQAs = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/communication/receptionist/knowledge');
      const data = await res.json();
      if (data.success && data.store?.qas) {
        setQAs(data.store.qas.filter((q: ReceptionistQA) => q.enabled));
      }
    } catch (err) {
      console.warn('[ReceptionistFAQKnowledge] Falling back to default list:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrainedQAs();
  }, []);

  const displayedQAs = qas.length > 0 ? qas.slice(0, 6) : [
    {
      id: "f1",
      category: "general" as const,
      priority: "high" as const,
      enabled: true,
      keywords: ["hours", "open"],
      question: "What are your business hours?",
      answer: "Monday through Friday, 8:00 AM to 6:00 PM Pacific Time. Emergency 24/7 on-call DevOps for Tier-1 enterprise SLAs."
    },
    {
      id: "f2",
      category: "general" as const,
      priority: "high" as const,
      enabled: true,
      keywords: ["location", "address", "hq"],
      question: "Where is your office located?",
      answer: "500 Howard Street, Suite 1400, San Francisco, CA 94105. Visitor badges prepared by front desk security."
    },
    {
      id: "f3",
      category: "pricing" as const,
      priority: "high" as const,
      enabled: true,
      keywords: ["pricing", "cost", "plans"],
      question: "What are your platform pricing plans?",
      answer: "Starter ($49/mo), Pro Suite ($1,000/mo with dedicated edge hosting), and Custom Enterprise Sovereign with zero-trust SLAs."
    },
    {
      id: "f4",
      category: "security" as const,
      priority: "high" as const,
      enabled: true,
      keywords: ["security", "soc2", "compliance"],
      question: "Can you tell me about your security and SOC2 compliance?",
      answer: "SOC 2 Type II certified, HIPAA compliant, ISO 27001, and zero-trust WebRTC end-to-end encryption."
    }
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm text-left">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
            Receptionist Knowledge Base ({displayedQAs.length} Active)
          </h3>
        </div>

        <div className="flex items-center gap-2">
          {onOpenTrainingStudio && (
            <button
              onClick={onOpenTrainingStudio}
              className="flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-700 px-2.5 py-1 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-all cursor-pointer shadow-sm active:scale-95"
            >
              <Sparkles className="h-3 w-3 text-blue-600" />
              <span>Train AI Receptionist</span>
            </button>
          )}
          <span className="text-[10px] font-semibold text-slate-400 hidden sm:inline">Click to Ask Voice</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {displayedQAs.map((faq) => (
          <div
            key={faq.id}
            onClick={() => onSelectPrompt(faq.question)}
            className="p-3 rounded-2xl bg-slate-50 hover:bg-blue-50/60 border border-slate-200 hover:border-blue-300 transition-all cursor-pointer group"
          >
            <div className="flex items-center justify-between gap-1 mb-1">
              <h4 className="text-xs font-bold text-slate-900 group-hover:text-blue-600 transition-colors line-clamp-1">
                {faq.question}
              </h4>
              <span className="text-[10px] text-blue-600 font-mono shrink-0">Ask Voice →</span>
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed line-clamp-2">
              {faq.answer}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
