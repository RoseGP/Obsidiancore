import React from 'react';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';

export interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  badgeText?: string;
  badgeVariant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  delta?: {
    value: string;
    isPositive?: boolean;
    comparisonText?: string;
  };
  icon?: React.ReactNode;
  actionText?: string;
  onAction?: () => void;
  className?: string;
}

export const KpiCard: React.FC<KpiCardProps> = ({
  title,
  value,
  subtitle,
  badgeText,
  badgeVariant = 'neutral',
  delta,
  icon,
  actionText,
  onAction,
  className = ''
}) => {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 p-5 shadow-2xs hover:border-slate-300 transition-colors flex flex-col justify-between ${className}`}>
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            {title}
          </span>
          {icon && (
            <div className="h-7 w-7 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-500">
              {icon}
            </div>
          )}
        </div>

        <div className="flex items-baseline gap-2.5">
          <div className="text-2xl font-bold text-slate-900 tracking-tight">
            {value}
          </div>
          {badgeText && (
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${
              badgeVariant === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60' :
              badgeVariant === 'warning' ? 'bg-amber-50 text-amber-700 border border-amber-200/60' :
              badgeVariant === 'danger' ? 'bg-rose-50 text-rose-700 border border-rose-200/60' :
              badgeVariant === 'info' ? 'bg-blue-50 text-blue-700 border border-blue-200/60' :
              'bg-slate-100 text-slate-700 border border-slate-200'
            }`}>
              {badgeText}
            </span>
          )}
        </div>

        {subtitle && (
          <p className="text-xs text-slate-500 mt-1 font-normal">
            {subtitle}
          </p>
        )}
      </div>

      {(delta || actionText) && (
        <div className="pt-4 mt-3 border-t border-slate-100 flex items-center justify-between text-xs">
          {delta && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className={`inline-flex items-center font-medium ${
                delta.isPositive === true ? 'text-emerald-600' :
                delta.isPositive === false ? 'text-rose-600' :
                'text-slate-600'
              }`}>
                {delta.isPositive === true ? (
                  <ArrowUpRight className="h-3.5 w-3.5 mr-0.5" />
                ) : delta.isPositive === false ? (
                  <ArrowDownRight className="h-3.5 w-3.5 mr-0.5" />
                ) : (
                  <Minus className="h-3.5 w-3.5 mr-0.5" />
                )}
                {delta.value}
              </span>
              {delta.comparisonText && (
                <span className="text-slate-400">
                  {delta.comparisonText}
                </span>
              )}
            </div>
          )}

          {actionText && onAction && (
            <button
              type="button"
              onClick={onAction}
              className="text-blue-600 hover:text-blue-700 font-medium text-xs hover:underline cursor-pointer"
            >
              {actionText}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default KpiCard;
