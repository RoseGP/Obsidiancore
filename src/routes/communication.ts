import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import twilio from 'twilio';
import axios from 'axios';
import { GoogleGenAI, Type } from "@google/genai";
import {
  KnowledgeInputError, addDocument, addQA, buildKnowledgeContext, clearKnowledge, deleteDocument, deleteQA, loadKnowledge,
  updateProfile, updateQA, upsertDepartment,
} from '../utils/receptionistKnowledgeDb';
import { requirePermission, requireTenant, sendError, tenantOf } from '../server/tenancy/middleware';
import { getOrg } from '../server/tenancy/orgs';
import { InvalidIdError, getDocStore, newId } from '../server/data/docStore';
import { coreSecret } from '../utils/secrets';
import { sendSecureOutboundEmail } from '../utils/secureOutboundMailer';
import { unsignedWebhooksAllowed } from '../server/runtimeEnv';
import { verifyTwilio } from '../features/voice/server/webhook';
import { loadIvrConfig } from '../features/voice/server/config';

// Twilio signature check shared with the IVR (TWILIO_AUTH_TOKEN, IVR_ALLOWED_HOSTS, TRUST_PROXY).
const twilioSignature = verifyTwilio(loadIvrConfig());

const router = Router();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
/** No AI key on the server: say so (never answer with canned text). */
function aiUnavailable(res: Response) {
  return res.status(503).json({ success: false, code: 'ai_not_configured', error: 'AI isn’t set up on this server (add GEMINI_API_KEY).' });
}
/** The AI provider failed: report it; nothing is made up in its place. */
function aiFailed(res: Response, tag: string, err: unknown) {
  console.error(`[communication] ${tag}: AI request failed:`, (err as any)?.status || (err as any)?.code || (err as any)?.name || 'error');
  return res.status(502).json({ success: false, code: 'ai_error', error: 'The AI service didn’t respond correctly. Please try again.' });
}
function knowledgeFail(res: Response, err: unknown, tag: string) {
  if (err instanceof KnowledgeInputError || err instanceof InvalidIdError) return res.status(400).json({ success: false, code: 'invalid_input', error: err.message });
  return sendError(res, err, tag);
}
const orgName = async (orgId: string) => (await getOrg(orgId))?.name || 'our company';

/**
 * Inbound phone numbers / WhatsApp numbers → organization.
 * inbound_routes/{kind}_{key} holds { orgId }; organizations/{orgId}/inbound_routes/{kind}_{key} mirrors it for listing.
 * Messages and voicemails for numbers nobody registered are not stored (and never shown to any organization).
 */
type RouteKind = 'phone' | 'whatsapp';
const routeKey = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(0, 20);
async function orgForInbound(kind: RouteKind, raw: unknown): Promise<string | null> {
  const key = routeKey(raw);
  if (key.length < 5) return null;
  const r = await (await getDocStore()).get(`inbound_routes/${kind}_${key}`);
  return typeof r?.orgId === 'string' ? r.orgId : null;
}
async function saveForOrg(orgId: string, collection: 'inbound_messages' | 'voicemails' | 'outbound_messages', rec: Record<string, unknown>) {
  const id = newId(collection === 'voicemails' ? 'vm' : 'msg');
  await (await getDocStore()).set(`organizations/${orgId}/${collection}/${id}`, { ...rec, id, at: new Date().toISOString() });
  return id;
}
const lastDigits = (v: unknown) => { const d = routeKey(v); return d ? `…${d.slice(-4)}` : 'unknown'; };

let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key || key.includes('placeholder') || key.includes('YOUR_GEMINI_API_KEY')) {
      return null;
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

// Retrieve environmental secrets with safe local fallback values
const WHATSAPP_VERIFY_TOKEN = coreSecret('WHATSAPP_VERIFY_TOKEN');
const SOFTPHONE_CLIENT_IDENTITY = process.env.TWILIO_SOFTPHONE_IDENTITY || 'luxury_crm_softphone';
const META_APP_SECRET = process.env.META_APP_SECRET || '';

/**
 * Verifies Meta's X-Hub-Signature-256 (HMAC-SHA256 of the RAW request body with the app secret).
 * Without META_APP_SECRET, events are rejected unless NODE_ENV is explicitly development/test
 * and ALLOW_UNSIGNED_WEBHOOKS=true.
 */
function verifyMetaSignature(req: Request, res: Response, next: NextFunction) {
  const signatureHeader = String(req.headers['x-hub-signature-256'] || '');

  if (!META_APP_SECRET) {
    if (unsignedWebhooksAllowed()) {
      console.warn('[Meta Signature] META_APP_SECRET not set; accepting unsigned event (development only).');
      return next();
    }
    console.error('[Meta Signature] Rejected: META_APP_SECRET is not configured.');
    res.status(503).send('Webhook signature verification is not configured.');
    return;
  }

  const match = /^sha256=([0-9a-f]{64})$/i.exec(signatureHeader);
  const rawBody: string | undefined = (req as any).rawBody;
  if (!match || typeof rawBody !== 'string') {
    res.status(401).send('Signature verification failed.');
    return;
  }

  // Meta signs the exact bytes it sent; re-serialising req.body would change them (e.g. \u escapes).
  const computed = crypto.createHmac('sha256', META_APP_SECRET).update(Buffer.from(rawBody, 'utf8')).digest();
  const provided = Buffer.from(match[1], 'hex');
  if (provided.length !== computed.length || !crypto.timingSafeEqual(provided, computed)) {
    console.error('[Meta Signature] Rejected: signature mismatch.');
    res.status(401).send('Invalid webhook signature.');
    return;
  }
  next();
}

/**
 * 1A. META WHATSAPP WEBHOOK VERIFICATION (GET)
 * Meta checks webhooks with a GET request on registering endpoints.
 */
router.get('/whatsapp-webhook', (req: Request, res: Response) => {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log(`[WhatsApp Webhook verification] GET request received. Mode: ${mode}`);

    if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
      console.log('[WhatsApp Webhook verification] Validation successful. Echoing challenge.');
      res.status(200).send(challenge);
      return;
    }

    console.warn('[WhatsApp Webhook verification] Unauthorized handshake trial.');
    res.status(403).json({ error: 'Forbidden: Verification token mismatch.' });
  } catch (error: any) {
    console.error('[WhatsApp Webhook GET Exception]', error.message);
    res.status(500).json({ error: 'Internal system fault.' });
  }
});

/**
 * 1B. META WHATSAPP WEBHOOK DATA RECEPTION (POST)
 * Accepts incoming inbound customer updates, parsing payload structures dynamically.
 */
router.post('/whatsapp-webhook', verifyMetaSignature, async (req: Request, res: Response) => {
  try {
    const body = req.body;

    // Safety guards to check if payload is from a valid Whatsapp subscription changes array
    if (body.object === 'whatsapp_business_account' && Array.isArray(body.entry)) {
      for (const entry of body.entry) {
        for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
          const value = change?.value;
          if (!value || !Array.isArray(value.messages)) continue;
          const orgId = await orgForInbound('whatsapp', value.metadata?.phone_number_id);
          if (!orgId) {
            console.warn('[WhatsApp Webhook] Message for an unregistered WhatsApp number; not stored.');
            continue;
          }
          for (const msg of value.messages) {
            let textBody = '';
            if (msg.type === 'text' && msg.text) textBody = String(msg.text.body || '');
            else if (msg.type === 'button' && msg.button) textBody = String(msg.button.text || '');
            else if (msg.type === 'interactive' && msg.interactive) textBody = String(msg.interactive.button_reply?.title || msg.interactive.list_reply?.title || '');
            else textBody = `[${String(msg.type || 'unknown').slice(0, 30)} message: open WhatsApp to view]`;
            await saveForOrg(orgId, 'inbound_messages', {
              channel: 'WHATSAPP',
              direction: 'INBOUND',
              from: String(msg.from || '').slice(0, 32),
              contactName: String(value.contacts?.[0]?.profile?.name || '').slice(0, 120),
              body: textBody.slice(0, 4096),
              providerMessageId: String(msg.id || '').slice(0, 200),
              sentAt: msg.timestamp ? new Date(parseInt(msg.timestamp, 10) * 1000).toISOString() : null,
            });
          }
        }
      }
      res.status(200).send('EVENT_RECEIVED');
      return;
    }

    // Default return for non-message callbacks (e.g., read receipts or statuses updates)
    res.status(200).send('UNHANDLED_CALLBACK_TYPE');
  } catch (error: any) {
    console.error('[WhatsApp Webhook POST Exception]', error?.code || error?.name || 'error');
    res.status(500).json({ error: 'Failed to process WhatsApp payload safely.' });
  }
});

