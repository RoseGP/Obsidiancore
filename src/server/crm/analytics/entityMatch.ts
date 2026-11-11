/**
 * Fuzzy duplicate and entity matching for people (contacts and leads). Pure, no dependencies.
 *
 * 1. Blocking: records are only compared when they share a key, so the work grows with the size of the
 *    blocks, not with every possible pair:
 *      m:<email>                      exact email (always compared)
 *      p:<last 7 phone digits>        phone (always compared)
 *      e:<email domain>:<initial>     email domain + first-name initial (nicknames use the full name's initial)
 *      c:<company token>              each normalized company token
 *      s:<Soundex(last name)>         sound-alike surname (single-word names: Soundex of that word)
 *    Blocks larger than MAX_BLOCK (other than m:/p:) are skipped: a very common surname alone doesn't make a match.
 * 2. Scoring a pair (symmetric: the pair is put in a fixed order first):
 *      exact email or phone           0.9 + 0.1·name similarity (0.75 when the names clearly differ: a shared
 *                                     inbox or office line)
 *      otherwise, a weighted mean     name 0.55 · company 0.25 · email local part 0.20 (only the signals both
 *                                     records have), then capped:
 *        - no names to compare, or different first or last names       → at most 0.6 / 0.65
 *        - no company/domain evidence and no similar email name         → at most 0.6 (name only)
 *        - only the email name agrees, or the first names only look alike (typo, initial) → at most 0.84
 *    Names: Jaro-Winkler on normalized names, first and last separately (0.45 / 0.55), with a nickname map
 *    (Bob = Robert, Jon/Jonathan = John…). Companies: Inc, LLC, Ltd, Co, Corp, The… and punctuation removed,
 *    then token Jaccard. Same non-webmail email domain counts as company evidence.
 * 3. Levels: likely ≥ 0.85, possible ≥ 0.7. Nothing is merged automatically.
 */

export const LIKELY = 0.85;
export const POSSIBLE = 0.7;
export const MAX_BLOCK = 300;
export const WEIGHTS = { name: 0.55, company: 0.25, emailLocal: 0.2 } as const;

export interface MatchRecord { id: string; name?: string; email?: string; phone?: string; company?: string; altEmails?: string[]; altPhones?: string[] }
export type MatchLevel = 'likely' | 'possible' | 'none';
export interface PairMatch { score: number; level: MatchLevel; reasons: string[]; summary: string }

