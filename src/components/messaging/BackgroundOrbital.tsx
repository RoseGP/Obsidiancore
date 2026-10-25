import React from 'react';

export const BackgroundOrbital: React.FC = () => {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* Deep space radial glow */}
      <div 
        className="absolute -top-[25%] -left-[10%] w-[60vw] h-[60vw] rounded-full opacity-20 blur-[130px]"
        style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.35) 0%, rgba(37,99,235,0.05) 70%, transparent 100%)' }}
      />
      <div 
        className="absolute -bottom-[20%] -right-[10%] w-[50vw] h-[50vw] rounded-full opacity-15 blur-[120px]"
        style={{ background: 'radial-gradient(circle, rgba(147,51,234,0.3) 0%, rgba(99,102,241,0.05) 70%, transparent 100%)' }}
      />
      {/* Subtle orbital concentric rings */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1200px] h-[1200px] rounded-full border border-white/[0.02] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full border border-white/[0.025] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[450px] h-[450px] rounded-full border border-white/[0.03] pointer-events-none" />
    </div>
  );
};

export default BackgroundOrbital;
