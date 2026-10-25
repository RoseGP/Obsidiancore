import React, { useState } from 'react';
import { 
  FileText, Download, Mail, Calendar, 
  Eye, CheckCircle2, Share2, Plus, Sparkles,
  TrendingUp, Star, MousePointerClick, Zap
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Dialog } from '../ui/Dialog';
import { ReportItem } from '../types';

export interface ReportsViewProps {
  reports: ReportItem[];
  onDownloadPdf: (reportId: string) => void;
  onSendEmail: (reportId: string) => void;
  onScheduleReport: () => void;
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  reports,
  onDownloadPdf,
  onSendEmail,
  onScheduleReport
}) => {
  const [selectedReport, setSelectedReport] = useState<ReportItem | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const handlePreview = (rep: ReportItem) => {
    setSelectedReport(rep);
    setIsPreviewOpen(true);
  };

  const templates = [
    {
      id: 't-1',
      title: 'Executive Local SEO Summary',
      desc: 'High-level C-suite report focusing on revenue-driving customer actions and top-pack rankings.',
      pages: '4 pages'
    },
    {
      id: 't-2',
      title: 'Multi-Location Franchise Scorecard',
      desc: 'Comparative matrix ranking individual regional branches and highlighting outlier issues.',
      pages: '12 pages'
    },
    {
      id: 't-3',
      title: 'Client White-Label Audit Pack',
      desc: 'Unbranded client-ready audit with before-and-after benchmark proofs and actionable fixes.',
      pages: '8 pages'
    }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-200" id="localpilot-reports-view">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Reports & Client Deliverables
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Create white-label reports, schedule recurring PDF deliveries, and export performance audits.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={onScheduleReport}
            leftIcon={<Calendar className="h-3.5 w-3.5" />}
          >
            Schedule Delivery
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => handlePreview(reports[0])}
            leftIcon={<Plus className="h-3.5 w-3.5" />}
          >
            Generate New Report
          </Button>
        </div>
      </div>

      {/* Featured Main Report Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <span className="text-[11px] font-bold text-blue-600 uppercase tracking-wider block mb-1">
              Latest Generated Report
            </span>
            <h2 className="text-lg font-bold text-slate-900">
              Monthly Local SEO Report — September 2026
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Generated automatically on Sep 1, 2026 • Covering 127 active business locations
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePreview(reports[0])}
              leftIcon={<Eye className="h-3.5 w-3.5" />}
            >
              Preview
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => reports[0] && onDownloadPdf(reports[0].id)} disabled={!reports.length}
              leftIcon={<Download className="h-3.5 w-3.5" />}
            >
              Download PDF
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => reports[0] && onSendEmail(reports[0].id)} disabled={!reports.length}
              leftIcon={<Mail className="h-3.5 w-3.5" />}
            >
              Email to Team
            </Button>
          </div>
        </div>

        {/* 4 Report Highlight Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <span className="text-[11px] font-medium text-slate-500 block">Average Visibility</span>
            <div className="text-2xl font-bold text-slate-900 mt-1 flex items-baseline gap-1">
              92 <span className="text-xs text-emerald-600 font-semibold">(+7.2%)</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <span className="text-[11px] font-medium text-slate-500 block">New Reviews</span>
            <div className="text-2xl font-bold text-slate-900 mt-1 flex items-baseline gap-1">
              +43 <span className="text-xs text-amber-600 font-semibold">(4.8 avg)</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <span className="text-[11px] font-medium text-slate-500 block">Customer Actions</span>
            <div className="text-2xl font-bold text-slate-900 mt-1 flex items-baseline gap-1">
              +18% <span className="text-xs text-emerald-600 font-semibold">(2,420 total)</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <span className="text-[11px] font-medium text-slate-500 block">SEO Opportunities</span>
            <div className="text-2xl font-bold text-slate-900 mt-1 flex items-baseline gap-1">
              7 <span className="text-xs text-blue-600 font-semibold">actionable</span>
            </div>
          </div>
        </div>
      </div>

      {/* Report Templates Section */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
          Report Templates
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {templates.map((tpl) => (
            <div
              key={tpl.id}
              className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs flex flex-col justify-between hover:border-slate-300 transition-all"
            >
              <div>
                <div className="h-8 w-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-3">
                  <FileText className="h-4 w-4" />
                </div>
                <h4 className="text-xs font-bold text-slate-900 mb-1">
                  {tpl.title}
                </h4>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {tpl.desc}
                </p>
              </div>

              <div className="pt-3 mt-4 border-t border-slate-100 flex items-center justify-between text-xs">
                <span className="text-slate-400">{tpl.pages}</span>
                <button
                  type="button"
                  onClick={() => handlePreview(reports[0])}
                  className="font-semibold text-blue-600 hover:underline cursor-pointer"
                >
                  Use Template
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Generated Report History Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="p-4 px-5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 tracking-tight">
            Generated Report Archive
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 border-b border-slate-100 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3">Report Name</th>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Generated</th>
                <th className="px-4 py-3">Format</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reports.map((rep) => (
                <tr key={rep.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="px-5 py-3.5 font-semibold text-slate-900">
                    {rep.title}
                  </td>
                  <td className="px-4 py-3.5 text-slate-500">
                    {rep.period}
                  </td>
                  <td className="px-4 py-3.5 text-slate-500">
                    {rep.generatedDate}
                  </td>
                  <td className="px-4 py-3.5">
                    <Badge variant="outline" size="sm">{rep.format}</Badge>
                  </td>
                  <td className="px-4 py-3.5 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="ghost" size="xs" onClick={() => handlePreview(rep)}>
                        Preview
                      </Button>
                      <Button variant="outline" size="xs" onClick={() => onDownloadPdf(rep.id)}>
                        PDF
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Report Preview Dialog Modal */}
      <Dialog
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        title="Report Preview: September 2026 Executive Summary"
        description="White-label Local SEO Performance Deliverable"
        size="lg"
        footer={
          <div className="flex items-center justify-between w-full">
            <span className="text-xs text-slate-500">Ready for client export</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setIsPreviewOpen(false)}>
                Close
              </Button>
              <Button variant="primary" size="sm" onClick={() => {
                onDownloadPdf('rep-01');
                setIsPreviewOpen(false);
              }}>
                Download PDF
              </Button>
            </div>
          </div>
        }
      >
        <div className="p-6 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-6 text-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 pb-4">
            <div>
              <h2 className="text-base font-bold">Acme Hospitality Group</h2>
              <p className="text-[11px] text-slate-500">127 Locations Managed • Powered by LocalPilot</p>
            </div>
            <div className="text-right">
              <span className="text-xs font-bold block">Visibility Score: 92/100</span>
              <span className="text-[10px] text-emerald-600 font-semibold">+7.2% Month-over-Month Lift</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 bg-white rounded-lg border border-slate-200">
              <span className="text-slate-500 block text-[10px] uppercase font-bold">Google Searches</span>
              <span className="text-lg font-bold">58,500</span>
            </div>
            <div className="p-3 bg-white rounded-lg border border-slate-200">
              <span className="text-slate-500 block text-[10px] uppercase font-bold">Phone Calls</span>
              <span className="text-lg font-bold">2,400</span>
            </div>
            <div className="p-3 bg-white rounded-lg border border-slate-200">
              <span className="text-slate-500 block text-[10px] uppercase font-bold">Directions</span>
              <span className="text-lg font-bold">5,100</span>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="font-bold text-xs">Executive Highlights:</h4>
            <p className="text-xs text-slate-500 leading-relaxed">
              During the month of September, total discovery searches across all 127 store profiles increased by 18.2%. The response time to customer reviews improved to an average of 3.2 hours, driving a 7.2% overall lift in local 3-pack search rankings.
            </p>
          </div>
        </div>
      </Dialog>

    </div>
  );
};

export default ReportsView;
