/**
 * AI receptionist knowledge, stored per organization:
 *   organizations/{orgId}/receptionist/settings        profile + departments
 *   organizations/{orgId}/receptionist_qas/{id}         Q&A pairs
 *   organizations/{orgId}/receptionist_documents/{id}   training documents
 * A new organization starts empty: nothing about any business is pre-filled.
 */
import { assertId, getDocStore, newId } from '../server/data/docStore';

export interface ReceptionistQA {
  id: string;
  category: 'general' | 'pricing' | 'technical' | 'security' | 'routing' | 'policy' | 'custom';
  question: string;
  answer: string;
  keywords: string[];
  enabled: boolean;
  priority: 'high' | 'medium' | 'low';
  updatedAt: string;
}

export interface ReceptionistDocument {
  id: string;
  title: string;
  category: string;
  rawContent: string;
  summary: string;
  extractedQAsCount: number;
  createdAt: string;
}

export interface DepartmentRoutingRule {
  departmentKey: 'sales' | 'support' | 'billing' | 'exec' | 'partnerships';
  name: string;
  title: string;
  leadPerson: string;
  extension: string;
  status: 'available' | 'in_meeting' | 'busy' | 'offline';
  triggers: string[];
  fallbackAction: 'take_message' | 'schedule_callback' | 'voicemail' | 'transfer_backup';
}

export interface ReceptionistCompanyProfile {
  companyName: string;
  tagline: string;
  industry: string;
  businessHours: string;
  timezone: string;
  address: string;
  visitorPolicy: string;
  emergencyPhone: string;
  defaultGreeting: string;
  agentName: string;
  voiceTone: 'executive' | 'friendly' | 'formal' | 'concierge';
  fallbackInstructions: string;
  maxResponseLengthWords: number;
}

export interface ReceptionistKnowledgeStore {
  profile: ReceptionistCompanyProfile;
  qas: ReceptionistQA[];
  documents: ReceptionistDocument[];
  departments: DepartmentRoutingRule[];
}

export class KnowledgeInputError extends Error { status = 400; code = 'invalid_input'; }

export const EMPTY_PROFILE: ReceptionistCompanyProfile = {
  companyName: '', tagline: '', industry: '', businessHours: '', timezone: '', address: '', visitorPolicy: '',
  emergencyPhone: '', defaultGreeting: '', agentName: '', voiceTone: 'friendly', fallbackInstructions: '',
  maxResponseLengthWords: 38,
};

const CATEGORIES = ['general', 'pricing', 'technical', 'security', 'routing', 'policy', 'custom'] as const;
const PRIORITIES = ['high', 'medium', 'low'] as const;
const DEPT_KEYS = ['sales', 'support', 'billing', 'exec', 'partnerships'] as const;
const DEPT_STATUS = ['available', 'in_meeting', 'busy', 'offline'] as const;
const DEPT_FALLBACK = ['take_message', 'schedule_callback', 'voicemail', 'transfer_backup'] as const;
const TONES = ['executive', 'friendly', 'formal', 'concierge'] as const;
const MAX_QAS = 500, MAX_DOCS = 200;

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const pick = <T extends readonly string[]>(v: unknown, list: T, d: T[number]): T[number] => (list.includes(v as any) ? (v as T[number]) : d);
const words = (v: unknown) => (Array.isArray(v) ? v : []).map((k) => str(k, 60).toLowerCase()).filter(Boolean).slice(0, 20);

const base = (orgId: string) => `organizations/${assertId(orgId)}`;

export async function loadKnowledge(orgId: string): Promise<ReceptionistKnowledgeStore> {
  const st = await getDocStore();
  const [settings, qas, documents] = await Promise.all([
    st.get(`${base(orgId)}/receptionist/settings`),
    st.list(`${base(orgId)}/receptionist_qas`),
    st.list(`${base(orgId)}/receptionist_documents`),
  ]);
  const newest = (a: { updatedAt?: string; createdAt?: string }, b: typeof a) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt));
  return {
    profile: { ...EMPTY_PROFILE, ...(settings?.profile || {}) },
    departments: Array.isArray(settings?.departments) ? settings.departments : [],
    qas: (qas as ReceptionistQA[]).sort(newest),
    documents: (documents as ReceptionistDocument[]).sort(newest),
  };
}

