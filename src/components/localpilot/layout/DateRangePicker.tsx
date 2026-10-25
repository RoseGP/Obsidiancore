import React, { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronDown, Check } from 'lucide-react';
import { TimeRange } from '../types';

export interface DateRangePickerProps {
  selectedRange: TimeRange;
  onRangeChange: (range: TimeRange) => void;
}

export const DateRangePicker: React.FC<DateRangePickerProps> = ({
  selectedRange,
  onRangeChange
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const options: { id: TimeRange; label: string; period: string }[] = [
    { id: '7D', label: 'Last 7 days', period: 'Aug 26 – Sep 1, 2026' },
    { id: '30D', label: 'Last 30 days', period: 'Aug 3 – Sep 1, 2026' },
    { id: '90D', label: 'Last 90 days', period: 'Jun 1 – Sep 1, 2026' },
    { id: '1Y', label: 'Last 12 months', period: 'Sep 2025 – Sep 2026' },
  ];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const current = options.find((o) => o.id === selectedRange) || options[1];

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-900 flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
      >
        <Calendar className="h-3.5 w-3.5 text-slate-500" />
        <span>{current.label}</span>
        <ChevronDown className="h-3 w-3 text-slate-400" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1.5 w-56 bg-white rounded-xl border border-slate-200 shadow-lg py-1 z-40 animate-in fade-in zoom-in-95 duration-100 text-xs">
          <div className="px-3 py-1.5 border-b border-slate-100 text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
            Select timeframe
          </div>
          {options.map((opt) => {
            const isSelected = opt.id === selectedRange;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  onRangeChange(opt.id);
                  setIsOpen(false);
                }}
                className={`w-full px-3 py-2 flex items-center justify-between text-left hover:bg-slate-50 transition cursor-pointer ${
                  isSelected ? 'bg-blue-50/70 text-blue-800 font-semibold' : 'text-slate-900'
                }`}
              >
                <div>
                  <div>{opt.label}</div>
                  <div className="text-[10px] text-slate-500">{opt.period}</div>
                </div>
                {isSelected && <Check className="h-3.5 w-3.5 text-blue-600" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DateRangePicker;
