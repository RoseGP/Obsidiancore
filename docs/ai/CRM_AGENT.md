# CRM agent ("Ask your CRM" on the dashboard)

A dashboard section where people ask questions about their CRM in plain language ("Which deals with Northwind
are closing this month?", "What's overdue?"). Answers are generated from the organization's own records
(retrieval-augmented generation) and show the records they're based on.

## How it works
`POST /api/crm-agent/ask { question }` (`src/routes/crmAgentApi.ts`):
1. **Access**: signed-in member of the organization (`requireTenant`) with dashboard access; 20 questions per
   person per minute (`CRM_AGENT_PER_MINUTE`).
2. **Retrieval** (`src/server/ai/crmRetrieval.ts`): reads only `organizations/{caller's org}/…` and only the record
   types the caller's role may view (`canAccess(role, module, 'view')`): contacts, companies, leads, deals, tasks.
   Deleted/merged/archived records are skipped. Each record becomes a short document of **allowlisted fields**
   (names, company, stage, value, dates, owner, status, short notes) plus derived facts computed from the data
   ("overdue", "closing soon", "stale", "high value", "hot"). Emails and phone numbers are included only when the
   question asks for contact details. Ranking is BM25 (keyword relevance) with a boost for the record type the
   question names; up to 8 records are used.
3. **No relevant records** → `status: "no_results"`; the model is not called.
4. **Generation** (`src/server/ai/crmAgent.ts`): the records go to Claude or Gemini (`src/services/ai/aiService.ts`,
   the app's existing provider layer with fallback) as numbered `<source id="S1">` blocks. The system prompt requires
   answering only from the sources, citing them, saying "I couldn't find that in your CRM records" otherwise, and
   treating source text as data (prompt-injection defence). No tools are given to the model.
5. **Checking**: citations in the reply are matched against the sources actually sent. The response lists the
   records, which were cited, and `grounded: false` when the answer cites none (the UI flags it).
6. **Without an AI key** → `status: "ai_not_configured"` with the matching records (real data, no invented answer).

The dashboard UI (`src/components/dashboard/CrmAgentPanel.tsx`) has loading, error (with retry), no-results,
not-configured and answer states; citations link to the source cards, which open the record's page.

## Configuration
- `ANTHROPIC_API_KEY` (and optional `ANTHROPIC_MODEL`) and/or `GEMINI_API_KEY` (`GEMINI_MODEL`). Either one works;
  the other is the fallback.
- No vector database or embeddings service is needed: retrieval runs in the server per request, bounded to 3,000
  records per type. For organizations far beyond that, replace `rankDocuments()` with a vector index (the callers
  don't change); keep the tenant and permission filtering in `retrieve()`.

## What is sent to the AI provider
Only the question and up to 8 matching records' allowlisted fields (about 12,000 characters at most). Never other
organizations' records, record types the person can't view, custom fields, addresses, payment data or message
bodies. Server logs record the organization, user, counts and timing, not the question text.

## Tests
`npm run test:crm-agent`: ranking, derived facts, role filtering, data minimization, prompt-injection containment,
citation checking, tenant isolation (the exact prompt sent to a stand-in model is inspected), 401/403/400/429/502.