/**
 * 1C. TWILIO SMS WEBHOOK DATA RECEPTION (POST)
 * Receives incoming SMS webhook payloads directly from Twilio over URL-encoded form format.
 */
router.post('/twilio-sms', twilioSignature, async (req: Request, res: Response) => {
  try {
    const { From, Body, MessageSid } = req.body;

    if (!From || !Body) {
      console.warn('[Twilio SMS Webhook] Received empty From or Body parameters in request.');
      res.status(400).send('<Response></Response>');
      return;
    }

    const orgId = await orgForInbound('phone', req.body.To);
    if (orgId) {
      await saveForOrg(orgId, 'inbound_messages', {
        channel: 'SMS',
        direction: 'INBOUND',
        from: String(From).slice(0, 32),
        contactName: '',
        body: String(Body).slice(0, 4096),
        providerMessageId: String(MessageSid || '').slice(0, 200),
      });
    } else {
      console.warn(`[Twilio SMS Webhook] Message to an unregistered number (${lastDigits(req.body.To)}); not stored.`);
    }

    // Output empty TwiML telling Twilio all is successfully processed
    const twiML = `<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`;
    res.header('Content-Type', 'text/xml');
    res.status(200).send(twiML);
  } catch (error: any) {
    console.error('[Twilio SMS Webhook Exception]', error?.code || error?.name || 'error');
    res.status(500).send('<Response></Response>');
  }
});

/**
 * 2A. TWILIO INBOUND CALLS ROUTER (POST)
 * Outputs XML-compliant Twilio Markup Language (TwiML) to bridge call logs or fallback to voicemail.
 */
router.post('/incoming-call', twilioSignature, (req: Request, res: Response) => {
  try {
    const fromNumber = req.body.From || 'Unknown Caller';
    const callSid = req.body.CallSid || 'n/a';

    void fromNumber; void callSid;

    // Generate compliant TwiML to ring client softphone
    // If softphone does not answer within 18 seconds, direct call traffic to local secure voicemail flow
    const twimlXml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Connecting your call.</Say>
  <Dial timeout="18" action="/api/communication/twiml-fallback">
    <Client>${SOFTPHONE_CLIENT_IDENTITY}</Client>
  </Dial>
</Response>`;

    res.header('Content-Type', 'text/xml');
    res.status(200).send(twimlXml);
  } catch (error: any) {
    console.error('[Twilio TwiML Generation Event Exception]', error.message);
    
    // Safety fallback XML returned in all failure instances to bypass silent carrier drops
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Sorry, we can't take your call right now. Please try again later.</Say>
</Response>`;
    res.header('Content-Type', 'text/xml');
    res.status(200).send(errorTwiml);
  }
});

/**
 * 2B. TWILIO FALLBACK VOICEMAIL CAPTURE ROUTE (POST)
 * Triggered automatically by Twilio if the <Dial><Client> ring duration yields no live connection.
 */
router.post('/twiml-fallback', twilioSignature, (req: Request, res: Response) => {
  try {
    const dialCallStatus = req.body.DialCallStatus || '';
    const fromNumber = req.body.From || 'Unknown Caller';
    const callSid = req.body.CallSid || '';

    void dialCallStatus; void fromNumber; void callSid;

    // Dynamic voicemail recording instruction
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">No one is available to take your call. Please leave a message after the tone.</Say>
  <Record maxLength="45" action="/api/communication/twiml-voicemail-saved" playBeep="true" />
  <Say voice="alice">We didn't receive a message. Goodbye.</Say>
</Response>`;

    res.header('Content-Type', 'text/xml');
    res.status(200).send(xml);
  } catch (error: any) {
    console.error('[Twilio Fallback Exception]', error.message);
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup />
</Response>`;
    res.header('Content-Type', 'text/xml');
    res.status(200).send(errorTwiml);
  }
});

/**
 * 2C. TWILIO RECORDING COMPLETED EVENT (POST)
 * Twilio issues metadata to this route when a customer finishes recording a voicemail.
 */