export async function updateProfile(orgId: string, input: Record<string, unknown>): Promise<ReceptionistCompanyProfile> {
  const st = await getDocStore();
  const path = `${base(orgId)}/receptionist/settings`;
  return st.transaction(async (tx) => {
    const cur = (await tx.get(path)) || {};
    const prev: ReceptionistCompanyProfile = { ...EMPTY_PROFILE, ...(cur.profile || {}) };
    const next: ReceptionistCompanyProfile = { ...prev };
    for (const k of ['companyName', 'tagline', 'industry', 'businessHours', 'timezone', 'address', 'visitorPolicy', 'emergencyPhone', 'agentName'] as const) {
      if (k in input) next[k] = str(input[k], 300);
    }
    for (const k of ['defaultGreeting', 'fallbackInstructions'] as const) if (k in input) next[k] = str(input[k], 1000);
    if ('voiceTone' in input) next.voiceTone = pick(input.voiceTone, TONES, prev.voiceTone);
    if ('maxResponseLengthWords' in input) {
      const n = Number(input.maxResponseLengthWords);
      if (!Number.isInteger(n) || n < 10 || n > 200) throw new KnowledgeInputError('maxResponseLengthWords must be a whole number from 10 to 200.');
      next.maxResponseLengthWords = n;
    }
    tx.set(path, { ...cur, profile: next });
    return next;
  });
}

function cleanQA(input: Record<string, unknown>, prev?: ReceptionistQA): Omit<ReceptionistQA, 'id' | 'updatedAt'> {
  const question = 'question' in input ? str(input.question, 500) : prev?.question || '';
  const answer = 'answer' in input ? str(input.answer, 2000) : prev?.answer || '';
  if (!question || !answer) throw new KnowledgeInputError('A question and an answer are required.');
  return {
    question, answer,
    category: 'category' in input ? pick(input.category, CATEGORIES, 'custom') : prev?.category || 'custom',
    priority: 'priority' in input ? pick(input.priority, PRIORITIES, 'medium') : prev?.priority || 'medium',
    keywords: 'keywords' in input ? words(input.keywords) : prev?.keywords || [],
    enabled: 'enabled' in input ? input.enabled !== false : prev?.enabled ?? true,
  };
}

export async function addQA(orgId: string, input: Record<string, unknown>): Promise<ReceptionistQA> {
  const st = await getDocStore();
  const existing = await st.list(`${base(orgId)}/receptionist_qas`, { limit: MAX_QAS });
  if (existing.length >= MAX_QAS) throw new KnowledgeInputError(`The knowledge base is limited to ${MAX_QAS} Q&A pairs.`);
  const qa: ReceptionistQA = { id: newId('qa'), ...cleanQA(input), updatedAt: new Date().toISOString() };
  await st.set(`${base(orgId)}/receptionist_qas/${qa.id}`, qa);
  return qa;
}

export async function updateQA(orgId: string, id: string, input: Record<string, unknown>): Promise<ReceptionistQA | null> {
  const st = await getDocStore();
  const path = `${base(orgId)}/receptionist_qas/${assertId(id)}`;
  return st.transaction(async (tx) => {
    const prev = (await tx.get(path)) as ReceptionistQA | null;
    if (!prev) return null;
    const next: ReceptionistQA = { id: prev.id, ...cleanQA(input, prev), updatedAt: new Date().toISOString() };
    tx.set(path, next);
    return next;
  });
}

export async function deleteQA(orgId: string, id: string): Promise<boolean> {
  return (await getDocStore()).deleteRecursive(`${base(orgId)}/receptionist_qas/${assertId(id)}`);
}

export async function addDocument(orgId: string, input: { title: unknown; category: unknown; rawContent: unknown; summary: unknown; extractedQAsCount: number }): Promise<ReceptionistDocument> {
  const st = await getDocStore();
  const existing = await st.list(`${base(orgId)}/receptionist_documents`, { limit: MAX_DOCS });
  if (existing.length >= MAX_DOCS) throw new KnowledgeInputError(`The knowledge base is limited to ${MAX_DOCS} documents.`);
  const rawContent = str(input.rawContent, 50_000);
  if (!rawContent) throw new KnowledgeInputError('Document text is required.');
  const doc: ReceptionistDocument = {
    id: newId('doc'),
    title: str(input.title, 200) || 'Untitled document',
    category: str(input.category, 100) || 'Custom Training',
    rawContent,
    summary: str(input.summary, 2000),
    extractedQAsCount: Math.max(0, Math.floor(Number(input.extractedQAsCount) || 0)),
    createdAt: new Date().toISOString(),
  };
  await st.set(`${base(orgId)}/receptionist_documents/${doc.id}`, doc);
  return doc;
}

export async function deleteDocument(orgId: string, id: string): Promise<boolean> {
  return (await getDocStore()).deleteRecursive(`${base(orgId)}/receptionist_documents/${assertId(id)}`);
}

