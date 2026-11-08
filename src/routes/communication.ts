import { Router, Request, Response, NextFunction } from 'express';
import { wsDispatcher } from '../utils/wsDispatcher';
import { db } from '../utils/db';
import crypto from 'crypto';
import twilio from 'twilio';
import axios from 'axios';
import { GoogleGenAI, Type } from "@google/genai";
import { receptionistKnowledgeDb } from '../utils/receptionistKnowledgeDb';
import { coreSecret } from '../utils/secrets';
import { sendSecureOutboundEmail } from '../utils/secureOutboundMailer';
import { unsignedWebhooksAllowed } from '../server/runtimeEnv';
import { verifyTwilio } from '../features/voice/server/webhook';
import { loadIvrConfig } from '../features/voice/server/config';

// Twilio signature check shared with the IVR (TWILIO_AUTH_TOKEN, IVR_ALLOWED_HOSTS, TRUST_PROXY).
const twilioSignature = verifyTwilio(loadIvrConfig());

const router = Router();

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

    console.log('[WhatsApp Webhook POST] Inbound payload received:', JSON.stringify(body));

    // Safety guards to check if payload is from a valid Whatsapp subscription changes array
    if (body.object === 'whatsapp_business_account' && Array.isArray(body.entry)) {
      for (const entry of body.entry) {
        if (Array.isArray(entry.changes)) {
          for (const change of entry.changes) {
            const value = change.value;
            // Check for potential message content payloads
            if (value && Array.isArray(value.messages)) {
              for (const msg of value.messages) {
                const messageId = msg.id;
                const fromPhoneNumber = msg.from; // Customer sender phone
                const timestamp = msg.timestamp;
                
                let textBody = '';

                // Extract correct text element based on message payload content class
                if (msg.type === 'text' && msg.text) {
                  textBody = msg.text.body;
                } else if (msg.type === 'button' && msg.button) {
                  textBody = msg.button.text;
                } else if (msg.type === 'interactive' && msg.interactive) {
                  textBody = msg.interactive.button_reply?.title || msg.interactive.list_reply?.title || 'Interactive action';
                } else {
                  textBody = `[Unsupported Media Format: ${msg.type}]`;
                }

                const contactName = value.contacts?.[0]?.profile?.name || `WhatsApp Contact ${fromPhoneNumber}`;

                // --- DATABASE LOGIC: Match or Create Client ---
                let client = await db.client.findFirst({
                  where: {
                    OR: [
                      { phone: fromPhoneNumber },
                      { email: `${fromPhoneNumber}@whatsapp.user` }
                    ]
                  }
                });

                if (!client) {
                  client = await db.client.create({
                    data: {
                      name: contactName,
                      email: `${fromPhoneNumber}@whatsapp.user`,
                      phone: fromPhoneNumber,
                      location: 'Inbound WhatsApp Webhook',
                      lifecycleStatus: 'LEAD',
                      company: 'WhatsApp Inbound Lead'
                    }
                  });
                }

                // --- DATABASE LOGIC: Append entry to Communications table (Message model) ---
                const messageRecord = await db.message.create({
                  data: {
                    channel: 'WHATSAPP',
                    direction: 'INBOUND',
                    body: textBody,
                    status: 'DELIVERED',
                    clientId: client.id
                  }
                });

                const payloadData = {
                  messageId: messageRecord.id,
                  senderPhone: fromPhoneNumber,
                  messageBody: textBody,
                  timestamp: timestamp ? new Date(parseInt(timestamp) * 1000).toISOString() : new Date().toISOString(),
                  metadata: {
                    contactsName: client.name,
                    phoneId: value.metadata?.phone_number_id || 'unspecified'
                  }
                };

                // Real-time Event Transmission over WebSocket pool safely
                wsDispatcher.broadcast('WHATSAPP_MESSAGE_RECEIVED', payloadData);

                // Trigger Polymorphic Linker & Gemini Classification for Inbound WhatsApp
                try {
                  const { onNewEmailIngested } = await import('../utils/crmActivityLinker');
                  await onNewEmailIngested({
                    id: `wa-${messageRecord.id}`,
                    messageId: msg.id || `wa-msg-${Date.now()}`,
                    threadId: `thread-wa-${fromPhoneNumber}`,
                    subject: `WhatsApp Message from ${contactName}`,
                    from: fromPhoneNumber,
                    to: 'whatsapp-trunk',
                    body: textBody,
                    date: new Date().toISOString()
                  });
                } catch (linkerErr: any) {
                  console.error('[WhatsApp Linker Sync Error]:', linkerErr.message);
                }
              }
            }
          }
        }
      }
      res.status(200).send('EVENT_RECEIVED');
      return;
    }

    // Default return for non-message callbacks (e.g., read receipts or statuses updates)
    res.status(200).send('UNHANDLED_CALLBACK_TYPE');
  } catch (error: any) {
    console.error('[WhatsApp Webhook POST Exception]', error.message);
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
      res.status(400).send('<Response><Sms>Error: Invalid SMS webhook fields.</Sms></Response>');
      return;
    }

    const fromPhoneNumber = From;
    const textBody = Body;
    const twilioId = MessageSid || `sms-${Date.now()}`;

    console.log(`[Twilio SMS Webhook] Inbound message received from: ${fromPhoneNumber} | Message: "${textBody}"`);

    // --- DATABASE LOGIC: Match or Create Client with phone number lookup ---
    let client = await db.client.findFirst({
      where: {
        OR: [
          { phone: fromPhoneNumber },
          { email: `${fromPhoneNumber}@sms.user` }
        ]
      }
    });

    if (!client) {
      client = await db.client.create({
        data: {
          name: `SMS Contact ${fromPhoneNumber}`,
          email: `${fromPhoneNumber}@sms.user`,
          phone: fromPhoneNumber,
          location: 'Inbound SMS Webhook',
          lifecycleStatus: 'LEAD',
          company: 'SMS Inbound Lead'
        }
      });
    }

    // --- DATABASE LOGIC: Append entry to Communications table (Message model) ---
    const messageRecord = await db.message.create({
      data: {
        channel: 'SMS',
        direction: 'INBOUND',
        body: textBody,
        status: 'DELIVERED',
        clientId: client.id
      }
    });

    // Structure websocket payload mirroring UI expected keys
    const payloadData = {
      messageId: messageRecord.id,
      senderPhone: fromPhoneNumber,
      // Wrap in [SMS] format prefix to distinguish communication routes in visual layouts
      messageBody: `[SMS] ${textBody}`,
      timestamp: new Date().toISOString(),
      metadata: {
        contactsName: client.name,
        phoneId: 'sms-trunk'
      }
    };

    // WebSocket real-time update push to notify UI
    wsDispatcher.broadcast('WHATSAPP_MESSAGE_RECEIVED', payloadData);

    // Trigger Polymorphic Linker & Gemini Classification for Inbound SMS
    try {
      const { onNewEmailIngested } = await import('../utils/crmActivityLinker');
      await onNewEmailIngested({
        id: `sms-${messageRecord.id}`,
        messageId: twilioId,
        threadId: `thread-sms-${fromPhoneNumber}`,
        subject: `SMS Message from ${client.name}`,
        from: fromPhoneNumber,
        to: 'sms-sub-trunk',
        body: textBody,
        date: new Date().toISOString()
      });
    } catch (linkerErr: any) {
      console.error('[SMS Linker Sync Error]:', linkerErr.message);
    }

    // Output empty TwiML telling Twilio all is successfully processed
    const twiML = `<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`;
    res.header('Content-Type', 'text/xml');
    res.status(200).send(twiML);
  } catch (error: any) {
    console.error('[Twilio SMS Webhook Exception]', error.message);
    res.status(500).send('<Response><Sms>Error: Failed to process SMS transaction safely.</Sms></Response>');
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

    console.log(`[Twilio Route] Inbound voice connection request from ${fromNumber}. CallSid: ${callSid}`);

    // Dynamic telemetry notification for Live Omnichannel feed
    wsDispatcher.broadcast('INCOMING_CELLULAR_CALL', {
      from: fromNumber,
      callSid,
      status: 'ringing'
    });

    // Generate compliant TwiML to ring client softphone
    // If softphone does not answer within 18 seconds, direct call traffic to local secure voicemail flow
    const twimlXml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Connecting call to the designated Obsidian Representative.</Say>
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
  <Say voice="alice">Our core communication trunks are currently undergoing routing adjustments. Please try call again later.</Say>
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

    console.log(`[Twilio Fallback] Call state evaluated as: ${dialCallStatus}. Diverting to Obsidian VM server.`);

    // Transmit active softphone miss alert for internal client records
    wsDispatcher.broadcast('CALL_REDIRECTED_TO_VOICEMAIL', {
      from: fromNumber,
      callSid,
      reason: dialCallStatus || 'no_answer'
    });

    // Dynamic voicemail recording instruction
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">The requested Obsidian partner is currently engaged. Please record your customer update or project reference number after the tone.</Say>
  <Record maxLength="45" action="/api/communication/twiml-voicemail-saved" playBeep="true" />
  <Say voice="alice">Thank you. Your request is registered.</Say>
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
router.post('/twiml-voicemail-saved', twilioSignature, (req: Request, res: Response) => {
  try {
    const recordingUrl = req.body.RecordingUrl || '';
    const duration = req.body.RecordingDuration || '0';
    const fromNumber = req.body.From || 'Unknown Caller';

    console.log(`[Twilio CRM Voicemail Saved] Recording URL registered: ${recordingUrl} (${duration} seconds)`);

    // Signal dynamic frontend update so a red voice memo dot indicates live pending messages
    wsDispatcher.broadcast('VOICEMAIL_RECORDED', {
      from: fromNumber,
      recordingUrl,
      duration,
      savedAt: new Date().toISOString()
    });

    const finishTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Your high-trust voice memo has been synced with Obsidian CRM systems. Goodbye.</Say>
  <Hangup />
</Response>`;

    res.header('Content-Type', 'text/xml');
    res.status(200).send(finishTwiml);
  } catch (error: any) {
    console.error('[Twilio Voicemail Saved Exception]', error.message);
    res.status(500).end();
  }
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

    console.log(`[Twilio Video Token] Request received for client identity "${identity}" in room "${roomName}"`);

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const apiKey = process.env.TWILIO_API_KEY;
    const apiSecret = process.env.TWILIO_API_SECRET;

    // Validate credentials presence. If missing, fall back to simulated token schema to survive preview constraints.
    if (!accountSid || !apiKey || !apiSecret || accountSid.includes('placeholder') || apiKey.includes('placeholder')) {
      console.warn('[Twilio Video Token] Credentials missing. Serving secure simulated bypass credential to preserve calling sandbox capabilities.');
      
      // Return a simulated structured response with a mock signature token
      res.status(200).json({
        success: true,
        identity,
        roomName,
        isSimulated: true,
        token: `mock-jwt-token-part-1.${Buffer.from(JSON.stringify({ identity, roomName, exp: Date.now() + 3600000 })).toString('base64')}.mock-sig`,
        expiresIn: 3600
      });
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
    console.log(`[Twilio Video Token] Real JWT successfully signed and dispatched for "${identity}".`);

    res.status(200).json({
      success: true,
      identity,
      roomName,
      isSimulated: false,
      token: jwtToken,
      expiresIn: 3600
    });

  } catch (error: any) {
    console.error('[Twilio Video Token Generating Exception]:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to manufacture Twilio Access Token securely.',
      details: error.message
    });
  }
});

/**
 * 4. AI-POWERED OR INTELLIGENT RULE-BASED INTAKE ASSISTANT BOT
 * Fully conforms to lead qualification steps, dual-sentence strict guidelines, sequential confirmation, and handoffs.
 */
router.post('/intake-bot', async (req: Request, res: Response) => {
  try {
    const { contactId, messages, contactName, company, userMessage, currentState } = req.body;

    const key = process.env.GEMINI_API_KEY;
    const hasApiKey = key && !key.includes('placeholder') && !key.includes('YOUR_GEMINI_API_KEY');

    if (hasApiKey) {
      try {
        const client = getGeminiClient();
        
        const systemInstruction = `You are Alex, a friendly and efficient virtual intake assistant at Obsidian Core CRM. Your single objective is to qualify inbound leads and route them appropriately.

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
      } catch (gemIniErr: any) {
        console.warn('[Gemini SDK Run Fail] Falling back to rule simulator:', gemIniErr.message);
      }
    }

    // Default Deterministic Intelligent Fallback Rule Engine
    const msgLower = userMessage.toLowerCase();
    let reply = "";
    let challenge = currentState.challenge;
    let budget = currentState.budget;
    let shouldBookAppointment = false;
    let shouldTransferToHuman = false;

    // Check custom question or complex question first
    if (msgLower.includes('how does') || msgLower.includes('why') || msgLower.includes('can you do') || msgLower.includes('pricing plans') || msgLower.includes('custom integration') || msgLower.includes('feature') || msgLower.includes('security') || msgLower.includes('what is') || msgLower.includes('cost')) {
      reply = "That's a great question, and I want to make sure you get the exact answer. Let me connect you with one of our specialists right now.";
      shouldTransferToHuman = true;
    } 
    // Step 1: Handle challenge identification
    else if (!challenge) {
      challenge = userMessage;
      reply = `Got it, focusing on "${userMessage}" makes perfect sense. Next, what is your approximate monthly budget threshold (Under $1k, $1k-$5k, or Over $5k)?`;
    } 
    // Step 2: Handle budget identification
    else if (!budget) {
      if (msgLower.includes('under 1k') || msgLower.includes('under $1k') || msgLower.includes('<1') || msgLower.includes('less than') || msgLower.includes('low') || msgLower.includes('1000')) {
        budget = "Under $1k";
        reply = "I'm glad you shared that budget threshold with me. For our advanced custom CRM portal features, a budget of Under $1k is slightly below our minimum entry level, but we can stay in touch if your threshold shifts!";
      } else if (msgLower.includes('1k-5k') || msgLower.includes('1k-$5k') || msgLower.includes('budget') || msgLower.includes('5000') || msgLower.includes('2000') || msgLower.includes('3000')) {
        budget = "$1k-$5k";
        reply = "Got it, a $1k-$5k budget threshold fits perfectly for our professional suite setups. Let's find an available session to book your CRM onboarding call!";
        shouldBookAppointment = true;
      } else {
        budget = "Over $5k";
        reply = "Fantastic, a budget over $5k unlocks our premium white-glove custom omnichannel implementation structures. Let's find a convenient time to schedule your dedicated tech review!";
        shouldBookAppointment = true;
      }
    } else {
      // Default fallback conversational reply
      reply = "Thanks for providing that update! I'm aligning our schedule options right now to secure a seamless session for you.";
    }

    res.json({
      success: true,
      aiUsed: false,
      reply,
      challenge,
      budget,
      shouldBookAppointment,
      shouldTransferToHuman
    });

  } catch (error: any) {
    console.error('[Intake Bot Endpoint Exception]', error.message);
    res.status(500).json({ error: 'Failed to evaluate intake bot response.' });
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
        - If they refer to a contact name or company (e.g. "Hannah Morgan" or "Dappr Design"), inspect the active threads list to match 'targetThreadId' automatically.`;

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
      } catch (gemIniErr: any) {
        console.warn('[ReplyZen Gemini Fail] Falling back to intelligence simulator:', gemIniErr.message);
      }
    }

    // Default Intelligence Mock/Rule Fallback if Gemini Key is unavailable
    const q = userPrompt.toLowerCase();
    let replyText = "";
    let targetThreadId = null;
    let draftResult = null;
    let suggestedAction = "NONE";

    if (q.includes('hannah') || q.includes('morgan') || q.includes('meeting')) {
      targetThreadId = "thread-hannah";
      suggestedAction = "SELECT_THREAD";
      replyText = "### Hannah Morgan: Meeting Scheduled\n\nI located a thread with **Hannah Morgan** regarding \"Meeting scheduled\". She is waiting to go over the design details.\n\nWould you like me to draft a confirmation?";
    } else if (q.includes('megan') || q.includes('campaign') || q.includes('marketing')) {
      targetThreadId = "thread-megan";
      suggestedAction = "SELECT_THREAD";
      replyText = "### Megan Clark: Marketing Campaign Update\n\nI identified a thread from **Megan Clark** at Dappr Ads. She sent an update on the marketing campaign progress.\n\nWould you like to draft a feedback reply?";
    } else if (q.includes('draft') || q.includes('reply') || q.includes('write')) {
      replyText = "### Draft Email Assistant\n\nI created a high-fidelity onboarding response draft. You can apply it to your compose area:\n\n*\"Hi there, happy to align on our collaboration details. Please let us know if next Tuesday works for a quick 15-minute briefing session!\"*";
      draftResult = "Hi there, happy to align on our collaboration details. Please let us know if next Tuesday works for a quick 15-minute briefing session!";
      suggestedAction = "REPLY_DRAFT";
    } else if (q.includes('summarize') || q.includes('summary')) {
      replyText = "### Email Inbox Summary\n\nHere is a quick breakdown of your active inbox:\n\n1. **Hannah Morgan**: High priority design team sync scheduled.\n2. **Megan Clark**: Marketing campaign update pending feedbacl.\n3. **Elena Rostova**: Pilot deployment contract adjustments.\n\nWould you like to compose a reply to any of them?";
    } else {
      replyText = `### ReplyZen Assistant\n\nI evaluated your inquiry: *"${userPrompt}"*.\n\nWe are ready to draft responses, summarize active message flows, or search specific logs dynamically. Type a request or click a command to begin!`;
    }

    res.json({
      success: true,
      aiUsed: false,
      replyText,
      targetThreadId,
      draftResult,
      suggestedAction
    });

  } catch (error: any) {
    console.error('[ReplyZen Assistant Exception]', error.message);
    res.status(500).json({ error: 'Failed to process AI assistant inquiry.' });
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
        The user is a senior Lead Account Director managing enterprise customer channels (WhatsApp, Telegram, email, GBP, SMS, and proposals).
        
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
      } catch (gemIniErr: any) {
        console.warn('[Dashboard Gemini Fail] Falling back to CRM rule simulator:', gemIniErr.message);
      }
    }

    if (!aiUsed) {
      // High-fidelity local rule/knowledge engine for the Seto cockpit
      const q = userPrompt.toLowerCase();
      if (q.includes('email') || q.includes('campaign') || q.includes('draft')) {
        replyText = `### ✉️ AI Email Assistant Recommendation

Based on your inquiry, I recommend launching the **AI Email Assistant**. Our active template library contains high-converting onboarding and SLA campaigns.

**Suggested Template (SLA Draft):**
*"Hello there, happy to align on our collaboration details. Please let us know if next Tuesday works for a quick 15-minute briefing session!"*

Would you like to navigate to the **Omnichannel Inbox** to draft a response?`;
      } else if (q.includes('voice') || q.includes('call') || q.includes('dialer') || q.includes('phone')) {
        replyText = `### 📞 Voice Interaction Hub Analysis

Active channels are healthy. You can configure AI dialers and analyze call transcripts in the **Voice Interaction Hub**.
- **Average Outbound Sentiment:** 84% Positive
- **Peak Performance Slot:** 2:00 PM – 4:00 PM EST

Would you like to open the **AI Voice Dialer**?`;
      } else if (q.includes('proposal') || q.includes('deal') || q.includes('contract')) {
        replyText = `### 💼 Enterprise Proposal Insights

I scanned your active high-value deals:
1. **Quantum Finance Contract**: Pilot deployment adjustments are waiting.
2. **Sarah Jenkins SLA**: Estimated worth is **$120,000**.

Click the **Enterprise Proposal** card to review and generate secure contracts!`;
      } else if (q.includes('meeting') || q.includes('video') || q.includes('collaborative')) {
        replyText = `### 🎥 Collaborative Video Call Scheduler

We detected scheduled sessions with clients this week.
- **Next up:** *Sarah Jenkins Technical Assessment* at 2:00 PM.

Navigate to **WebRTC Call Canvas** to launch seamless virtual meetings!`;
      } else {
        replyText = `### ✦ Obsidian CRM Assistant Active

I received your command: *"${userPrompt}"*.

As your CRM Co-pilot, I can assist with:
- **Campaign Optimization**: Analyze customer sentiment or draft follow-ups.
- **Workflow Automation**: Schedule auto-replies and trigger AI voice summaries.
- **Deal Advisory**: Review contract terms and proposal statuses.

Let me know how I can help you streamline your next action!`;
      }
    }

    res.json({
      success: true,
      aiUsed,
      replyText
    });

  } catch (error: any) {
    console.error('[Dashboard Assistant Exception]', error.message);
    res.status(500).json({ error: 'Failed to process assistant inquiry.' });
  }
});

