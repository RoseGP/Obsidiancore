import React from 'react';
import * as Icons from 'lucide-react';

export interface Phase {
  id: string;
  title: string;
  duration?: string;
  description?: string;
  completed: boolean;
  icon?: string;
}

interface VerticalTimelineProps {
  phases: Phase[];
}

export default function VerticalTimeline({ phases }: VerticalTimelineProps) {
  return (
    <div className="relative pl-8 border-l border-slate-200 ml-4 space-y-6 py-2" id="reusable-timeline-vertical">
      {phases.map((phase, index) => {
        // Resolve dynamic Lucide icon matching string-based inputs
        let IconComponent = Icons.HelpCircle;
        if (phase.icon && phase.icon in Icons) {
          IconComponent = (Icons as any)[phase.icon];
        } else {
          // Defaults based on common terms or index
          if (index === 0) IconComponent = Icons.Search;
          else if (index === 1) IconComponent = Icons.Layers;
          else if (index === 2) IconComponent = Icons.Code;
          else IconComponent = Icons.Rocket;
        }

        const isCompleted = phase.completed;

        return (
          <div key={phase.id} className="relative group transition-all duration-300" id={`timeline-phase-${phase.id}`}>
            {/* Left aligned absolute circle & checkmark / icon indicator wrapper */}
            <div className="absolute -left-[45px] top-0.5 flex items-center justify-center">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all duration-500 shadow-sm ${
                  isCompleted
                    ? 'bg-emerald-50 border-emerald-500 text-emerald-600 ring-4 ring-emerald-50'
                    : 'bg-white border-slate-300 text-slate-400 group-hover:border-slate-400'
                }`}
              >
                {isCompleted ? (
                  <div className="relative">
                    <IconComponent className="h-4.5 w-4.5" />
                    <div className="absolute -top-1 -right-1 bg-emerald-500 text-white rounded-full p-0.5 border border-white">
                      <Icons.Check className="h-2 w-2 stroke-[3]" />
                    </div>
                  </div>
                ) : (
                  <IconComponent className="h-4 w-4" />
                )}
              </div>
            </div>

            {/* Content card details */}
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <h4 className={`text-xs font-bold leading-none tracking-tight font-sans transition-colors ${
                  isCompleted ? 'text-slate-900' : 'text-slate-700 group-hover:text-slate-900'
                }`}>
                  {phase.title}
                </h4>
                {phase.duration && (
                  <span className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded-full border shrink-0 transition-colors ${
                    isCompleted 
                      ? 'bg-emerald-50/50 border-emerald-100 text-emerald-700' 
                      : 'bg-slate-50 border-slate-200 text-slate-500'
                  }`}>
                    {phase.duration}
                  </span>
                )}
              </div>
              {phase.description && (
                <p className="text-xs text-slate-500 leading-normal leading-relaxed font-normal max-w-2xl font-sans">
                  {phase.description}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
