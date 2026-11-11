/**
 * Dashboard card: the profile checks for the selected location (from the server audit of the
 * data synced from Google). "Re-check" syncs from Google again; nothing is simulated.
 */
import React, { useState } from 'react';
import { CheckCircle2, AlertTriangle, RefreshCw, Activity } from 'lucide-react';
import { LocationItem } from '../types';
import { useOptionalLocalSeo } from '../live/localSeoClient';

interface SeoQuickHealthCheckCardProps {
  selectedLocation: LocationItem;
}

export const SeoQuickHealthCheckCard: React.FC<SeoQuickHealthCheckCardProps> = ({ selectedLocation }) => {
  const seo = useOptionalLocalSeo();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  if (!selectedLocation) return null;

  const checks = selectedLocation.auditChecks || [];
  const passed = checks.filter((c) => c.passed).length;
  const score = selectedLocation.visibilityScore;
  const radius = 28;
  const strokeWidth = 5;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (Math.max(0, Math.min(100, score)) / 100) * circumference;
  const lastSync = seo?.connection?.lastSync?.at;

  const recheck = async () => {
    if (!seo) return;
    setBusy(true); setNote('');
    try { await seo.sync(); setNote('Synced from Google and re-checked.'); }
    catch (e: any) { setNote(e?.message || 'The sync didn\'t complete.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-blue-50 text-blue-600 flex items-center justify-center">
            <Activity className="h-3.5 w-3.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900 tracking-tight">Profile checks</h3>
            <p className="text-[11px] text-slate-500">
              {lastSync ? `Last sync ${new Date(lastSync).toLocaleString()}` : 'Not synced yet'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void recheck()}
          disabled={busy || !seo}
          className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 transition cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
          <span>{busy ? 'Syncing…' : 'Re-check'}</span>
        </button>
      </div>

      <div className="flex items-center gap-4">
        <svg width="70" height="70" className="shrink-0 -rotate-90" aria-hidden="true">
          <circle cx="35" cy="35" r={radius} stroke="#e2e8f0" strokeWidth={strokeWidth} fill="none" />
          <circle cx="35" cy="35" r={radius} stroke={score >= 80 ? '#059669' : '#d97706'} strokeWidth={strokeWidth} fill="none"
            strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} strokeLinecap="round" />
        </svg>
        <div className="text-xs">
          <div className="text-lg font-bold text-slate-900">{score} / 100</div>
          <div className="text-slate-500">{checks.length ? `${passed} of ${checks.length} checks passed` : 'No checks yet'}</div>
        </div>
      </div>

      {checks.length > 0 && (
        <ul className="space-y-1.5 text-xs">
          {checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2">
              {c.passed
                ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-emerald-600 shrink-0" />
                : <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-amber-500 shrink-0" />}
              <span className={c.passed ? 'text-slate-500' : 'text-slate-900 font-medium'}>{c.label}</span>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="text-[11px] text-slate-600" role="status">{note}</p>}
      <p className="text-[10px] text-slate-400">This app's check of the profile, not a Google score.</p>
    </div>
  );
};

export default SeoQuickHealthCheckCard;