// ---------------------------------------------------------------- normalization
export const normEmail = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
export const normPhone = (v: unknown) => { const d = String(v ?? '').replace(/\D/g, ''); return d.length >= 7 ? d.slice(-10) : ''; };
const phone7 = (v: unknown) => { const d = String(v ?? '').replace(/\D/g, ''); return d.length >= 7 ? d.slice(-7) : ''; };
const fold = (v: unknown) => String(v ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof', 'sir', 'jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md', 'esq']);
/** Lowercase name tokens without accents, punctuation or titles ("Dr. José O'Neil Jr." → ["jose", "oneil"]). */
export function nameTokens(v: unknown): string[] {
  return fold(v).replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((t) => t && !HONORIFICS.has(t));
}

const COMPANY_STOP = new Set(['inc', 'incorporated', 'llc', 'ltd', 'limited', 'co', 'corp', 'corporation', 'company', 'the', 'gmbh', 'plc', 'sa', 'ag', 'bv', 'pty', 'llp', 'lp', 'and', 'group']);
/** Company tokens after removing legal suffixes, "the" and punctuation ("The Acme Co., Inc." → ["acme"]). */
export function companyTokens(v: unknown): string[] {
  return [...new Set(fold(v).replace(/&/g, ' ').replace(/['’`.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((t) => t && !COMPANY_STOP.has(t)))];
}
/** Token Jaccard of two company names (null when either is missing). */
export function companySimilarity(a: unknown, b: unknown): number | null {
  const x = companyTokens(a), y = companyTokens(b);
  if (!x.length || !y.length) return null;
  const sy = new Set(y);
  const inter = x.filter((t) => sy.has(t)).length;
  return inter / (x.length + y.length - inter);
}

export const FREE_EMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de', 'mail.com', 'yandex.com', 'zoho.com', 'hey.com', 'fastmail.com']);
const emailParts = (e: string) => { const i = e.lastIndexOf('@'); return i > 0 ? { local: e.slice(0, i), domain: e.slice(i + 1) } : null; };
const localKey = (l: string) => l.split('+')[0].replace(/[^a-z]/g, '');

// ---------------------------------------------------------------- string similarity
/** Jaro-Winkler similarity (0..1), prefix scale 0.1 over at most 4 characters. Symmetric. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a ? 1 : 0;
  if (!a || !b) return 0;
  const win = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const ma = new Array<boolean>(a.length).fill(false), mb = new Array<boolean>(b.length).fill(false);
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - win); j < Math.min(b.length, i + win + 1); j++) {
      if (!mb[j] && a[i] === b[j]) { ma[i] = mb[j] = true; m++; break; }
    }
  }
  if (!m) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < a.length; i++) if (ma[i]) { while (!mb[k]) k++; if (a[i] !== b[k]) t++; k++; }
  const jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3;
  let p = 0; while (p < 4 && p < a.length && p < b.length && a[p] === b[p]) p++;
  return jaro + p * 0.1 * (1 - jaro);
}

/** American Soundex ("Robert" → R163, "Rupert" → R163). Empty string for no letters. */
export function soundex(v: unknown): string {
  const s = fold(v).replace(/[^a-z]/g, '');
  if (!s) return '';
  const code = (c: string) => ('bfpv'.includes(c) ? '1' : 'cgjkqsxz'.includes(c) ? '2' : 'dt'.includes(c) ? '3' : c === 'l' ? '4' : 'mn'.includes(c) ? '5' : c === 'r' ? '6' : '');
  let out = s[0].toUpperCase(), prev = code(s[0]);
  for (let i = 1; i < s.length && out.length < 4; i++) {
    const c = s[i], d = code(c);
    if (d && d !== prev) out += d;
    if (c !== 'h' && c !== 'w') prev = d; // h/w don't separate equal codes; vowels do
  }
  return out.padEnd(4, '0');
}

// ---------------------------------------------------------------- nicknames
/** Each group is one given name and its common short forms; the first entry is the canonical name. */
const NICKNAME_GROUPS: string[][] = [
  ['robert', 'bob', 'bobby', 'rob', 'robbie', 'bert'], ['william', 'bill', 'billy', 'will', 'willy', 'liam'], ['john', 'jon', 'jonathan', 'johnny', 'jack'],
  ['james', 'jim', 'jimmy', 'jamie'], ['michael', 'mike', 'mikey', 'mick'], ['thomas', 'tom', 'tommy'], ['richard', 'rick', 'ricky', 'rich', 'dick'],
  ['elizabeth', 'liz', 'lizzie', 'beth', 'betty', 'eliza', 'libby'], ['katherine', 'catherine', 'kathryn', 'kate', 'katie', 'kathy', 'cathy', 'kat'],
  ['david', 'dave', 'davey'], ['daniel', 'dan', 'danny'], ['christopher', 'chris', 'kit'], ['christine', 'christina', 'chris', 'tina'],
  ['steven', 'stephen', 'steve'], ['alexander', 'alex', 'xander', 'sasha'], ['alexandra', 'alex', 'alexa', 'sandra'], ['samuel', 'sam', 'sammy'],
  ['samantha', 'sam', 'sammy'], ['matthew', 'matt'], ['nicholas', 'nick', 'nicky'], ['anthony', 'tony'], ['joseph', 'joe', 'joey'],
  ['andrew', 'andy', 'drew'], ['benjamin', 'ben', 'benny'], ['margaret', 'maggie', 'meg', 'peggy', 'marge'], ['jennifer', 'jen', 'jenny'],
  ['susan', 'sue', 'susie', 'suzy'], ['patrick', 'pat', 'paddy'], ['patricia', 'pat', 'patty', 'trish'], ['edward', 'ed', 'eddie', 'ted', 'ned'],
  ['gregory', 'greg'], ['jeffrey', 'geoffrey', 'jeff', 'geoff'], ['kenneth', 'ken', 'kenny'], ['lawrence', 'laurence', 'larry'], ['ronald', 'ron', 'ronnie'],
  ['timothy', 'tim', 'timmy'], ['victoria', 'vicky', 'tori'], ['abigail', 'abby', 'gail'], ['rebecca', 'becky', 'becca'], ['amanda', 'mandy'],
  ['nathan', 'nathaniel', 'nate'], ['zachary', 'zach', 'zack'], ['henry', 'hank', 'harry'], ['charles', 'charlie', 'chuck'], ['frederick', 'fred', 'freddie'],
  ['donald', 'don', 'donnie'], ['douglas', 'doug'], ['gerald', 'gerry', 'jerry'], ['raymond', 'ray'], ['philip', 'phillip', 'phil'], ['peter', 'pete'],
  ['deborah', 'debra', 'deb', 'debbie'], ['dorothy', 'dot', 'dottie'], ['jessica', 'jess', 'jessie'], ['kimberly', 'kim'], ['melissa', 'mel', 'missy'],
  ['pamela', 'pam'], ['sandra', 'sandy'], ['theresa', 'teresa', 'terry', 'tess'], ['valerie', 'val'], ['jacqueline', 'jackie'], ['josephine', 'jo', 'josie'],
  ['eleanor', 'ellie', 'nora'], ['isabella', 'isabel', 'bella', 'izzy'], ['olivia', 'liv'], ['sophia', 'sophie'], ['leonard', 'leo', 'len', 'lenny'],
  ['mohammed', 'mohammad', 'muhammad', 'mo'], ['alejandro', 'alex', 'ale'], ['francisco', 'frank', 'paco', 'pancho'], ['francis', 'frank', 'fran'],
  ['jose', 'pepe'], ['guillermo', 'memo'], ['eduardo', 'eddie', 'lalo'], ['ignacio', 'nacho'], ['manuel', 'manny', 'manolo'],
];
const NICK = new Map<string, number[]>();
NICKNAME_GROUPS.forEach((g, i) => { for (const n of g) NICK.set(n, [...(NICK.get(n) || []), i]); });
/** True when two first names are the same name or forms of the same name (Bob/Robert, Jon/Jonathan). */
export function nicknameMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const ga = NICK.get(a), gb = NICK.get(b);
  return !!ga && !!gb && ga.some((g) => gb.includes(g));
}
/** Initials of the canonical forms of a first name (for the domain+initial block). */
const initials = (first: string) => [...new Set([first[0], ...(NICK.get(first) || []).map((g) => NICKNAME_GROUPS[g][0][0])].filter(Boolean))];

// ---------------------------------------------------------------- names
export interface NameSim { score: number; first: number | null; last: number | null; firstKind: 'exact' | 'nickname' | 'initial' | 'similar' | 'different' | 'n/a'; nickname: [string, string] | null }

function firstNameSim(a: string, b: string): { s: number; kind: NameSim['firstKind'] } {
  if (a === b) return { s: 1, kind: 'exact' };
  if (nicknameMatch(a, b)) return { s: 1, kind: 'nickname' };
  if ((a.length === 1 || b.length === 1) && a[0] === b[0]) return { s: 0.85, kind: 'initial' };
  const jw = jaroWinkler(a, b);
  return { s: jw, kind: jw >= 0.88 ? 'similar' : 'different' };
}

/** Similarity of two person names (null when either is empty). */
export function nameSimilarity(a: unknown, b: unknown): NameSim | null {
  const x = nameTokens(a), y = nameTokens(b);
  if (!x.length || !y.length) return null;
  if (x.length >= 2 && y.length >= 2) {
    const f = firstNameSim(x[0], y[0]);
    const last = jaroWinkler(x[x.length - 1], y[y.length - 1]);
    const straight = 0.45 * f.s + 0.55 * last;
    // Same words in the other order ("Lee Hana" / "Hana Lee").
    const swapped = 0.5 * jaroWinkler(x[0], y[y.length - 1]) + 0.5 * jaroWinkler(x[x.length - 1], y[0]);
    if (swapped > straight && swapped >= 0.95) return { score: swapped * 0.95, first: null, last: null, firstKind: 'similar', nickname: null };
    return { score: straight, first: f.s, last, firstKind: f.kind, nickname: f.kind === 'nickname' ? [x[0], y[0]] : null };
  }
  // One side is a single word: compare it with the other's first and last name, at a discount.
  const single = x.length === 1 ? x[0] : y[0];
  const full = x.length === 1 ? y : x;
  if (full.length === 1) {
    const f = firstNameSim(x[0], y[0]);
    return { score: f.s * 0.9, first: f.s, last: null, firstKind: f.kind, nickname: f.kind === 'nickname' ? [x[0], y[0]] : null };
  }
  const f = firstNameSim(single, full[0]);
  const l = jaroWinkler(single, full[full.length - 1]);
  return { score: Math.max(f.s, l) * 0.8, first: f.s, last: null, firstKind: f.s >= l ? f.kind : 'n/a', nickname: f.kind === 'nickname' && f.s >= l ? [single, full[0]] : null };
}

// ---------------------------------------------------------------- pair score
const emailsOf = (r: MatchRecord) => [...new Set([r.email, ...(r.altEmails || [])].map(normEmail).filter(Boolean))];
const phonesOf = (r: MatchRecord) => [...new Set([r.phone, ...(r.altPhones || [])].map(normPhone).filter(Boolean))];
const orderKey = (r: MatchRecord) => `${nameTokens(r.name).join(' ')}\u0000${emailsOf(r)[0] || ''}\u0000${phonesOf(r)[0] || ''}\u0000${r.id}`;
const fmt = (n: number) => n.toFixed(2);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const levelOf = (score: number): MatchLevel => (score >= LIKELY ? 'likely' : score >= POSSIBLE ? 'possible' : 'none');

/** How much two people records look like the same person, with the reasons. Symmetric. */
export function matchScore(a: MatchRecord, b: MatchRecord): PairMatch {
  const [p, q] = orderKey(a) <= orderKey(b) ? [a, b] : [b, a];
  const ep = emailsOf(p), eq = new Set(emailsOf(q));
  const pp = phonesOf(p), pq = new Set(phonesOf(q));
  const sameEmail = ep.some((e) => eq.has(e));
  const samePhone = pp.some((x) => pq.has(x));
  const n = nameSimilarity(p.name, q.name);
  const reasons: string[] = [];
  if (sameEmail) reasons.push('Same email');
  if (samePhone) reasons.push('Same phone');
  const nameReason = () => {
    if (!n) return;
    const nick = n.nickname ? ` (${cap(n.nickname[0])}/${cap(n.nickname[1])})` : n.firstKind === 'initial' ? ' (initial)' : '';
    reasons.push(n.score >= 0.995 ? (n.nickname ? `Names match as nicknames${nick}` : 'Same name') : `Names ${fmt(n.score)} similar${nick}`);
  };

  // Company evidence: normalized company names, else the same non-webmail email domain.
  const c = companySimilarity(p.company, q.company);
  const domains = (r: string[]) => new Set(r.map((e) => emailParts(e)?.domain || '').filter((d) => d && !FREE_EMAIL_DOMAINS.has(d)));
  const dq = domains([...eq]);
  const sharedDomain = [...domains(ep)].find((d) => dq.has(d)) || null;
  const companySignal = c ?? (sharedDomain ? 1 : null);

  let score: number;
  if (sameEmail || samePhone) {
    if (!n) score = 0.9;
    else if (n.score < 0.5 || n.firstKind === 'different' || (n.last !== null && n.last < 0.88)) {
      score = 0.75; reasons.push(`Names differ (${fmt(n.score)}): maybe a shared ${sameEmail ? 'inbox' : 'number'}`);
    } else { score = 0.9 + 0.1 * n.score; nameReason(); }
    if (c !== null && c === 1) reasons.push('Same company after normalization');
  } else {
    // Email local part (only when both have an email and they differ).
    const lp = ep.map((e) => localKey(emailParts(e)?.local || '')).filter(Boolean), lq = [...eq].map((e) => localKey(emailParts(e)?.local || '')).filter(Boolean);
    let l: number | null = null;
    for (const x of lp) for (const y of lq) l = Math.max(l ?? 0, jaroWinkler(x, y));
    const parts: Array<[number, number]> = [];
    if (n) parts.push([n.score, WEIGHTS.name]);
    if (companySignal !== null) parts.push([companySignal, WEIGHTS.company]);
    if (l !== null) parts.push([l, WEIGHTS.emailLocal]);
    const wsum = parts.reduce((s, [, w]) => s + w, 0);
    score = wsum ? parts.reduce((s, [v, w]) => s + v * w, 0) / wsum : 0;

    nameReason();
    if (c !== null && c === 1) reasons.push('Same company after normalization');
    else if (c !== null && c >= 0.5) reasons.push(`Company names ${fmt(c)} similar`);
    else if (c !== null) reasons.push('Different companies');
    if (c === null && sharedDomain) reasons.push(`Same email domain (${sharedDomain})`);
    if (l !== null && l >= 0.85) reasons.push(`Email names ${fmt(l)} similar`);

    const strong = (companySignal ?? 0) >= 0.5;
    const weak = (l ?? 0) >= 0.85;
    const differentFirst = !!n && n.first !== null && n.firstKind === 'different';
    const differentLast = !!n && n.last !== null && n.last < 0.88;
    if (!n) score = Math.min(score, 0.6);
    else if (differentFirst || differentLast || n.score < 0.75) { score = Math.min(score, 0.65); reasons.push(differentFirst ? 'Different first names' : 'Different last names'); }
    if (!strong && !weak) score = Math.min(score, 0.6);
    if ((!strong && weak) || (n && (n.firstKind === 'similar' || n.firstKind === 'initial'))) score = Math.min(score, 0.84);
  }
  score = Math.round(Math.min(1, Math.max(0, score)) * 1000) / 1000;
  return { score, level: levelOf(score), reasons, summary: reasons.join('; ') };
}

// ---------------------------------------------------------------- blocking
/** Blocking keys of one record (see the header). */
export function blockingKeys(r: MatchRecord): string[] {
  const keys = new Set<string>();
  const tokens = nameTokens(r.name);
  const first = tokens[0] || '';
  for (const e of emailsOf(r)) {
    keys.add(`m:${e}`);
    const parts = emailParts(e);
    if (parts?.domain) for (const i of first ? initials(first) : [localKey(parts.local)[0] || '']) if (i) keys.add(`e:${parts.domain}:${i}`);
  }
  for (const ph of [r.phone, ...(r.altPhones || [])]) { const k = phone7(ph); if (k) keys.add(`p:${k}`); }
  for (const t of companyTokens(r.company)) if (t.length >= 2) keys.add(`c:${t}`);
  const sx = soundex(tokens.length >= 2 ? tokens[tokens.length - 1] : first);
  if (sx) keys.add(`s:${sx}`);
  return [...keys];
}

const exactKey = (k: string) => k.startsWith('m:') || k.startsWith('p:');

/** Index of blocking key → record positions. */
export function buildIndex(records: MatchRecord[]): Map<string, number[]> {
  const index = new Map<string, number[]>();
  records.forEach((r, i) => { for (const k of blockingKeys(r)) { const list = index.get(k); if (list) list.push(i); else index.set(k, [i]); } });
  return index;
}

/** Positions of records that share at least one usable block with `r`. */
export function candidatesFor(r: MatchRecord, index: Map<string, number[]>): Set<number> {
  const out = new Set<number>();
  for (const k of blockingKeys(r)) { const list = index.get(k); if (list && (exactKey(k) || list.length <= MAX_BLOCK)) for (const i of list) out.add(i); }
  return out;
}

/** Every pair within the same blocks (i < j), once. */
export function candidatePairs(records: MatchRecord[]): Array<[number, number]> {
  const index = buildIndex(records);
  const seen = new Set<string>(); const out: Array<[number, number]> = [];
  for (const [k, list] of index) {
    if (list.length < 2 || (!exactKey(k) && list.length > MAX_BLOCK)) continue;
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
      const i = Math.min(list[x], list[y]), j = Math.max(list[x], list[y]);
      if (i === j) continue;
      const key = `${i}|${j}`; if (seen.has(key)) continue; seen.add(key); out.push([i, j]);
    }
  }
  return out;
}

export interface ScoredPair { a: number; b: number; match: PairMatch }
/** Pairs of records at or above `min` (default: possible). */
export function findMatchingPairs(records: MatchRecord[], min = POSSIBLE): ScoredPair[] {
  return candidatePairs(records).map(([a, b]) => ({ a, b, match: matchScore(records[a], records[b]) }))
    .filter((p) => p.match.score >= min).sort((x, y) => y.match.score - x.match.score);
}

/** The records in `pool` that look like `candidate`, best first (at or above `min`). */
export function matchAgainst(candidate: MatchRecord, pool: MatchRecord[], opts: { min?: number; limit?: number; index?: Map<string, number[]>; exclude?: (r: MatchRecord) => boolean } = {}) {
  const index = opts.index ?? buildIndex(pool);
  return [...candidatesFor(candidate, index)].map((i) => pool[i]).filter((r) => r.id !== candidate.id && !(opts.exclude && opts.exclude(r)))
    .map((r) => ({ record: r, match: matchScore(candidate, r) }))
    .filter((x) => x.match.score >= (opts.min ?? POSSIBLE))
    .sort((x, y) => y.match.score - x.match.score)
    .slice(0, opts.limit ?? 5);
}

/** For each open lead, the existing contact it most looks like (leads already linked to that contact are skipped). */
export function matchLeadsToContacts(leads: any[], contacts: any[], min = POSSIBLE) {
  const pool: MatchRecord[] = contacts;
  const index = buildIndex(pool);
  const out: Array<{ lead: any; contact: any; score: number; level: MatchLevel; reasons: string[]; summary: string }> = [];
  for (const l of leads) {
    if (!l || l.deletedAt || ((l.isConverted || l.status === 'converted') && (l.convertedContactId || l.contactId))) continue;
    const linked = new Set([l.convertedContactId, l.contactId].filter(Boolean));
    const [best] = matchAgainst(l, pool, { min, limit: 1, index, exclude: (c) => linked.has(c.id) });
    if (best) out.push({ lead: l, contact: best.record, score: best.match.score, level: best.match.level, reasons: best.match.reasons, summary: best.match.summary });
  }
  return out.sort((x, y) => y.score - x.score);
}
