/**
 * Contacts tab (mounted inside Sales Pipeline & Deals next to Leads and Deals; no page chrome of its own).
 * One record per person: search, tags, owner, company, duplicate warnings and merge, and a profile with the
 * person's leads, deals, tasks, proposals, meetings, invoicing clients, WhatsApp/SMS + inbox history and a
 * combined timeline. Data: /api/contacts.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Building2, GitMerge, Mail, Pencil, Phone, Plus, Search, Trash2, Users, AlertTriangle } from 'lucide-react';
import { onCrmChanged, notifyCrmChanged } from '../../lib/crmEvents';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { TaskForm, TaskList } from './TasksView';
import { Avatar, Badge, Button, Card, Drawer, Empty, ErrorNote, Field, Loading, Modal, NoteBox, Section, Timeline, api, fmtDate, inputCls, money } from './ui';

export interface Contact {
  id: string; name: string; email: string; phone: string; title: string; company: string; companyId: string | null;
  owner: string; ownerId: string | null; tags: string[]; category: string; notes: string; status: string;
  altEmails?: string[]; altPhones?: string[]; createdAt: string; updatedAt: string; deletedAt?: string | null;
}
interface Match { id: string; name: string; email: string; company: string; reasons: string[]; score?: number; level?: 'likely' | 'possible' }
const scoreLabel = (m: { score?: number; level?: string }) => (typeof m.score === 'number' ? `${Math.round(m.score * 100)}% ${m.level === 'likely' ? 'likely match' : 'possible match'}` : '');

export interface ContactsViewProps {
  /** Opens another screen (e.g. 'messages', 'calendar', 'proposals'). */
  onNavigate?: (view: string) => void;
  /** Opens a company in the Companies tab, if the host has one. */
  onOpenCompany?: (companyId: string) => void;
  /** Contact to open on first render (e.g. from search or a deep link). */
  initialContactId?: string | null;
}

