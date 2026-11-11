/** Business Profile Manager: CRM tab for auditing and maintaining business listings. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ProfileSummaryView } from './domain/types';
import { bpApi } from './client/api';
import { Dashboard } from './components/Dashboard';
import { ProfileDetail } from './components/ProfileDetail';
import { ToastProvider } from './components/ui';

export default function BusinessProfilesApp({ onOpenGbp }: { onOpenGbp?: () => void }) {
  const [profiles, setProfiles] = useState<ProfileSummaryView[]>([]);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [canCreate, setCanCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(() => { try { return new URLSearchParams(window.location.search).get('bp') || null; } catch { return null; } });
  const dirty = useRef(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try { const r = await bpApi.list(); setProfiles(r.profiles); setAiConfigured(r.aiConfigured); setCanCreate(!!r.permissions?.create); setError(null); }
    catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const leave = (fn: () => void) => { if (dirty.current && !window.confirm('You have unsaved changes. Leave without saving?')) return; dirty.current = false; fn(); };
  const back = () => leave(() => { setOpenId(null); reload(); });

  return (
    <ToastProvider>
      <div className="min-h-full bg-[var(--app-bg)] text-[var(--text)]">
        {openId ? (
          <ProfileDetail key={openId} id={openId} aiConfigured={aiConfigured} onBack={back} onDeleted={() => { dirty.current = false; setOpenId(null); reload(); }}
            onOpenGbp={() => leave(() => onOpenGbp?.())} onDirtyChange={(d) => { dirty.current = d; }} />
        ) : (
          <Dashboard profiles={profiles} loading={loading} error={error} canCreate={canCreate} onOpen={setOpenId} onCreated={(id) => { setOpenId(id); reload(); }} onReload={reload} />
        )}
      </div>
    </ToastProvider>
  );
}
