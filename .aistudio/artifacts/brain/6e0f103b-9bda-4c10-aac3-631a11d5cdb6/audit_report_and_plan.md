# Phase 1: Architectural Audit Report & Production Implementation Plan

**Target Application**: Obsidian Multi-Channel CRM & Revenue Operations Platform  
**Target Environment**: Node.js 20+ / Express TypeScript backend + Vite React SPA frontend with Firebase Firestore database (`ai-studio-omnichannelcrm-db8d10f6-218d-4bf0-9c46-21c81254257b`) & Google Gemini AI API (`@google/genai`).

---

## 1. Executive Summary & Stack Discovery

### 1.1 Technology Stack (Discovered from Codebase)
- **Frontend Framework**: React 19 SPA running with Vite (`vite.middlewares` mounted on Express in dev, static dist in production).
- **Backend Architecture**: Express 4 server with TypeScript (`server.ts`), modular routes mounted under `/api/*`, and real-time Socket.IO signaling server (`signalingServer.ts`) for WebRTC and live data synchronization.
- **Database & Persistence**:
  - Primary persistent storage: **Google Cloud Firestore** (`adminDb` from `firebase-admin/firestore` + client Firebase SDK via `DatabaseContext.tsx`).
  - ORM / Relational abstraction: `src/utils/db.ts` providing an operational schema-aligned storage engine targeting PostgreSQL when `DATABASE_URL` is set, with seamless fallback to Firestore and in-memory dual-write for high performance and zero-downtime reliability.
- **Authentication & Authorization**:
  - `src/features/social-accounts/server/auth.ts` and `src/lib/apiAuth.ts`: Multi-tier authentication supporting Firebase Auth ID tokens (JWT verified via Google's public certs), HS256 session JWTs, and secure preview dev identities (`exec-director-45`).
- **Styling & UI Components**:
  - Tailwind CSS with the Obsidian dark design system (`bg-slate-950`, `bg-[var(--obsidian-1)]`, sharp typography, high-contrast badges, zero AI-slop).
  - Icons: `lucide-react`. Animations: `motion/react` (Framer Motion).
- **AI Integrations**:
  - Google Gemini API via official `@google/genai` TypeScript SDK (primary model: `gemini-3.8-flash`).
  - Fallback gateway controller in `src/controllers/omniRouteChatController.ts` supporting Server-Sent Events (SSE) streaming.

---

## 2. Component & Feature Audit

| Module / View | File Location | Current Functional State | Gaps / Missing Capabilities |
|---|---|---|---|
| **Dashboard** | `src/components/DashboardView.tsx` | **Functional** (Live stats from `/api/dashboard/stats`, widget grid, recent leads) | AI assistant needs direct CRM function calling & multi-turn tool execution. |
| **Unified AI Assistant** | `src/components/assistant/UnifiedAssistant.tsx` | **Semi-Functional** (SSE streaming from `/api/chat/completions`) | Missing real-time tool calling (searching leads, deals, contacts, creating tasks, social drafts); conversations not persisted per organization. |
| **Sales & Leads Pipeline** | `src/components/DealsPipelineView.tsx` | **Fully Functional** (5-stage Kanban, leads table, duplicate detection, BANT qualification, conversion analytics) | Needs strict organization-level data scoping (`orgId`). |
| **Messaging & Inbox** | `src/components/messaging/ProductionMessagingPlatform.tsx` | **Functional** (Unified channels: WhatsApp, SMS, Email, Telegram) | Needs public embeddable website lead capture webhook. |
| **Social Media Planner** | `src/components/SocialPlannerTab.tsx`, `socialPosts.ts` | **Semi-Functional** (Mock posts in memory, caption generation via Gemini) | Needs real database persistence for drafts, scheduled posts, platform variants, and publishing queue. |
| **Greet & Call Canvas** | `src/components/greet/VideoMeetingWorkspace.tsx`, `CRMCallCanvas.tsx` | **Functional** (WebRTC video consultations, audio recording) | Fully operational. |
| **Public Lead Scheduling** | `src/components/PublicSchedulingPage.tsx` | **Semi-Functional** (Frontend booking interface) | Needs direct integration with automated website lead capture and calendar synchronization. |
| **Settings & Workspace** | `src/components/SettingsView.tsx` | **Functional** (OAuth connectors, payment gateways, team members) | Needs organization workspace selector and role-based access control (RBAC). |

---

## 3. Security, Multi-Tenancy & Data Model Audit

### Identified Gaps:
1. **Multi-Tenancy Scoping**:
   - Several backend handlers (`dashboardApi.ts`, `leadsApi.ts`, `postsApi.ts`) stored items globally or under `ownerId` rather than enforcing an explicit `orgId` (organization/workspace ID).
   - Solution: Implement `resolveOrgContext(req)` middleware to enforce `orgId` on all reads, writes, and database queries.
2. **AI Tool Calling & Grounding**:
   - The dashboard chatbot streamed text using simple prompts without native tool schemas (function declarations). It could not execute CRM operations (e.g., search leads, calculate pipeline metrics, create follow-up tasks, draft posts) or return structured actions.
   - Solution: Implement a tool-calling loop using `@google/genai` with 10 structured tools.
3. **Automated Website Lead Capture**:
   - Missing an unauthenticated, rate-limited public endpoint (`POST /api/leads/capture` / `POST /api/widget/lead`) for external landing pages and embedded forms to submit leads with origin metadata, anti-spam honeypot, and automated BANT scoring.
4. **Social Media Planning & Publishing Engine**:
   - `socialPosts.ts` relied partially on a hardcoded in-memory array (`memoryPosts`).
   - Solution: Migrate to persistent storage (`crm_social_posts`) supporting drafts, scheduled jobs, multi-platform variants (LinkedIn, X, Instagram, Facebook), and execution history.

---

## 4. Prioritized Implementation Plan

### Phase 2: Multi-Tenant Database & Core Backend Architecture
- [x] Define multi-tenant schema entities (`crm_organizations`, `crm_org_members`, `crm_leads`, `crm_deals`, `crm_tasks`, `crm_social_posts`, `crm_chat_sessions`).
- [ ] Build `src/server/tenantContext.ts` middleware to validate user identity, organization membership, and RBAC permissions (`ADMIN`, `MANAGER`, `SALES_REP`, `MARKETER`).
- [ ] Implement public Website Lead Capture API (`POST /api/leads/capture`) with honeypot spam protection, automatic BANT score calculation, and duplicate detection.
- [ ] Implement persistent Social Media Planning & Publishing API (`/api/social-posts`) with platform variants, status lifecycle (`DRAFT`, `SCHEDULED`, `PUBLISHED`, `FAILED`), and publishing logs.

### Phase 3: Functional AI Dashboard Assistant
- [ ] Upgrade `src/controllers/omniRouteChatController.ts` and `src/services/crmAiAssistant.ts` using `@google/genai` (`gemini-3.8-flash`).
- [ ] Implement 10 structured CRM tools with schema validation:
  1. `search_contacts`
  2. `search_leads`
  3. `get_pipeline_summary`
  4. `create_lead`
  5. `create_deal`
  6. `create_followup_task`
  7. `search_knowledge_base`
  8. `draft_sales_outreach`
  9. `create_social_draft`
  10. `schedule_social_post`
- [ ] Connect SSE streaming with tool execution feedback, action confirmation protocols, and chat history persistence in `crm_chat_sessions` scoped by user & organization.
- [ ] Update frontend `UnifiedAssistant.tsx` to handle tool call notifications and action confirmations.
