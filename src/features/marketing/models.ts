/**
 * Core Data Models for Workspace, Subscribers, Campaigns, and API Tokens
 * Converted from PHP Laravel Eloquent Models to 100% Type-Safe TypeScript / JavaScript.
 */

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceUser {
  id: string;
  workspaceId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: string;
}

export interface WorkspaceInvitation {
  id: string;
  workspaceId: string;
  email: string;
  role: 'admin' | 'member';
  token: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
  expiresAt: string;
}

export interface ApiToken {
  id: string;
  workspaceId: string;
  name: string;
  token: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface Subscriber {
  id: string;
  workspaceId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  tags: string[];
  status: 'subscribed' | 'unsubscribed' | 'bounced';
  createdAt: string;
  updatedAt: string;
}

export interface Campaign {
  id: string;
  workspaceId: string;
  name: string;
  subject: string;
  fromName: string;
  fromEmail: string;
  content: string;
  status: 'draft' | 'queued' | 'sending' | 'sent';
  stats: {
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
  };
  scheduledAt?: string;
  sentAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EngineHealthCheck {
  runtime: string;
  engine: string;
  status: 'healthy' | 'degraded';
  uptimeSeconds: number;
  memoryUsage: {
    rss: string;
    heapTotal: string;
    heapUsed: string;
  };
  workspacesCount: number;
  subscribersCount: number;
  campaignsCount: number;
  checks: {
    database: boolean;
    storage: boolean;
    queue: boolean;
    crypto: boolean;
  };
}