router.post('/twiml-voicemail-saved', twilioSignature, async (req: Request, res: Response) => {
  try {
    const recordingUrl = String(req.body.RecordingUrl || '');
    const duration = Math.max(0, parseInt(String(req.body.RecordingDuration || '0'), 10) || 0);
    const orgId = await orgForInbound('phone', req.body.To);
    if (orgId && /^https:\/\//.test(recordingUrl)) {
      await saveForOrg(orgId, 'voicemails', {
        from: String(req.body.From || '').slice(0, 32),
        recordingUrl: recordingUrl.slice(0, 500),
        durationSeconds: duration,
        callSid: String(req.body.CallSid || '').slice(0, 64),
      });
    } else if (!orgId) {
      console.warn(`[Twilio Voicemail] Recording for an unregistered number (${lastDigits(req.body.To)}); not stored.`);
    }

    const finishTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Thank you. Your message has been recorded. Goodbye.</Say>
  <Hangup />
</Response>`;

    res.header('Content-Type', 'text/xml');
    res.status(200).send(finishTwiml);
  } catch (error: any) {
    console.error('[Twilio Voicemail Saved Exception]', error?.code || error?.name || 'error');
    res.status(500).end();
  }
});

// ---------------------------------------------------------------------------
// Everything below is for signed-in members of an organization.
// ---------------------------------------------------------------------------
router.use(requireTenant);

/** Which phone / WhatsApp numbers deliver into this organization. */
router.get('/inbound-routes', requirePermission('read'), async (req, res) => {
  try { res.json({ success: true, routes: await (await getDocStore()).list(`organizations/${tenantOf(req).orgId}/inbound_routes`) }); }
  catch (err) { sendError(res, err, 'communication.routes.list'); }
});
router.post('/inbound-routes', requirePermission('manage_org'), async (req, res) => {
  try {
    const kind = req.body?.kind;
    const key = routeKey(req.body?.number);
    if ((kind !== 'phone' && kind !== 'whatsapp') || key.length < 5) {
      return res.status(400).json({ success: false, code: 'invalid_input', error: 'Choose phone or whatsapp and enter the number (or WhatsApp phone number ID).' });
    }
    const orgId = tenantOf(req).orgId;
    const st = await getDocStore();
    const id = `${kind}_${key}`;
    const route = { id, kind, number: key, orgId, addedBy: tenantOf(req).userId, addedAt: new Date().toISOString() };
    const taken = await st.transaction(async (tx) => {
      const cur = await tx.get(`inbound_routes/${id}`);
      if (cur && cur.orgId !== orgId) return true;
      tx.set(`inbound_routes/${id}`, { orgId });
      tx.set(`organizations/${orgId}/inbound_routes/${id}`, route);
      return false;
    });
    if (taken) return res.status(409).json({ success: false, code: 'number_in_use', error: 'That number is already connected to another organization.' });
    res.status(201).json({ success: true, route });
  } catch (err) { sendError(res, err, 'communication.routes.add'); }
});
router.delete('/inbound-routes/:id', requirePermission('manage_org'), async (req, res) => {
  try {
    const id = String(req.params.id);
    if (!/^(phone|whatsapp)_\d{5,20}$/.test(id)) return res.status(404).json({ success: false, error: 'Not found.' });
    const orgId = tenantOf(req).orgId;
    const st = await getDocStore();
    const removed = await st.transaction(async (tx) => {
      const cur = await tx.get(`inbound_routes/${id}`);
      if (!cur || cur.orgId !== orgId) return false;
      tx.delete(`inbound_routes/${id}`);
      tx.delete(`organizations/${orgId}/inbound_routes/${id}`);
      return true;
    });
    if (!removed) return res.status(404).json({ success: false, error: 'Not found.' });
    res.json({ success: true });
  } catch (err) { sendError(res, err, 'communication.routes.delete'); }
});

/** Messages and voicemails received on this organization's numbers (newest first). */
router.get('/inbound-messages', requirePermission('read'), async (req, res) => {
  try {
    const st = await getDocStore();
    const orgId = tenantOf(req).orgId;
    const [messages, voicemails] = await Promise.all([
      st.list(`organizations/${orgId}/inbound_messages`, { orderBy: 'at', direction: 'desc', limit: 200 }),
      st.list(`organizations/${orgId}/voicemails`, { orderBy: 'at', direction: 'desc', limit: 200 }),
    ]);
    res.json({ success: true, messages, voicemails });
  } catch (err) { sendError(res, err, 'communication.inbound.list'); }
});

/** Message slips (call-back requests) taken by the team or the receptionist, per organization. */
const SLIP_STATUS = ['unread', 'resolved', 'called_back'] as const;
const SLIP_URGENCY = ['normal', 'high', 'urgent'] as const;
router.get('/message-slips', requirePermission('read'), async (req, res) => {
  try {
    const slips = await (await getDocStore()).list(`organizations/${tenantOf(req).orgId}/message_slips`, { orderBy: 'createdAt', direction: 'desc', limit: 200 });
    res.json({ success: true, slips });
  } catch (err) { sendError(res, err, 'communication.slips.list'); }
});
router.post('/message-slips', requirePermission('write'), async (req, res) => {
  try {
    const b = req.body || {};
    const text = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
    const callerName = text(b.callerName, 120), notes = text(b.notes, 2000);
    if (!callerName || !notes) return res.status(400).json({ success: false, code: 'invalid_input', error: 'Caller name and message are required.' });
    const t = tenantOf(req);
    const slip = {
      id: newId('slip'),
      callerName, notes,
      callerCompany: text(b.callerCompany, 120),
      callbackNumber: text(b.callbackNumber, 40),
      recipient: text(b.recipient, 120),
      urgency: SLIP_URGENCY.includes(b.urgency) ? b.urgency : 'normal',
      status: 'unread',
      source: b.source === 'test_call' ? 'test_call' : 'manual',
      createdBy: t.userId,
      createdAt: new Date().toISOString(),
    };
    await (await getDocStore()).set(`organizations/${t.orgId}/message_slips/${slip.id}`, slip);
    res.status(201).json({ success: true, slip });
  } catch (err) { sendError(res, err, 'communication.slips.add'); }
});
router.patch('/message-slips/:id', requirePermission('write'), async (req, res) => {
  try {
    const id = String(req.params.id);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return res.status(404).json({ success: false, error: 'Not found.' });
    if (!SLIP_STATUS.includes(req.body?.status)) return res.status(400).json({ success: false, code: 'invalid_input', error: 'Unknown status.' });
    const updated = await (await getDocStore()).update(`organizations/${tenantOf(req).orgId}/message_slips/${id}`, { status: req.body.status, updatedAt: new Date().toISOString() });
    if (!updated) return res.status(404).json({ success: false, error: 'Not found.' });
    res.json({ success: true });
  } catch (err) { sendError(res, err, 'communication.slips.update'); }
});

/**
 * 3A. SECURE TWILIO VIDEO ACCESS TOKEN GENERATOR (POST & GET)
 * Generates dynamic WebRTC Access Tokens containing video constraints and identity scopes.
 */
router.all('/twilio-video-token', (req: Request, res: Response) => {
  try {
    // Resolve identity and roomName from either query keys (GET) or request payload (POST)
    // The token identity is always the signed-in user (the route is no longer public).
    // TO COMPLETE (Phase 1): check the caller is a participant of roomName before granting it.
    const identity = String((req as any).user?.id || '');
    if (!identity) { res.status(401).json({ success: false, error: 'Sign in to continue.' }); return; }
    const roomName = String(req.query.roomName || req.body?.roomName || '').trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(roomName)) { res.status(400).json({ success: false, error: 'A valid roomName is required.' }); return; }


    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const apiKey = process.env.TWILIO_API_KEY;
    const apiSecret = process.env.TWILIO_API_SECRET;

    if (!accountSid || !apiKey || !apiSecret || accountSid.includes('placeholder') || apiKey.includes('placeholder')) {
      res.status(503).json({ success: false, code: 'video_not_configured', error: 'Twilio Video isn’t set up on this server (TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET).' });
      return;
    }

    // Access real Twilio token builder constructs
    const AccessToken = twilio.jwt.AccessToken;
    const VideoGrant = AccessToken.VideoGrant;

    // Build the JWT container with active credentials
    const token = new AccessToken(accountSid, apiKey, apiSecret, {
      identity: identity,
      ttl: 3600 // token valid for 1 hour
    });

    // Restrict scope targeting to the requested consultation room
    const grant = new VideoGrant({ room: roomName });
    token.addGrant(grant);

    const jwtToken = token.toJwt();

    res.status(200).json({
      success: true,
      identity,
      roomName,
      token: jwtToken,
      expiresIn: 3600
    });

  } catch (error: any) {
    sendError(res, error, 'communication.twilio-video-token');
  }
});

/**
 * 4. AI-POWERED OR INTELLIGENT RULE-BASED INTAKE ASSISTANT BOT
 * Fully conforms to lead qualification steps, dual-sentence strict guidelines, sequential confirmation, and handoffs.
 */
router.post('/intake-bot', async (req: Request, res: Response) => {
  try {
    const { contactName = '', company = '', userMessage, currentState = {} } = req.body || {};
    if (typeof userMessage !== 'string' || !userMessage.trim()) return res.status(400).json({ success: false, error: 'userMessage is required.' });

    const key = process.env.GEMINI_API_KEY;
    const hasApiKey = key && !key.includes('placeholder') && !key.includes('YOUR_GEMINI_API_KEY');

    if (hasApiKey) {
      try {
        const client = getGeminiClient();
        
        const systemInstruction = `You are a friendly and efficient virtual intake assistant for ${await orgName(tenantOf(req).orgId)}. Your single objective is to qualify inbound leads and route them appropriately.

Tone & Style:
- Warm, enthusiastic, yet professional.
- Use natural contractions (e.g., "I'm", "don't", "we'll").
- Keep responses to a maximum of 2 sentences. 

Qualification Criteria:
1. Confirm their current primary business challenge.
2. Ask for their approximate monthly budget threshold (Under $1k, $1k-$5k, or Over $5k).
3. If they meet the criteria, seamlessly trigger 'book_appointment' tool to find a slot. (Budget of Under $1k does not qualify and you should explain politely and end negotiation).

Conversational Rules & Priority:
- Verify qualification criteria sequentially, one question at a time.
- NEVER bundle questions. If you need to confirm challenge, ask only about that challenge. Do NOT ask for the budget in the same turn.
- Mirror and Validate: Briefly acknowledge and validate their answer before moving to the next criteria (e.g., "Understood, a $2,000 budget makes sense. Let's look at available times." or "Got it, solving core CRM messaging bottleneck is crucial.").
- Hand off to Human Specialist: If they ask a complex custom question, or if we cannot answer because of scope, immediately set 'shouldTransferToHuman' to true, and say: "That's a great question, and I want to make sure you get the exact answer. Let me connect you with one of our specialists right now." and trigger handoff.`;

        const prompt = `Active Lead metadata:
Name: ${contactName}
Company: ${company}

Current Qualification State:
- Identified Challenge: ${currentState.challenge || 'None yet'}
- Logged Budget: ${currentState.budget || 'None yet'}

New Incoming Message from Client:
"${userMessage}"

Provide your assessment, response, and qualify/classify this lead.`;

        const result = await client.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                reply: {
                  type: Type.STRING,
                  description: "Your friendly response back to the customer, max 2 sentences."
                },
                challenge: {
                  type: Type.STRING,
                  description: "Extracted or confirmed primary challenge. Keep it concise. Set to null if still unconfirmed."
                },
                budget: {
                  type: Type.STRING,
                  description: "Strictly match one of: 'Under $1k', '$1k-$5k', 'Over $5k'. Set to null if still unconfirmed."
                },
                shouldBookAppointment: {
                  type: Type.BOOLEAN,
                  description: "Set to true if challenge is confirmed AND budget is NOT 'Under $1k' (i.e. is '$1k-$5k' or 'Over $5k') and we should book appointment slot."
                },
                shouldTransferToHuman: {
                  type: Type.BOOLEAN,
                  description: "Set to true if they ask custom questions outside pure qualification, or require human/specialist support."
                }
              },
              required: ['reply', 'challenge', 'budget', 'shouldBookAppointment', 'shouldTransferToHuman']
            }
          }
        });

        const parsedContent = JSON.parse(result.text || '{}');
        res.json({
          success: true,
          aiUsed: true,
          ...parsedContent
        });
        return;
      } catch (gemIniErr) {
        return aiFailed(res, 'intake-bot', gemIniErr);
      }
    }
    return aiUnavailable(res);
  } catch (error: any) {
    sendError(res, error, 'communication.intake-bot');
  }
});

/**
 * 5. REPLYZEN SMART EMAIL CO-PILOT ASSISTANT (POST)
 * Dynamically queries Gemini to analyze threads, summarize content, or draft replies.
 */
router.post('/replyzen-assistant', async (req: Request, res: Response) => {
  try {
    const { prompt: userPrompt, threads } = req.body;

    if (!userPrompt) {
      res.status(400).json({ error: 'Please provide a prompt.' });
      return;
    }

    const key = process.env.GEMINI_API_KEY;
    const hasApiKey = key && !key.includes('placeholder') && !key.includes('YOUR_GEMINI_API_KEY');

    if (hasApiKey) {
      try {
        const client = getGeminiClient();
        
        const systemInstruction = `You are ReplyZen, a state-of-the-art AI email assistant designed to compose polished replies, summarize threads, or analyze communication streams instantly.
        
        You have direct access to the user's active email threads.
        Analyze the client's query against these threads and provide:
        1. An intelligent and highly polished advisor response (use clean markdown).
        2. Suggested context-specific actions (e.g., matching a thread to select, drafting a response, or highlighting an issue) if applicable.
        
        Guidelines:
        - Be concise, helpful, and ultra-professional.
        - Treat user requests with high intelligence. If they want a draft, output a beautiful email draft in the 'draftResult' parameter.
        - If they refer to a contact name or company, inspect the active threads list to match 'targetThreadId' automatically. Only use facts present in the threads.`;

        const threadListSummary = Array.isArray(threads) ? threads.map((t: any) => ({
          threadId: t.id,
          subject: t.subject,
          contactName: t.contactName,
          company: t.company,
          unread: t.unread,
          starred: t.starred,
          folder: t.folder,
          messages: t.messages?.map((m: any) => ({
            sender: m.sender,
            senderName: m.senderName,
            text: m.text,
            date: m.date
          }))
        })) : [];

        const prompt = `User Request: "${userPrompt}"
        
        Available Email Threads:
        ${JSON.stringify(threadListSummary, null, 2)}
        
        Respond with your assessment, matching active target threads if needed, or creating high-fidelity drafts.`;

        const result = await client.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                replyText: {
                  type: Type.STRING,
                  description: "Text response back to the user explaining what you found, summarized, or drafted. Use clean markdown formatting."
                },
                targetThreadId: {
                  type: Type.STRING,
                  description: "Thread ID of the matched active conversation related to the request, if any. Else null."
                },
                draftResult: {
                  type: Type.STRING,
                  description: "Drafted email message body if the user requested a reply or compose template. Else null."
                },
                suggestedAction: {
                  type: Type.STRING,
                  description: "Brief label of suggested action like 'REPLY_DRAFT', 'SELECT_THREAD', 'NONE'."
                }
              },
              required: ['replyText', 'targetThreadId', 'draftResult', 'suggestedAction']
            }
          }
        });

        const parsedContent = JSON.parse(result.text || '{}');
        res.json({
          success: true,
          aiUsed: true,
          ...parsedContent
        });
        return;
      } catch (gemIniErr) {
        return aiFailed(res, 'replyzen-assistant', gemIniErr);
      }
    }
    return aiUnavailable(res);
  } catch (error: any) {
    sendError(res, error, 'communication.replyzen');
  }
});

/**
 * 6. SEND EMAIL COMPOSER OUTBOX (POST)
 * Accepts To, CC, BCC, Subject, and Body and handles outgoing SMTP/IMAP simulations.
 */
router.post('/send-email', async (req: Request, res: Response) => {
  // Real SMTP delivery (utils/secureOutboundMailer). Without SMTP settings this reports "not configured"
  // instead of pretending the email went out.
  const { to, cc, bcc, subject, body, html } = req.body || {};
  const emails = (v: unknown) => (Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(',') : []).map((x) => String(x).trim()).filter(Boolean);
  const valid = (list: string[]) => list.every((e) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e) && e.length <= 254);
  const toList = emails(to), ccList = emails(cc), bccList = emails(bcc);
  if (!toList.length) { res.status(400).json({ success: false, error: 'Add a recipient.' }); return; }
  if (!valid([...toList, ...ccList, ...bccList]) || toList.length + ccList.length + bccList.length > 50) { res.status(400).json({ success: false, error: 'One of the email addresses is invalid (max 50 recipients).' }); return; }
  if (typeof body !== 'string' || !body.trim() || body.length > 200_000) { res.status(400).json({ success: false, error: 'Write a message.' }); return; }
  if (!process.env.SMTP_HOST && !process.env.CLOUDFLARE_SMTP_RELAY_HOST) {
    res.status(503).json({ success: false, code: 'email_not_configured', error: 'Email sending isn’t configured on the server (SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM).' });
    return;
  }
  try {
    const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
    const result = await sendSecureOutboundEmail({
      to: toList, cc: ccList.length ? ccList : undefined, bcc: bccList.length ? bccList : undefined,
      subject: String(subject || '(No subject)').slice(0, 300), text: body,
      // The HTML version is built from the text (escaped), never from client-supplied HTML.
      html: `<div style="font-family:sans-serif;line-height:1.6">${esc(body).replace(/\n/g, '<br>')}</div>`,
    });
    void html;
    res.status(202).json({ success: true, messageId: result.messageId, dispatchedAt: new Date().toISOString() });
  } catch (err: any) {
    console.error('[send-email] SMTP delivery failed:', err?.message);
    res.status(502).json({ success: false, code: 'smtp_failed', error: 'The mail server rejected the message. Nothing was sent.' });
  }
});

/**
 * 7. CRM DASHBOARD INTEGRATED COMMAND ASSISTANT (POST)
 * Processes queries directly from the Seto-inspired dashboard's smart command bar.
 */
router.post('/dashboard-assistant', async (req: Request, res: Response) => {
  try {
    const { prompt: userPrompt } = req.body;

    if (!userPrompt) {
      res.status(400).json({ error: 'Please provide a command or question.' });
      return;
    }

    const key = process.env.GEMINI_API_KEY;
    const hasApiKey = key && !key.includes('placeholder') && !key.includes('YOUR_GEMINI_API_KEY');

    let replyText = '';
    let aiUsed = false;

    if (hasApiKey) {
      try {
        const client = getGeminiClient();
        const systemInstruction = `You are Obsidian AI, a helpful, extremely intelligent, and highly professional CRM virtual assistant embedded in the Obsidian customer relationship management cockpit.
 The user manages customer channels (email, SMS, WhatsApp, Google Business Profile and proposals).
        You have no access to their CRM data in this chat: never invent names, deals, numbers or statistics.
        
        Answer their inquiry precisely, using beautiful and polished markdown format with elegant spacing.
        You can suggest ideas, draft messages, or explain metrics, but keep it concise and action-oriented.`;

        const result = await client.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: userPrompt,
          config: {
            systemInstruction: systemInstruction,
            temperature: 0.7,
          }
        });

        if (result.text) {
          replyText = result.text;
          aiUsed = true;
        }
      } catch (gemIniErr) {
        return aiFailed(res, 'dashboard-assistant', gemIniErr);
      }
    }
    if (!hasApiKey) return aiUnavailable(res);
    if (!aiUsed) return aiFailed(res, 'dashboard-assistant', new Error('empty reply'));

    res.json({ success: true, aiUsed, replyText });

  } catch (error: any) {
    sendError(res, error, 'communication.dashboard-assistant');
  }
});

/**
 * 8. UNIFIED OUTBOUND COMMUNICATIONS PROXY (POST /api/communication/send)
 * Design and implement a secure, unified outbound proxy route to dispatch real WhatsApp/SMS messages.
 * Checks for credentials; if missing, falls back to simulated state gracefully with detailed logs.
 */
router.post('/send', requirePermission('write'), async (req: Request, res: Response) => {
  try {
    const { to, channel, body } = req.body || {};
    const upperChannel = String(channel || '').toUpperCase();
    const toNumber = String(to || '').trim();
    if (!/^\+?[1-9]\d{6,14}$/.test(toNumber.replace(/[\s()-]/g, '')) || typeof body !== 'string' || !body.trim() || body.length > 1600) {
      return res.status(400).json({ success: false, code: 'invalid_input', error: 'Enter a phone number in international format and a message (max 1,600 characters).' });
    }
    if (upperChannel !== 'SMS' && upperChannel !== 'WHATSAPP') {
      return res.status(400).json({ success: false, code: 'invalid_input', error: 'Channel must be SMS or WHATSAPP.' });
    }
    const dest = toNumber.replace(/[\s()-]/g, '');
    let externalMessageId = '';

    if (upperChannel === 'SMS') {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const fromNumber = process.env.TWILIO_PHONE_NUMBER;
      if (!accountSid || !authToken || !fromNumber || accountSid.includes('placeholder')) {
        return res.status(503).json({ success: false, code: 'sms_not_configured', error: 'SMS sending isn’t set up on this server (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER). Nothing was sent.' });
      }
      try {
        const response = await twilio(accountSid, authToken).messages.create({ from: fromNumber, to: dest, body });
        externalMessageId = response.sid;
      } catch (err: any) {
        console.error('[communication.send] Twilio rejected the SMS:', err?.code || err?.status || 'error');
        return res.status(502).json({ success: false, code: 'sms_failed', error: 'The SMS provider rejected the message. Nothing was sent.' });
      }
    } else {
      const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
      if (!phoneId || !accessToken || phoneId.includes('placeholder')) {
        return res.status(503).json({ success: false, code: 'whatsapp_not_configured', error: 'WhatsApp sending isn’t set up on this server (WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN). Nothing was sent.' });
      }
      try {
        const response = await axios.post(`https://graph.facebook.com/v18.0/${encodeURIComponent(phoneId)}/messages`, {
          messaging_product: 'whatsapp', recipient_type: 'individual', to: dest.replace(/^\+/, ''), type: 'text',
          text: { preview_url: false, body },
        }, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, timeout: 15000 });
        externalMessageId = String(response.data?.messages?.[0]?.id || '');
      } catch (err: any) {
        console.error('[communication.send] WhatsApp rejected the message:', err?.response?.status || err?.code || 'error');
        return res.status(502).json({ success: false, code: 'whatsapp_failed', error: 'WhatsApp rejected the message. Nothing was sent.' });
      }
    }

    const t = tenantOf(req);
    const messageId = await saveForOrg(t.orgId, 'outbound_messages', {
      channel: upperChannel, direction: 'OUTBOUND', to: dest, body, status: 'SENT_TO_PROVIDER', providerMessageId: externalMessageId, sentBy: t.userId,
    });
    res.status(200).json({ success: true, messageId, externalMessageId, channel: upperChannel, direction: 'OUTBOUND', status: 'SENT_TO_PROVIDER' });
  } catch (error) {
    sendError(res, error, 'communication.send');
  }
});

