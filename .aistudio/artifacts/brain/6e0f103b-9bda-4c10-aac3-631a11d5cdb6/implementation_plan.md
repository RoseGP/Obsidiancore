# Omnichannel CRM — Dashboard Module Implementation Plan

A unified, real-time command center for omnichannel customer interactions, cross-channel communication health, pipeline velocity, and rapid agent actions.

## User Review & Critical Decisions

> [!IMPORTANT]
> Based on your confirmed requirement, the Dashboard embeds a **comprehensive interactive suite**: a live omnichannel stream with instant inline replies, a quick deal creator modal, a chronological activity timeline, and multi-channel metrics filtering.

- **Confirmed Decision**: Comprehensive interactive capabilities — Live omnichannel stream with instant inline reply, deal quick-create, real-time activity timeline, and multi-channel analytics.
- **Data Persistence**: Backed by Firestore (`ai-studio-omnichannelcrm-db8d10f6-218d-4bf0-9c46-21c81254257b`) with real-time `onSnapshot` subscriptions and verified ABAC security rules.
- **Design Standard**: High-density enterprise SaaS layout adhering strictly to the SaaS Dashboard constitution (Plus Jakarta Sans display, clean unboxed metadata, tabular numeric counters, zero decorative status pulse cliches, zero pill clutter).

---

## 1. Overview & Core Concept

### What It Does
The Dashboard serves as the central cockpit of the Omnichannel CRM. It aggregates high-volume customer interactions across five primary channels (**WhatsApp**, **Email**, **Web Live Chat**, **SMS**, and **Voice Calls**), provides executive KPIs (Active Conversations, First Response Time, SLA compliance, Pipeline Value, and Conversion Rate), and gives reps and managers direct in-place actionability without navigating away from the dashboard.

### Target Audience & Persona
- **Sales & Support Representatives**: Monitor inbound customer pings across channels, respond instantly to urgent conversations, and register incoming deals directly from incoming leads.
- **Sales Managers & Team Leads**: Monitor team SLA adherence, channel distribution volume, deal flow velocity, and recent rep activity in real time.

### Key Value
Eliminates context-switching between fragmented communication tools by providing an actionable single pane of glass for real-time customer dialogues and pipeline progression.

---

## 2. User Experience & Visual Design

### Key User Flows
1. **Executive KPI Scanning**: Upon loading, the user inspects 4 core metric cards: Total Active Conversations, Average First Response Time (SLA), Active Pipeline Value, and Omnichannel Resolution Rate. Each metric displays dynamic percentage shifts against the previous period.
2. **Channel-Filtered Interaction Analysis**: Users toggle between "All Channels", "WhatsApp", "Email", "Live Chat", "SMS", and "Voice" using a segmented control to isolate channel performance and message throughput.
3. **Live Omnichannel Feed & Instant Quick Reply**:
   - The live incoming stream displays recent customer dialogues with unboxed metadata (`channel · customer · timestamp`).
   - Reps can expand any incoming conversation and send a quick response directly through the corresponding channel adapter.
4. **Deal Quick Creation**: Reps click "New Deal" in the header action zone to open an accessible dialog modal, select an existing contact or create a new one, define deal value and stage, and instantly link the deal into the sales pipeline.
5. **Real-time Activity Stream & Filterable Timeline**: An interactive timeline tracking state transitions, channel dispatches, stage updates, and agent notes.

### Visual Identity & Theme
- **Aesthetic Direction**: High-density, utilitarian B2B enterprise workspace with crisp architectural lines and intentional whitespace.
- **Color Palette (60-30-10 Rule)**:
  - Canvas (60%): `#090D16` dark slate / clean dark mode background (`bg-slate-950`).
  - Surfaces (30%): `#0F172A` structural cards (`bg-slate-900/70`) with subtle hairline borders (`border-slate-800`).
  - Accent Budget (10%): `#3B82F6` (Electric Indigo/Blue) for primary CTAs and active states; semantic green (`#10B981`) for nominal SLA, amber (`#F59E0B`) for approaching breach, and rose (`#F43F5E`) for breached SLAs.
- **Typography & Tabular Discipline**:
  - Display & Headings: `Plus Jakarta Sans` font family for modern clarity.
  - Body Prose: `Plus Jakarta Sans` / `DM Sans` at 13px–14px sizes.
  - Financial figures, timers, and KPI statistics: `font-mono tabular-nums` for rock-solid vertical alignment.
- **Zero-Pill Rule**: Channel badges and metadata are rendered as clean, unboxed text separated by subtle bullets (`WhatsApp · Urgent · 2m ago`).

---

## 3. Key Product Decisions & Trade-Offs

- **Real-Time Synchronous Streams vs. Polling**:
  - *Chosen Approach*: Firestore `onSnapshot` listeners with optimistic UI updates.
  - *Why*: Reps need sub-second notification when a high-priority WhatsApp or chat message lands, eliminating manual refresh cycles.
  - *Trade-off*: Requires disciplined query boundary constraints and unmount cleanup to avoid memory leaks.
- **Unified Activity Timeline vs. Split Feeds**:
  - *Chosen Approach*: A composite activity stream combining CRM deal mutations, incoming messages, and outbound agent replies in chronological order.
  - *Why*: Gives complete operational context for customer accounts in one view.
- **Inline Rapid Response vs. Deep Redirect**:
  - *Chosen Approach*: Lightweight inline quick-response drawer directly on the dashboard card, with a "Open Full Thread" shortcut.
  - *Why*: 80% of SLA-critical messages are fast acknowledgments or routing confirmations; inline replies maximize team throughput.

