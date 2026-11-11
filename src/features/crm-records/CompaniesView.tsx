/**
 * Companies tab (mounted inside Sales Pipeline & Deals; no page chrome of its own).
 * Business profiles with their contacts, leads, deals, open/won value, parent/subsidiary relationships,
 * tasks and a combined timeline. Data: /api/companies.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Building2, Globe, Pencil, Phone, Plus, Search, Trash2 } from 'lucide-react';
import { notifyCrmChanged, onCrmChanged } from '../../lib/crmEvents';
import { TaskForm, TaskList } from './TasksView';
import { Avatar, Badge, Button, Card, Drawer, Empty, ErrorNote, Field, Loading, Modal, NoteBox, Section, Timeline, api, inputCls, money } from './ui';

export interface Company { id: string; name: string; industry: string; website: string; domain?: string; phone: string; address: string; size: string; tier: string; notes: string; tags: string[]; parentCompanyId: string | null; createdAt: string }

export interface CompaniesViewProps {
  /** Opens another screen (e.g. 'messages', 'proposals'). */
  onNavigate?: (view: string) => void;
  /** Opens a contact in the Contacts tab, if the host has one. */
  onOpenContact?: (contactId: string) => void;
  /** Company to open on first render (e.g. when a contact's company is clicked). */
  initialCompanyId?: string | null;
}

function CompanyForm({ company, onClose, onSaved, onOpenExisting }: { company?: Company | null; onClose: () => void; onSaved: (c: Company) => void; onOpenExisting: (id: string) => void }) {
  const [others, setOthers] = useState<Array<{ id: string; name: string }>>([]);
  const [f, setF] = useState({ name: company?.name || '', industry: company?.industry && company.industry !== 'Unspecified' ? company.industry : '', website: company?.website || '', phone: company?.phone || '', address: company?.address || '', size: company?.size || '', tags: (company?.tags || []).join(', '), parentCompanyId: company?.parentCompanyId || '', notes: company?.notes || '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [dup, setDup] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => { api<{ companies: Company[] }>('/api/companies').then((r) => setOthers(r.companies.filter((c) => c.id !== company?.id).map((c) => ({ id: c.id, name: c.name })))).catch(() => setOthers([])); }, [company?.id]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const save = async (force = false) => {
    setBusy(true); setErr('');
    const body = { ...f, parentCompanyId: f.parentCompanyId || null, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), force };
    try {
      const r = company ? await api<{ company: Company }>(`/api/companies/${company.id}`, { method: 'PATCH', body: JSON.stringify(body) }) : await api<{ company: Company }>('/api/companies', { method: 'POST', body: JSON.stringify(body) });
      notifyCrmChanged('company'); onSaved(r.company); onClose();
    } catch (e: any) { setErr(e.message); if (e.code === 'possible_duplicate') setDup(e.body?.matches?.[0] || null); } finally { setBusy(false); }
  };
  return (
    <Modal title={company ? 'Edit company' : 'New company'} onClose={onClose} labelId="company-form-title"
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        {dup && <Button onClick={() => { onClose(); onOpenExisting(dup.id); }}>Open {dup.name}</Button>}
        {dup && <Button onClick={() => save(true)} disabled={busy}>Save anyway</Button>}
        <Button variant="primary" onClick={() => save(false)} disabled={busy || !f.name.trim()}>{busy ? 'Saving…' : company ? 'Save' : 'Add company'}</Button>
      </>}>
      <Field label="Name"><input autoFocus className={inputCls} value={f.name} onChange={set('name')} maxLength={160} /></Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Industry"><input className={inputCls} value={f.industry} onChange={set('industry')} maxLength={80} /></Field>
        <Field label="Size"><input className={inputCls} value={f.size} onChange={set('size')} placeholder="1–10, 11–50…" maxLength={40} /></Field>
        <Field label="Website"><input className={inputCls} value={f.website} onChange={set('website')} placeholder="https://" maxLength={300} /></Field>
        <Field label="Phone"><input type="tel" className={inputCls} value={f.phone} onChange={set('phone')} maxLength={40} /></Field>
        <Field label="Parent company"><select className={inputCls} value={f.parentCompanyId} onChange={set('parentCompanyId')}><option value="">None</option>{others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
        <Field label="Tags" hint="Separate with commas"><input className={inputCls} value={f.tags} onChange={set('tags')} /></Field>
      </div>
      <Field label="Address"><input className={inputCls} value={f.address} onChange={set('address')} maxLength={400} /></Field>
      <Field label="Notes"><textarea rows={3} className={inputCls} value={f.notes} onChange={set('notes')} /></Field>
      {err && <ErrorNote text={err} />}
    </Modal>
  );
}