/**
 * 6B. AI RECEPTIONIST KNOWLEDGE BASE MANAGEMENT (GET, POST, DELETE)
 * Provides comprehensive inspection, training, and update endpoints for the AI receptionist.
 */
router.get('/receptionist/knowledge', requirePermission('read'), async (req: Request, res: Response) => {
  try {
    const store = await loadKnowledge(tenantOf(req).orgId);
    return res.status(200).json({
      success: true,
      store,
      trainingMetrics: {
        totalQAs: store.qas.length,
        enabledQAs: store.qas.filter(q => q.enabled).length,
        totalDocuments: store.documents.length,
        totalDepartments: store.departments.length,
      }
    });
  } catch (error) {
    return knowledgeFail(res, error, 'receptionist.knowledge.get');
  }
});

router.post('/receptionist/knowledge', requirePermission('write'), async (req: Request, res: Response) => {
  try {
    const orgId = tenantOf(req).orgId;
    const { action, profile, qa, qaId, updates, departmentKey, deptUpdates, document } = req.body || {};

    if (action === 'update_profile' && profile && typeof profile === 'object') {
      return res.status(200).json({ success: true, profile: await updateProfile(orgId, profile), message: 'Company profile updated.' });
    }
    if (action === 'add_qa' && qa && typeof qa === 'object') {
      return res.status(200).json({ success: true, qa: await addQA(orgId, qa), message: 'Q&A pair added.' });
    }
    if (action === 'update_qa' && qaId && updates && typeof updates === 'object') {
      const updatedQA = await updateQA(orgId, String(qaId), updates);
      if (!updatedQA) return res.status(404).json({ success: false, error: 'Q&A entry not found.' });
      return res.status(200).json({ success: true, qa: updatedQA, message: 'Q&A entry updated.' });
    }
    if (action === 'update_dept' && departmentKey && deptUpdates && typeof deptUpdates === 'object') {
      return res.status(200).json({ success: true, department: await upsertDepartment(orgId, departmentKey, deptUpdates), message: 'Department routing saved.' });
    }
    if (action === 'add_doc' && document && typeof document === 'object') {
      const newDoc = await addDocument(orgId, { title: document.title, category: document.category, rawContent: document.rawContent, summary: document.summary, extractedQAsCount: 0 });
      return res.status(200).json({ success: true, document: newDoc, message: 'Document added.' });
    }
    if (action === 'reset') {
      return res.status(200).json({ success: true, store: await clearKnowledge(orgId), message: 'Knowledge base cleared.' });
    }
    return res.status(400).json({ success: false, error: 'Invalid action or missing parameters.' });
  } catch (error) {
    return knowledgeFail(res, error, 'receptionist.knowledge.post');
  }
});

