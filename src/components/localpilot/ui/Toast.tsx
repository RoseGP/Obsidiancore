import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, Info, X, AlertTriangle } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextType {
  showToast: (title: string, message?: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((
    title: string,
    message?: string,
    type: 'success' | 'error' | 'info' | 'warning' = 'success'
  ) => {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast: ToastMessage = { id, title, message, type };
    setToasts((prev) => [...prev, newToast]);

    setTimeout(() => {
      removeToast(id);
    }, 4000);
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      
      {/* Toast container */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto p-4 rounded-xl border shadow-lg bg-white flex items-start gap-3 animate-in slide-in-from-bottom-2 duration-150 ${
              toast.type === 'success' ? 'border-emerald-200 text-slate-900' :
              toast.type === 'error' ? 'border-rose-200 text-slate-900' :
              toast.type === 'warning' ? 'border-amber-200 text-slate-900' :
              'border-blue-200 text-slate-900'
            }`}
          >
            <div className="shrink-0 mt-0.5">
              {toast.type === 'success' && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
              {toast.type === 'error' && <AlertCircle className="h-4 w-4 text-rose-600" />}
              {toast.type === 'warning' && <AlertTriangle className="h-4 w-4 text-amber-600" />}
              {toast.type === 'info' && <Info className="h-4 w-4 text-blue-600" />}
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-slate-900">
                {toast.title}
              </div>
              {toast.message && (
                <p className="text-xs text-slate-500 mt-0.5 leading-snug">
                  {toast.message}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              className="text-slate-400 hover:text-slate-700 p-0.5 rounded cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
