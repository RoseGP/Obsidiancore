/**
 * CRM data model (server and client share these shapes).
 * Every record belongs to exactly one workspace (the signed-in user's id) and
 * carries createdAt / updatedAt / version for auditing and conflict detection.
 */

export type EntityType = 'contact' | 'lead' | 'deal';
export type RelatedType = EntityType | 'task';

export interface Base {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Increments on every update; clients send it back to detect conflicting edits. */
  version: number;
}

export type CustomValues = Record<string, string | number | boolean | null>;

export type ContactStatus = 'active' | 'prospect' | 'inactive';
export interface Contact extends Base {
  firstName: string;
  lastName: string;
  company: string;
  title: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  status: ContactStatus;
  /** Free-form categories such as "VIP" or "Wholesale". */
  tags: string[];
  source: string;
  owner: string;
  notes: string;
  fields: CustomValues;
  lastActivityAt: string | null;
}

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'unqualified', 'converted', 'lost'] as const;
export type LeadStatus = typeof LEAD_STATUSES[number];
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = typeof PRIORITIES[number];

export interface Lead extends Base {
  name: string;
  company: string;
  email: string;
  phone: string;
  status: LeadStatus;
  priority: Priority;
  source: string;
  /** 0–100, set by the user. */
  score: number;
  /** Estimated value in the workspace currency (whole units). */
  value: number;
  assignedTo: string;
  nextFollowUpAt: string | null;
  tags: string[];
  notes: string;
  fields: CustomValues;
  lostReason: string;
  convertedAt: string | null;
  contactId: string | null;
  dealId: string | null;
  lastActivityAt: string | null;
}

export interface PipelineStage { id: string; name: string; probability: number; kind: 'open' | 'won' | 'lost' }

export interface Deal extends Base {
  name: string;
  contactId: string | null;
  leadId: string | null;
  company: string;
  stageId: string;
  value: number;
  /** Overrides the stage probability when set (0–100). */
  probability: number | null;
  expectedCloseDate: string | null;
  owner: string;
  closedAt: string | null;
  lostReason: string;
  notes: string;
  tags: string[];
  fields: CustomValues;
}

export const TASK_STATUSES = ['open', 'done'] as const;
export interface Task extends Base {
  title: string;
  description: string;
  dueAt: string | null;
  priority: Priority;
  status: typeof TASK_STATUSES[number];
  assignee: string;
  relatedTo: { type: EntityType; id: string } | null;
  completedAt: string | null;
}

export interface Note extends Base {
  body: string;
  relatedTo: { type: EntityType; id: string };
}

export const INTERACTION_TYPES = ['call', 'meeting', 'message', 'note', 'other'] as const;
export interface Activity {
  id: string;
  at: string;
  /** created, updated, status, stage, converted, task_done, note, call, meeting, message, imported, merged … */
  kind: string;
  summary: string;
  relatedTo: { type: RelatedType; id: string } | null;
  actor: string;
}

export interface CalendarEvent extends Base {
  title: string;
  start: string;
  end: string | null;
  kind: 'meeting' | 'call' | 'demo' | 'follow_up' | 'other';
  location: string;
  attendees: string;
  relatedTo: { type: EntityType; id: string } | null;
  notes: string;
}

export interface SavedView extends Base {
  entity: EntityType | 'task';
  name: string;
  /** Opaque filter state from the list page (search text, status, tags, sort). */
  filters: Record<string, string | string[] | boolean | null>;
}

export type FieldKind = 'text' | 'number' | 'date' | 'select' | 'checkbox';
export interface CustomFieldDef { key: string; label: string; kind: FieldKind; options: string[] }

export interface CrmSettings {
  currency: string;
  pipeline: PipelineStage[];
  leadSources: string[];
  customFields: Record<EntityType, CustomFieldDef[]>;
  /** Secret key for the public lead-capture form endpoint; null = form disabled. */
  captureKey: string | null;
  updatedAt: string;
}

export const DEFAULT_PIPELINE: PipelineStage[] = [
  { id: 'qualified', name: 'Qualified', probability: 20, kind: 'open' },
  { id: 'meeting', name: 'Meeting held', probability: 40, kind: 'open' },
  { id: 'proposal', name: 'Proposal sent', probability: 60, kind: 'open' },
  { id: 'negotiation', name: 'Negotiation', probability: 80, kind: 'open' },
  { id: 'won', name: 'Won', probability: 100, kind: 'won' },
  { id: 'lost', name: 'Lost', probability: 0, kind: 'lost' },
];

export const DEFAULT_SOURCES = ['Website', 'Referral', 'Phone', 'WhatsApp', 'Social media', 'Event', 'Advertising', 'Other'];

export const defaultSettings = (): CrmSettings => ({
  currency: 'USD',
  pipeline: DEFAULT_PIPELINE.map((s) => ({ ...s })),
  leadSources: [...DEFAULT_SOURCES],
  customFields: { contact: [], lead: [], deal: [] },
  captureKey: null,
  updatedAt: new Date(0).toISOString(),
});

export type Collection = 'contacts' | 'leads' | 'deals' | 'tasks' | 'notes' | 'activities' | 'events' | 'views';