router.delete('/receptionist/knowledge/:type/:id', requirePermission('write'), async (req: Request, res: Response) => {
  try {
    const orgId = tenantOf(req).orgId;
    const { type, id } = req.params;
    if (type === 'qa') {
      const ok = await deleteQA(orgId, id);
      return res.status(ok ? 200 : 404).json({ success: ok, message: ok ? 'Q&A entry deleted.' : 'Entry not found.' });
    }
    if (type === 'doc') {
      const ok = await deleteDocument(orgId, id);
      return res.status(ok ? 200 : 404).json({ success: ok, message: ok ? 'Document deleted.' : 'Document not found.' });
    }
    return res.status(400).json({ success: false, error: 'Invalid type parameter.' });
  } catch (error) {
    return knowledgeFail(res, error, 'receptionist.knowledge.delete');
  }
});

/**
 * 6C. AI AUTOMATED DOCUMENT INGESTION & TRAINING GENERATOR (POST)
 * Takes unstructured text, policies, website copy, or employee guides and uses Gemini 3.7 Flash
 * to automatically synthesize production Q&As, keywords, and routing recommendations.
 */
router.post('/receptionist/ai-train', requirePermission('write'), async (req: Request, res: Response) => {
  try {
    const { rawText, documentTitle = 'Custom Document', category = 'Custom Training' } = req.body;

    if (!rawText || !rawText.trim()) {
      return res.status(400).json({ error: 'rawText is required for AI training.' });
    }

    if (typeof rawText !== 'string' || rawText.length > 50_000) {
      return res.status(400).json({ success: false, error: 'Training text is limited to 50,000 characters.' });
    }
    const orgId = tenantOf(req).orgId;
    const client = getGeminiClient();
    if (client) {
      try {
        const prompt = `You are a Senior Conversational AI Receptionist Trainer.
Analyze the following source document or business information and generate high-yield training Q&A pairs suitable for both voice telephony and live chat.

Source Document Title: "${documentTitle}"
Category: "${category}"
Source Content:
"""
${rawText.slice(0, 8000)}
"""

Extract 3 to 6 distinct, high-impact Q&A pairs with:
1. 'question': Clear question likely asked by callers or chat clients.
2. 'answer': Spoken-friendly, accurate answer (under 40 words, no markdown or asterisks).
3. 'category': One of ['general', 'pricing', 'technical', 'security', 'routing', 'policy', 'custom'].
4. 'keywords': 4-6 lowercase search trigger keywords.
5. 'priority': 'high' | 'medium' | 'low'.

Also output:
- 'summary': 1-2 sentence overview of what was learned.
- 'companyUpdates': Any extracted update for business hours, address, or tone.`;

        const result = await client.models.generateContent({
          model: 'gemini-3.7-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                summary: { type: Type.STRING },
                extractedQAs: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      question: { type: Type.STRING },
                      answer: { type: Type.STRING },
                      category: { type: Type.STRING },
                      keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                      priority: { type: Type.STRING }
                    },
                    required: ['question', 'answer', 'category', 'keywords', 'priority']
                  }
                }
              },
              required: ['summary', 'extractedQAs']
            }
          }
        });

        const parsed = JSON.parse(result.text?.trim() || '{}');
        const extractedQAs = parsed.extractedQAs || [];

        // Ingest into knowledge store
        const createdDoc = await addDocument(orgId, {
          title: documentTitle,
          category,
          rawContent: rawText,
          summary: parsed.summary || `Extracted ${extractedQAs.length} Q&As from ${documentTitle}.`,
          extractedQAsCount: extractedQAs.length
        });

        const createdQAs = [];
        for (const q of extractedQAs.slice(0, 10)) {
          if (!q?.question || !q?.answer) continue;
          createdQAs.push(await addQA(orgId, { category: q.category, question: q.question, answer: q.answer, keywords: q.keywords, priority: q.priority, enabled: true }));
        }

        return res.status(200).json({
          success: true,
          message: `Successfully generated ${createdQAs.length} training Q&A items.`,
          document: createdDoc,
          qas: createdQAs,
          summary: parsed.summary,
          model: 'gemini-3.7-flash'
        });
      } catch (gemError) {
        return aiFailed(res, 'receptionist.ai-train', gemError);
      }
    }
    return aiUnavailable(res);
  } catch (error: any) {
    return knowledgeFail(res, error, 'receptionist.ai-train');
  }
});

