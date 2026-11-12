# Analytics: forecast, pipeline health, segments, duplicate matching, deal actions

Every report is computed on request from the organization's own records. Nothing is stored, nothing is
sampled or invented: when there isn't enough data, the report says so and falls back to a documented default
that is labelled as such.

| What | Code | Endpoint | UI |
|---|---|---|---|
| Sales forecast | `src/server/crm/analytics/forecast.ts` | `GET /api/reports/forecast?months=3` | Reports & Analytics › Sales forecast |
| Pipeline health, lead sources | `pipelineHealth.ts` | `GET /api/reports/pipeline` | Pipeline health, Lead source conversion |
| Customer segments (RFM) | `segments.ts` | `GET /api/reports/segments` | Customer segments |
| Fuzzy duplicate matching | `entityMatch.ts` | `GET /api/contacts/duplicates`, `POST /api/contacts/match`, `POST /api/contacts` (409) | Contacts › possible duplicates, new-contact form |
| Deal next-best-action | `dealActions.ts` | `GET /api/reports/deal-actions?dealId=` | Deal actions, the pipeline deal drawer |

Shared helpers (stage history, dates, medians) are in `common.ts`; `load.ts` reads the records for one
organization. All functions besides `load.ts` are pure: same records + same `now` → same output.

**Access.** `/api/reports/*` requires a signed-in member whose role has `reports:view` (OWNER, ADMIN, MANAGER,
SALES_REP, MARKETER, READ_ONLY; not SUPPORT_AGENT or GUEST). Data is read only under
`organizations/{orgId}` and `billing/{orgId}` for the caller's organization. Contact matching uses the contacts
router's permissions (any member who can read contacts).

**Tests:** `npm run test:analytics` (pure math, HTTP routes incl. cross-tenant and roles, the Reports page in
happy-dom); duplicate matching is also covered in `test:contacts` and `test:crm-screens`.

---

## Stage history (used by the forecast, pipeline health and deal actions)

Deals now record `stageHistory: [{ stage, from, at }]`, `stageEnteredAt`, `closedAt` and, for lost deals,
`lostFromStage`, on creation and on every stage change (`PATCH /api/dashboard/deals/:id/stage`). These fields are
additive. For older deals the history is rebuilt from the organization activity feed ("Stage moved to X"
entries); without either, the deal is assumed to have been in its current stage since it was created.

- **Furthest stage reached.** Won deals passed every open stage. Lost deals: the furthest stage in their history
  or `lostFromStage`. A lost deal with no history is *unknown*: it is left out of stage rates and counted in a note.
- **Time in stage.** Completed stays only (the deal left the stage); the current stay is not a sample.

## 1. Sales forecast

**Win probability per open deal**, from the stage the deal is in:

```
closed  = closed deals (won + lost) that reached or passed the stage
wins    = the won ones among them
p0      = the stage's default probability (DEAL_STAGE_PROBABILITY: lead 20%, discovery 30%, qualified 50%,
          proposal 70%, negotiation 85%)
p       = (wins + k·p0) / (closed + k)        k = 5   (a Beta(k·p0, k·(1−p0)) prior)
```

With fewer than **5** closed deals at that stage, `p = p0` and the basis reads "Default stage rate, not enough
history (n=…)". Otherwise "Your history (n=…): x of n … blended with the default".

**Age penalty.** `typical` = the organization's median completed stay in the stage (needs 3 stays; otherwise a
default: 14 days, 21 for Qualified). `ratio = days in stage ÷ typical`.

```
multiplier = 1                                   if ratio ≤ 2
           = max(0.5, 1 − 0.15 · (ratio − 2))    otherwise
p_final    = p × multiplier
```

So 3× the typical time costs 15%, 4× costs 30%, and it never more than halves the probability. The deal's note
says e.g. "In Proposal for 165 days, 3× the typical 55 days: probability × 0.85".

**Expected close month.**
- `expectedClose` when it is a real date (`YYYY-MM-DD`, `YYYY-MM` or a full ISO time). Relative labels such as
  "Next Month" (older default values) are not dates and are treated as not set.
- Otherwise `createdAt + sales cycle`, labelled **Estimated**. Sales cycle = median days from creation to won
  over won deals (needs 5 won deals; otherwise a default of **60 days**).
- A date already in the past counts in the current month and is flagged (overdue / estimate passed).
- Months are calendar months in UTC.

**Per-month buckets** (current month + the next `months − 1`, `months` 1–12, default 3). Deals beyond the window
are summed in `later`.

```
commit     = Σ v  over deals with p ≥ 0.7
best case  = Σ v  over deals with p ≥ 0.4    (includes commit)
pipeline   = Σ v  over all deals
expected   = Σ p·v
σ          = √ Σ p(1−p)v²                    (variance of a sum of independent Bernoulli × value)
range      = [max(0, expected − 1.28σ), expected + 1.28σ]     (normal approximation, ≈80% two-sided)
```

