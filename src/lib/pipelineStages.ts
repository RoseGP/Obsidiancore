/**
 * One pipeline vocabulary for the whole CRM (server routes and the Sales Pipeline board).
 *
 *   Lead statuses  new → contacted → qualifying → qualified → converted   (or unqualified)
 *   Deal stages    lead → discovery → qualified → proposal → negotiation → won   (or lost)
 *   Board columns  Inbound · Qualified · Proposal sent · Negotiation · Won · Lost · Unqualified
 *
 * Every lead status and deal stage maps to exactly one board column, and every board column maps back to
 * the status/stage a card gets when it's dropped there. Unknown values never fall into a "real" column.
 */

export const LEAD_STATUSES = ['new', 'contacted', 'qualifying', 'qualified', 'unqualified', 'converted'] as const;
export type LeadStatus = typeof LEAD_STATUSES[number];

export const DEAL_STAGES = ['lead', 'discovery', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] as const;
export type DealStage = typeof DEAL_STAGES[number];

/** Default closing probability (%) for a deal in each stage. */
export const DEAL_STAGE_PROBABILITY: Record<DealStage, number> = { lead: 20, discovery: 30, qualified: 50, proposal: 70, negotiation: 85, won: 100, lost: 0 };

export const BOARD_COLUMNS = ['new_leads', 'qualified', 'proposal_sent', 'negotiation', 'closed_won', 'closed_lost', 'unqualified'] as const;
export type BoardColumn = typeof BOARD_COLUMNS[number];

export const BOARD_COLUMN_LABELS: Record<BoardColumn, { label: string; sublabel: string }> = {
  new_leads: { label: 'Inbound leads', sublabel: 'New and contacted' },
  qualified: { label: 'Qualified', sublabel: 'Ready for a proposal' },
  proposal_sent: { label: 'Proposal sent', sublabel: 'Waiting on the client' },
  negotiation: { label: 'Negotiation', sublabel: 'Terms and pricing' },
  closed_won: { label: 'Won', sublabel: 'Closed won' },
  closed_lost: { label: 'Lost', sublabel: 'Closed lost' },
  unqualified: { label: 'Unqualified', sublabel: 'Not a fit right now' },
};

export const isLeadStatus = (v: unknown): v is LeadStatus => typeof v === 'string' && (LEAD_STATUSES as readonly string[]).includes(v);
export const isDealStage = (v: unknown): v is DealStage => typeof v === 'string' && (DEAL_STAGES as readonly string[]).includes(v);
export const isBoardColumn = (v: unknown): v is BoardColumn => typeof v === 'string' && (BOARD_COLUMNS as readonly string[]).includes(v);

/** Board column for a lead that has no deal yet. Converted leads are shown through their deal. */
export function columnForLeadStatus(status: unknown): BoardColumn {
  switch (status) {
    case 'qualified': return 'qualified';
    case 'unqualified': return 'unqualified';
    case 'converted': return 'closed_won';
    default: return 'new_leads'; // new, contacted, qualifying (and anything unknown)
  }
}

/** Board column for a deal stage (legacy board ids are accepted too). Unknown stages go to Inbound, never to a later stage. */
export function columnForDealStage(stage: unknown): BoardColumn {
  const s = String(stage ?? '').toLowerCase();
  if (s === 'lead' || s === 'discovery' || s === 'new_leads') return 'new_leads';
  if (s === 'qualified') return 'qualified';
  if (s === 'proposal' || s === 'proposal_sent') return 'proposal_sent';
  if (s === 'negotiation') return 'negotiation';
  if (s === 'won' || s === 'closed_won') return 'closed_won';
  if (s === 'lost' || s === 'closed_lost') return 'closed_lost';
  return 'new_leads';
}

/** Deal stage a deal card gets when dropped on a column. */
export function dealStageForColumn(col: BoardColumn): DealStage {
  switch (col) {
    case 'new_leads': return 'discovery';
    case 'qualified': return 'qualified';
    case 'proposal_sent': return 'proposal';
    case 'negotiation': return 'negotiation';
    case 'closed_won': return 'won';
    case 'closed_lost': return 'lost';
    case 'unqualified': return 'lost';
  }
}

/**
 * Lead status a lead card (no deal yet) gets when dropped on a column, or null when that move needs a deal
 * first (proposal, negotiation, won: the board asks to convert the lead instead).
 */
export function leadStatusForColumn(col: BoardColumn): Exclude<LeadStatus, 'converted'> | null {
  switch (col) {
    case 'new_leads': return 'contacted';
    case 'qualified': return 'qualified';
    case 'unqualified': return 'unqualified';
    case 'closed_lost': return 'unqualified';
    default: return null;
  }
}