/** Creates or updates one department's routing rule. */
export async function upsertDepartment(orgId: string, key: unknown, input: Record<string, unknown>): Promise<DepartmentRoutingRule> {
  if (!DEPT_KEYS.includes(key as any)) throw new KnowledgeInputError(`Department must be one of: ${DEPT_KEYS.join(', ')}.`);
  const st = await getDocStore();
  const path = `${base(orgId)}/receptionist/settings`;
  return st.transaction(async (tx) => {
    const cur = (await tx.get(path)) || {};
    const list: DepartmentRoutingRule[] = Array.isArray(cur.departments) ? cur.departments : [];
    const prev = list.find((d) => d.departmentKey === key);
    const next: DepartmentRoutingRule = {
      departmentKey: key as DepartmentRoutingRule['departmentKey'],
      name: 'name' in input ? str(input.name, 100) : prev?.name || String(key),
      title: 'title' in input ? str(input.title, 100) : prev?.title || '',
      leadPerson: 'leadPerson' in input ? str(input.leadPerson, 100) : prev?.leadPerson || '',
      extension: 'extension' in input ? str(input.extension, 30) : prev?.extension || '',
      status: 'status' in input ? pick(input.status, DEPT_STATUS, 'available') : prev?.status || 'available',
      triggers: 'triggers' in input ? words(input.triggers) : prev?.triggers || [],
      fallbackAction: 'fallbackAction' in input ? pick(input.fallbackAction, DEPT_FALLBACK, 'take_message') : prev?.fallbackAction || 'take_message',
    };
    tx.set(path, { ...cur, departments: [...list.filter((d) => d.departmentKey !== key), next] });
    return next;
  });
}

/** Removes everything this organization taught the receptionist. */
export async function clearKnowledge(orgId: string): Promise<ReceptionistKnowledgeStore> {
  const st = await getDocStore();
  await st.deleteRecursive(`${base(orgId)}/receptionist/settings`);
  for (const q of await st.list(`${base(orgId)}/receptionist_qas`)) if (q?.id) await st.deleteRecursive(`${base(orgId)}/receptionist_qas/${q.id}`);
  for (const d of await st.list(`${base(orgId)}/receptionist_documents`)) if (d?.id) await st.deleteRecursive(`${base(orgId)}/receptionist_documents/${d.id}`);
  return loadKnowledge(orgId);
}

/** Prompt context for the AI, built only from what the organization entered. */
export function buildKnowledgeContext(store: ReceptionistKnowledgeStore, fallbackCompany: string): string {
  const { profile, qas, departments, documents } = store;
  const company = profile.companyName || fallbackCompany;
  const line = (label: string, v: string) => (v ? `- ${label}: ${v}\n` : '');
  const enabledQAs = qas.filter((q) => q.enabled);
  const qaContext = enabledQAs.map((q, i) => `Q${i + 1} [${q.category.toUpperCase()}]: "${q.question}"\nA${i + 1}: "${q.answer}"`).join('\n\n');
  const deptContext = departments.map((d) =>
    `- ${d.name}${d.leadPerson ? ` (${d.leadPerson}` : ' ('}${d.extension ? `, Ext: ${d.extension}` : ''}, Status: ${d.status === 'in_meeting' ? 'IN MEETING (take a message)' : d.status.toUpperCase()}). Triggers: ${d.triggers.join(', ')}`
  ).join('\n');
  const docContext = documents.map((doc) => `[DOCUMENT: ${doc.title} (${doc.category})]\n${doc.summary || doc.rawContent.slice(0, 300)}`).join('\n\n');
  return `
========================================
RECEPTIONIST KNOWLEDGE BASE (entered by ${company}):
========================================
COMPANY INFORMATION:
${line('Company name', company)}${line('Industry', profile.industry)}${line('Tagline', profile.tagline)}${line('Business hours', profile.businessHours)}${line('Timezone', profile.timezone)}${line('Address', profile.address)}${line('Visitor policy', profile.visitorPolicy)}${line('Emergency phone', profile.emergencyPhone)}- Tone of voice: ${profile.voiceTone} (about ${profile.maxResponseLengthWords} words per spoken reply)
${line('Opening greeting', profile.defaultGreeting)}${line('When unsure', profile.fallbackInstructions)}
ACTIONS: You can only PROPOSE a video call, a meeting or a proposal; a team member creates it. Never say it is already booked, sent or confirmed.
If the knowledge base doesn't answer a question, say you'll pass it to the team. Never invent prices, hours, addresses, people or policies.

DEPARTMENTS:
${deptContext || '(none configured)'}

Q&A (${enabledQAs.length} entries):
${qaContext || '(none yet)'}

DOCUMENTS:
${docContext || '(none yet)'}
========================================
`;
}
