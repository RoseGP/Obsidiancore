/**
 * Full-screen loading page while the saved sign-in is restored at start-up (before we know whether to show
 * the sign-in page or the app). Same Obsidian Core look as the sign-in page.
 */
import React from 'react';
import { CoreScan, CoreWordmark } from './CoreVisuals';

export default function AppLoadingScreen({ message = 'Checking your sign-in…' }: { message?: string }) {
  return (
    <div className="oc-screen oc-grid relative flex min-h-screen flex-col" role="status" aria-live="polite" aria-label="Loading Obsidian Core">
      <header className="flex h-[60px] shrink-0 items-center border-b border-[var(--border)] px-5 sm:px-6"><CoreWordmark /></header>
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-5 py-10 text-center">
        <CoreScan percent={null} size={220} />
        <div>
          <p className="text-[20px] font-semibold tracking-[-0.015em]">Starting Obsidian Core</p>
          <p className="mt-1.5 text-[13.5px] text-[var(--text-muted)]">{message}</p>
        </div>
      </main>
    </div>
  );
}
