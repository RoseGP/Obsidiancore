/**
 * Reports: a printable summary built from the data synced from Google (locations, reviews,
 * profile checks). Saved, scheduled and emailed reports aren't built yet, and the page says so.
 */
import React from 'react';
import { Printer, Calendar, Mail, Star } from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { LocationItem, ReviewItem } from '../types';

export interface ReportsViewProps {
  locations: LocationItem[];
  reviews: ReviewItem[];
  onSendEmail: () => void;
  onScheduleReport: () => void;
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  locations,
  reviews,
  onSendEmail,
  onScheduleReport
}) => {
  const total = reviews.length;
  const unanswered = reviews.filter((r) => r.status === 'unanswered').length;
  const avgRating = total ? Math.round((reviews.reduce((a, r) => a + r.rating, 0) / total) * 10) / 10 : null;
  const responseRate = total ? Math.round(((total - unanswered) / total) * 100) : null;
  const avgHealth = locations.length ? Math.round(locations.reduce((a, l) => a + l.visibilityScore, 0) / locations.length) : null;
  const generated = new Date().toLocaleString();

  return (
    <div className="space-y-6 animate-in fade-in duration-200" id="localpilot-reports-view">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1 print:hidden">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Reports</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            A summary of your connected locations from the latest sync. Print it or save it as a PDF from your browser.
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <Button variant="outline" size="sm" onClick={onScheduleReport} leftIcon={<Calendar className="h-3.5 w-3.5" />}>
            Schedule
          </Button>
          <Button variant="outline" size="sm" onClick={onSendEmail} leftIcon={<Mail className="h-3.5 w-3.5" />}>
            Email
          </Button>
          <Button variant="primary" size="sm" onClick={() => window.print()} disabled={!locations.length} leftIcon={<Printer className="h-3.5 w-3.5" />}>
            Print / save as PDF
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-6">
        <div className="pb-4 border-b border-slate-100">
          <span className="text-[11px] font-bold text-blue-600 uppercase tracking-wider block mb-1">Local profile summary</span>
          <h2 className="text-lg font-bold text-slate-900">
            {locations.length} location{locations.length === 1 ? '' : 's'}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Generated {generated} from data synced from Google Business Profile.</p>
        </div>

        {locations.length === 0 ? (
          <p className="text-xs text-slate-500">Connect Google Business Profile and choose locations to build a report.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-[11px] font-medium text-slate-500 block">Average profile health</span>
                <div className="text-2xl font-bold text-slate-900 mt-1">{avgHealth ?? '—'}<span className="text-xs text-slate-400 font-normal"> / 100</span></div>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-[11px] font-medium text-slate-500 block">Reviews synced</span>
                <div className="text-2xl font-bold text-slate-900 mt-1">{total.toLocaleString()}</div>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-[11px] font-medium text-slate-500 block">Average rating</span>
                <div className="text-2xl font-bold text-slate-900 mt-1 flex items-center gap-1">
                  {avgRating ?? '—'} {avgRating !== null && <Star className="h-4 w-4 fill-amber-400 text-amber-400" />}
                </div>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-[11px] font-medium text-slate-500 block">Reviews replied to</span>
                <div className="text-2xl font-bold text-slate-900 mt-1">{responseRate === null ? '—' : `${responseRate}%`}</div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/80 border-b border-slate-100 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Location</th>
                    <th className="px-4 py-3">Profile health</th>
                    <th className="px-4 py-3">Checks to fix</th>
                    <th className="px-4 py-3">Reviews</th>
                    <th className="px-4 py-3">Rating</th>
                    <th className="px-4 py-3">Without reply</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {locations.map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{l.name}</div>
                        <div className="text-[11px] text-slate-500">{[l.address, l.city].filter(Boolean).join(', ')}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={l.status === 'Healthy' ? 'success' : l.status === 'Critical' ? 'danger' : 'warning'} size="sm">{l.visibilityScore} / 100</Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{l.openIssuesCount}</td>
                      <td className="px-4 py-3 text-slate-700">{l.reviewsCount}</td>
                      <td className="px-4 py-3 text-slate-700">{l.hasRating === false ? '—' : l.rating}</td>
                      <td className="px-4 py-3 text-slate-700">{l.unansweredReviewsCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-400">
              Profile health is this app's check of the profile, not a Google score. Views, calls and clicks are in Performance.
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default ReportsView;