function CompanyProfile({ id, onClose, onOpen, onOpenContact, onNavigate, onChanged }: { id: string; onClose: () => void; onOpen: (id: string) => void; onOpenContact?: (id: string) => void; onNavigate?: (v: string) => void; onChanged: () => void }) {
  const [p, setP] = useState<any | null>(null);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const load = useCallback(async () => { setErr(''); try { setP(await api(`/api/companies/${encodeURIComponent(id)}`)); } catch (e: any) { setErr(e.message); } }, [id]);
  useEffect(() => { setP(null); void load(); }, [load]);
  const c: Company | undefined = p?.company;
  const remove = async () => { try { await api(`/api/companies/${id}`, { method: 'DELETE' }); notifyCrmChanged('company'); onChanged(); onClose(); } catch (e: any) { setErr(e.message); setConfirmDelete(false); } };
  return (
    <Drawer labelId="company-profile-title" onClose={onClose} title={c?.name || 'Company'} subtitle={c && [c.industry !== 'Unspecified' ? c.industry : '', c.size].filter(Boolean).join(' · ')}
      actions={c && <div className="flex gap-1">
        <Button variant="ghost" className="!px-2" aria-label="Edit company" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /></Button>
        <Button variant="ghost" className="!px-2" aria-label="Delete company" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" /></Button>
      </div>}>
      {err && <ErrorNote text={err} onRetry={load} />}
      {!p && !err ? <Loading /> : c && (
        <>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[['Contacts', p.totals.contacts], ['Deals', p.totals.deals], ['Open value', money(p.totals.openValue)], ['Won', money(p.totals.wonValue)]].map(([k, v]) => (
              <div key={k as string} className="rounded-[var(--radius-control)] bg-[var(--surface-sunken)] px-3 py-2"><dt className="text-[11px] text-[var(--text-muted)]">{k}</dt><dd className="text-[15px] font-semibold tabular-nums">{v}</dd></div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            {c.website && <a className="inline-flex items-center gap-1.5 text-[var(--accent-text)] hover:underline" href={/^https?:\/\//i.test(c.website) ? c.website : `https://${c.website}`} target="_blank" rel="noopener noreferrer"><Globe className="h-4 w-4" aria-hidden="true" />{c.domain || c.website}</a>}
            {c.phone && <a className="inline-flex items-center gap-1.5 text-[var(--accent-text)] hover:underline" href={`tel:${c.phone}`}><Phone className="h-4 w-4" aria-hidden="true" />{c.phone}</a>}
            {c.address && <span className="text-[var(--text-muted)]">{c.address}</span>}
          </div>
          {(p.parent || p.subsidiaries.length > 0) && (
            <p className="text-[13px] text-[var(--text-muted)]">
              {p.parent && <>Part of <button type="button" className="text-[var(--accent-text)] hover:underline" onClick={() => onOpen(p.parent.id)}>{p.parent.name}</button>. </>}
              {p.subsidiaries.length > 0 && <>Subsidiaries: {p.subsidiaries.map((s: any, i: number) => <React.Fragment key={s.id}>{i > 0 && ', '}<button type="button" className="text-[var(--accent-text)] hover:underline" onClick={() => onOpen(s.id)}>{s.name}</button></React.Fragment>)}</>}
            </p>
          )}
          {c.tags?.length > 0 && <div className="flex flex-wrap gap-1.5">{c.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>}
          {c.notes && <p className="whitespace-pre-wrap rounded-[var(--radius-control)] bg-[var(--surface-sunken)] p-3 text-[13px]">{c.notes}</p>}

          <Section title="Contacts" count={p.contacts.length}>
            {p.contacts.length ? <ul className="space-y-1">{p.contacts.map((x: any) => (
              <li key={x.id}><button type="button" disabled={!onOpenContact} onClick={() => onOpenContact?.(x.id)} className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-1 py-1 text-left text-[13px] enabled:hover:bg-[var(--surface-sunken)]"><Avatar name={x.name || x.email} /><span className="min-w-0 flex-1 truncate">{x.name || x.email}<span className="text-[var(--text-muted)]">{x.title ? ` · ${x.title}` : ''}</span></span></button></li>
            ))}</ul> : <p className="text-[13px] text-[var(--text-muted)]">No contacts linked yet.</p>}
          </Section>
          <Section title="Deals" count={p.deals.length}>
            {p.deals.length ? <ul className="space-y-1 text-[13px]">{p.deals.map((d: any) => <li key={d.id} className="flex justify-between gap-2"><button type="button" className="truncate text-left hover:underline" onClick={() => onNavigate?.('deals')}>{d.name}</button><span className="text-[var(--text-muted)] whitespace-nowrap">{money(d.value)} · {d.stage}</span></li>)}</ul> : <p className="text-[13px] text-[var(--text-muted)]">No deals.</p>}
          </Section>
          <Section title="Leads" count={p.leads.length}>
            {p.leads.length ? <ul className="space-y-1 text-[13px]">{p.leads.map((l: any) => <li key={l.id} className="flex justify-between gap-2"><span className="truncate">{l.name}</span><Badge>{l.status}</Badge></li>)}</ul> : <p className="text-[13px] text-[var(--text-muted)]">No leads.</p>}
          </Section>
          <Section title="Tasks" count={p.tasks.length} action={<Button variant="ghost" onClick={() => setAddingTask(true)}><Plus className="h-4 w-4" />Add</Button>}>
            {p.tasks.length ? <TaskList compact tasks={p.tasks} onChanged={load} onNavigate={onNavigate} /> : <p className="text-[13px] text-[var(--text-muted)]">No open tasks.</p>}
          </Section>
          <Section title="Timeline" count={p.timeline.length}>
            <NoteBox onSave={async (note) => { await api(`/api/companies/${id}/notes`, { method: 'POST', body: JSON.stringify({ note }) }); await load(); }} />
            <div className="mt-4"><Timeline items={p.timeline} /></div>
          </Section>
        </>
      )}
      {editing && c && <CompanyForm company={c} onClose={() => setEditing(false)} onSaved={() => { void load(); onChanged(); }} onOpenExisting={onOpen} />}
      {addingTask && c && <TaskForm fixed={{ companyId: c.id }} onClose={() => setAddingTask(false)} onSaved={() => load()} />}
      {confirmDelete && c && (
        <Modal title="Delete this company?" onClose={() => setConfirmDelete(false)} labelId="company-del-title"
          footer={<><Button onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" onClick={remove}>Delete</Button></>}>
          <p className="text-[13px]">{c.name} is hidden from lists. Its contacts, deals and history are kept.</p>
        </Modal>
      )}
    </Drawer>
  );
}

export default function CompaniesView({ onNavigate, onOpenContact, initialCompanyId }: CompaniesViewProps) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Company[] | null>(null);
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState<string | null>(initialCompanyId || null);
  const [adding, setAdding] = useState(false);
  const load = useCallback(async () => {
    setErr('');
    try { setRows((await api<{ companies: Company[] }>(`/api/companies${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)).companies); }
    catch (e: any) { setErr(e.message); setRows((x) => x ?? []); }
  }, [q]);
  useEffect(() => { const h = setTimeout(load, q ? 250 : 0); return () => clearTimeout(h); }, [load, q]);
  useEffect(() => onCrmChanged((k) => { if (k === 'company' || k === 'contact' || k === 'lead') void load(); }), [load]);
  useEffect(() => { if (initialCompanyId) setOpenId(initialCompanyId); }, [initialCompanyId]);

  return (
    <div className="space-y-4 text-[var(--text)]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative block flex-1">
          <span className="sr-only">Search companies</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-subtle)]" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, industry or website" className={`${inputCls} pl-8`} />
        </label>
        <Button variant="primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />New company</Button>
      </div>
      {err && <ErrorNote text={err} onRetry={load} />}
      <Card>
        {rows === null ? <Loading label="Loading companies…" /> : rows.length === 0 ? (
          <Empty icon={<Building2 className="h-8 w-8" />} title={q ? 'No companies match.' : 'No companies yet.'}
            text={q ? undefined : 'Add a company, or convert a lead with a company name: it’s created and linked for you.'}
            action={!q ? <Button variant="primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />New company</Button> : undefined} />
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {rows.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setOpenId(c.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
                  <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--surface-sunken)] text-[var(--text-muted)]"><Building2 className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{c.name}</span>
                    <span className="block truncate text-[12px] text-[var(--text-muted)]">{[c.industry !== 'Unspecified' ? c.industry : '', c.domain || c.website, c.size].filter(Boolean).join(' · ') || 'No details yet'}</span>
                  </span>
                  <span className="hidden sm:flex gap-1">{(c.tags || []).slice(0, 3).map((t) => <Badge key={t}>{t}</Badge>)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {adding && <CompanyForm onClose={() => setAdding(false)} onSaved={(c) => { void load(); setOpenId(c.id); }} onOpenExisting={setOpenId} />}
      {openId && <CompanyProfile id={openId} onClose={() => setOpenId(null)} onOpen={setOpenId} onOpenContact={onOpenContact} onNavigate={onNavigate} onChanged={load} />}
    </div>
  );
}
