import { Router, Request, Response } from 'express';
import { wsDispatcher } from '../utils/wsDispatcher';
import { postMeetingWorkflow, MeetingWorkflowData } from '../utils/postMeetingWorkflow';

const router = Router();

// Store bot states and fetched transcripts in-memory for live dashboard demonstration
interface BotState {
  id: string;
  meetingUrl: string;
  botName: string;
  status: 'invited' | 'joining' | 'recording' | 'ended' | 'failed';
  createdAt: string;
  transcript?: string;
  retriesAttempted?: number;
}

export const activeBotsCache: Map<string, BotState> = new Map();

// Helper to validate common meeting platform domains
function isValidMeetingUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    return (
      host.includes('zoom.us') ||
      host.includes('meet.google.com') ||
      host.includes('teams.microsoft.com') ||
      host.includes('teams.live.com')
    );
  } catch (e) {
    return false;
  }
}

/**
 * Robust fetchTranscript function that simulates/executes transcript retrieval.
 * If the transcript is not immediately ready, it uses exponential backoff to retry.
 */
async function fetchTranscript(
  botId: string,
  maxAttempts: number = 5,
  initialDelayMs: number = 1000
): Promise<{ success: boolean; transcript?: string; error?: string }> {
  let attempt = 0;
  let delay = initialDelayMs;

  const apiKey = process.env.RECALL_API_KEY;
  const isMock = !apiKey || apiKey.includes('placeholder') || apiKey.includes('YOUR_RECALL_API_KEY');

  while (attempt < maxAttempts) {
    attempt++;
    console.log(`[Meeting Bot] [fetchTranscript] Bot ID: ${botId} | Attempt ${attempt}/${maxAttempts} (Wait: ${delay}ms)`);

    try {
      if (isMock) {
        // --- HIGH-FIDELITY SIMULATION MODE ---
        // Simulate that the transcription is transcribing during the first 2 attempts, and becomes ready on attempt 3
        if (attempt < 3) {
          console.warn(`[Meeting Bot] [Mock API] Transcript for bot ${botId} is not ready yet. Current status: 'transcribing'`);
          // We throw a spec-compliant "not ready" error or return null to trigger retry logic
          throw new Error('TRANSCRIPT_NOT_READY');
        }

        // On attempt 3+, mock a beautiful, complete summary transcription from the real estate call
        const mockTranscript = `
Alexandra Opalan (11:30 AM): Hi everyone, let's start the call soon 😊
Alexandra Opalan (11:31 AM): Hey! I'm waiting 😊
John Hudson (11:32 AM): Hello all!
Alexandra Opalan (11:33 AM): Are we waiting for absent teammates?
Kate Smith (11:34 AM): I suggest to start this call a little bit later 😊
Alexandra Opalan (11:34 AM): Hey! I'm waiting 😊
[System] (11:35 AM): Started the call
Kate Smith (11:36 AM): Thanks for sending all those completed transcripts through – we've been really happy with the compliance checks under the new GDPR parameters.
John Hudson (11:37 AM): The multi-region redundancy pipeline is fully operational with 99.99% reliability.
        `.trim();

        console.log(`[Meeting Bot] [Mock API] Transcript fetched successfully on attempt ${attempt}!`);
        return { success: true, transcript: mockTranscript };
      } else {
        // --- REAL INTEGRATION MODE WITH RECALL.AI ---
        console.log(`[Meeting Bot] [Real API] Fetching from Recall.ai for bot ${botId}`);
        const response = await fetch(`https://api.recall.ai/api/v1/bot/${botId}/`, {
          method: 'GET',
          headers: {
            'Authorization': `Token ${apiKey}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error(`Recall.ai API returned status ${response.status}`);
        }

        const data: any = await response.json();
        
        // Check if the bot is done and transcription is available
        // Recall.ai status can be: "done", "recording", "joining", etc.
        if (data.status === 'done' && data.transcript && data.transcript.length > 0) {
          // Format the Recall.ai transcript elements into a single readable block
          const formattedTranscript = data.transcript
            .map((t: any) => `${t.speaker || 'Unknown'}: ${t.text}`)
            .join('\n');
          
          return { success: true, transcript: formattedTranscript };
        } else {
          console.warn(`[Meeting Bot] [Real API] Bot state: '${data.status}'. Transcript is not fully ready.`);
          throw new Error('TRANSCRIPT_NOT_READY');
        }
      }
    } catch (error: any) {
      if (error.message === 'TRANSCRIPT_NOT_READY') {
        // This is an expected retriable state
        if (attempt === maxAttempts) {
          console.error(`[Meeting Bot] [Backoff Limit] Max retries reached for bot ${botId}. Giving up.`);
          return { success: false, error: 'TRANSCRIPT_NOT_READY_MAX_REACHED' };
        }
      } else {
        // This is a network or API execution failure
        console.error(`[Meeting Bot] [API Error] Attempt ${attempt} encountered error:`, error.message);
        if (attempt === maxAttempts) {
          return { success: false, error: error.message };
        }
      }
    }

    // Apply exponential backoff delay before the next attempt
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay *= 2; // Double the interval for exponential backoff
  }

  return { success: false, error: 'Unknown timeout occurred.' };
}

/**
 * 1. POST /api/bot/invite
 * Dispatches a recording bot to a live Zoom, Google Meet, or MS Teams meeting url.
 */
router.post('/api/bot/invite', async (req: Request, res: Response) => {
  const { meetingUrl, botName = 'Executive Recording Bot' } = req.body;

  console.log(`[Meeting Bot] Received request to invite bot to: "${meetingUrl}"`);

  // Basic payload validation
  if (!meetingUrl) {
    console.error('[Meeting Bot] Invitation failed: meetingUrl parameter is missing.');
    return res.status(400).json({
      success: false,
      error: 'Missing required field: meetingUrl'
    });
  }

  if (!isValidMeetingUrl(meetingUrl)) {
    console.warn(`[Meeting Bot] Invitation rejected: URL "${meetingUrl}" is not a recognized Zoom, Google Meet, or Microsoft Teams link.`);
    return res.status(400).json({
      success: false,
      error: 'Invalid meetingUrl. Must be a valid Zoom, Google Meet, or Microsoft Teams URL.'
    });
  }

  const apiKey = process.env.RECALL_API_KEY;
  const isMock = !apiKey || apiKey.includes('placeholder') || apiKey.includes('YOUR_RECALL_API_KEY');
  const botId = `bot_${Math.random().toString(36).substring(2, 11)}`;

  try {
    if (isMock) {
      // Create a simulated active bot entry
      const botEntry: BotState = {
        id: botId,
        meetingUrl,
        botName,
        status: 'recording',
        createdAt: new Date().toISOString()
      };

      activeBotsCache.set(botId, botEntry);

      console.log(`[Meeting Bot] [Mock Dispatch] Bot dispatched successfully. Simulated Bot ID: ${botId}`);

      // Broadcast the real-time bot invitation event
      wsDispatcher.broadcast('BOT_INVITED', {
        botId,
        botName,
        meetingUrl,
        status: 'recording',
        message: `Recording bot "${botName}" has successfully joined the meeting.`
      });

      return res.status(201).json({
        success: true,
        message: 'Mock bot dispatched successfully to meeting.',
        botId,
        status: 'recording',
        provider: 'mock-recall-api'
      });
    } else {
      // Real API Call to Recall.ai
      console.log(`[Meeting Bot] [Real Dispatch] Sending dispatch call to Recall.ai API...`);
      
      const recallPayload = {
        meeting_url: meetingUrl,
        bot_name: botName,
        transcription_options: {
          provider: 'assembly_ai'
        },
        realtime_transcription: true
      };

      const response = await fetch('https://api.recall.ai/api/v1/bot/', {
        method: 'POST',
        headers: {
          'Authorization': `Token ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(recallPayload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Meeting Bot] Recall.ai server responded with error status ${response.status}:`, errorText);
        return res.status(response.status).json({
          success: false,
          error: 'External Bot Dispatch API call failed.',
          details: errorText
        });
      }

      const responseData: any = await response.json();
      const realBotId = responseData.id || botId;

      // Register the real bot state in-memory
      activeBotsCache.set(realBotId, {
        id: realBotId,
        meetingUrl,
        botName,
        status: 'recording',
        createdAt: new Date().toISOString()
      });

      console.log(`[Meeting Bot] [Real Dispatch] Bot dispatched. Recall Bot ID: ${realBotId}`);

      // Broadcast connection event
      wsDispatcher.broadcast('BOT_INVITED', {
        botId: realBotId,
        botName,
        meetingUrl,
        status: 'recording',
        message: `Recall.ai bot "${botName}" has joined the meeting channel.`
      });

      return res.status(201).json({
        success: true,
        message: 'External bot successfully dispatched to meeting room.',
        botId: realBotId,
        status: 'recording',
        provider: 'recall-api',
        rawData: responseData
      });
    }
  } catch (error: any) {
    console.error('[Meeting Bot] [Invite Exception] Fatal error during dispatch routing:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Internal server failure initiating recording bot.',
      message: error.message
    });
  }
});

/**
 * 2. POST /webhook/meeting-ended
 * Listen for webhook callbacks from the external recording bot.
 * Triggers background processing of the meeting's transcript with exponential backoff.
 */
router.post('/webhook/meeting-ended', async (req: Request, res: Response) => {
  const payload = req.body;
  console.log('[Meeting Bot Webhook] Received meeting conclusion callback.');
  console.log('[Meeting Bot Webhook] Raw Payload:', JSON.stringify(payload, null, 2));

  // Handle diverse payload formats safely
  // Standard Recall.ai hook events or direct payload simulation support
  const botId = payload.botId || payload.bot_id || payload.data?.id || payload.data?.bot_id;
  const status = payload.status || payload.event || payload.data?.status;

  if (!botId) {
    console.error('[Meeting Bot Webhook] Error: Missing identifier botId / bot_id in payload.');
    return res.status(400).json({
      success: false,
      error: 'Unrecognized payload schema. Missing bot identifier.'
    });
  }

  // Find or initialize local state cache for logging
  let botState = activeBotsCache.get(botId);
  if (!botState) {
    botState = {
      id: botId,
      meetingUrl: 'Unknown / Direct Webhook',
      botName: 'External Recording Bot',
      status: 'ended',
      createdAt: new Date().toISOString()
    };
    activeBotsCache.set(botId, botState);
  } else {
    botState.status = 'ended';
  }

  console.log(`[Meeting Bot Webhook] Confirmed conclusion for Bot ID: ${botId}. Launching asynchronous transcript fetcher...`);

  // Broadast meeting ended state instantly to the front-end clients
  wsDispatcher.broadcast('BOT_MEETING_ENDED', {
    botId,
    status: 'ended',
    message: 'Meeting concluded. Transcript retrieval and compliance processing initiated.'
  });

  // CRITICAL SENIOR PATTERN: Return a 202 Accepted status immediately to the webhook producer 
  // to avoid blocking the webhook endpoint or causing external gateway connection timeouts.
  res.status(202).json({
    success: true,
    message: 'Webhook received. Processing transcript retrieval with exponential backoff in background.',
    botId
  });

  // Offload exponential backoff fetching asynchronously to background event loop
  (async () => {
    try {
      // Fetch the transcript with up to 5 retries starting at 1s delay
      const result = await fetchTranscript(botId, 5, 1000);

      if (result.success && result.transcript) {
        // Cache the completed transcript
        botState!.transcript = result.transcript;
        botState!.status = 'ended';
        
        console.log(`[Meeting Bot Background] Successfully finalized transcript processing for Bot: ${botId}`);

        // Broadcast transcript completion payload dynamically to active client frameworks
        wsDispatcher.broadcast('BOT_TRANSCRIPT_READY', {
          botId,
          transcript: result.transcript,
          status: 'ready',
          message: 'Meeting transcript is fully synchronized and processed.'
        });
      } else {
        botState!.status = 'failed';
        console.error(`[Meeting Bot Background] Backoff pipeline failed to obtain transcript for Bot: ${botId}. Error: ${result.error}`);
        
        wsDispatcher.broadcast('BOT_TRANSCRIPT_FAILED', {
          botId,
          status: 'failed',
          error: result.error,
          message: 'Failed to extract meeting audio transcript from the bot API.'
        });
      }
    } catch (bgError: any) {
      console.error('[Meeting Bot Background] Fatal exception in asynchronous worker thread:', bgError.message);
    }
  })();
});

// GET endpoint to query active bots for local telemetry visualization
router.get('/api/bot/list', (req: Request, res: Response) => {
  const botsList = Array.from(activeBotsCache.values());
  res.json({
    success: true,
    count: botsList.length,
    bots: botsList
  });
});

/**
 * 3. POST /api/post-meeting-workflow
 * Accepts structured meetingData payload and triggers the post-meeting automation sequence.
 */
router.post('/api/post-meeting-workflow', async (req: Request, res: Response) => {
  const meetingData: MeetingWorkflowData = req.body;

  console.log(`[Meeting Bot API] Initiating post-meeting workflow for: "${meetingData.title || 'Untitled Session'}"`);

  // Payload validations
  if (!meetingData.meetingId) {
    return res.status(400).json({
      success: false,
      error: 'Missing required field: meetingId'
    });
  }

  if (!meetingData.title) {
    meetingData.title = 'Executive Video Conference Session';
  }
  if (!meetingData.summary) {
    meetingData.summary = 'No summary was provided by the client caller.';
  }
  if (!Array.isArray(meetingData.decisions)) {
    meetingData.decisions = [];
  }
  if (!Array.isArray(meetingData.actionItems)) {
    meetingData.actionItems = [];
  }
  if (!Array.isArray(meetingData.participants)) {
    meetingData.participants = [];
  }

  try {
    const outcome = await postMeetingWorkflow(meetingData);
    
    return res.status(200).json({
      success: true,
      message: 'Post-meeting automation sequence completed.',
      outcome
    });
  } catch (err: any) {
    console.error('[Meeting Bot API Error] Failed executing post-meeting pipeline:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to process post-meeting workflow.',
      details: err.message
    });
  }
});

export default router;
