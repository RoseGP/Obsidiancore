import type { Email as PostalMimeEmail, Attachment as PostalMimeAttachment } from "postal-mime";

export interface ParsedAttachmentInfo {
  filename: string;
  mimeType: string;
  size: number;
  disposition?: string;
  contentId?: string;
}

export interface ParsedEmailResponse {
  messageId?: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  date?: string;
  text?: string;
  html?: string;
  attachments: ParsedAttachmentInfo[];
  headers: Record<string, string>;
  rawSize?: number;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface ForwardableEmailMessage {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  setReject(reason: string): void;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
  reply(message: any): Promise<void>;
}

export interface Env {
  // Optional downstream bindings (e.g. D1, R2, Queues, Analytics)
  DB?: any;
  STORAGE?: any;
  ENVIRONMENT?: string;
}
