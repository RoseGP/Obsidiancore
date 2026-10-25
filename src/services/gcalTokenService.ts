import crypto from 'crypto';

// Secret key for AES-256-GCM encryption (32 bytes / 256 bits)
const ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_SECRET 
  ? crypto.scryptSync(process.env.TOKEN_ENCRYPTION_SECRET, 'gcal_salt_2026', 32)
  : crypto.scryptSync('default_dev_crm_encryption_secret_key_2026', 'gcal_salt_2026', 32);

const ALGORITHM = 'aes-256-gcm';

export interface EncryptedData {
  iv: string;         // Hex
  encryptedText: string; // Hex
  authTag: string;    // Hex
}

export interface StoredTokens {
  userId: string;
  accessTokenEncrypted: EncryptedData;
  refreshTokenEncrypted: EncryptedData;
  expiryDate: number; // Unix timestamp ms
  scope: string;
  updatedAt: string;
}

export interface WatchChannelInfo {
  channelId: string;
  resourceId: string;
  expiration: number; // Unix timestamp ms
  nextSyncToken?: string;
  createdAt: string;
}

export interface LocalGCalEvent {
  id: string;
  summary: string;
  startISO: string;
  endISO: string;
  status: 'confirmed' | 'cancelled';
  updatedAt: string;
}

/**
 * Encrypt sensitive plain text string (e.g. Refresh Token) using AES-256-GCM
 */
export function encryptToken(text: string): EncryptedData {
  const iv = crypto.randomBytes(12); // 96-bit IV recommended for AES-GCM
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    iv: iv.toString('hex'),
    encryptedText: encrypted,
    authTag,
  };
}

/**
 * Decrypt AES-256-GCM encrypted token payload
 */
export function decryptToken(data: EncryptedData): string {
  const iv = Buffer.from(data.iv, 'hex');
  const authTag = Buffer.from(data.authTag, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(data.encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

// In-memory persistent database store for Google OAuth credentials & synchronized blocks
class GCalDataStore {
  private tokens: Map<string, StoredTokens> = new Map();
  private watchChannels: Map<string, WatchChannelInfo> = new Map(); // channelId -> WatchChannelInfo
  private syncedBusyEvents: Map<string, LocalGCalEvent> = new Map(); // eventId -> LocalGCalEvent

  saveTokens(userId: string, tokens: StoredTokens) {
    this.tokens.set(userId, tokens);
  }

  getTokens(userId: string): StoredTokens | undefined {
    return this.tokens.get(userId);
  }

  saveWatchChannel(channelId: string, info: WatchChannelInfo) {
    this.watchChannels.set(channelId, info);
  }

  getWatchChannel(channelId: string): WatchChannelInfo | undefined {
    return this.watchChannels.get(channelId);
  }

  getAllWatchChannels(): WatchChannelInfo[] {
    return Array.from(this.watchChannels.values());
  }

  setSyncToken(channelId: string, syncToken: string) {
    const channel = this.watchChannels.get(channelId);
    if (channel) {
      channel.nextSyncToken = syncToken;
      this.watchChannels.set(channelId, channel);
    }
  }

  upsertEvent(event: LocalGCalEvent) {
    if (event.status === 'cancelled') {
      this.syncedBusyEvents.delete(event.id);
    } else {
      this.syncedBusyEvents.set(event.id, event);
    }
  }

  getSyncedEvents(): LocalGCalEvent[] {
    return Array.from(this.syncedBusyEvents.values());
  }

  clearSyncedEvents() {
    this.syncedBusyEvents.clear();
  }
}

export const gcalDataStore = new GCalDataStore();
