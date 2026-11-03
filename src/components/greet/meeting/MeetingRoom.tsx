/**
 * Meeting room layout. Owns structure only; content comes in through slots.
 *
 *  ┌ alert (reconnecting) ────────────────────────────┐
 *  │ header                                           │
 *  ├ stage ─────────────────────────────┬ side panel ─┤
 *  │ notices                            │             │
 *  │ video grid                         │             │
 *  │        [ floating toolbar ]        │             │
 *  └────────────────────────────────────┴─────────────┘
 */
import React from 'react';
import type { MeetingTheme } from './useMeetingUi';

export function MeetingRoom({ theme, alert, header, notices, stage, toolbar, panel, children }: {
  theme: MeetingTheme;
  alert?: React.ReactNode;
  header: React.ReactNode;
  notices?: React.ReactNode;
  stage: React.ReactNode;
  toolbar: React.ReactNode;
  panel?: React.ReactNode;
  /** Dialogs and overlays. */
  children?: React.ReactNode;
}) {
  return (
    <div className="mtg obsidian flex h-screen w-full flex-col overflow-hidden font-sans" data-mtg-theme={theme}>
      {alert}
      {header}
      <div className="flex min-h-0 flex-1">
        <main className="m-stage relative flex min-w-0 flex-1 flex-col overflow-hidden" style={{ borderTopLeftRadius: 22, borderTopRightRadius: 22 }} aria-label="Meeting stage">
          {notices && <div className="flex flex-none flex-col gap-2 px-3 pt-3 empty:hidden sm:px-4">{notices}</div>}
          <div className="relative min-h-0 flex-1 px-3 pb-[92px] pt-3 sm:px-4 sm:pb-[100px]">{stage}</div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-3" style={{ paddingBottom: 'max(14px, env(safe-area-inset-bottom, 0px))' }}>
            <div className="pointer-events-auto">{toolbar}</div>
          </div>
        </main>
        {panel}
      </div>
      {children}
    </div>
  );
}
