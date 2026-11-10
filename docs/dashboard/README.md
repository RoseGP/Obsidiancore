# Dashboard: AI Business Command Center

`src/components/DashboardView.tsx`. Deep-midnight theme scoped to this tab (`.cc` tokens in `src/index.css`;
the root also carries `data-theme="dark"` so embedded components follow). Everything shown comes from the
organization's records or the server's status endpoints. Nothing is sample data; what isn't connected says so.

## Sections (collapsible; hide/reorder in Customize, saved per person in this browser)
| Section | Data | Notes |
|---|---|---|
| Welcome header | auth profile, `/api/dashboard/service` (AI status), NotificationContext | live clock, greeting line built from records (`greetingLine`) |
| AI Copilot | `POST /api/chat/completions`, `GET /api/chat/models` | Claude/Gemini switch (configured providers only), voice commands (browser speech recognition), history saved in the browser, full screen. CRM tools incl. `create_deal`, `create_lead`, `qualify_lead`, `draft_sales_outreach`, `summarize_recent_conversations`. No workflow engine exists, so it doesn't claim to trigger automations. |
| Needs your attention | leads, deals, tickets, `/api/proposals`, `/api/meetings`, inbox, service | `buildAttention`: meetings within 3 h, unanswered messages, missed calls, uncontacted 70+ leads, follow-ups idle 7+ days, deals idle 14+ days, proposals waiting 3+ days or expiring, critical tickets |
| Business performance | leads, deals | `headlineKpis`: total contacts (vs 7 days ago), new leads today (vs yesterday), open deals, pipeline value, weighted forecast (added this week). Click a card for charts, date range and CSV/print export |
| Upcoming meetings | `/api/meetings` (every occurrence), calendar events | Join starts the meeting if nobody has yet |
| Live activity | inbox conversations, `/api/communication/inbound-messages` (WhatsApp/SMS, voicemail) | live via the messaging stream; quick reply posts to the conversation or sends WhatsApp/SMS (503 when not configured). Telegram/Instagram aren't supported yet |
| Daily missions | `/api/dashboard/missions` | measured from your own actions today; XP, streak and badges stored per user on the server |
| Service monitoring | `/api/dashboard/service` | SLA met % (first reply within `SLA_FIRST_RESPONSE_MINUTES`, default 15), avg first response, missed calls, unanswered, AI providers, channel status |
| AI insights | `buildInsights` + `commandCenterInsights` | top 3, expandable; "Ask copilot" hands the question to the copilot |
| Business tools | navigation | receptionist, meetings, proposals, dialer, scheduler, new deal |
| Work queues | existing widgets | collapsed by default |

## Navigation
`src/components/DynamicSidebar.tsx` groups: Command Center, Customer Management, Communications, Business
Operations, Marketing, AI Management, Settings. Item ids are views, dashboard sections (`dashboard#missions`)
or Settings tabs (`settings:integrations`); `navigateTo` in `App.tsx` resolves them. Items for features that
don't exist (AI agents, automations, Telegram, Instagram, a separate email inbox) are not shown.

## Tests
`npm run test:dashboard` (metrics, command center, widgets) and `npm run test:command-center` (missions,
service status, isolation). Meeting notes: `npm run test:meeting-notes`.
