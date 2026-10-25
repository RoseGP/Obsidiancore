# Firebase Firestore Database Architecture & Schema Specification
**Platform**: OmniChannel CRM & Marketing Automation Platform  
**Target Firestore DB**: `ai-studio-omnichannelcrm-db8d10f6-218d-4bf0-9c46-21c81254257b`

---

## 1. High-Level Entity Relationship Model

```
[ users ] (Auth & Profiles)
    │
    ├─── [ users/{userId}/channels ] (OAuth Tokens & Social Connections)
    │
    ├─── [ posts ] / [ drafts ] (Content Creation & Social Media Publishing)
    │
    ├─── [ crm_leads ] ────► [ crm_companies ] (Account / Organization)
    │         │
    │         ├────► [ crm_tasks ] (Follow-ups & Next Actions)
    │         │
    │         └────► [ crm_deals ] (Sales Pipeline Opportunities)
    │                     │
    │                     └────► [ crm_proposals ] (Drafts, SOWs, & Signatures)
    │
    ├─── [ conversations ] (In-App, Live Chat Widget & Channel Conversations)
    │         │
    │         └────► [ conversations/{convId}/messages ] (Real-time Message Stream)
    │
    ├─── [ crm_tickets ] (Customer Support & SLA Tracking)
    │
    └─── [ crm_activities ] (Audit Trail & Activity Stream)
```

---

## 2. Collection Specifications & Data Dictionaries

### 2.1 Collection: `users`
**Path**: `/users/{userId}`  
**Purpose**: Primary user identity, account tier, and organization access profile.

| Field Name | Type | Required | Description |
|---|---|---|---|
| `uid` | `string` | Yes | Firebase Auth User ID |
| `email` | `string` | Yes | Primary email address |
| `displayName` | `string` | No | User's full name |
| `role` | `string` | Yes | `admin` \| `manager` \| `agent` \| `viewer` |
| `photoURL` | `string` | No | Avatar URL |
| `preferences` | `map` | No | UI theme, notifications, default channel |
| `createdAt` | `timestamp` | Yes | Document creation time |
| `updatedAt` | `timestamp` | Yes | Document modification time |

#### Sub-collection: `users/{userId}/channels/{channelId}`
**Purpose**: Connected social and communication channels (LinkedIn, Instagram, WhatsApp, X/Twitter).
- `platform`: `string` (`linkedin` | `instagram` | `facebook` | `x` | `youtube` | `whatsapp`)
- `connected`: `boolean`
- `handle`: `string`
- `accessToken`: `string` (encrypted)
- `refreshToken`: `string` (encrypted)
- `tokenExpiry`: `timestamp`
- `updatedAt`: `timestamp`

---

### 2.2 Collection: `posts` (Content Management & Publishing)
**Path**: `/posts/{postId}`  
**Purpose**: Multi-channel marketing content, scheduled social posts, and published media.

| Field Name | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Unique post UUID |
| `userId` | `string` | Yes | Author UID (`users/{userId}`) |
| `caption` | `string` | Yes | Post copy / text body |
| `mediaUrls` | `array<string>` | No | Uploaded media storage URLs |
| `platforms` | `array<string>` | Yes | Targets e.g. `["linkedin", "x", "instagram"]` |
| `status` | `string` | Yes | `draft` \| `scheduled` \| `publishing` \| `published` \| `failed` |
| `scheduledAt` | `timestamp` | No | Scheduled publishing execution time |
| `publishedAt` | `timestamp` | No | Actual published timestamp |
| `analytics` | `map` | No | `{ impressions: number, likes: number, clicks: number, shares: number }` |
| `createdAt` | `timestamp` | Yes | Creation timestamp |
| `updatedAt` | `timestamp` | Yes | Last modified timestamp |

---

### 2.3 Collection: `crm_proposals` (Proposals & Draft Editor)
**Path**: `/crm_proposals/{proposalId}`  
**Purpose**: Sales proposals, scopes of work (SOW), pricing matrices, local/cloud auto-save drafts, and electronic signatures.

