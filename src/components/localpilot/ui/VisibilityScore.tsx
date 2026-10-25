import React from 'react';
import { ArrowUpRight, CheckCircle2 } from 'lucide-react';

export interface VisibilityScoreProps {
  score: number;
  change?: number; // e.g. +7.2
  size?: 'sm' | 'md' | 'lg';
  showBenchmark?: boolean;
  benchmarkText?: string;
  className?: string;
}

export const VisibilityScore: React.FC<VisibilityScoreProps> = ({
  score,
  change,
  size = 'md',
  showBenchmark = true,
  benchmarkText = 'Excellent (Top 5% in Miami metro)',
  className = ''
}) => {
  const getRatingStatus = (val: number) => {
    if (val >= 90) return { label: 'Excellent', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' };
    if (val >= 75) return { label: 'Good', color: 'text-blue-700 bg-blue-50 border-blue-200' };
    if (val >= 60) return { label: 'Fair', color: 'text-amber-700 bg-amber-50 border-amber-200' };
    return { label: 'Needs Attention', color: 'text-rose-700 bg-rose-50 border-rose-200' };
  };

  const status = getRatingStatus(score);

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="flex items-baseline gap-3">
        <div className={`font-bold text-slate-900 tracking-tight ${
          size === 'lg' ? 'text-4xl' : size === 'md' ? 'text-3xl' : 'text-xl'
        }`}>
          {score}
          <span className="text-sm font-normal text-slate-400 ml-1">/ 100</span>
        </div>

        <span className={`px-2 py-0.5 rounded-md text-xs font-semibold border ${status.color}`}>
          {status.label}
        </span>

        {change !== undefined && (
          <div className="flex items-center text-xs font-medium text-emerald-600">
            <ArrowUpRight className="h-3.5 w-3.5 mr-0.5" />
            <span>+{change}% vs last month</span>
          </div>
        )}
      </div>

      {showBenchmark && (
        <p className="text-xs text-slate-500 mt-1.5 flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          <span>{benchmarkText}</span>
        </p>
      )}
    </div>
  );
};

export default VisibilityScore;