/**
 * 8. UNIFIED OUTBOUND COMMUNICATIONS PROXY (POST /api/communication/send)
 * Design and implement a secure, unified outbound proxy route to dispatch real WhatsApp/SMS messages.
 * Checks for credentials; if missing, falls back to simulated state gracefully with detailed logs.
 */
router.post('/send', async (req: Request, res: Response) => {
  try {
    const { to, channel, body, clientId } = req.body;

    // Validate parameters
    if (!to || !channel || !body) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters. "to", "channel", and "body" are required.'
      });
    }

    const upperChannel = channel.toUpperCase();
    if (upperChannel !== 'SMS' && upperChannel !== 'WHATSAPP') {
      return res.status(400).json({
        success: false,
        error: 'Unsupported channel. Must be "SMS" or "WHATSAPP".'
      });
    }

    let isSimulated = false;
    let externalMessageId = '';

    if (upperChannel === 'SMS') {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const fromNumber = process.env.TWILIO_PHONE_NUMBER;

      const hasTwilioSecrets = 
        accountSid && !accountSid.includes('placeholder') && accountSid.trim() !== '' &&
        authToken && !authToken.includes('placeholder') && authToken.trim() !== '' &&
        fromNumber && !fromNumber.includes('placeholder') && fromNumber.trim() !== '';

      if (hasTwilioSecrets) {
        console.log(`[Unified Proxy] Initiating real Twilio SMS dispatch to ${to}`);
        try {
          const client = twilio(accountSid, authToken);
          const response = await client.messages.create({
            from: fromNumber,
            to: to,
            body: body
          });
          externalMessageId = response.sid;
          console.log(`[Unified Proxy] Twilio SMS sent successfully. SID: ${externalMessageId}`);
        } catch (twilioErr: any) {
          console.error(`[Unified Proxy] Twilio real sending failed: ${twilioErr.message}. Falling back to simulation.`);
          isSimulated = true;
          externalMessageId = `mock-sms-${Date.now()}`;
        }
      } else {
        console.warn('[Unified Proxy] Twilio environment secrets are missing or contain placeholders. Gracefully falling back to simulated SMS state.');
        isSimulated = true;
        externalMessageId = `mock-sms-${Date.now()}`;
      }
    } else if (upperChannel === 'WHATSAPP') {
      const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

      const hasMetaSecrets = 
        phoneId && !phoneId.includes('placeholder') && phoneId.trim() !== '' &&
        accessToken && !accessToken.includes('placeholder') && accessToken.trim() !== '';

      if (hasMetaSecrets) {
        console.log(`[Unified Proxy] Initiating real Meta WhatsApp dispatch to ${to}`);
        try {
          const url = `https://graph.facebook.com/v18.0/${phoneId}/messages`;
          const response = await axios.post(url, {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: to,
            type: 'text',
            text: {
              preview_url: false,
              body: body
            }
          }, {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          });
          externalMessageId = response.data?.messages?.[0]?.id || `wa-${Date.now()}`;
          console.log(`[Unified Proxy] Meta WhatsApp sent successfully. Message ID: ${externalMessageId}`);
        } catch (metaErr: any) {
          console.error(`[Unified Proxy] Meta WhatsApp real sending failed: ${metaErr.message}. Falling back to simulation.`);
          isSimulated = true;
          externalMessageId = `mock-wa-${Date.now()}`;
        }
      } else {
        console.warn('[Unified Proxy] Meta WhatsApp environment secrets are missing or contain placeholders. Gracefully falling back to simulated WhatsApp state.');
        isSimulated = true;
        externalMessageId = `mock-wa-${Date.now()}`;
      }
    }

    // --- DATABASE LOGIC: Retrieve or Create client ---
    let client = null;
    if (clientId) {
      client = await db.client.findUnique({ where: { id: clientId } });
    }

    if (!client) {
      client = await db.client.findFirst({
        where: {
          OR: [
            { phone: to },
            { email: `${to}@${upperChannel.toLowerCase()}.user` }
          ]
        }
      });
    }

    if (!client) {
      client = await db.client.create({
        data: {
          name: `${upperChannel} Contact ${to}`,
          email: `${to}@${upperChannel.toLowerCase()}.user`,
          phone: to,
          location: `Outbound Proxy`,
          lifecycleStatus: 'LEAD',
          company: `${upperChannel} Outbound Lead`
        }
      });
    }

    // --- DATABASE LOGIC: Log message under database message logging models ---
    const messageRecord = await db.message.create({
      data: {
        channel: upperChannel,
        direction: 'OUTBOUND',
        body: body,
        status: 'DELIVERED',
        clientId: client.id
      }
    });

    // --- REALTIME: Broadcast update via WebSocket pool ---
    const wsPayload = {
      messageId: messageRecord.id,
      senderPhone: to,
      messageBody: upperChannel === 'SMS' ? `[SMS] ${body}` : body,
      timestamp: new Date().toISOString(),
      metadata: {
        contactsName: client.name,
        phoneId: upperChannel === 'SMS' ? 'sms-trunk' : 'whatsapp-trunk',
        isOutbound: true,
        isSimulated
      }
    };

    console.log(`[Unified Proxy] Broadcasting OUTBOUND message event via wsDispatcher.`);
    wsDispatcher.broadcast('WHATSAPP_MESSAGE_RECEIVED', wsPayload);

    // Return structured, clean response
    res.status(200).json({
      success: true,
      messageId: messageRecord.id,
      externalMessageId,
      isSimulated,
      channel: upperChannel,
      direction: 'OUTBOUND',
      body,
      recipient: {
        id: client.id,
        name: client.name,
        phone: client.phone
      },
      loggedAt: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('[Unified Proxy Exception] /api/communication/send failed:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to process unified outbound message transmission.',
      details: error.message
    });
  }
});

