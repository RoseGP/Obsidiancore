import React, { useState } from "react";
import { 
  Building2, PhoneForwarded, Users, Headset, 
  CreditCard, Shield, ExternalLink, ArrowRight,
  CheckCircle2, Clock, AlertCircle, Sparkles
} from "lucide-react";

export interface DepartmentInfo {
  key: string;
  name: string;
  repName: string;
  extension: string;
  description: string;
  status: "available" | "busy" | "meeting";
  icon: string;
}

export const COMPANY_DEPARTMENTS: DepartmentInfo[] = [
  {
    key: "sales",
    name: "Sales & New Accounts",
    repName: "Alex Vance (Sales Director)",
    extension: "Ext: 101",
    description: "Enterprise tier pricing, demo scheduling, custom contracts.",
    status: "available",
    icon: "sales"
  },
  {
    key: "support",
    name: "Technical Support & DevOps",
    repName: "Jordan Reed (Staff Engineer)",
    extension: "Ext: 102",
    description: "API integrations, WebRTC latency, system troubleshooting.",
    status: "available",
    icon: "support"
  },
  {
    key: "billing",
    name: "Billing & Invoicing",
    repName: "Marcus Zhao (Finance Lead)",
    extension: "Ext: 103",
    description: "Invoices, tax exemption, payment methods, SLA refunds.",
    status: "available",
    icon: "billing"
  },
  {
    key: "exec",
    name: "Executive Suite (CEO)",
    repName: "Evelyn Sinclair Desk",
    extension: "Ext: 104",
    description: "Private equity, M&A inquiries, partnership approvals.",
    status: "meeting",
    icon: "exec"
  },
  {
    key: "partnerships",
    name: "Strategic Partnerships",
    repName: "David Kim (Ecosystem VP)",
    extension: "Ext: 105",
    description: "Cloudflare, GCP, and AI ecosystem reseller alliances.",
    status: "available",
    icon: "partnerships"
  }
];

interface ReceptionistDirectoryProps {
  activeDepartment: string | null;
  isTransferring: boolean;
  isCallActive: boolean;
  onTransfer: (deptKey: string, deptName: string) => void;
}

export default function ReceptionistDirectory({
  activeDepartment,
  isTransferring,
  isCallActive,
  onTransfer
}: ReceptionistDirectoryProps) {
  const [selectedDept, setSelectedDept] = useState<DepartmentInfo>(COMPANY_DEPARTMENTS[0]);

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm text-left">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-blue-600" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
            Company Directory & Routing Board
          </h3>
        </div>
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
          5 Lines Live
        </span>
      </div>

      <div className="space-y-2">
        {COMPANY_DEPARTMENTS.map((dept) => {
          const isActive = activeDepartment?.includes(dept.name) || activeDepartment?.includes(dept.repName);

          return (
            <div
              key={dept.key}
              onClick={() => setSelectedDept(dept)}
              className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                isActive
                  ? "bg-blue-50/80 border-blue-300 shadow-sm"
                  : "bg-slate-50/60 hover:bg-slate-100/80 border-slate-200"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-900 truncate">{dept.name}</span>
                  <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded bg-white text-slate-600 border border-slate-200 shrink-0">
                    {dept.extension}
                  </span>
                  {dept.status === "available" ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" title="Available" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" title="In Meeting / Taking Messages" />
                  )}
                </div>
                <p className="text-[11px] text-slate-600 mt-0.5 truncate">{dept.repName}</p>
                <p className="text-[10px] text-slate-500 mt-0.5 truncate">{dept.description}</p>
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onTransfer(dept.key, `${dept.name} (${dept.repName})`);
                }}
                disabled={!isCallActive || isTransferring}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-600 disabled:opacity-40 border border-blue-200 hover:border-blue-600 text-blue-600 hover:text-white text-xs font-bold transition-all shrink-0 cursor-pointer shadow-sm disabled:cursor-not-allowed"
                title={isCallActive ? `Transfer caller to ${dept.name}` : "Start call first to transfer"}
              >
                <PhoneForwarded className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Warm Transfer</span>
                <span className="sm:hidden">Route</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Reception Desk Info Banner */}
      <div className="mt-3 p-2.5 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between text-[10px] text-slate-600">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-blue-600" />
          <span>Hours: Mon–Fri 8:00 AM – 6:00 PM PST</span>
        </div>
        <span className="text-slate-500">HQ: San Francisco, CA</span>
      </div>
    </div>
  );
}
