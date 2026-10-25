/**
 * Shared between server and browser. The server-side allowlist lives here so
 * the UI and API agree on which platforms exist and how each one connects.
 */

export type AccountPlatform = 'instagram' | 'facebook' | 'linkedin' | 'x' | 'tiktok' | 'youtube' | 'pinterest' | 'threads' | 'mastodon' | 'bluesky';

export type ConnectionMethod =
  /** Via the Postiz public API (provider OAuth hosted by Postiz). */
  | 'postiz'
  /** Directly against the provider's official API (no Postiz involved). */
  | 'direct';

export interface PlatformDefinition {
  platform: AccountPlatform;
  label: string;
  method: ConnectionMethod;
  /** Postiz provider identifier (integration.manager allowlist), for method 'postiz'. */
  postizIdentifier?: string;
  /** Short note shown on the card about how connection works. */
  note?: string;
}

/**
 * Server-side allowlist. Anything not in this list is rejected before any
 * Postiz or provider call is made.
 *
 * Postiz identifiers verified against gitroomhq/postiz-app
 * (libraries/nestjs-libraries/src/integrations/social/*.provider.ts).
 * Bluesky is 'direct' because Postiz's Bluesky provider uses custom fields
 * entered in the Postiz UI, which the public API cannot drive.
 */
export const PLATFORM_DEFINITIONS: PlatformDefinition[] = [
  { platform: 'instagram', label: 'Instagram', method: 'postiz', postizIdentifier: 'instagram', note: 'Business or Creator account linked to a Facebook Page.' },
  { platform: 'facebook', label: 'Facebook', method: 'postiz', postizIdentifier: 'facebook', note: 'Facebook Pages you manage.' },
  { platform: 'linkedin', label: 'LinkedIn', method: 'postiz', postizIdentifier: 'linkedin' },
  { platform: 'x', label: 'X', method: 'postiz', postizIdentifier: 'x' },
  { platform: 'tiktok', label: 'TikTok', method: 'postiz', postizIdentifier: 'tiktok' },
  { platform: 'youtube', label: 'YouTube', method: 'postiz', postizIdentifier: 'youtube', note: 'YouTube channel with video publishing.' },
  { platform: 'pinterest', label: 'Pinterest', method: 'postiz', postizIdentifier: 'pinterest', note: 'Pinterest profile and boards.' },
  { platform: 'threads', label: 'Threads', method: 'postiz', postizIdentifier: 'threads', note: 'Meta Threads account.' },
  { platform: 'mastodon', label: 'Mastodon', method: 'postiz', postizIdentifier: 'mastodon', note: 'Accounts on mastodon.social.' },
  { platform: 'bluesky', label: 'Bluesky', method: 'direct', note: 'Connects with a Bluesky app password.' },
];

export const isAccountPlatform = (v: unknown): v is AccountPlatform =>
  typeof v === 'string' && PLATFORM_DEFINITIONS.some((d) => d.platform === v);

export const definitionFor = (p: AccountPlatform) => PLATFORM_DEFINITIONS.find((d) => d.platform === p)!;

export type CardStatus = 'connected' | 'not_connected' | 'expired' | 'needs_attention';

export interface AccountProfile {
  connectionId: string;
  name: string;
  /** Handle, username or profile identifier when the provider returns one. */
  handle?: string;
  pictureUrl?: string;
  connectedAt: string;
  lastVerifiedAt?: string;
}

export interface PlatformCard {
  platform: AccountPlatform;
  label: string;
  method: ConnectionMethod;
  /** False when the server isn't configured for this connection method. */
  available: boolean;
  unavailableReason?: string;
  status: CardStatus;
  /** Why the status is expired / needs attention. */
  detail?: string;
  accounts: AccountProfile[];
  pendingAttemptId?: string;
}

export type PostizMode = 'oauth' | 'api_key' | 'none';

export interface AccountsOverview {
  postiz: {
    mode: PostizMode;
    /** OAuth mode: whether this user has authorized their Postiz workspace. */
    workspaceAuthorized: boolean;
    workspaceName?: string;
    /** True when connections return to this app via a validated callback (self-hosted enterprise flow). */
    returnsToApp: boolean;
    /** Workspace-level problem (revoked token, unreachable API). */
    problem?: { status: 'expired' | 'needs_attention'; detail: string };
  };
  platforms: PlatformCard[];
  checkedAt: string;
}

/** What the browser should do after asking to connect. */
export type ConnectNext =
  | { next: 'authorize_workspace'; url: string }
  | { next: 'redirect'; url: string; attemptId: string }
  | { next: 'popup'; url: string; attemptId: string }
  | { next: 'credentials'; fields: { key: string; label: string; type: 'text' | 'password' | 'url'; placeholder?: string; help?: string }[] };

export type AttemptStatus = 'pending' | 'completed' | 'cancelled' | 'failed' | 'expired';

export interface AttemptResult {
  attemptId: string;
  status: AttemptStatus;
  detail?: string;
  account?: AccountProfile;
}