| Field Name | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Unique proposal ID (e.g. `PROP-0194`) |
| `contactId` | `string` | Yes | Associated CRM contact ID |
| `dealId` | `string` | No | Linked pipeline deal ID |
| `clientName` | `string` | Yes | Client or prospect name |
| `clientEmail` | `string` | No | Client email address |
| `title` | `string` | Yes | Document title |
| `status` | `string` | Yes | `draft` \| `under_review` \| `sent` \| `accepted` \| `declined` |
| `industry` | `string` | No | Client industry (e.g. `Fintech`, `Cloud SaaS`) |
| `bottlenecks` | `string` | No | Client discovery bottlenecks |
| `scopeRequirements`| `string` | No | Technical deliverables and architecture |
| `selectedFrameworks`| `array<string>` | No | Compliance badges (e.g. `["GDPR", "ISO 27001"]`) |
| `pricingTier` | `string` | No | `Standard` \| `Premium Enterprise` \| `Emergency Fast-Track` |
| `deliverySpeed` | `string` | No | `Normal` \| `Accelerated` \| `Express` |
| `items` | `array<map>` | No | Proposal items: `[{ id, title, price, isOptional, isSelected }]` |
| `total` | `number` | Yes | Calculated total price in USD |
| `signatureName` | `string` | No | Signatory name upon acceptance |
| `signedAt` | `timestamp` | No | Timestamp when electronically signed |
| `autoSavedAt` | `timestamp` | No | Timestamp of the latest auto-save sync |
| `createdAt` | `timestamp` | Yes | Creation timestamp |
| `updatedAt` | `timestamp` | Yes | Modification timestamp |

---

### 2.4 Collection: `crm_deals` (Sales Pipeline)
**Path**: `/crm_deals/{dealId}`  
**Purpose**: Visual Kanban pipeline tracking, revenue forecasting, and deal health analytics.

| Field Name | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Unique deal ID |
| `title` | `string` | Yes | Opportunity name |
| `client` | `string` | Yes | Company or lead name |
| `companyId` | `string` | No | Foreign key to `crm_companies` |
| `leadId` | `string` | No | Foreign key to `crm_leads` (if converted) |
| `value` | `number` | Yes | Annual Recurring Revenue (ARR) in USD |
| `stage` | `string` | Yes | `discovery` \| `qualified` \| `proposal` \| `negotiation` \| `closing` \| `won` \| `lost` |
| `probability` | `number` | Yes | Win probability (0 - 100) |
| `priority` | `string` | Yes | `high` \| `medium` \| `low` |
| `momentum` | `string` | No | `hot` \| `steady` \| `stagnant` |
| `expectedClose` | `string` | No | Expected close timeline |
| `owner` | `string` | Yes | Assigned account executive |
| `notes` | `string` | No | Contextual deal logs |
| `createdAt` | `timestamp` | Yes | Creation date |
| `updatedAt` | `timestamp` | Yes | Stage advancement timestamp |

---

### 2.5 Collection: `crm_leads` (Lead Lifecycle & Inbound Ingestion)
**Path**: `/crm_leads/{leadId}`  
**Purpose**: Lead qualification, BANT scoring, and conversion into accounts and deals.

| Field Name | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Unique lead ID |
| `name` | `string` | Yes | Lead contact name |
| `company` | `string` | Yes | Company name |
| `email` | `string` | No | Contact email |
| `phone` | `string` | No | Phone number |
| `source` | `string` | Yes | `whatsapp` \| `sms` \| `website` \| `linkedin` \| `call` \| `import` |
| `status` | `string` | Yes | `new` \| `contacted` \| `qualifying` \| `qualified` \| `unqualified` \| `converted` |
| `score` | `number` | Yes | BANT automated qualification score (0 - 100) |
| `qualification` | `map` | No | `{ budget, authority, need, timeline }` |
| `isConverted` | `boolean` | Yes | `true` if converted to deal/account |
| `convertedDealId`| `string` | No | Linked deal ID |
| `owner` | `string` | Yes | Assigned sales representative |
| `createdAt` | `timestamp` | Yes | Capture timestamp |
| `updatedAt` | `timestamp` | Yes | Last activity timestamp |

---

### 2.6 Collection: `conversations` & `messages` (In-App & Omnichannel Messaging)
**Path**: `/conversations/{convId}` and `/conversations/{convId}/messages/{messageId}`  
**Purpose**: In-app live chat, customer website widget sessions, WhatsApp, and SMS streams.

| Field Name | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Conversation ID |
| `channel` | `string` | Yes | `in_app` \| `live_widget` \| `whatsapp` \| `sms` |
| `participantName` | `string` | Yes | Visitor or contact name |
| `participantContact`| `string` | No | Phone or identifier |
| `assignedAgentId` | `string` | No | Assigned user ID (`users/{userId}`) |
| `status` | `string` | Yes | `open` \| `waiting` \| `resolved` |
| `lastMessage` | `string` | No | Preview snippet of newest message |
| `unreadCount` | `number` | Yes | Number of unread inbound messages |
| `updatedAt` | `timestamp` | Yes | Timestamp of latest message |

#### Sub-collection: `messages`
- `id`: `string`
- `senderType`: `agent` | `visitor` | `system`
- `senderId`: `string`
- `text`: `string`
- `mediaUrl`: `string` (optional)
- `timestamp`: `timestamp`
- `status`: `sent` | `delivered` | `read`
