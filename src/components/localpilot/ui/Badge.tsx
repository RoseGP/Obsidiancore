import React from 'react';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'outline' | 'purple';
  size?: 'sm' | 'md';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'sm',
  className = ''
}) => {
  const base = 'inline-flex items-center font-medium transition-colors whitespace-nowrap rounded-md';
  
  const sizeClasses = size === 'sm' 
    ? 'px-2 py-0.5 text-[11px] leading-tight' 
    : 'px-2.5 py-1 text-xs';

  const variantClasses = {
    default: 'bg-slate-100 text-slate-700 border border-slate-200',
    neutral: 'bg-slate-100 text-slate-600 border border-slate-200',
    success: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border border-amber-200',
    danger: 'bg-rose-50 text-rose-700 border border-rose-200',
    info: 'bg-blue-50 text-blue-700 border border-blue-200',
    outline: 'bg-transparent text-slate-600 border border-slate-300',
    purple: 'bg-purple-50 text-purple-700 border border-purple-200'
  }[variant];

  return (
    <span className={`${base} ${sizeClasses} ${variantClasses} ${className}`}>
      {children}
    </span>
  );
};

export default Badge;
