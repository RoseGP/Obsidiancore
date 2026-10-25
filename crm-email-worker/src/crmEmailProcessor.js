/**
 * CRM Email Processor Module for Cloudflare Workers & D1
 *
 * Implements:
 * 1. Sender Contact Auto-Discovery & Upserting
 * 2. RFC 822 / Subject Threading Engine (ignoring 'Re:', 'Fwd:', etc.)
 * 3. Thread State Management
 * 4. Structured Returns: { contact_id, thread_id, isNewContact, isNewThread }
 */

/**
 * Normalizes email subject line by stripping common prefix markers like Re:, Fwd:, FW:, etc.
 *
 * @param {string} subject - Raw email subject
 * @returns {string} Normalized subject without reply/forward prefixes
 */
export function normalizeSubject(subject) {
  if (!subject || typeof subject !== 'string') return '(No Subject)';
  return subject
    .replace(/^(\s*(re|fwd|fw|aw|vs|ref|sv|antwort)\s*:\s*)+/i, '')
    .trim() || '(No Subject)';
}

/**
 * Extracts a human-readable name from an email address when a displayName is absent
 *
 * @param {string} email - Email address
 * @returns {string} Formatted name
 */
export function extractNameFromEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const localPart = email.split('@')[0] || '';
  return localPart
    .replace(/[._+-]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Core CRM Processing Function:
 * - Checks if the sender's email exists in the `contacts` table (or creates a new contact record).
 * - Implements threading logic: Looks up existing emails using `In-Reply-To` or matching subject lines (ignoring 'Re:').
 * - If a matching thread exists, appends the new email to that `thread_id`. Otherwise, creates a new record in `email_threads`.
 * - Returns the resulting `contact_id` and `thread_id` for database insertion.
 *
 * @param {D1Database} db - Cloudflare D1 database binding (env.DB)
 * @param {Object} emailData - Parsed email object
 * @param {string} emailData.sender - Sender email address
 * @param {string} [emailData.senderName] - Sender display name
 * @param {string} [emailData.subject] - Email subject
 * @param {string} [emailData.inReplyTo] - RFC822 In-Reply-To header
 * @param {string} [emailData.references] - RFC822 References header
 * @param {string} [emailData.crmAccountId] - CRM Tenant / Account ID (defaults to 'acc_primary_org')
 * @param {string} [emailData.receivedAt] - Timestamp ISO string
 * @returns {Promise<{ contact_id: string, thread_id: string, isNewContact: boolean, isNewThread: boolean }>}
 */
export async function processEmailForCrm(db, emailData) {
  const {
    sender,
    senderName,
    subject = '(No Subject)',
    inReplyTo = null,
    references = null,
    crmAccountId = 'acc_primary_org',
    receivedAt = new Date().toISOString()
  } = emailData;

  const normalizedSender = (sender || '').trim().toLowerCase();
  const normalizedSubj = normalizeSubject(subject);
  const contactName = (senderName || extractNameFromEmail(normalizedSender)).trim();

  let contactId = null;
  let isNewContact = false;
  let threadId = null;
  let isNewThread = false;

  // ---------------------------------------------------------------------------
  // 1. SENDER CONTACT CHECK & AUTO-CREATION
  // ---------------------------------------------------------------------------
  const existingContact = await db.prepare(`
    SELECT id, name FROM contacts
    WHERE crm_account_id = ? AND email = ? COLLATE NOCASE
    LIMIT 1
  `).bind(crmAccountId, normalizedSender).first();

  if (existingContact && existingContact.id) {
    contactId = existingContact.id;
  } else {
    contactId = `cnt_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    await db.prepare(`
      INSERT INTO contacts (
        id, email, name, crm_account_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      contactId,
      normalizedSender,
      contactName,
      crmAccountId,
      receivedAt,
      receivedAt
    ).run();

    isNewContact = true;
    console.log(`[CRM Engine] Created new contact: ${contactId} (${normalizedSender})`);
  }

  // ---------------------------------------------------------------------------
  // 2. THREADING LOGIC: IN-REPLY-TO, REFERENCES, OR MATCHING NORMALIZED SUBJECT
  // ---------------------------------------------------------------------------

  // 2.1 Direct RFC Message-ID matching via In-Reply-To
  if (inReplyTo) {
    const parentEmail = await db.prepare(`
      SELECT thread_id FROM emails
      WHERE message_id = ?
      LIMIT 1
    `).bind(inReplyTo.trim()).first();

    if (parentEmail && parentEmail.thread_id) {
      threadId = parentEmail.thread_id;
      console.log(`[CRM Engine] Thread matched by In-Reply-To [${inReplyTo}]: ${threadId}`);
    }
  }

  // 2.2 References header fallback matching
  if (!threadId && references) {
    // Extract all message IDs from the References header string
    const refIds = references.match(/<[^>]+>/g) || [];
    for (const refId of refIds.reverse()) {
      const parentEmail = await db.prepare(`
        SELECT thread_id FROM emails
        WHERE message_id = ?
        LIMIT 1
      `).bind(refId).first();

      if (parentEmail && parentEmail.thread_id) {
        threadId = parentEmail.thread_id;
        console.log(`[CRM Engine] Thread matched by References [${refId}]: ${threadId}`);
        break;
      }
    }
  }

  // 2.3 Normalized Subject line matching for the same contact
  if (!threadId && normalizedSubj !== '(No Subject)') {
    const matchedThread = await db.prepare(`
      SELECT id, subject FROM email_threads
      WHERE contact_id = ? AND status != 'archived'
      ORDER BY last_message_at DESC
    `).bind(contactId).all();

    if (matchedThread && matchedThread.results && matchedThread.results.length > 0) {
      for (const row of matchedThread.results) {
        if (normalizeSubject(row.subject).toLowerCase() === normalizedSubj.toLowerCase()) {
          threadId = row.id;
          console.log(`[CRM Engine] Thread matched by normalized subject "${normalizedSubj}": ${threadId}`);
          break;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 3. THREAD CREATION OR UPDATE
  // ---------------------------------------------------------------------------
  if (threadId) {
    // Existing thread: Update last_message_at and bump updated_at
    await db.prepare(`
      UPDATE email_threads
      SET last_message_at = ?, updated_at = ?
      WHERE id = ?
    `).bind(receivedAt, receivedAt, threadId).run();
  } else {
    // New thread: Create record in email_threads
    threadId = `thd_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    await db.prepare(`
      INSERT INTO email_threads (
        id, contact_id, subject, last_message_at, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'open', ?, ?)
    `).bind(
      threadId,
      contactId,
      subject,
      receivedAt,
      receivedAt,
      receivedAt
    ).run();

    isNewThread = true;
    console.log(`[CRM Engine] Created new email thread: ${threadId} for contact ${contactId}`);
  }

  // ---------------------------------------------------------------------------
  // 4. RETURN RESULTING IDs
  // ---------------------------------------------------------------------------
  return {
    contact_id: contactId,
    thread_id: threadId,
    isNewContact,
    isNewThread
  };
}

export default {
  processEmailForCrm,
  normalizeSubject,
  extractNameFromEmail
};
