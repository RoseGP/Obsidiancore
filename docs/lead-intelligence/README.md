# Lead Intelligence Center

Sidebar → Customer Management → **Lead Intelligence** (`src/features/lead-intelligence/LeadIntelligenceView.tsx`).
Engine: `src/server/crm/leadIntelligence.ts`. API: `src/routes/leadIntelligenceApi.ts` (`/api/lead-intelligence`).

## How a lead is scored
Seven factors, each 0–100 with the evidence that produced it. Weighted total = score.

| Factor | Weight | Signals |
|---|---|---|
| Buying intent | 25 | words in notes, need and the lead's messages (quote, pricing, ready to…; negative: not interested, just looking), referral or inbound call, a next step taken |
| Budget indicators | 20 | stated budget, amounts mentioned in conversation, "budget approved", budget concerns |
| Business requirements | 15 | recorded need, decision-maker (authority or title), company, urgency of timeline |
| Lead engagement | 15 | status, proposals sent/opened/accepted, meetings booked/held, follow-up tasks done |
| Communication history | 10 | messages exchanged in the inbox and on WhatsApp/SMS (matched by email/phone), channels, recency |
| Potential deal value | 10 | deal from the lead → stated budget → amount mentioned → your typical deal size |
| Response frequency | 5 | their messages in the last 14 days and how fast they reply to you |

**Hot** ≥ 65 · **Warm** 40–64 · **Cold** < 40. A lead marked unqualified is capped at 25. Hot and Warm leads
that aren't converted or unqualified count as **qualified**.

New leads (team, quick add, web forms via `/api/leads/capture`) are classified when they arrive; the class and
any change are logged on the lead's activity. The list re-analyzes on every load.

## Predictions
- **Closing probability**: your own win rate for that class once 10+ deals from leads have closed (at least 3
  in the class); before that, an estimate from the score. The basis is shown next to the number.
- **Potential value**: with the source of the number shown.
- **Follow-up timing**: now if they're waiting for a reply; hot within 1 hour (new) or today; warm within
  2 days; cold in 2 weeks. Shows when they usually write if there are enough messages.
- **Suggested approach / potential objections**: rules over the same signals.
- **Next best action**: reply (they're waiting) → prepare for an upcoming meeting → follow up on an opened
  proposal → convert (hot with budget and intent) → book a call → contact → send proposal / follow-up → nurture.

## AI analysis
"Write analysis" asks Claude or Gemini for a brief built only from the facts above and the lead's recent
messages (treated as data). Returns 503 `ai_not_configured` without an AI key. Nothing is changed.

## Convert to opportunity
One click calls `POST /api/leads/:id/convert` with the predicted value (stage Qualified), creating a contact,
company and deal. The drawer lets you change the name, value and stage first.

Tests: `npm run test:lead-intelligence`.