/**
 * RECEPTIONIST ACTION SUGGESTIONS
 * The AI can only suggest an action. Nothing here is created, booked or sent: a team member does that
 * in Meetings, Calendar or Proposals. Only details the caller actually gave are passed through.
 */
const NOT_CREATED = 'Suggested by the receptionist. Nothing has been created yet: a team member needs to confirm it.';
function executeStartVideoCall(leadName: string, company: string) {
  return { status: 'suggested', note: NOT_CREATED, leadName: leadName || '', company: company || '', createdAt: new Date().toISOString() };
}

function executeScheduleCalendarEvent(title: string, date: string, time: string, duration: number, guests: string[], notes: string) {
  return {
    status: 'suggested',
    note: NOT_CREATED,
    title: title || 'Meeting',
    date: date || '',
    time: time || '',
    duration: duration || null,
    attendees: guests.filter(Boolean),
    additionalNotes: notes || '',
    createdAt: new Date().toISOString()
  };
}

function executeCreateProposal(clientName: string, title: string, price: number | null, deliverables: string[]) {
  return {
    status: 'suggested',
    note: NOT_CREATED,
    client_name: clientName || '',
    title: title || 'Proposal',
    price: typeof price === 'number' && price > 0 ? price : null,
    deliverables: Array.isArray(deliverables) ? deliverables.slice(0, 20) : [],
    created_at: new Date().toISOString()
  };
}

/**
 * 6D. AI RECEPTIONIST CHAT QUERY ANSWERING (POST)
 * Answers any question submitted via chat or command center using the trained knowledge base.
 */
