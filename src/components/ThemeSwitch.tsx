/** Segmented System / Light / Dark switch for the top bar. */
import React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePref } from '../context/ThemeContext';

const OPTIONS: { id: ThemePref; label: string; Icon: typeof Sun }[] = [
  { id: 'light', label: 'Light theme', Icon: Sun },
  { id: 'dark', label: 'Dark theme', Icon: Moon },
  { id: 'system', label: 'Match system', Icon: Monitor },
];

export default function ThemeSwitch() {
  const { pref, setPref } = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className="flex items-center gap-0.5 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-sunken)] p-0.5">
      {OPTIONS.map(({ id, label, Icon }) => (
        <button
          key={id} type="button" role="radio" aria-checked={pref === id} aria-label={label} title={label}
          onClick={() => setPref(id)}
          className={`h-7 w-7 flex items-center justify-center rounded-[6px] transition-colors ${pref === id ? 'bg-[var(--surface)] text-[var(--text)] shadow-xs' : 'text-[var(--text-subtle)] hover:text-[var(--text)]'}`}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </button>
      ))}
    </div>
  );
}