function ContactForm({ contact, onClose, onSaved, onOpenExisting }: { contact?: Contact | null; onClose: () => void; onSaved: (c: Contact) => void; onOpenExisting: (id: string) => void }) {
  const { members } = useTeamMembers();
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [f, setF] = useState({ name: contact?.name || '', email: contact?.email || '', phone: contact?.phone || '', title: contact?.title || '', companyId: contact?.companyId || '', company: contact?.company || '', ownerId: contact?.ownerId || '', tags: (contact?.tags || []).join(', '), category: contact?.category || '', notes: contact?.notes || '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [similar, setSimilar] = useState<Match[]>([]);
  useEffect(() => { api<{ companies: any[] }>('/api/companies').then((r) => setCompanies(r.companies.map((c) => ({ id: c.id, name: c.name })))).catch(() => setCompanies([])); }, []);
  // While typing a new contact: the closest existing contacts (fuzzy match), so a duplicate is caught before saving.
  const companyName = companies.find((c) => c.id === f.companyId)?.name || f.company;
  useEffect(() => {
    if (contact || (!f.name.trim() && !f.email.trim() && f.phone.replace(/\D/g, '').length < 7)) { setSimilar([]); return; }
    let alive = true;
    const h = setTimeout(() => {
      api<{ matches: Match[] }>('/api/contacts/match', { method: 'POST', body: JSON.stringify({ name: f.name, email: f.email, phone: f.phone, company: companyName }) })
        .then((r) => { if (alive) setSimilar(r.matches || []); }).catch(() => { if (alive) setSimilar([]); });
    }, 300);
    return () => { alive = false; clearTimeout(h); };
  }, [contact, f.name, f.email, f.phone, companyName]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const save = async (force = false) => {
    setBusy(true); setErr('');
    const owner = members.find((m) => m.id === f.ownerId);
    const company = companies.find((c) => c.id === f.companyId);
    const body = { name: f.name, email: f.email, phone: f.phone, title: f.title, companyId: f.companyId || null, company: company?.name || f.company, ownerId: f.ownerId || null, owner: owner?.name || '', tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), category: f.category, notes: f.notes, force };
    try {
      const r = contact ? await api<{ contact: Contact }>(`/api/contacts/${contact.id}`, { method: 'PATCH', body: JSON.stringify(body) }) : await api<{ contact: Contact }>('/api/contacts', { method: 'POST', body: JSON.stringify(body) });
      notifyCrmChanged('contact'); onSaved(r.contact); onClose();
    } catch (e: any) {
      if (e.code === 'possible_duplicate') { setMatches(e.body?.matches || []); setErr(e.message); } else setErr(e.message);
    } finally { setBusy(false); }
  };

  return (
    <Modal title={contact ? 'Edit contact' : 'New contact'} onClose={onClose} labelId="contact-form-title"
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        {matches && <Button onClick={() => save(true)} disabled={busy}>Save anyway</Button>}
        <Button variant="primary" onClick={() => save(false)} disabled={busy || (!f.name.trim() && !f.email.trim())}>{busy ? 'Saving…' : contact ? 'Save' : 'Add contact'}</Button>
      </>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name"><input autoFocus className={inputCls} value={f.name} onChange={set('name')} maxLength={120} /></Field>
        <Field label="Job title"><input className={inputCls} value={f.title} onChange={set('title')} maxLength={120} /></Field>
        <Field label="Email"><input type="email" className={inputCls} value={f.email} onChange={set('email')} maxLength={254} /></Field>
        <Field label="Phone"><input type="tel" className={inputCls} value={f.phone} onChange={set('phone')} maxLength={40} /></Field>
        <Field label="Company">
          <select className={inputCls} value={f.companyId} onChange={set('companyId')}>
            <option value="">{f.company && !f.companyId ? `${f.company} (not linked)` : 'None'}</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Owner">
          <select className={inputCls} value={f.ownerId} onChange={set('ownerId')}>
            <option value="">{contact ? 'Unassigned' : 'Me'}</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
        <Field label="Tags" hint="Separate with commas"><input className={inputCls} value={f.tags} onChange={set('tags')} placeholder="vip, retail" /></Field>
        <Field label="Category"><input className={inputCls} value={f.category} onChange={set('category')} placeholder="Customer, partner, supplier…" maxLength={40} /></Field>
      </div>
      <Field label="Notes"><textarea rows={3} className={inputCls} value={f.notes} onChange={set('notes')} /></Field>
      {err && <ErrorNote text={err} />}
      {(() => {
        const list = matches && matches.length ? matches : !contact ? similar : [];
        if (!list.length) return null;
        return (
          <div className="space-y-1" role={matches ? undefined : 'status'}>
            {!matches && <p className="flex items-center gap-1.5 text-[12px] text-[var(--warning)]"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />This may already be in your contacts:</p>}
            <ul className="space-y-1" aria-label="Similar contacts">
              {list.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--border)] px-3 py-2 text-[13px]">
                  <span className="min-w-0">
                    <span className="block truncate">{m.name || m.email}{scoreLabel(m) && <> <Badge>{scoreLabel(m)}</Badge></>}</span>
                    <span className="block text-[12px] text-[var(--text-muted)]">{m.reasons.join(' · ')}</span>
                  </span>
                  <Button variant="ghost" onClick={() => { onClose(); onOpenExisting(m.id); }}>Open</Button>
                </li>
              ))}
            </ul>
          </div>
        );
      })()}
    </Modal>
  );
}