Buckets use the per-deal probabilities as reported (rounded to 0.1%), so they can be re-done by hand.
A deal with no value counts **$0** and is listed in `noValue` ("no value set"); its probability is still shown.

**History line.** Won value in each of the last three full calendar months (by close date), for comparison.

**Confidence.** `low` when there are no open deals or fewer than 5 closed deals; `high` with 20+ closed and 5+
won; `medium` otherwise. `notes` explains every fallback in plain language.

**Limitations.** Deals are treated as independent (correlated deals, e.g. one buyer, make the true range wider).
The normal approximation is rough for a handful of deals. Stage rates assume the pipeline order; a deal that
skipped stages is counted as having passed them. Won/lost dates of older deals without `closedAt` or history fall
back to their last update.

## 2. Pipeline health (`/api/reports/pipeline`)

- **Moved on (conversion by stage).** Of the deals that reached a stage *and have since left it* (later stage, won
  or lost), the share that went further. Deals still in the stage are not counted yet (censored).
- **Typical days** per stage, as above (median of completed stays, or the default).
- **Stale deals.** Open deals with an age penalty (in stage > 2× typical), most overdue first.
- **Lead source conversion.** Per `lead.source`: leads, converted share (`isConverted` or status `converted`),
  won deals created from those leads and their value. Sources with fewer than 5 leads are flagged "small sample".
  Lead counts over time are already on the dashboard and are not repeated.

## 3. Customer segmentation (RFM, `/api/reports/segments`)

**Purchases** = won deals + fully paid invoices (not void or draft, total > 0, balance due ≤ 0 using
the invoicing calculation and confirmed payments). Invoices in a currency other than the invoicing workspace's
default are left out (amounts are never converted) and counted in a note.

**Who bought** (the contact profile's matching): `deal.contactId` (following merges) → the lead the deal came
from (`originLeadId` / `leadId` / a lead whose `convertedDealId` is the deal) → its `convertedContactId` /
`contactId`, else its email or phone → the deal's contact email. Invoices: invoicing client `contactId`, else the
client's or bill-to email/phone. When no person is found the purchase goes to the **company** (company id, or the
normalized company name); when there is no company either it is counted as unmatched and left out.

```
R = days since the last purchase (deal close date / date of the last confirmed payment)
F = number of purchases
M = total value
```

**Scores 1–5.**
- **20+ customers: quintiles** of the organization's own customers. `score = 1 + ⌊5 · (customers strictly worse) / n⌋`,
  capped at 5 (ties share a score). Lower R is better; higher F and M are better.
- **Fewer than 20: fixed thresholds**, and the response says so:
  - R: ≤30 days → 5, ≤90 → 4, ≤180 → 3, ≤365 → 2, older → 1
  - F: 10+ → 5, 5–9 → 4, 3–4 → 3, 2 → 2, 1 → 1
  - M: total ÷ the median customer's total: ≥4 → 5, ≥2 → 4, ≥1 → 3, ≥0.5 → 2, below → 1
- `thresholds` returns, per score, the min–max R, F and M actually observed, plus the explanation.

**Segments** (first rule that applies). "Quiet" = no activity for 90+ days (or none recorded); "engaged" =
activity in the last 30 days. Activity = organization feed entries for the contact, its leads and deals, inbox
messages by email and WhatsApp/SMS by phone.

| Segment | Rule |
|---|---|
| Champions | R ≥ 4 and F ≥ 4 |
| Loyal | R ≥ 3 and F ≥ 3 (R 3 / F 3 *and quiet* goes to At risk instead) |
| At risk | R ≤ 2 and (F ≥ 3 or M ≥ 4); or R = 3, F 2–3 and quiet |
| Promising / New | R ≥ 4 and F ≤ 2 |
| Needs attention | R = 3; or R ≤ 2 but engaged |
| Hibernating | everything else |

Every member has a reason, e.g. "Used to buy often but not lately. 4 purchases, last 240 days ago, $18,000 in
total: R2 F4 M5." **Prospects** (contacts without a purchase) are counted, not scored.

**Limitations.** A won deal and the invoice that billed it count as two purchases (there is no link between
deals and invoices yet). Contact-level and company-level customers of the same business are separate entities.
Activity uses the organization feed, the inbox and WhatsApp/SMS, not each contact's own timeline subcollection.
Members are capped at 500 per segment in the response (`truncated`).

## 4. Fuzzy duplicate and entity matching (`entityMatch.ts`)

**Blocking** (pairs are only compared when they share a key):