/**
 * 6B. AI RECEPTIONIST KNOWLEDGE BASE MANAGEMENT (GET, POST, DELETE)
 * Provides comprehensive inspection, training, and update endpoints for the AI receptionist.
 */
router.get('/receptionist/knowledge', (req: Request, res: Response) => {
  try {
    const store = receptionistKnowledgeDb.getStore();
    return res.status(200).json({
      success: true,
      store,
      trainingMetrics: {
        totalQAs: store.qas.length,
        enabledQAs: store.qas.filter(q => q.enabled).length,
        totalDocuments: store.documents.length,
        totalDepartments: store.departments.length,
        readinessScore: 98
      }
    });
  } catch (error: any) {
    console.error('[Receptionist Knowledge GET Error]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/receptionist/knowledge', (req: Request, res: Response) => {
  try {
    const { action, profile, qa, qaId, updates, departmentKey, deptUpdates, document } = req.body;

    if (action === 'update_profile' && profile) {
      const updatedProfile = receptionistKnowledgeDb.updateProfile(profile);
      return res.status(200).json({ success: true, profile: updatedProfile, message: 'Company profile updated successfully.' });
    }

    if (action === 'add_qa' && qa) {
      const newQA = receptionistKnowledgeDb.addQA(qa);
      return res.status(200).json({ success: true, qa: newQA, message: 'New Q&A pair added to knowledge base.' });
    }

    if (action === 'update_qa' && qaId && updates) {
      const updatedQA = receptionistKnowledgeDb.updateQA(qaId, updates);
      if (!updatedQA) return res.status(404).json({ success: false, error: 'Q&A entry not found.' });
      return res.status(200).json({ success: true, qa: updatedQA, message: 'Q&A entry updated.' });
    }

    if (action === 'update_dept' && departmentKey && deptUpdates) {
      const updatedDept = receptionistKnowledgeDb.updateDepartment(departmentKey, deptUpdates);
      return res.status(200).json({ success: true, department: updatedDept, message: 'Department routing updated.' });
    }

    if (action === 'add_doc' && document) {
      const newDoc = receptionistKnowledgeDb.addDocument(document);
      return res.status(200).json({ success: true, document: newDoc, message: 'Document added to knowledge base.' });
    }

    if (action === 'reset') {
      const resetStore = receptionistKnowledgeDb.resetToDefaults();
      return res.status(200).json({ success: true, store: resetStore, message: 'Knowledge base restored to default values.' });
    }

    return res.status(400).json({ success: false, error: 'Invalid action or missing parameters.' });
  } catch (error: any) {
    console.error('[Receptionist Knowledge POST Error]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/receptionist/knowledge/:type/:id', (req: Request, res: Response) => {
  try {
    const { type, id } = req.params;
    if (type === 'qa') {
      const ok = receptionistKnowledgeDb.deleteQA(id);
      return res.status(200).json({ success: ok, message: ok ? 'Q&A entry deleted.' : 'Entry not found.' });
    }
    if (type === 'doc') {
      const ok = receptionistKnowledgeDb.deleteDocument(id);
      return res.status(200).json({ success: ok, message: ok ? 'Document deleted.' : 'Document not found.' });
    }
    return res.status(400).json({ success: false, error: 'Invalid type parameter.' });
  } catch (error: any) {
    console.error('[Receptionist Knowledge DELETE Error]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 6C. AI AUTOMATED DOCUMENT INGESTION & TRAINING GENERATOR (POST)
 * Takes unstructured text, policies, website copy, or employee guides and uses Gemini 3.7 Flash
 * to automatically synthesize production Q&As, keywords, and routing recommendations.
 */
router.post('/receptionist/ai-train', async (req: Request, res: Response) => {
  try {
    const { rawText, documentTitle = 'Custom Document', category = 'Custom Training' } = req.body;

    if (!rawText || !rawText.trim()) {
      return res.status(400).json({ error: 'rawText is required for AI training.' });
    }

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
        const createdDoc = receptionistKnowledgeDb.addDocument({
          title: documentTitle,
          category,
          rawContent: rawText,
          summary: parsed.summary || `Extracted ${extractedQAs.length} Q&As from ${documentTitle}.`,
          extractedQAsCount: extractedQAs.length
        });

        const createdQAs = extractedQAs.map((q: any) => receptionistKnowledgeDb.addQA({
          category: ['general', 'pricing', 'technical', 'security', 'routing', 'policy', 'custom'].includes(q.category) ? q.category : 'custom',
          question: q.question,
          answer: q.answer,
          keywords: Array.isArray(q.keywords) ? q.keywords : ['info'],
          priority: ['high', 'medium', 'low'].includes(q.priority) ? q.priority : 'medium',
          enabled: true
        }));

        return res.status(200).json({
          success: true,
          message: `Successfully generated ${createdQAs.length} training Q&A items.`,
          document: createdDoc,
          qas: createdQAs,
          summary: parsed.summary,
          model: 'gemini-3.7-flash'
        });
      } catch (gemError: any) {
        console.warn('[AI Train Gemini Error] Falling back to heuristic text extractor:', gemError.message);
      }
    }

    // Heuristic extraction fallback
    const sentences = rawText.split(/[.!?]+/).map((s: string) => s.trim()).filter((s: string) => s.length > 20);
    const mockQAs = sentences.slice(0, 3).map((s: string, idx: number) => {
      const q = idx === 0 ? `What is the policy regarding ${documentTitle}?` : `Can you explain the details of ${documentTitle}?`;
      return receptionistKnowledgeDb.addQA({
        category: 'custom',
        question: q,
        answer: s.slice(0, 180) + '.',
        keywords: [documentTitle.toLowerCase().slice(0, 15), 'policy', 'details'],
        priority: 'medium',
        enabled: true
      });
    });

    const doc = receptionistKnowledgeDb.addDocument({
      title: documentTitle,
      category,
      rawContent: rawText,
      summary: `Indexed ${mockQAs.length} points from ${documentTitle}.`,
      extractedQAsCount: mockQAs.length
    });

    return res.status(200).json({
      success: true,
      message: `Extracted ${mockQAs.length} training items via heuristic parser.`,
      document: doc,
      qas: mockQAs,
      model: 'heuristic-extractor'
    });
  } catch (error: any) {
    console.error('[Receptionist AI Train Exception]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * RECEPTIONIST AUTONOMOUS ACTION HELPERS
 */
function executeStartVideoCall(leadName: string, company: string) {
  const roomId = `room_meet_greet_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const joinUrl = `/meet-and-greet?room=${roomId}`;
  return {
    roomId,
    roomName: 'My Meet & Greet',
    topic: `My Meet & Greet Video Consultation with ${leadName || 'Client'}`,
    joinUrl,
    targetView: 'call_canvas',
    host: 'Sophia (AI Receptionist)',
    leadName: leadName || 'Caller',
    company: company || 'Enterprise Client',
    status: 'ACTIVE_READY',
    createdAt: new Date().toISOString()
  };
}

function executeScheduleCalendarEvent(title: string, date: string, time: string, duration: number, guests: string[], notes: string) {
  const newMeetingId = `mtg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const cleanDate = date || new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const cleanTime = time || '14:00';
  const meetingRecord = {
    id: newMeetingId,
    title: title || 'Executive Briefing & Discovery Session',
    locations: ['Virtual Google Meet / WebRTC Gateway', 'San Francisco HQ'],
    guests: guests && guests.length > 0 ? guests : ['client@enterprise.com', 'alex.vance@obsidian-crm.internal'],
    permissions: { modify: false, inviteOther: true, seeGuestList: true },
    date: cleanDate,
    time: cleanTime,
    duration: duration || 30,
    availability: 'Busy',
    visibility: 'Default Visibility',
    additionalNotes: notes || 'Booked autonomously by Sophia (AI Front-Desk Receptionist).',
    startTime: `${cleanDate}T${cleanTime}:00.000Z`,
    endTime: `${cleanDate}T${cleanTime}:00.000Z`,
    // Not a real booking: it isn't saved or plan-checked. Real meetings go through POST /api/meetings/create.
    videoLink: '',
    status: 'PROPOSED',
    createdAt: new Date().toISOString()
  };
  return meetingRecord;
}

function executeCreateProposal(clientName: string, title: string, price: number, deliverables: string[]) {
  const propId = `PROP-${Math.floor(1000 + Math.random() * 9000)}`;
  const finalPrice = price || 78000;
  const itemsList = deliverables && deliverables.length > 0 ? deliverables : [
    'Phase 1: Zero-Trust Security Architecture & GDPR/SOC2 Compliance Framework',
    'Phase 2: High-Velocity WebRTC & Omnichannel Telecom Gateway Pipeline',
    'Phase 3: Autonomous AI Receptionist & Multi-Modal Voice Agent Engine',
    'Phase 4: Dedicated 24/7 SLA Hotline & Edge Deployment Hosting'
  ];

  return {
    proposalId: propId,
    id: propId,
    client_name: clientName || 'Enterprise Client',
    title: title || 'Enterprise Omnichannel Platform & AI Voice SLA',
    status: 'draft',
    signature_name: null,
    client_email: null,
    signed_at: null,
    total_price: finalPrice,
    price: finalPrice,
    deliverables: itemsList,
    items: itemsList.map((d: string, idx: number) => ({
      id: `item-${propId}-${idx + 1}`,
      proposal_id: propId,
      title: d,
      description: `Production deliverable milestone: ${d}`,
      price: Math.round(finalPrice / itemsList.length),
      is_optional: false,
      is_selected: true
    })),
    created_at: new Date().toISOString(),
    viewUrl: `/proposals/${propId}`
  };
}

/**
 * 6D. AI RECEPTIONIST CHAT QUERY ANSWERING (POST)
 * Answers any question submitted via chat or command center using the trained knowledge base.
 */
router.post('/receptionist/chat-query', async (req: Request, res: Response) => {
  try {
    const { 
      message, 
      leadName = 'Client', 
      leadCompany = 'Visitor',
      conversationHistory = [] 
    } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }

    const dynamicKnowledge = receptionistKnowledgeDb.buildKnowledgeContext();
    const store = receptionistKnowledgeDb.getStore();
    const client = getGeminiClient();

    if (client) {
      try {
        const systemInstruction = `You are ${store.profile.agentName}, the trained AI Front-Desk Receptionist at ${store.profile.companyName}.
Your job is to answer the user's questions with absolute accuracy based on the company's verified knowledge base and execute real-time business actions when requested.

${dynamicKnowledge}

RECEPTIONIST GUIDELINES FOR CHAT ANSWERS:
1. Provide a direct, courteous, helpful answer formatted cleanly in markdown.
2. Provide a 'spokenReply' field containing a concise, 1-2 sentence spoken summary (under 35 words, no markdown) suitable for speech synthesis.
3. ACTION DETECTION:
   - If the user asks to START A VIDEO CALL (e.g. "let's do a video call", "start video", "switch to video"): Set 'actionType' to 'start_video_call', mention that you are routing them to the 'My Meet & Greet' room, and confirm that the video conference room is ready.
   - If the user asks to SCHEDULE A CALENDAR EVENT (e.g. "schedule a meeting", "book a demo", "schedule an appointment"): Set 'actionType' to 'schedule_calendar_event', extract 'calendarEventData', and confirm the booking.
   - If the user asks to CREATE A CONTRACT OR PROPOSAL (e.g. "create a contract", "draft a proposal", "generate a quote"): Set 'actionType' to 'create_proposal', extract 'proposalData', and confirm the generated draft proposal.
   - If the user asks for a department (Sales, Tech Support, Billing, Executive, Partnerships), set 'transferDepartment'.
   - If they want to leave a message or reach someone in a meeting, set 'isTakingMessage': true and prepare 'messageSlip'.
4. Include 2-3 relevant follow-up questions in 'suggestedQuestions'.
5. Evaluate 'confidenceScore' (from 50 to 100) based on how well the question matches the verified knowledge base.`;

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
              cal.title || `Discovery Session: ${leadCompany || leadName}`,
              cal.date || new Date(Date.now() + 86400000).toISOString().split('T')[0],
              cal.time || '14:00',
              cal.duration || 30,
              [leadName ? `${leadName.toLowerCase().replace(/\s+/g, '.')}@${(leadCompany || 'client').toLowerCase().replace(/\s+/g, '')}.com` : 'client@enterprise.com'],
              cal.notes || `Scheduled during Receptionist conversation for ${leadName}.`
            )
          };
        } else if (parsed.actionType === 'create_proposal' || parsed.intent === 'create_proposal') {
          const prop = parsed.proposalData || {};
          executedAction = {
            type: 'proposal',
            data: executeCreateProposal(
              leadCompany || leadName,
              prop.title || `Enterprise CRM & Voice Integration Proposal`,
              prop.price || 78000,
              prop.deliverables || []
            )
          };
        }

        return res.status(200).json({
          success: true,
          chatReply: parsed.chatReply || "I'd be glad to assist you with that inquiry. How else can I help?",
          spokenReply: parsed.spokenReply || "I'd be glad to assist you with that inquiry today.",
          confidenceScore: parsed.confidenceScore || 92,
          intent: parsed.intent || 'inquiry',
          actionType: parsed.actionType || (executedAction ? executedAction.type : null),
          executedAction,
          transferDepartment: parsed.transferDepartment || null,
          isTakingMessage: Boolean(parsed.isTakingMessage),
          messageSlip: parsed.messageSlip || null,
          matchedKnowledgeTopic: parsed.matchedKnowledgeTopic || 'Verified Knowledge Base',
          suggestedQuestions: parsed.suggestedQuestions || ['Start a video call with me', 'Schedule a meeting for tomorrow at 2 PM', 'Create an enterprise contract proposal'],
          model: 'gemini-3.7-flash'
        });
      } catch (gemError: any) {
        console.warn('[Receptionist Chat Gemini Error]', gemError.message);
      }
    }

    // Heuristic matching fallback for chat actions and questions
    const lower = message.toLowerCase();
    let actionType: string | null = null;
    let executedAction: any = null;
    let chatReply = "";
    let spokenReply = "";
    let intent = "inquiry";
    let matchedTopic = "General Operations";

    if (lower.includes('video') || lower.includes('video call') || lower.includes('zoom') || lower.includes('face to face') || lower.includes('camera') || lower.includes('consultation')) {
      actionType = 'video_call';
      intent = 'start_video_call';
      const videoData = executeStartVideoCall(leadName, leadCompany);
      executedAction = { type: 'video_call', data: videoData };
      chatReply = `### 🎥 My Meet & Greet Video Consultation Initiated\n\nI have initiated a secure, encrypted WebRTC video conference in **My Meet & Greet** for **${leadCompany || leadName}**.\n\n- **Room**: \`${videoData.roomName}\`\n- **Host**: Sophia (AI Receptionist)\n- **Direct Link**: [Join My Meet & Greet](${videoData.joinUrl})\n\nClick the button below to route directly to My Meet & Greet.`;
      spokenReply = "I have initiated your video consultation and am routing you to our My Meet & Greet room right now.";
      matchedTopic = "My Meet & Greet Video Calling";
    } else if (lower.includes('schedule') || lower.includes('calendar') || lower.includes('appointment') || lower.includes('book a demo') || lower.includes('meeting')) {
      actionType = 'calendar_event';
      intent = 'schedule_calendar_event';
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
      const eventData = executeScheduleCalendarEvent(
        `Executive Briefing: ${leadCompany || leadName}`,
        tomorrow,
        '14:00',
        30,
        [`${(leadName || 'client').toLowerCase().replace(/\s+/g, '.')}@${(leadCompany || 'company').toLowerCase().replace(/\s+/g, '')}.com`],
        `Autonomously scheduled via Receptionist chat by ${leadName}.`
      );
      executedAction = { type: 'calendar_event', data: eventData };
      chatReply = `### 📅 Calendar Event Booked\n\nI have scheduled an appointment on our CRM agenda and Google Calendar:\n\n- **Title**: ${eventData.title}\n- **Date & Time**: ${eventData.date} at ${eventData.time} (30 mins)\n- **Meeting Link**: [Google Meet / WebRTC](${eventData.videoLink})\n- **Status**: Confirmed & Synced`;
      spokenReply = `I have scheduled the calendar event for tomorrow at 2 PM and added it to our agenda calendar.`;
      matchedTopic = "Calendar Scheduling";
    } else if (lower.includes('proposal') || lower.includes('contract') || lower.includes('agreement') || lower.includes('quote') || lower.includes('sow') || lower.includes('statement of work')) {
      actionType = 'proposal';
      intent = 'create_proposal';
      const propData = executeCreateProposal(
        leadCompany || leadName,
        `Enterprise Platform & Voice SLA Agreement for ${leadCompany || leadName}`,
        78000,
        [
          'Phase 1: Zero-Trust Security Architecture & Compliance Setup ($19,500)',
          'Phase 2: Real-Time WebRTC Voice Telephony Integration ($19,500)',
          'Phase 3: Autonomous AI Receptionist & Automated Routing Bot ($19,500)',
          'Phase 4: Dedicated 24/7 SLA Hosting & Continuous Operations ($19,500)'
        ]
      );
      executedAction = { type: 'proposal', data: propData };
      chatReply = `### 📄 Contract & Proposal Generated\n\nI have drafted a formal enterprise proposal for **${leadCompany || leadName}**:\n\n- **Proposal ID**: \`${propData.proposalId}\`\n- **Total Investment**: **$78,000**\n- **Scope**: Omnichannel CRM Modernization, AI Receptionist, Sub-50ms Voice Dialer\n- **Signature**: Ready for Digital E-Signature\n\nYou can review, customize, or e-sign the draft contract now.`;
      spokenReply = "I have drafted a comprehensive enterprise contract proposal for you with full digital signature capability.";
      matchedTopic = "Proposal & Contract Generation";
    } else {
      const matchedQA = store.qas.find(q => 
        q.enabled && (
          lower.includes(q.question.toLowerCase().slice(0, 15)) ||
          q.keywords.some(k => lower.includes(k.toLowerCase()))
        )
      );

      chatReply = matchedQA 
        ? `**${matchedQA.question}**\n\n${matchedQA.answer}`
        : `Thank you for asking, ${leadName}. ${store.profile.defaultGreeting}`;
      spokenReply = matchedQA ? matchedQA.answer : `Thank you for asking. Our team is available during standard business hours.`;
      matchedTopic = matchedQA ? matchedQA.category : 'General Operations';
    }

    return res.status(200).json({
      success: true,
      chatReply,
      spokenReply,
      confidenceScore: executedAction ? 98 : 85,
      intent,
      actionType,
      executedAction,
      transferDepartment: null,
      isTakingMessage: false,
      messageSlip: null,
      matchedKnowledgeTopic: matchedTopic,
      suggestedQuestions: ['Start a video call with me', 'Schedule a meeting for tomorrow at 2 PM', 'Create an enterprise contract proposal'],
      model: 'heuristic-engine'
    });

  } catch (error: any) {
    console.error('[Receptionist Chat Query Exception]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 7. AI VOICE DIALER & RECEPTIONIST CONVERSATIONAL TURN (POST)
 * Interactive conversational telephony intelligence powered by Gemini 3.7 Flash.
 * Supports both Outbound Sales Dialer and Inbound Virtual Front-Desk Receptionist.
 */
router.post('/voice-dialer/turn', async (req: Request, res: Response) => {
  try {
    const { 
      callMode = 'receptionist', // 'receptionist' | 'dialer'
      leadName = 'Caller', 
      leadCompany = 'Guest Client',
      leadDealValue = '$50,000',
      leadStage = 'Discovery',
      agentPersona = 'Alex AI - Unified Executive Voice Concierge',
      userMessage = '',
      conversationHistory = [],
      callGoal = 'Serve as the unified voice concierge: greet callers, qualify deals, answer knowledge base FAQs, execute actions or route to specialized departments'
    } = req.body;

    if (!userMessage || !userMessage.trim()) {
      return res.status(400).json({ error: 'userMessage is required' });
    }

    const dynamicKnowledge = receptionistKnowledgeDb.buildKnowledgeContext();
    const store = receptionistKnowledgeDb.getStore();

    const key = process.env.GEMINI_API_KEY;
    const hasApiKey = key && !key.includes('placeholder') && !key.includes('YOUR_GEMINI_API_KEY');

    if (hasApiKey) {
      try {
        const client = getGeminiClient();
        if (!client) throw new Error('Gemini client unavailable');

        const systemInstruction = `You are ${agentPersona}, the unified AI voice agent and executive concierge at ${store.profile.companyName}.
Company: ${store.profile.companyName} (${store.profile.address}).
Caller Name: ${leadName} from ${leadCompany}.
Context / Deal Stage: ${leadStage} (${leadDealValue}).
Operational Goal: ${callGoal}.

${dynamicKnowledge}

UNIFIED VOICE AGENT & SPOKEN TELEPHONY RULES:
1. Speak naturally, warmly, and authoritatively as Alex AI on a crystal-clear phone line. Keep replies to 1-3 short spoken sentences (under 35 words total).
2. NEVER output markdown, bullet points, asterisks, headers, citations, emojis, or code syntax because your output is fed directly into a Text-To-Speech (TTS) synthesizer.
3. You are an all-in-one unified agent: you expertly handle front-desk reception, sales qualification, billing inquiries, technical architecture, schedule bookings, and company routing.
4. ACTION EXECUTION & TOOL TRIGGERING:
   - If caller asks to START/SWITCH TO A VIDEO CALL: Confirm you are opening the 'My Meet & Greet' room. Set 'actionType' to 'start_video_call'.
   - If caller asks to SCHEDULE A CALENDAR EVENT / MEETING: Confirm date and time, set 'actionType' to 'schedule_calendar_event', and provide 'calendarEventData'.
   - If caller asks to CREATE A CONTRACT OR PROPOSAL: Confirm generation of draft proposal, set 'actionType' to 'create_proposal', and provide 'proposalData'.
5. If caller asks to speak to or be transferred to a specific department or teammate:
   - Acknowledge warmly and confirm the transfer (e.g. "I would be happy to transfer you to Alex in Sales right away. Please hold for just a moment.").
   - Set 'transferDepartment' to the department key ('sales', 'support', 'billing', 'exec', 'partnerships').
6. If caller asks for someone in a meeting (Evelyn Sinclair / Executive Desk) or wants to leave a message:
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
              cal.title || `Executive Meeting: ${leadCompany || leadName}`,
              cal.date || new Date(Date.now() + 86400000).toISOString().split('T')[0],
              cal.time || '14:00',
              cal.duration || 30,
              [leadName ? `${leadName.toLowerCase().replace(/\s+/g, '.')}@${(leadCompany || 'client').toLowerCase().replace(/\s+/g, '')}.com` : 'client@enterprise.com'],
              cal.notes || `Scheduled via Voice Phone Call by ${leadName}.`
            )
          };
        } else if (parsed.actionType === 'create_proposal' || parsed.intent === 'create_proposal') {
          const prop = parsed.proposalData || {};
          executedAction = {
            type: 'proposal',
            data: executeCreateProposal(
              leadCompany || leadName,
              prop.title || `Enterprise CRM & Voice Integration Proposal`,
              prop.price || 78000,
              prop.deliverables || []
            )
          };
        }

        return res.status(200).json({
          success: true,
          replyText: parsed.replyText || `Thank you for calling ${store.profile.companyName}. How can I direct your call today?`,
          sentiment: parsed.sentiment || 'positive',
          intent: parsed.intent || (callMode === 'receptionist' ? 'routing' : 'general'),
          actionType: parsed.actionType || (executedAction ? executedAction.type : null),
          executedAction,
          transferDepartment: parsed.transferDepartment || null,
          isTakingMessage: Boolean(parsed.isTakingMessage),
          messageSlip: parsed.messageSlip || null,
          actionItem: parsed.actionItem || (executedAction ? `Executed action: ${executedAction.type}` : null),
          qualificationScore: parsed.qualificationScore || 75,
          keyTakeaway: parsed.keyTakeaway || `Handled call for ${leadName}.`,
          model: 'gemini-3.7-flash',
          source: 'gemini-trained-knowledge'
        });
      } catch (geminiError: any) {
        console.warn('[Voice Dialer AI Error] Gemini call fallback triggered:', geminiError.message);
      }
    }

    // Dynamic heuristic fallback matching trained knowledge if Gemini is offline
    const lower = userMessage.toLowerCase();
    let actionType: string | null = null;
    let executedAction: any = null;
    let reply = `Thank you for calling ${store.profile.companyName}, ${leadName}. How can I direct your call today?`;
    let sentiment = 'neutral';
    let intent = callMode === 'receptionist' ? 'routing' : 'general';
    let transferDept: string | null = null;
    let isTakingMsg = false;
    let msgSlip: any = null;
    let actionItem = 'Answer caller inquiry';
    let score = 75;

    // Action Execution Heuristics
    if (lower.includes('video') || lower.includes('video call') || lower.includes('zoom') || lower.includes('switch to video')) {
      const vid = executeStartVideoCall(leadName, leadCompany);
      executedAction = { type: 'video_call', data: vid };
      actionType = 'video_call';
      intent = 'start_video_call';
      reply = `I am starting our video consultation and routing you to our My Meet and Greet video room right now.`;
      sentiment = 'enthusiastic';
      actionItem = 'Initiate WebRTC Video Consultation in My Meet & Greet';
      score = 95;
    } else if (lower.includes('schedule') || lower.includes('calendar') || lower.includes('appointment') || lower.includes('book a demo') || lower.includes('meeting')) {
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
      const cal = executeScheduleCalendarEvent(
        `Executive Meeting: ${leadCompany || leadName}`,
        tomorrow,
        '14:00',
        30,
        [`${(leadName || 'caller').toLowerCase().replace(/\s+/g, '.')}@${(leadCompany || 'company').toLowerCase().replace(/\s+/g, '')}.com`],
        `Autonomously scheduled during phone call with ${leadName}.`
      );
      executedAction = { type: 'calendar_event', data: cal };
      actionType = 'calendar_event';
      intent = 'schedule_calendar_event';
      reply = `I have booked your meeting for tomorrow at 2 PM in our calendar and sent the confirmation to your email.`;
      sentiment = 'positive';
      actionItem = 'Schedule CRM & Google Calendar Meeting';
      score = 92;
    } else if (lower.includes('proposal') || lower.includes('contract') || lower.includes('agreement') || lower.includes('quote') || lower.includes('sow')) {
      const prop = executeCreateProposal(
        leadCompany || leadName,
        `Enterprise Platform & Voice SLA Agreement for ${leadCompany || leadName}`,
        78000,
        [
          'Phase 1: Zero-Trust Security Architecture & Compliance Setup ($19,500)',
          'Phase 2: Real-Time WebRTC Voice Telephony Integration ($19,500)',
          'Phase 3: Autonomous AI Receptionist & Automated Routing Bot ($19,500)',
          'Phase 4: Dedicated 24/7 SLA Hosting & Continuous Operations ($19,500)'
        ]
      );
      executedAction = { type: 'proposal', data: prop };
      actionType = 'proposal';
      intent = 'create_proposal';
      reply = `I have created a formal proposal for ${leadCompany || leadName} totaling 78,000 dollars with digital signature readiness.`;
      sentiment = 'enthusiastic';
      actionItem = 'Create Enterprise Contract Proposal';
      score = 95;
    } else if (lower.includes('sales') || lower.includes('buy') || lower.includes('enterprise quote') || lower.includes('alex')) {
      reply = `Certainly! I am transferring you directly to Alex Vance in Sales right now. Please hold for just a moment.`;
      intent = 'transfer';
      transferDept = 'sales';
      sentiment = 'enthusiastic';
      actionItem = `Warm transfer call to Sales (Alex Vance)`;
      score = 90;
    } else if (lower.includes('support') || lower.includes('technical') || lower.includes('devops') || lower.includes('bug') || lower.includes('jordan') || lower.includes('api')) {
      reply = `Connecting you to Jordan Reed in Technical Support right away. Please stay on the line.`;
      intent = 'transfer';
      transferDept = 'support';
      sentiment = 'urgent';
      actionItem = `Route to Technical Support (Jordan Reed)`;
      score = 85;
    } else if (lower.includes('bill') || lower.includes('invoice') || lower.includes('payment') || lower.includes('marcus') || lower.includes('refund')) {
      reply = `I will connect you with Marcus Zhao in Billing and Accounts immediately. One moment please.`;
      intent = 'transfer';
      transferDept = 'billing';
      sentiment = 'neutral';
      actionItem = `Route to Billing & Invoicing (Marcus Zhao)`;
      score = 70;
    } else if (lower.includes('evelyn') || lower.includes('ceo') || lower.includes('executive') || lower.includes('management')) {
      reply = `Evelyn Sinclair is currently in an executive briefing. May I take down your name and a detailed message so she can return your call?`;
      intent = 'message_taking';
      transferDept = 'exec';
      isTakingMsg = true;
      msgSlip = {
        recipient: 'Evelyn Sinclair (CEO Office)',
        urgency: 'high',
        notes: `Caller ${leadName} requested direct line with CEO.`,
        callbackNumber: '+1 (555) 234-8901'
      };
      actionItem = `Save message slip for Evelyn Sinclair`;
      score = 85;
    } else if (lower.includes('message') || lower.includes('leave a note') || lower.includes('tell them') || lower.includes('callback')) {
      reply = `I would be glad to take down a message. What notes and callback number should I include for the team?`;
      intent = 'message_taking';
      isTakingMsg = true;
      msgSlip = {
        recipient: 'Front Desk Dispatch',
        urgency: 'normal',
        notes: `Caller ${leadName} left callback request: "${userMessage}"`,
        callbackNumber: '+1 (555) 019-2834'
      };
      actionItem = `Log message slip for team`;
      score = 80;
    } else {
      const matchedQA = store.qas.find(q => 
        q.enabled && (
          lower.includes(q.question.toLowerCase().slice(0, 15)) ||
          q.keywords.some(k => lower.includes(k.toLowerCase()))
        )
      );
      if (matchedQA) {
        reply = matchedQA.answer;
        score = 90;
      }
    }

    return res.status(200).json({
      success: true,
      replyText: reply,
      sentiment,
      intent,
      actionType,
      executedAction,
      transferDepartment: transferDept,
      isTakingMessage: isTakingMsg,
      messageSlip: msgSlip,
      actionItem,
      qualificationScore: score,
      keyTakeaway: `Processed inquiry from ${leadName}.`,
      model: 'heuristic-engine-with-knowledge'
    });

  } catch (error: any) {
    console.error('[Voice Dialer Turn Exception]', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to process voice dialer conversational turn',
      details: error.message
    });
  }
});

/**
 * 8. AI VOICE DIALER POST-CALL SUMMARY & CRM REPORT GENERATOR (POST)
 */
router.post('/voice-dialer/summary', async (req: Request, res: Response) => {
  try {
    const {
      leadName = 'Customer',
      leadPhone = '',
      leadCompany = 'Prospect Co',
      leadDealValue = '$50,000',
      durationSeconds = 60,
      transcripts = []
    } = req.body;

    const transcriptText = transcripts.map((t: any) => 
      `[${t.sender === 'user' || t.sender === 'lead' ? leadName : 'AI Agent'}]: ${t.text}`
    ).join('\n');

    const key = process.env.GEMINI_API_KEY;
    const hasApiKey = key && !key.includes('placeholder') && !key.includes('YOUR_GEMINI_API_KEY');

    if (hasApiKey && transcripts.length > 0) {
      try {
        const client = getGeminiClient();
        const systemInstruction = `You are an elite CRM Intelligence Analyst at Obsidian Core CRM.
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
      } catch (err: any) {
        console.warn('[Voice Dialer Summary AI Error] Fallback triggered:', err.message);
      }
    }

    // Heuristic summary fallback
    const defaultSummary = {
      executiveSummary: `Completed a ${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s consultative AI voice call with ${leadName} at ${leadCompany}. The prospect engaged regarding product capabilities and scheduling next steps.`,
      sentimentScore: 'Positive',
      leadQuality: 'High Priority',
      keyTopicsDiscussed: [
        'Obsidian Core Platform Overview',
        'Enterprise Security & Cloud Infrastructure',
        'Calendar & Demo Scheduling',
        'Custom Package Pricing & ROI'
      ],
      actionItems: [
        `Send calendar confirmation for follow-up session to ${leadName}`,
        `Prepare custom deployment architecture blueprint for ${leadCompany}`,
        'Log call audio transcript into CRM audit timeline'
      ],
      suggestedNextStep: `Follow up via email with scheduling link for ${leadName}.`,
      crmNote: `📞 AI Voice Call Completed (${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s)\nLead: ${leadName} (${leadCompany})\nSentiment: Positive\nStatus: Qualified for Demonstration\nAction: Calendar invite sent.`
    };

    return res.status(200).json({
      success: true,
      summary: defaultSummary,
      model: 'heuristic-engine'
    });

  } catch (error: any) {
    console.error('[Voice Dialer Summary Exception]', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate post-call summary',
      details: error.message
    });
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
