import React, { useState } from 'react';
import { ShieldCheck, Unlock, RefreshCw, KeyRound, Globe, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface LockScreenProps {
  onUnlock: () => void;
}

export default function LockScreen({ onUnlock }: LockScreenProps) {
  const [pin, setPin] = useState<string>('');
  const [errorCount, setErrorCount] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleKeyPress = (num: string) => {
    setErrorMessage(null);
    if (pin.length < 4) {
      setPin(prev => prev + num);
    }
  };

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
  };

  const handleClear = () => {
    setPin('');
    setErrorMessage(null);
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (pin === '1337') {
      onUnlock();
    } else {
      setErrorCount(prev => prev + 1);
      setErrorMessage('DECRYPTION FAILURE: SEC_ACCESS_DENIED');
      setPin('');
      // Vibrate if supported
      if ('vibrate' in navigator) {
        navigator.vibrate(120);
      }
    }
  };

  return (
    <div 
      id="obsidian-terminal-lockscreen" 
      className="obsidian fixed inset-0 z-50 flex items-center justify-center bg-[var(--obsidian-0)] bg-radial-gradient text-neutral-100 overflow-hidden font-sans select-none"
    >
      {/* Background Ambient Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-blue-600/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-[300px] h-[300px] rounded-full bg-indigo-600/5 blur-[100px] pointer-events-none" />

      {/* Top Left Branding */}
      <div className="absolute top-6 left-6 flex items-center gap-2.5">
        <div className="h-7 w-7 rounded bg-blue-600/10 border border-blue-500/20 flex items-center justify-center">
          <Globe className="h-4 w-4 text-blue-500 animate-spin-slow" />
        </div>
        <div>
          <span className="text-[10px] font-black text-white tracking-widest block uppercase">Obsidian Core</span>
          <span className="text-[8px] text-blue-500 font-mono tracking-wider">OMNICHANNEL SECURE GATEFLOW</span>
        </div>
      </div>

      <div className="w-full max-w-sm px-6 flex flex-col items-center">
        {/* Profile Lock Wrapper */}
        <div className="flex flex-col items-center mb-8 relative">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="relative"
          >
            {/* Outer Pulsing Lock rings */}
            <div className="absolute -inset-2.5 rounded-2xl border border-blue-500/15 animate-ping opacity-40 duration-3000" />
            <div className="absolute -inset-1.5 rounded-2xl border border-indigo-500/20" />
            
            <img 
              src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120" 
              alt="Locked Account Officer avatar" 
              className="h-16 w-16 rounded-2xl object-cover bg-neutral-900 border border-white/10 shadow-2xl relative z-10"
              referrerPolicy="no-referrer"
            />
            
            {/* Secure Badge icon lock overlay */}
            <div className="obsidian absolute -bottom-1 -right-1 h-5 w-5 rounded-md bg-[var(--obsidian-0)] border border-blue-500/20 flex items-center justify-center z-25 text-blue-400 shadow-md">
              <KeyRound className="h-3 w-3" />
            </div>
          </motion.div>

          <div className="text-center mt-4">
            <span className="text-xs font-black text-rose-500 uppercase tracking-widest block font-mono">
              Terminal Locked
            </span>
            <h1 className="text-sm font-bold text-neutral-100 tracking-tight mt-0.5">Rene Pierrette</h1>
            <span className="text-[10px] text-neutral-500 block">Executive Officer • SEC_NODE_09</span>
          </div>
        </div>

        {/* Central Passcode Grid */}
        <div className="w-full bg-slate-900/80 backdrop-blur-3xl border border-white/5 rounded-3xl p-6 shadow-2xl space-y-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Virtual PIN dots display */}
            <div className="flex flex-col items-center space-y-2">
              <div className="flex justify-center gap-4 py-2.5">
                {[0, 1, 2, 3].map((index) => {
                  const filled = pin.length > index;
                  return (
                    <motion.div 
                      key={index}
                      animate={{ 
                        scale: filled ? [1, 1.15, 1] : 1, 
                        backgroundColor: filled ? '#3b82f6' : 'rgba(255, 255, 255, 0.08)' 
                      }}
                      className="h-3 w-3 rounded-full border border-white/5"
                    />
                  );
                })}
              </div>

              {/* Secure status code description */}
              {errorMessage ? (
                <span className="text-[9px] font-bold font-mono tracking-wider text-rose-500 uppercase select-none animate-bounce">
                  {errorMessage}
                </span>
              ) : (
                <span className="text-[8px] font-semibold text-neutral-500 uppercase tracking-widest select-none">
                  Enter 4-Digit Security Bypass Key
                </span>
              )}
            </div>

            {/* Keypad Layout */}
            <div className="grid grid-cols-3 gap-2 [&_button]:cursor-pointer">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
                <button
                  type="button"
                  key={num}
                  onClick={() => handleKeyPress(num)}
                  className="h-11 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/5 hover:border-white/10 active:scale-95 text-sm font-bold font-mono transition-all duration-100 text-neutral-200"
                >
                  {num}
                </button>
              ))}

              <button
                type="button"
                onClick={handleClear}
                className="h-11 rounded-xl hover:bg-white/5 active:scale-95 text-[9px] font-sans font-bold tracking-wider text-neutral-500 hover:text-white transition-all uppercase"
              >
                Clear
              </button>

              <button
                type="button"
                onClick={() => handleKeyPress('0')}
                className="h-11 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/5 hover:border-white/10 active:scale-95 text-sm font-bold font-mono transition-all duration-100 text-neutral-200"
              >
                0
              </button>

              <button
                type="button"
                onClick={handleBackspace}
                className="h-11 rounded-xl hover:bg-white/5 active:scale-95 text-[9px] font-sans font-bold tracking-wider text-neutral-500 hover:text-white transition-all uppercase"
              >
                Del
              </button>
            </div>

            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              {/* Dynamic Auto fill button for convenient code demonstration */}
              <button
                type="button"
                onClick={() => setPin('1337')}
                className="flex items-center justify-center gap-1.5 h-10 px-3 rounded-xl border border-white/10 text-[10px] font-bold text-neutral-400 hover:text-white hover:bg-white/5 transition-all"
              >
                <Sparkles className="h-3 w-3 text-blue-400" />
                <span>Fill Demo Key</span>
              </button>

              <button
                type="submit"
                disabled={pin.length < 4}
                className="flex items-center justify-center gap-1.5 h-10 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:pointer-events-none text-[10px] font-bold text-white transition-all shadow-lg shadow-blue-500/10"
              >
                <Unlock className="h-3.5 w-3.5" />
                <span>Unlock Node</span>
              </button>
            </div>
          </form>
        </div>

        {/* Informative system info block bottom */}
        <div className="mt-8 text-center bg-blue-500/5 border border-blue-500/10 p-3 rounded-2xl text-[9px] text-neutral-400 leading-normal max-w-[280px]">
          <span className="font-bold text-neutral-200 block mb-0.5">Session Locker Bypass Instruction</span>
          To instantly re-authenticate and open this active operational instance, input security bypass code: <span className="font-mono font-bold text-blue-400">1337</span>.
        </div>
      </div>
    </div>
  );
}
