/**
 * Page-level code splitting and crash containment.
 *
 * - `lazyPage(() => import('./X'))` loads a page only when it is first shown, so the first load doesn't
 *   download every page (the app used to ship as one ~4.8 MB script).
 * - After a deploy, an open tab may ask for a chunk that no longer exists. `lazyPage` reloads the page once
 *   to pick up the new build (guarded so it can't loop); if that doesn't help, the boundary shows the error.
 * - `PageBoundary` shows a loading state while a page loads and, if a page throws while rendering, an error
 *   with "Try again" instead of a blank app. It resets when `resetKey` changes (navigating to another page).
 */
import React, { Suspense } from 'react';
import { Loading, ErrorNote } from '../features/crm-records/ui';

const RELOAD_FLAG = 'obsidian:chunk-reload-at';
const RELOAD_WINDOW_MS = 60_000;

export function isChunkLoadError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? '');
  return (err as any)?.name === 'ChunkLoadError'
    || /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk [\w-]+ failed/i.test(msg);
}

function reloadOnceForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0);
    if (Date.now() - last < RELOAD_WINDOW_MS) return false; // already tried: show the error instead of looping
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch { return false; } // storage blocked: don't risk a reload loop
  window.location.reload();
  return true;
}

export function lazyPage<T extends React.ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return React.lazy(() => load().catch((err) => {
    if (isChunkLoadError(err) && typeof window !== 'undefined' && reloadOnceForNewBuild()) return new Promise<{ default: T }>(() => {});
    throw err;
  }));
}

interface Props { children: React.ReactNode; resetKey?: unknown; label?: string }
interface State { error: unknown }

export class PageBoundary extends React.Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: unknown): State { return { error }; }
  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // The details stay in the console; the user sees a short message.
    console.error('[page] render failed:', error, info?.componentStack);
  }
  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }
  render() {
    if (this.state.error) {
      const text = isChunkLoadError(this.state.error)
        ? 'This page couldn’t be loaded. A new version may have been released: reload the page.'
        : 'Something went wrong while showing this page.';
      return (
        <div className="mx-auto w-full max-w-xl p-6">
          <ErrorNote text={text} onRetry={() => (isChunkLoadError(this.state.error) ? window.location.reload() : this.setState({ error: null }))} />
        </div>
      );
    }
    return <Suspense fallback={<Loading label={this.props.label ?? 'Loading…'} />}>{this.props.children}</Suspense>;
  }
}