---

## 4. Technical Architecture & Data Strategy

### System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Omnichannel CRM Dashboard                       │
├────────────────────────────────────────────────────────────────────────┤
│  Top Bar: [Wordmark: Omnichannel CRM] ── [Time & Channel Filters] ── [New Deal]
├───────────────────┬────────────────────────────────────────────────────┤
│                   │                                                    │
│  4x Metric Cards  │  • Active Conversations (Total + Unassigned)       │
│  (Tabular Nums)   │  • First Response Time (SLA: < 3m 42s)            │
│                   │  • Active Pipeline Value ($428,500)                │
│                   │  • Resolution Rate (94.2%)                         │
│                   │                                                    │
├───────────────────┴────────────────────────────────────────────────────┤
│  Omnichannel Volume Breakdown & Channel Performance Strip              │
│  [WhatsApp: 42%]  [Email: 28%]  [Live Chat: 18%]  [SMS: 8%]  [Voice: 4%]│
├──────────────────────────────────────┬─────────────────────────────────┤
│  Live Inbound Conversation Stream    │  Pipeline Velocity & Activity   │
│  ┌────────────────────────────────┐  │  ┌───────────────────────────┐  │
│  │ WhatsApp: Acquired Lead        │  │  │ Deal Stage Distribution   │  │
│  │ "Can we schedule a demo?"      │  │  │ [Lead -> Qualified -> ...]│  │
│  │ [Inline Quick Reply Composer]  │  │  ├───────────────────────────┤  │
│  ├────────────────────────────────┤  │  │ Recent CRM Activity Feed  │  │
│  │ Email: Support Inquiry         │  │  │ • Deal won ($45k)         │  │
│  │ "Contract review attached"     │  │  │ • Call logged with Acme   │  │
│  └────────────────────────────────┘  │  └───────────────────────────┘  │
└──────────────────────────────────────┴─────────────────────────────────┘
                                   │
                     Firestore Real-Time Data Layer
  ┌────────────────────────────────┬──────────────────────────────────┐
  │ collections/conversations      │ collections/messages              │
  │ collections/deals              │ collections/contacts              │
  │ collections/activities         │ collections/dashboard_metrics     │
  └────────────────────────────────┴──────────────────────────────────┘
```

### Core Entities & Data Model

1. **`conversations`**:
   - `id`: string
   - `contactId`: string
   - `contactName`: string
   - `channel`: `'whatsapp' | 'email' | 'chat' | 'sms' | 'voice'`
   - `status`: `'open' | 'pending' | 'resolved'`
   - `lastMessage`: string
   - `lastMessageAt`: timestamp
   - `unreadCount`: number
   - `assignedAgentId`: string
   - `slaBreached`: boolean

2. **`messages`**:
   - `id`: string
   - `conversationId`: string
   - `senderType`: `'customer' | 'agent' | 'system'`
   - `senderName`: string
   - `channel`: `'whatsapp' | 'email' | 'chat' | 'sms' | 'voice'`
   - `content`: string
   - `createdAt`: timestamp

3. **`deals`**:
   - `id`: string
   - `title`: string
   - `contactId`: string
   - `contactName`: string
   - `value`: number
   - `stage`: `'lead' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost'`
   - `channelOrigin`: string
   - `expectedCloseDate`: string
   - `createdAt`: timestamp

4. **`activities`**:
   - `id`: string
   - `type`: `'message_sent' | 'deal_created' | 'deal_stage_changed' | 'call_logged' | 'note_added'`
   - `title`: string
   - `description`: string
   - `targetId`: string
   - `targetType`: `'deal' | 'conversation' | 'contact'`
   - `actorName`: string
   - `createdAt`: timestamp

---

## 5. Execution Steps for Dashboard Module

- **Step 1: Database Blueprint & Security Rules**:
  - Configure `firebase-blueprint.json` with entity schemas for `conversations`, `messages`, `deals`, `contacts`, and `activities`.
  - Author robust `firestore.rules` adhering to the Eight Pillars of Hardened Rules.
  - Implement standardized `handleFirestoreError` conforming to `FirestoreErrorInfo`.
- **Step 2: Firebase Connection & Seed Data**:
  - Initialize Firebase SDK connecting to `ai-studio-omnichannelcrm-db8d10f6-218d-4bf0-9c46-21c81254257b`.
  - Seed initial realistic omnichannel demo data if collections are empty, ensuring immediate end-to-end functionality.
- **Step 3: KPI Metrics Grid & Channel Volume Analyzer**:
  - Implement responsive high-density metric widgets with tabular numerals and period delta badges.
  - Build channel distribution breakdown bar with real-time percentages.
- **Step 4: Live Omnichannel Stream & Inline Reply Drawer**:
  - Interactive conversation cards with channel badges, customer details, and timestamp.
  - Expandable inline quick-reply form that appends to `messages` and updates `conversations`.
- **Step 5: Quick Deal Creator & Pipeline Status**:
  - Accessible modal dialog allowing instant deal registration linked to contacts and channels.
  - Deal stage visual summary bar showing total pipeline value per stage.
- **Step 6: Real-time Activity Timeline**:
  - Chronological feed with filter buttons (`All`, `Deals`, `Messages`, `Calls`).
- **Step 7: Verification & Testing**:
  - Validate state updates, compilation (`compile_applet`), and responsive layout integrity.