router.post('/receptionist/chat-query', requirePermission('read'), async (req: Request, res: Response) => {
  try {
    const { 
      message, 
      leadName = '',
      leadCompany = '',
    } = req.body || {};

    if (typeof message !== 'string' || !message.trim() || message.length > 4000) {
      return res.status(400).json({ success: false, error: 'message is required (max 4,000 characters).' });
    }

    const orgId = tenantOf(req).orgId;
    const company = await orgName(orgId);
    const store = await loadKnowledge(orgId);
    const dynamicKnowledge = buildKnowledgeContext(store, company);
    const client = getGeminiClient();
    if (!client) return aiUnavailable(res);

    if (client) {
      try {
        const systemInstruction = `You are ${store.profile.agentName || 'the AI receptionist'} at ${store.profile.companyName || company}.
Answer only from the knowledge base below. You can suggest actions, but you cannot create, book or send anything yourself.

${dynamicKnowledge}

RECEPTIONIST GUIDELINES FOR CHAT ANSWERS:
1. Provide a direct, courteous, helpful answer formatted cleanly in markdown.
2. Provide a 'spokenReply' field containing a concise, 1-2 sentence spoken summary (under 35 words, no markdown) suitable for speech synthesis.
3. ACTION DETECTION:
   - If the user asks for a VIDEO CALL: set 'actionType' to 'start_video_call' and say a team member will send a meeting link.
   - If the user asks to SCHEDULE a meeting: set 'actionType' to 'schedule_calendar_event', extract only the details they gave into 'calendarEventData', and say the team will confirm the time.
   - If the user asks for a PROPOSAL or quote: set 'actionType' to 'create_proposal', extract only what they asked for into 'proposalData' (no invented prices), and say the team will prepare it.
   - If the user asks for a department (Sales, Tech Support, Billing, Executive, Partnerships), set 'transferDepartment'.
   - If they want to leave a message or reach someone in a meeting, set 'isTakingMessage': true and prepare 'messageSlip'.
4. Include 2-3 relevant follow-up questions in 'suggestedQuestions'.
5. Set 'confidenceScore' (0-100) to how well the knowledge base covers the question; use a low score when it doesn't.`;

        const prompt = `User Name: ${leadName} (${leadCompany})
User Question: "${message}"

Answer and execute actions based on the trained knowledge base.`;

        const result = await client.models.generateContent({
          model: 'gemini-3.7-flash',
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                chatReply: {
                  type: Type.STRING,
                  description: 'Rich markdown answer formatted for chat UI.'
                },
                spokenReply: {
                  type: Type.STRING,
                  description: 'Concise spoken answer under 35 words for voice TTS.'
                },
                confidenceScore: {
                  type: Type.NUMBER,
                  description: 'Confidence percentage 50-100.'
                },
                intent: {
                  type: Type.STRING,
                  description: 'inquiry, transfer, message_taking, start_video_call, schedule_calendar_event, create_proposal, pricing, support, security, or general.'
                },
                actionType: {
                  type: Type.STRING,
                  description: 'start_video_call, schedule_calendar_event, create_proposal, transfer, message_taking, or null.'
                },
                videoCallData: {
                  type: Type.OBJECT,
                  properties: {
                    roomName: { type: Type.STRING },
                    topic: { type: Type.STRING }
                  }
                },
                calendarEventData: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    date: { type: Type.STRING },
                    time: { type: Type.STRING },
                    duration: { type: Type.NUMBER },
                    notes: { type: Type.STRING }
                  }
                },
                proposalData: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    price: { type: Type.NUMBER },
                    deliverables: { type: Type.ARRAY, items: { type: Type.STRING } }
                  }
                },
                transferDepartment: {
                  type: Type.STRING,
                  description: 'Department key if routing is relevant, otherwise null.'
                },
                isTakingMessage: {
                  type: Type.BOOLEAN
                },
                messageSlip: {
                  type: Type.OBJECT,
                  properties: {
                    recipient: { type: Type.STRING },
                    urgency: { type: Type.STRING },
                    notes: { type: Type.STRING }
                  }
                },
                matchedKnowledgeTopic: {
                  type: Type.STRING,
                  description: 'Title of the matched knowledge category or topic.'
                },
                suggestedQuestions: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                }
              },
              required: ['chatReply', 'spokenReply', 'confidenceScore', 'intent', 'suggestedQuestions']
            }
          }
        });

        const parsed = JSON.parse(result.text?.trim() || '{}');
        let executedAction: any = null;

        if (parsed.actionType === 'start_video_call' || parsed.intent === 'start_video_call') {
          executedAction = {
            type: 'video_call',
            data: executeStartVideoCall(leadName, leadCompany)
          };
        } else if (parsed.actionType === 'schedule_calendar_event' || parsed.intent === 'schedule_calendar_event') {
          const cal = parsed.calendarEventData || {};
          executedAction = {
            type: 'calendar_event',
            data: executeScheduleCalendarEvent(
              cal.title || '',
              cal.date || '',
              cal.time || '',
              cal.duration || 0,
              [],
              cal.notes || ''
            )
          };
        } else if (parsed.actionType === 'create_proposal' || parsed.intent === 'create_proposal') {
          const prop = parsed.proposalData || {};
          executedAction = {
            type: 'proposal',
            data: executeCreateProposal(
              leadCompany || leadName,
              prop.title || '',
              typeof prop.price === 'number' ? prop.price : null,
              prop.deliverables || []
            )
          };
        }

        return res.status(200).json({
          success: true,
          chatReply: String(parsed.chatReply || ''),
          spokenReply: String(parsed.spokenReply || ''),
          confidenceScore: typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : null,
          intent: parsed.intent || 'inquiry',
          actionType: parsed.actionType || (executedAction ? executedAction.type : null),
          executedAction,
          transferDepartment: parsed.transferDepartment || null,
          isTakingMessage: Boolean(parsed.isTakingMessage),
          messageSlip: parsed.messageSlip || null,
          matchedKnowledgeTopic: parsed.matchedKnowledgeTopic || null,
          suggestedQuestions: Array.isArray(parsed.suggestedQuestions) ? parsed.suggestedQuestions.slice(0, 5) : [],
          model: 'gemini-3.7-flash'
        });
      } catch (gemError) {
        return aiFailed(res, 'receptionist.chat-query', gemError);
      }
    }
    return aiUnavailable(res);
  } catch (error: any) {
    return knowledgeFail(res, error, 'receptionist.chat-query');
  }
});

/**
 * 7. AI VOICE DIALER & RECEPTIONIST CONVERSATIONAL TURN (POST)
 * Interactive conversational telephony intelligence powered by Gemini 3.7 Flash.
 * Supports both Outbound Sales Dialer and Inbound Virtual Front-Desk Receptionist.
 */