| Key | |
|---|---|
| `m:<email>` | exact email (always used) |
| `p:<last 7 digits>` | phone (always used) |
| `e:<domain>:<initial>` | email domain + first-name initial (nicknames add their full name's initial: Bob → r) |
| `c:<token>` | each normalized company token |
| `s:<Soundex>` | Soundex of the surname (of the single word for one-word names) |

Blocks with more than 300 records (other than `m:`/`p:`) are skipped, so a very common surname alone never makes
everyone a candidate.

**Signals.**
- Names: lowercase, accents and titles (Mr, Dr, Jr…) removed. Two-word+ names: `0.45 · first + 0.55 · last`, with
  Jaro-Winkler per part. First names: same → 1, nicknames (built-in map, e.g. Bob/Robert, Jon/Jonathan/John,
  Liz/Elizabeth) → 1, an initial that fits ("H." / Hana) → 0.85, else Jaro-Winkler. Reversed order is detected.
  One-word names compare with the other's first and last name at a 0.8–0.9 discount.
- Company: Inc, LLC, Ltd, Co, Corp, Corporation, Company, The, GmbH, PLC, Group, "&"/"and" and punctuation removed;
  token Jaccard. When either company is missing, the same non-webmail email domain counts as company evidence.
- Email local part: Jaro-Winkler on the letters before `@` (only when the emails differ).

**Score.**
- Same email or same phone: `0.9 + 0.1 · name similarity`; if the names clearly differ (different first or
  last name, or similarity < 0.5) → 0.75 "maybe a shared inbox/number".
- Otherwise a weighted mean of the available signals (name 0.55, company 0.25, email name 0.20), then capped:
  no names → ≤ 0.6; different first or last names → ≤ 0.65; no company/domain evidence and no similar email name
  → ≤ 0.6 (a name alone is not enough); only a similar email name, or first names that only look alike (typo,
  initial) → ≤ 0.84.
- **likely ≥ 0.85, possible ≥ 0.7.** The pair is put in a fixed order before scoring, so scores are symmetric.

Each match lists its reasons, e.g. "Same phone; Names match as nicknames (Jon/Jonathan); Same company after
normalization".

**Grouping pairs (`clusterMatches`, complete linkage).** Pairs become duplicate groups strongest first (Kruskal
order); two groups join only when *every* cross pair scores ≥ 0.7, so everyone in a group resembles everyone else.
Plain connected components used to chain: Dan Brown ≈ Daniel Brown (1.0) and Daniel ≈ Danielle Brown (0.84) put
Dan and Danielle (0.65) in one "likely" group, and merging it merged two people. Exact-rule pairs (same email,
same phone, same name and company) always join and are placed first. A pair that can't join its group is still
listed as its own two-person group, so no candidate is hidden (Daniel can appear in two groups). Cross pairs that
blocking didn't produce are scored on demand and cached. The result doesn't depend on input order.

**Where it is used.**
- `GET /api/contacts/duplicates` keeps `groups[].reasons` and `groups[].contacts`, and adds `score`, `level`,
  `pairs[]` (ids, score, level, reasons, summary) and `leadMatches[]` (open leads that look like an existing
  contact; leads already linked to that contact are skipped). Exact rules (same email, same phone, same name and
  company) always count.
- `POST /api/contacts/match` `{ name, email, phone, company }` → up to 5 closest contacts (≥ 0.7) for the create
  form, which shows them while typing.
- `POST /api/contacts` answers `409 possible_duplicate` for exact matches and for fuzzy *likely* matches, with
  `matches[].score/level/reasons`; "Save anyway" (`force: true`) still creates the contact.
- **Merging is always manual.**

**Limitations.** The nickname map is English/Spanish-centric and small. Different people with very similar first
names at the same company (Michael/Michelle Smith) can show as *possible*. Soundex is tuned for English surnames.

## 5. Deal next-best-action (`/api/reports/deal-actions`)

Rules over each open deal; each fired rule is returned with its reason:

| Rule | When | Urgency |
|---|---|---|
| `close_date_passed` | the deal's close date (a real date) is before today | 3 |
| `proposal_missing` | stage Proposal and no sent proposal linked (deal id, contact, lead or email); a draft is "send the draft" | 2.5 |
| `stuck` | the forecast's age penalty applies (in stage > 2× typical) | 2 |
| `re_engage` | value ≥ 2× the median open deal value (needs 3 valued open deals) and no activity for 14+ days | 2 |
| `no_open_task` | no open task on the deal, its lead or its contact (unified tasks and older lead tasks) | 1.5 |

`priority = expected value (p_final × value) × the highest urgency`. Deals without a value have an expected
value of 0, so they come after valued deals; their reasons say "No value set". The list on the Reports page opens
the pipeline drawer for the deal (`?deal=<id>`); the drawer shows the same actions.

## Sparse data, in short

| Situation | Behaviour |
|---|---|
| No open deals | Forecast empty, `confidence: low`, note; deal actions empty |
| < 5 closed deals that reached a stage | Default stage probability, labelled |
| < 3 completed stays in a stage | Default typical time, labelled |
| < 5 won deals | Default 60-day sales cycle, labelled "Estimated" |
| Deal without value | Counts $0, listed in `noValue`, ranks last in actions |
| < 20 customers | Fixed RFM thresholds instead of quintiles, said so |
| No purchases | Segments empty, prospects counted |
