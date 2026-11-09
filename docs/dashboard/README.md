# Dashboard

`src/components/DashboardView.tsx`. Everything shown comes from the organization's own records via
`/api/dashboard` (deals, leads, tickets, activity). There is no sample data.

## Layout
Header (greeting, one-line summary, Add lead / New deal) → toolbar (date range, refresh, export, customize)
→ setup checklist (until done or dismissed) → sections: key figures, performance over time, what needs
your attention, pipeline by stage, lead sources, recent activity, quick actions, AI assistant, work queues.

Sections can be hidden and reordered (Customize). Order, visibility, date range and the checklist
state are saved per person in the browser (`obsidian_dashboard_v3:<uid>`).

## How each figure is computed (`src/lib/dashboardMetrics.ts`)
| Figure | Definition | Compared with |
|---|---|---|
| New leads | Leads created in the period | Same-length previous period |
| Pipeline added | Value of deals created in the period (also shows current open pipeline) | Previous period |
| Won revenue | Value of deals in stage Won whose last update falls in the period | Previous period |
| Win rate | Won ÷ (won + lost) for deals closed in the period; "—" if none closed | Change in percentage points |
| Lead conversion | Share of the period's new leads that are converted; "—" if none | Change in percentage points |
| Open tickets | Unresolved tickets now (critical count shown) | Tickets opened vs previous period |

There is no separate close-date field, so "closed in the period" uses the deal's last update time.

Insights appear only when the records support them: lead volume change ≥ 20% (with ≥ 3 earlier),
open deals not updated for 14+ days, open critical tickets, high-scoring (70+) leads still marked New,
leads without an owner, and the top lead source (with ≥ 5 leads from at least two sources).

## Data loading
`src/lib/dashboardData.ts` shares one request per endpoint between the dashboard and the work-queue
widgets (15 s cache, in-flight requests shared). Any change made from the dashboard calls
`invalidateDashboard()`, which refreshes every mounted view.

## Export
CSV for key figures, deals and leads in the selected period (cells starting with `= + - @` are
prefixed to prevent spreadsheet formula injection), and Print / Save as PDF (print styles hide the
app chrome, the assistant, quick actions and work queues).

## Tests
`npm run test:dashboard`: metric definitions, ranges, insights, CSV (`src/lib/__tests__/dashboardMetrics.test.ts`)
and the widgets against the real API on the in-memory store (`src/components/dashboard/__tests__/widgets.test.tsx`).