router.post('/voice-dialer/turn', requirePermission('read'), async (req: Request, res: Response) => {
  try {
    const { 
      callMode = 'receptionist', // 'receptionist' | 'dialer'
      leadName = 'Caller',
      leadCompany = '',
      leadDealValue = '',
      leadStage = '',
      agentPersona = '',
      userMessage = '',
      conversationHistory = [],
      callGoal = 'Greet callers, answer from the knowledge base, suggest actions and route to the right department'
    } = req.body || {};

    if (typeof userMessage !== 'string' || !userMessage.trim() || userMessage.length > 4000) {
      return res.status(400).json({ success: false, error: 'userMessage is required (max 4,000 characters).' });
    }

    const orgId = tenantOf(req).orgId;
    const company = await orgName(orgId);
    const store = await loadKnowledge(orgId);
    const dynamicKnowledge = buildKnowledgeContext(store, company);
    const persona = String(agentPersona || store.profile.agentName || 'the AI receptionist').slice(0, 120);

    const key = process.env.GEMINI_API_KEY;
    const hasApiKey = key && !key.includes('placeholder') && !key.includes('YOUR_GEMINI_API_KEY');

    if (hasApiKey) {
      try {
        const client = getGeminiClient();
        if (!client) throw new Error('Gemini client unavailable');

        const systemInstruction = `You are ${persona}, the AI voice receptionist at ${store.profile.companyName || company}.
Caller Name: ${leadName}${leadCompany ? ` from ${leadCompany}` : ''}.
${leadStage || leadDealValue ? `Context / Deal Stage: ${leadStage} ${leadDealValue}` : ''}
Operational Goal: ${callGoal}.

${dynamicKnowledge}

UNIFIED VOICE AGENT & SPOKEN TELEPHONY RULES:
1. Speak naturally and warmly on the phone. Keep replies to 1-3 short spoken sentences (under 35 words total).
2. NEVER output markdown, bullet points, asterisks, headers, citations, emojis, or code syntax because your output is fed directly into a Text-To-Speech (TTS) synthesizer.
3. You are an all-in-one unified agent: you expertly handle front-desk reception, sales qualification, billing inquiries, technical architecture, schedule bookings, and company routing.
4. ACTION EXECUTION & TOOL TRIGGERING:
   - You cannot create, book or send anything. If the caller wants a video call, meeting or proposal, say a team member will follow up, set 'actionType' ('start_video_call', 'schedule_calendar_event' or 'create_proposal') and include only the details the caller gave.
5. If caller asks to speak to or be transferred to a specific department or teammate:
   - Only offer departments listed in the knowledge base. Acknowledge warmly and say you'll pass the call or message on.
   - Set 'transferDepartment' to the department key ('sales', 'support', 'billing', 'exec', 'partnerships').
6. If the person they want is unavailable or they want to leave a message:
   - Offer to take down their message or schedule a callback. Collect their return contact number, name, and notes.
   - Set 'isTakingMessage' to true and fill 'messageSlip'.
7. Evaluate caller sentiment (positive, neutral, skeptical, enthusiastic, urgent), intent, lead qualification score (0-100), and next action item.`;

        // Format history
        const formattedHistory = conversationHistory.slice(-8).map((h: any) => 
          `${h.sender === 'user' || h.sender === 'lead' ? leadName : 'Receptionist'}: "${h.text}"`
        ).join('\n');

        const prompt = `Caller: ${leadName} (${leadCompany})
Current Call Mode: ${callMode}
Call History:
${formattedHistory ? formattedHistory + '\n' : ''}
Latest Spoken Statement from ${leadName}:
"${userMessage}"

Respond naturally for the phone call using your trained knowledge base and output structured receptionist intelligence with action triggers.`;

        const result = await client.models.generateContent({
          model: 'gemini-3.7-flash',
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                replyText: {
                  type: Type.STRING,
                  description: 'The spoken response to read out over the phone, max 3 conversational sentences.'
                },
                sentiment: {
                  type: Type.STRING,
                  description: 'Caller sentiment: positive, neutral, skeptical, enthusiastic, or urgent.'
                },
                intent: {
                  type: Type.STRING,
                  description: 'Primary caller intent: routing, transfer, inquiry, booking, start_video_call, schedule_calendar_event, create_proposal, message_taking, billing, support, or objection.'
                },
                actionType: {
                  type: Type.STRING,
                  description: 'start_video_call, schedule_calendar_event, create_proposal, transfer, message_taking, or null.'
                },
                videoCallData: {
                  type: Type.OBJECT,
                  properties: {
                    roomName: { type: Type.STRING },
                    topic: { type: Type.STRING }
                  }
                },
                calendarEventData: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    date: { type: Type.STRING },
                    time: { type: Type.STRING },
                    duration: { type: Type.NUMBER },
                    notes: { type: Type.STRING }
                  }
                },
                proposalData: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    price: { type: Type.NUMBER },
                    deliverables: { type: Type.ARRAY, items: { type: Type.STRING } }
                  }
                },
                transferDepartment: {
                  type: Type.STRING,
                  description: 'Department key to transfer to if requested: sales, support, billing, exec, partnerships, or null.'
                },
                isTakingMessage: {
                  type: Type.BOOLEAN,
                  description: 'True if the caller is leaving a voicemail or message slip.'
                },
                messageSlip: {
                  type: Type.OBJECT,
                  properties: {
                    recipient: { type: Type.STRING },
                    urgency: { type: Type.STRING },
                    notes: { type: Type.STRING },
                    callbackNumber: { type: Type.STRING }
                  }
                },
                actionItem: {
                  type: Type.STRING,
                  description: 'Identified immediate action item or null.'
                },
                qualificationScore: {
                  type: Type.NUMBER,
                  description: 'Calculated lead/urgency score from 1 to 100.'
                },
                keyTakeaway: {
                  type: Type.STRING,
                  description: 'Short 1-sentence takeaway for CRM receptionist logs.'
                }
              },
              required: ['replyText', 'sentiment', 'intent', 'qualificationScore']
            }
          }
        });

        const raw = result.text?.trim() || '{}';
        const parsed = JSON.parse(raw);

        let executedAction: any = null;
        if (parsed.actionType === 'start_video_call' || parsed.intent === 'start_video_call') {
          executedAction = {
            type: 'video_call',
            data: executeStartVideoCall(leadName, leadCompany)
          };
        } else if (parsed.actionType === 'schedule_calendar_event' || parsed.intent === 'schedule_calendar_event') {
          const cal = parsed.calendarEventData || {};
          executedAction = {
            type: 'calendar_event',
            data: executeScheduleCalendarEvent(
              cal.title || '',
              cal.date || '',
              cal.time || '',
              cal.duration || 0,
              [],
              cal.notes || ''
            )
          };
        } else if (parsed.actionType === 'create_proposal' || parsed.intent === 'create_proposal') {
          const prop = parsed.proposalData || {};
          executedAction = {
            type: 'proposal',
            data: executeCreateProposal(
              leadCompany || leadName,
              prop.title || '',
              typeof prop.price === 'number' ? prop.price : null,
              prop.deliverables || []
            )
          };
        }

        return res.status(200).json({
          success: true,
          replyText: String(parsed.replyText || ''),
          sentiment: parsed.sentiment || null,
          intent: parsed.intent || (callMode === 'receptionist' ? 'routing' : 'general'),
          actionType: parsed.actionType || (executedAction ? executedAction.type : null),
          executedAction,
          transferDepartment: parsed.transferDepartment || null,
          isTakingMessage: Boolean(parsed.isTakingMessage),
          messageSlip: parsed.messageSlip || null,
          actionItem: parsed.actionItem || (executedAction ? `Suggested: ${executedAction.type} (needs a team member)` : null),
          qualificationScore: typeof parsed.qualificationScore === 'number' ? parsed.qualificationScore : null,
          keyTakeaway: parsed.keyTakeaway || null,
          model: 'gemini-3.7-flash'
        });
      } catch (geminiError) {
        return aiFailed(res, 'voice-dialer.turn', geminiError);
      }
    }
    return aiUnavailable(res);
  } catch (error: any) {
    return knowledgeFail(res, error, 'voice-dialer.turn');
  }
});

/**
 * 8. AI VOICE DIALER POST-CALL SUMMARY & CRM REPORT GENERATOR (POST)
 */
router.post('/voice-dialer/summary', requirePermission('read'), async (req: Request, res: Response) => {
  try {
    const {
      leadName = 'Caller',
      leadPhone = '',
      leadCompany = '',
      leadDealValue = '',
      durationSeconds = 0,
      transcripts = []
    } = req.body || {};
    if (!Array.isArray(transcripts) || transcripts.length === 0) {
      return res.status(400).json({ success: false, code: 'no_transcript', error: 'There is no transcript to summarize.' });
    }

    const transcriptText = transcripts.map((t: any) => 
      `[${t.sender === 'user' || t.sender === 'lead' ? leadName : 'AI Agent'}]: ${t.text}`
    ).join('\n');

    const key = process.env.GEMINI_API_KEY;
    const hasApiKey = key && !key.includes('placeholder') && !key.includes('YOUR_GEMINI_API_KEY');

    if (hasApiKey && transcripts.length > 0) {
      try {
        const client = getGeminiClient();
        const systemInstruction = `You are a CRM analyst. Use only what is in the transcript; never invent facts, owners or commitments.
Analyze the following recorded phone call transcript between an AI voice agent and ${leadName} from ${leadCompany}.
Generate a comprehensive, actionable Post-Call CRM Intelligence Briefing in structured JSON.`;

        const prompt = `Lead Name: ${leadName}
Company: ${leadCompany}
Phone: ${leadPhone}
Deal Value: ${leadDealValue}
Call Duration: ${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s

Call Transcript:
${transcriptText}

Generate the post-call summary and next action items.`;

        const result = await client.models.generateContent({
          model: 'gemini-3.7-flash',
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                executiveSummary: {
                  type: Type.STRING,
                  description: '2-3 sentence executive briefing of the call conversation.'
                },
                sentimentScore: {
                  type: Type.STRING,
                  description: 'Strongly Positive, Positive, Neutral, or Skeptical.'
                },
                leadQuality: {
                  type: Type.STRING,
                  description: 'High Priority, Warm Nurture, or Low Priority.'
                },
                keyTopicsDiscussed: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: '3-5 key topics covered during the call.'
                },
                actionItems: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: 'Immediate action items with assigned owners.'
                },
                suggestedNextStep: {
                  type: Type.STRING,
                  description: 'Recommended next touchpoint.'
                },
                crmNote: {
                  type: Type.STRING,
                  description: 'Formatted multi-line CRM note ready to append to customer timeline.'
                }
              },
              required: ['executiveSummary', 'sentimentScore', 'leadQuality', 'keyTopicsDiscussed', 'actionItems', 'suggestedNextStep', 'crmNote']
            }
          }
        });

        const raw = result.text?.trim() || '{}';
        const parsed = JSON.parse(raw);

        return res.status(200).json({
          success: true,
          summary: parsed,
          model: 'gemini-3.7-flash'
        });
      } catch (err) {
        return aiFailed(res, 'voice-dialer.summary', err);
      }
    }
    return aiUnavailable(res);
  } catch (error: any) {
    sendError(res, error, 'voice-dialer.summary');
  }
});

/**
 * POST /trigger-outbound
 * LiveKit Outbound SIP Telephony Trigger
 * Executes createSipParticipant to call a phone number and assign the participant directly to an active voice agent room.
 */
router.post('/trigger-outbound', (_req: Request, res: Response) => {
  // The LiveKit outbound SIP worker isn't part of this build (livekit-server-sdk isn't installed), so say so
  // instead of failing with a module error. Wire it up with the video/telephony provider work.
  res.status(501).json({ success: false, code: 'not_available', error: 'Outbound calling through LiveKit isn’t set up on this server.' });
});

export default router;
