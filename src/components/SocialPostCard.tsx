import React from 'react';

interface SocialPostCardProps {
  key?: React.Key;
  title: string;
  time: string;
  status: 'Draft' | 'Scheduled' | 'Published' | 'Failed' | string;
  platforms: string[];
  onClick?: () => void;
}

export default function SocialPostCard({ 
  title, 
  time, 
  status, 
  platforms = [], 
  onClick 
}: SocialPostCardProps) {
  // Normalize status for visual treatment
  const upperStatus = status.toUpperCase();
  
  let borderColor = 'border-l-slate-400 bg-slate-50/50';
  let statusBadgeColor = 'bg-slate-100 text-slate-700 border-slate-200';
  let friendlyStatusName = 'Draft';

  if (upperStatus === 'PUBLISHED') {
    borderColor = 'border-l-emerald-500 bg-emerald-50/10 hover:bg-emerald-50/25';
    statusBadgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    friendlyStatusName = 'Published';
  } else if (upperStatus === 'SCHEDULED') {
    borderColor = 'border-l-sky-500 bg-sky-50/10 hover:bg-sky-50/25';
    statusBadgeColor = 'bg-sky-50 text-sky-700 border-sky-200';
    friendlyStatusName = 'Scheduled';
  } else if (upperStatus === 'FAILED') {
    borderColor = 'border-l-rose-500 bg-rose-50/10 hover:bg-rose-50/25';
    statusBadgeColor = 'bg-rose-50 text-rose-700 border-rose-200';
    friendlyStatusName = 'Failed';
  } else if (upperStatus === 'DRAFT') {
    borderColor = 'border-l-slate-400 bg-slate-50/10 hover:bg-slate-50/25';
    statusBadgeColor = 'bg-slate-100 text-slate-600 border-slate-200';
    friendlyStatusName = 'Draft';
  }

  // Small beautiful high fidelity SVG components / icons for platforms
  const renderPlatformIcon = (platform: string) => {
    const platNormal = platform.toUpperCase().trim();
    switch (platNormal) {
      case 'X':
      case 'TWITTER':
        return (
          <span 
            key={platform} 
            title="X (Twitter)" 
            className="w-4.5 h-4.5 flex items-center justify-center bg-black rounded text-[8px] font-extrabold text-white font-mono leading-none shadow-xs border border-neutral-900"
          >
            𝕏
          </span>
        );
      case 'LINKEDIN':
        return (
          <span 
            key={platform} 
            title="LinkedIn" 
            className="w-4.5 h-4.5 flex items-center justify-center bg-[#0077b5] rounded text-[8px] font-bold text-white font-sans leading-none shadow-xs"
          >
            in
          </span>
        );
      case 'FACEBOOK':
        return (
          <span 
            key={platform} 
            title="Facebook" 
            className="w-4.5 h-4.5 flex items-center justify-center bg-[#1877f2] rounded text-[9px] font-extrabold text-white font-sans leading-none shadow-xs"
          >
            f
          </span>
        );
      case 'TIKTOK':
        return (
          <span 
            key={platform} 
            title="TikTok" 
            className="w-4.5 h-4.5 flex items-center justify-center bg-[#010101] rounded text-[8px] font-extrabold text-white font-sans leading-none border border-cyan-400/35 shadow-xs"
          >
            🎵
          </span>
        );
      case 'PINTEREST':
        return (
          <span 
            key={platform} 
            title="Pinterest" 
            className="w-4.5 h-4.5 flex items-center justify-center bg-[#e60023] rounded text-[10px] font-bold text-white font-sans leading-none shadow-xs"
          >
            P
          </span>
        );
      case 'THREADS':
      case 'THREAD':
        return (
          <span 
            key={platform} 
            title="Threads" 
            className="w-4.5 h-4.5 flex items-center justify-center bg-zinc-900 rounded text-[9px] font-bold text-white font-sans leading-none shadow-xs border border-zinc-750"
          >
            @
          </span>
        );
      default:
        return (
          <span 
            key={platform} 
            title={platform} 
            className="w-4.5 h-4.5 flex items-center justify-center bg-slate-100 rounded text-[7px] font-mono font-black text-slate-650 leading-none border border-slate-200"
          >
            {platform.substring(0, 2).toUpperCase()}
          </span>
        );
    }
  };

  return (
    <div 
      onClick={onClick}
      className={`group/card border-l-4 ${borderColor} bg-white shadow-sm hover:shadow-md border border-slate-200 rounded-lg p-2.5 transition-all text-left flex flex-col justify-between cursor-pointer space-y-2 select-none`}
    >
      {/* Title & Time Section */}
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-1.5">
          <span className={`text-[8px] font-extrabold uppercase px-1.5 py-0.2 rounded-md border tracking-wider shrink-0 ${statusBadgeColor}`}>
            {friendlyStatusName}
          </span>
          <span className="text-[8.5px] font-mono font-bold text-slate-500 bg-slate-50 border border-slate-100 px-1 py-0.2 rounded shrink-0">
            {time}
          </span>
        </div>
        <h4 className="text-[10px] font-bold text-slate-800 line-clamp-2 leading-snug group-hover/card:text-slate-950 transition-colors">
          {title || "Untitled Social Broadcast"}
        </h4>
      </div>

      {/* Target Platforms array */}
      {platforms && platforms.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1.5 border-t border-slate-100/80 items-center justify-between">
          <span className="text-[7.5px] uppercase font-mono font-bold text-slate-400 tracking-wider">
            Destinations
          </span>
          <div className="flex items-center gap-1">
            {platforms.map(plat => renderPlatformIcon(plat))}
          </div>
        </div>
      )}
    </div>
  );
}
