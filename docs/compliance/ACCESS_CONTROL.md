# Access control

## Layers (all on the server)

1. **`guard()`** on every `/api` mount (`server.ts`): a verified sign-in is required except for listed public paths
   (OAuth callbacks, signed provider webhooks, the website chat widget, public booking and proposal links).
   `src/server/__tests__/securityHardening.test.ts` fails if a mount is added without it (four routers that
   authenticate internally are listed there with the reason).
2. **`requireTenant`** resolves the organization from server-side membership (`X-Org-Id` is honoured only for
   members) and applies the organization's security policy (two-step sign-in, session age) and the guest rule.
3. **`requirePermission(action)`**: the original rank check (`read` < `write` < `manage_records` <
   `manage_members` = `manage_org`). Still used by most routes.
4. **`requireAccess(module, permission)`**: the permission matrix in `src/server/security/permissions.ts`.
   Used for exports, deletions, compliance, the audit log, security settings and member lists. The matrix never
   grants more than the rank check (tested in `rbac.test.ts`).

## Roles

| Product role | Role id | Summary |
|---|---|---|
| Super Administrator | platform admin (`PLATFORM_ADMIN_USER_IDS`) | Operates the platform (plans); not an organization role |
| Administrator | `OWNER`, `ADMIN` | Everything. Only owners manage owner roles; the last owner can't be removed |
| Manager | `MANAGER` | All CRM work incl. delete and export; no organization settings, members or compliance |
| Sales Representative | `SALES_REP` | Create, edit and share CRM records; no delete or export |
| Support Agent | `SUPPORT_AGENT` | Inbox, tasks, meetings; view other records |
| Standard User | `MARKETER`, `READ_ONLY` | Marketing work / view only |
| Guest | `GUEST` | Only GREET meetings they're invited to. Refused on every other tenant route |

Module `listings` (Business Profiles, `docs/business-profiles/README.md`): OWNER/ADMIN everything; MANAGER
view/create/edit/delete/share (share = link listings and publish to Google, archive); MARKETER view/create/edit;
SALES_REP, SUPPORT_AGENT, READ_ONLY view; GUEST none.

Permissions per module: view, create, edit, delete, export, share, manage. The full table is in
**Settings › Roles & permissions** and `GET /api/security/roles`.

### Guests

`GUEST` has rank 0, so it passes no `requirePermission` check, and `requireTenant` refuses guests unless the route
opts in with the `allowGuest` middleware (place it before `requireTenant`). Meeting routes that should accept
guests must add `allowGuest` explicitly.

## Two-step sign-in policy

`organizations/{org}/settings/security`:

| Field | Effect |
|---|---|
| `requireMfa` | Requests from a sign-in without a second factor get `403 mfa_required` (except `GET /api/security/policy`, so the person can see why) |
| `maxSessionHours` | A sign-in older than this (credential `auth_time`) gets `401 session_expired` |
| `idleSignOutMinutes` | The browser signs out after this much inactivity |

An admin can only turn on `requireMfa` from a two-step sign-in (`409 enroll_first` otherwise), so they can't lock
themselves out.