function DuplicatesPanel({ onDone, onOpen }: { onDone: () => void; onOpen: (id: string) => void }) {
  const [groups, setGroups] = useState<Array<{ reasons: string[]; contacts: Contact[]; score?: number; level?: 'likely' | 'possible'; pairs?: Array<{ ids: string[]; score: number; level: string; summary: string }> }> | null>(null);
  const [leadMatches, setLeadMatches] = useState<Array<{ lead: { id: string; name: string; email: string; company: string }; contact: { id: string; name: string; email: string }; score: number; level: string; summary: string }>>([]);
  const [keep, setKeep] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => api<{ groups: any[]; leadMatches?: any[] }>('/api/contacts/duplicates').then((r) => { setGroups(r.groups); setLeadMatches(r.leadMatches || []); }).catch((e) => { setErr(e.message); setGroups([]); }), []);
  useEffect(() => { void load(); }, [load]);
  const merge = async (i: number) => {
    const g = groups![i]; const keepId = keep[i] || g.contacts[0].id;
    setBusy(i); setErr('');
    try { await api('/api/contacts/merge', { method: 'POST', body: JSON.stringify({ keepId, mergeIds: g.contacts.filter((c) => c.id !== keepId).map((c) => c.id) }) }); notifyCrmChanged('contact'); await load(); onDone(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };
  if (!groups) return <Loading label="Looking for duplicates…" />;
  return (
    <div className="space-y-3">
      {err && <ErrorNote text={err} />}
      {groups.length === 0 ? <p className="text-[13px] text-[var(--text-muted)]">No possible duplicates.</p> : groups.map((g, i) => (
        <fieldset key={g.contacts.map((c) => c.id).join()} className="rounded-[var(--radius-card)] border border-[var(--border)] p-3">
          <legend className="px-1 text-[12px] text-[var(--text-muted)]">{scoreLabel(g) && <Badge>{scoreLabel(g)}</Badge>} {g.reasons.join(' · ')}</legend>
          {g.pairs && g.pairs.length > 1 && (
            <ul className="mb-2 space-y-0.5 text-[12px] text-[var(--text-muted)]">
              {g.pairs.map((p) => <li key={p.ids.join()}>{p.ids.map((id) => g.contacts.find((c) => c.id === id)?.name || 'Contact').join(' ↔ ')}: {Math.round(p.score * 100)}% · {p.summary}</li>)}
            </ul>
          )}
          <p className="mb-2 text-[12px] text-[var(--text-muted)]">Pick the record to keep. Everything linked to the others (leads, deals, tasks, proposals, meetings, history) moves to it; the others are kept as merged records.</p>
          <ul className="space-y-1.5">
            {g.contacts.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-[13px]">
                <input type="radio" id={`keep-${i}-${c.id}`} name={`keep-${i}`} checked={(keep[i] || g.contacts[0].id) === c.id} onChange={() => setKeep((k) => ({ ...k, [i]: c.id }))} />
                <label htmlFor={`keep-${i}-${c.id}`} className="min-w-0 flex-1 truncate">{c.name || c.email} <span className="text-[var(--text-muted)]">{[c.email, c.phone, c.company].filter(Boolean).join(' · ')}</span></label>
                <Button variant="ghost" onClick={() => onOpen(c.id)}>Open</Button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex justify-end"><Button variant="primary" onClick={() => merge(i)} disabled={busy !== null}><GitMerge className="h-4 w-4" />{busy === i ? 'Merging…' : 'Merge'}</Button></div>
        </fieldset>
      ))}
      {leadMatches.length > 0 && (
        <section aria-label="Leads that look like contacts" className="space-y-1.5">
          <h3 className="text-[13px] font-semibold">Leads that look like an existing contact</h3>
          <ul className="space-y-1">
            {leadMatches.map((m) => (
              <li key={m.lead.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--border)] px-3 py-2 text-[13px]">
                <span className="min-w-0">
                  <span className="block">Lead <strong>{m.lead.name || m.lead.email}</strong> looks like contact <strong>{m.contact.name || m.contact.email}</strong> <Badge>{scoreLabel(m)}</Badge></span>
                  <span className="block text-[12px] text-[var(--text-muted)]">{m.summary}</span>
                </span>
                <Button variant="ghost" onClick={() => onOpen(m.contact.id)}>Open contact</Button>
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-[var(--text-subtle)]">Nothing is merged automatically. Convert the lead from the Leads tab to link it to the contact.</p>
        </section>
      )}
    </div>
  );
}

function ContactProfile({ id, onClose, onNavigate, onOpenCompany, onChanged, onOpen }: { id: string; onClose: () => void; onNavigate?: (v: string) => void; onOpenCompany?: (id: string) => void; onChanged: () => void; onOpen: (id: string) => void }) {
  const [p, setP] = useState<any | null>(null);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const load = useCallback(async () => {
    setErr('');
    try {
      const r = await api<any>(`/api/contacts/${encodeURIComponent(id)}`);
      if (r.mergedInto) { onOpen(r.mergedInto); return; }
      setP(r);
    } catch (e: any) { setErr(e.message); }
  }, [id, onOpen]);
  useEffect(() => { setP(null); void load(); }, [load]);
  const c: Contact | undefined = p?.contact;
  const remove = async () => {
    try { await api(`/api/contacts/${id}`, { method: 'DELETE' }); notifyCrmChanged('contact'); onChanged(); onClose(); } catch (e: any) { setErr(e.message); setConfirmDelete(false); }
  };

  return (
    <Drawer labelId="contact-profile-title" onClose={onClose} title={c ? c.name || c.email : 'Contact'}
      subtitle={c && [c.title, c.company].filter(Boolean).join(' · ')}
      actions={c && <div className="flex gap-1">
        <Button variant="ghost" className="!px-2" aria-label="Edit contact" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /></Button>
        <Button variant="ghost" className="!px-2" aria-label="Delete contact" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" /></Button>
      </div>}>
      {err && <ErrorNote text={err} onRetry={load} />}
      {!p && !err ? <Loading /> : c && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[13px]">
            {c.email && <a className="inline-flex items-center gap-2 text-[var(--accent-text)] hover:underline break-all" href={`mailto:${c.email}`}><Mail className="h-4 w-4 shrink-0" aria-hidden="true" />{c.email}</a>}
            {c.phone && <a className="inline-flex items-center gap-2 text-[var(--accent-text)] hover:underline" href={`tel:${c.phone}`}><Phone className="h-4 w-4 shrink-0" aria-hidden="true" />{c.phone}</a>}
            {p.company && <button type="button" onClick={() => onOpenCompany?.(p.company.id)} disabled={!onOpenCompany} className="inline-flex items-center gap-2 text-left text-[var(--text)] enabled:hover:underline"><Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />{p.company.name}</button>}
            <span className="text-[var(--text-muted)]">Owner: {c.owner || 'Unassigned'}</span>
          </div>
          {(c.tags?.length > 0 || c.category) && <div className="flex flex-wrap gap-1.5">{c.category && <Badge tone="accent">{c.category}</Badge>}{c.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>}
          {((c.altEmails?.length || 0) > 0 || (c.altPhones?.length || 0) > 0) && <p className="text-[12px] text-[var(--text-muted)]">Also: {[...(c.altEmails || []), ...(c.altPhones || [])].join(', ')}</p>}
          {c.notes && <p className="whitespace-pre-wrap rounded-[var(--radius-control)] bg-[var(--surface-sunken)] p-3 text-[13px]">{c.notes}</p>}

          <Section title="Tasks" count={p.tasks.length} action={<Button variant="ghost" onClick={() => setAddingTask(true)}><Plus className="h-4 w-4" />Add</Button>}>
            {p.tasks.length ? <TaskList compact tasks={p.tasks} onChanged={load} onNavigate={onNavigate} /> : <p className="text-[13px] text-[var(--text-muted)]">No open tasks.</p>}
          </Section>

          <Section title="Deals" count={p.deals.length}>
            {p.deals.length ? <ul className="space-y-1 text-[13px]">{p.deals.map((d: any) => <li key={d.id} className="flex justify-between gap-2"><span className="truncate">{d.name}</span><span className="text-[var(--text-muted)] whitespace-nowrap">{money(d.value)} · {d.stage}</span></li>)}</ul> : <p className="text-[13px] text-[var(--text-muted)]">No deals.</p>}
          </Section>
          <Section title="Leads" count={p.leads.length}>
            {p.leads.length ? <ul className="space-y-1 text-[13px]">{p.leads.map((l: any) => <li key={l.id} className="flex justify-between gap-2"><span className="truncate">{l.name}{l.company ? ` · ${l.company}` : ''}</span><Badge>{l.status}</Badge></li>)}</ul> : <p className="text-[13px] text-[var(--text-muted)]">No leads.</p>}
          </Section>
          <Section title="Meetings" count={p.meetings.length}>
            {p.meetings.length ? <ul className="space-y-1 text-[13px]">{p.meetings.map((m: any) => <li key={m.id} className="flex justify-between gap-2"><span className="truncate">{m.title}</span><span className="text-[var(--text-muted)] whitespace-nowrap">{fmtDate(m.startTime, true)}</span></li>)}</ul> : <p className="text-[13px] text-[var(--text-muted)]">No meetings.</p>}
          </Section>
          <Section title="Proposals & invoicing" count={p.proposals.length + p.invoicingClients.length}>
            {p.proposals.length + p.invoicingClients.length ? (
              <ul className="space-y-1 text-[13px]">
                {p.proposals.map((x: any) => <li key={x.id} className="flex justify-between gap-2"><button type="button" className="truncate text-left hover:underline" onClick={() => onNavigate?.('proposals')}>{x.number} · {x.title}</button><Badge>{x.status}</Badge></li>)}
                {p.invoicingClients.map((x: any) => <li key={x.id} className="flex justify-between gap-2"><button type="button" className="truncate text-left hover:underline" onClick={() => onNavigate?.('proposals')}>Invoicing client: {x.name}</button></li>)}
              </ul>
            ) : <p className="text-[13px] text-[var(--text-muted)]">None.</p>}
          </Section>
          <Section title="Conversations" count={p.communications.length}>
            {p.communications.length ? (
              <ul className="space-y-2">
                {p.communications.slice(0, 20).map((m: any, i: number) => (
                  <li key={i} className="rounded-[var(--radius-control)] bg-[var(--surface-sunken)] px-3 py-2">
                    <p className="text-[11px] text-[var(--text-muted)]">{m.fromCustomer ? 'From them' : 'From your team'} · {String(m.channel).toLowerCase() === 'widget' ? 'Website chat' : m.channel} · {fmtDate(m.at, true)}</p>
                    <p className="mt-0.5 text-[13px] break-words">{m.text}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[13px] text-[var(--text-muted)]">No messages matched by email or phone yet.</p>}
          </Section>
          <Section title="Timeline" count={p.timeline.length}>
            <NoteBox onSave={async (note) => { await api(`/api/contacts/${id}/notes`, { method: 'POST', body: JSON.stringify({ note }) }); await load(); }} />
            <div className="mt-4"><Timeline items={p.timeline} /></div>
          </Section>
        </>
      )}
      {editing && c && <ContactForm contact={c} onClose={() => setEditing(false)} onSaved={() => { void load(); onChanged(); }} onOpenExisting={onOpen} />}
      {addingTask && c && <TaskForm fixed={{ contactId: c.id }} onClose={() => setAddingTask(false)} onSaved={() => load()} />}
      {confirmDelete && c && (
        <Modal title="Delete this contact?" onClose={() => setConfirmDelete(false)} labelId="contact-del-title"
          footer={<><Button onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" onClick={remove}>Delete</Button></>}>
          <p className="text-[13px]">{c.name || c.email} is hidden from lists. Linked leads, deals and history are kept, and an admin can restore the contact.</p>
        </Modal>
      )}
    </Drawer>
  );
}

export default function ContactsView({ onNavigate, onOpenCompany, initialContactId }: ContactsViewProps) {
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [rows, setRows] = useState<Contact[] | null>(null);
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState<string | null>(initialContactId || null);
  const [adding, setAdding] = useState(false);
  const [showDups, setShowDups] = useState(false);
  const [dupCount, setDupCount] = useState(0);

  const load = useCallback(async () => {
    setErr('');
    try {
      const qs = new URLSearchParams(); if (q.trim()) qs.set('q', q.trim()); if (tag) qs.set('tag', tag);
      const [r, d] = await Promise.all([api<{ contacts: Contact[] }>(`/api/contacts?${qs}`), api<{ groups: any[]; leadMatches?: any[] }>('/api/contacts/duplicates').catch(() => ({ groups: [], leadMatches: [] }))]);
      setRows(r.contacts); setDupCount(d.groups.length + (d.leadMatches?.length || 0));
    } catch (e: any) { setErr(e.message); setRows((x) => x ?? []); }
  }, [q, tag]);
  useEffect(() => { const h = setTimeout(load, q ? 250 : 0); return () => clearTimeout(h); }, [load, q]);
  useEffect(() => onCrmChanged((k) => { if (k === 'contact' || k === 'lead') void load(); }), [load]);
  useEffect(() => { if (initialContactId) setOpenId(initialContactId); }, [initialContactId]);

  const tags = [...new Set((rows || []).flatMap((c) => c.tags || []))].sort();

  return (
    <div className="space-y-4 text-[var(--text)]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative block flex-1">
          <span className="sr-only">Search contacts</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-subtle)]" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, phone, company or tag" className={`${inputCls} pl-8`} />
        </label>
        {tags.length > 0 && (
          <label className="sm:w-44"><span className="sr-only">Filter by tag</span>
            <select value={tag} onChange={(e) => setTag(e.target.value)} className={inputCls}><option value="">All tags</option>{tags.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          </label>
        )}
        {dupCount > 0 && <Button onClick={() => setShowDups(true)}><AlertTriangle className="h-4 w-4 text-[var(--warning)]" />{dupCount} possible duplicate{dupCount === 1 ? '' : 's'}</Button>}
        <Button variant="primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />New contact</Button>
      </div>
      {err && <ErrorNote text={err} onRetry={load} />}
      <Card>
        {rows === null ? <Loading label="Loading contacts…" /> : rows.length === 0 ? (
          <Empty icon={<Users className="h-8 w-8" />} title={q || tag ? 'No contacts match.' : 'No contacts yet.'}
            text={q || tag ? undefined : 'Add a contact, or convert a lead: the person becomes a contact with their history attached.'}
            action={!q && !tag ? <Button variant="primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />New contact</Button> : undefined} />
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {rows.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setOpenId(c.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
                  <Avatar name={c.name || c.email} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{c.name || c.email}</span>
                    <span className="block truncate text-[12px] text-[var(--text-muted)]">{[c.title, c.company, c.email, c.phone].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="hidden sm:flex flex-wrap justify-end gap-1 max-w-[40%]">{(c.tags || []).slice(0, 3).map((t) => <Badge key={t}>{t}</Badge>)}</span>
                  <span className="hidden md:block w-28 truncate text-right text-[12px] text-[var(--text-muted)]">{c.owner || 'Unassigned'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {adding && <ContactForm onClose={() => setAdding(false)} onSaved={(c) => { void load(); setOpenId(c.id); }} onOpenExisting={setOpenId} />}
      {showDups && <Modal title="Possible duplicates" onClose={() => setShowDups(false)} labelId="dups-title"><DuplicatesPanel onDone={load} onOpen={(id) => { setShowDups(false); setOpenId(id); }} /></Modal>}
      {openId && <ContactProfile id={openId} onClose={() => setOpenId(null)} onNavigate={onNavigate} onOpenCompany={onOpenCompany} onChanged={load} onOpen={setOpenId} />}
    </div>
  );
}
