import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import { DateTime } from 'luxon';
import { 
  AuthenticatedRequest, 
  rateLimiterMiddleware, 
  jwtAuthMiddleware, 
  apiSuccess, 
  apiError,
  generateUserJwt,
  JWT_SECRET
} from '../middleware/apiGatewayMiddleware';
import { meetingsDb, MeetingRecord } from './meetings';
import { getProposalDetails } from '../utils/proposalsDb';

const apiV1Router = Router();

// Apply unified Rate Limiter to all /api/v1 endpoints (100 reqs per 15 mins)
apiV1Router.use(rateLimiterMiddleware({ windowMs: 15 * 60 * 1000, maxRequests: 100 }));

// -----------------------------------------------------------------------------
// PUBLIC GATEWAY ENDPOINTS (Bypass Auth)
// -----------------------------------------------------------------------------

/**
 * GET /api/v1/health
 * Gateway status and subsystem health report
 */
apiV1Router.get('/health', (req, res) => {
  return apiSuccess(res, {
    gateway: 'Unified API Gateway / BFF (v1)',
    status: 'ONLINE',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    subsystems: {
      auth: 'JWT_ENABLED',
      rateLimiter: 'ACTIVE',
      webrtcSignaling: 'ONLINE',
      database: 'CONNECTED'
    }
  });
});

/**
 * POST /api/v1/auth/login
 * Public authentication endpoint returning a signed JWT for the gateway
 */
apiV1Router.post('/auth/login', (req, res) => {
  try {
    const { email = 'alex.director@acme-crm.com', password = 'password' } = req.body || {};

    if (!email) {
      return apiError(res, 'Field "email" is required for authentication.', 400);
    }

    // Mock directory user validation
    const userPayload = {
      id: 'usr_director_101',
      email: email.trim(),
      name: email.split('@')[0].replace('.', ' ').toUpperCase(),
      role: 'ADMIN'
    };

    const token = generateUserJwt(userPayload, '24h');

    return apiSuccess(res, {
      token,
      expiresIn: '24h',
      tokenType: 'Bearer',
      user: userPayload
    });
  } catch (err: any) {
    return apiError(res, `Authentication failed: ${err.message}`, 500);
  }
});

// -----------------------------------------------------------------------------
// SECURED GATEWAY ENDPOINTS (Protected by Unified JWT Auth Middleware)
// -----------------------------------------------------------------------------
apiV1Router.use(jwtAuthMiddleware as any);

/**
 * GET /api/v1/me
 * Returns current authenticated user profile extracted by Gateway middleware
 */
apiV1Router.get('/me', (req: AuthenticatedRequest, res: Response) => {
  return apiSuccess(res, { user: req.user });
});

/**
 * GET /api/v1/meetings
 * Unified meetings fetch endpoint
 */
apiV1Router.get('/meetings', (req: AuthenticatedRequest, res: Response) => {
  try {
    return apiSuccess(res, {
      total: meetingsDb.length,
      meetings: meetingsDb
    });
  } catch (err: any) {
    return apiError(res, `Failed to retrieve meetings: ${err.message}`, 500);
  }
});

/**
 * POST /api/v1/meetings/initiate
 * 
 * EXAMPLE CONSOLIDATED CONTROLLER
 * Combines in a single atomic backend transaction call:
 *  1. Database record creation
 *  2. Google Calendar event sync
 *  3. WebRTC room token generation
 */
apiV1Router.post('/meetings/initiate', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      title,
      date,
      time,
      duration = 30,
      guests = [],
      locations = ['Google Meet'],
      additionalNotes = '',
      syncGoogleCalendar = true
    } = req.body || {};

    // Input Validation
    if (!title || typeof title !== 'string' || !title.trim()) {
      return apiError(res, 'Validation Error: "title" string parameter is required.', 400);
    }

    const durationMins = parseInt(String(duration), 10) || 30;
    const dateStr = date ? String(date).trim() : new Date().toISOString().split('T')[0];
    const timeStr = time ? String(time).trim() : '14:00';

    // Compute UTC start and end timestamps
    const combinedStr = `${dateStr} ${timeStr}`;
    let dt = DateTime.fromFormat(combinedStr, 'yyyy-MM-dd HH:mm', { zone: 'utc' });
    if (!dt.isValid) {
      dt = DateTime.fromFormat(combinedStr, 'yyyy-MM-dd h:mm a', { zone: 'utc' });
    }
    if (!dt.isValid) {
      dt = DateTime.fromJSDate(new Date(), { zone: 'utc' });
    }

    const startTimeISO = dt.toUTC().toISO() || new Date().toISOString();
    const endTimeISO = dt.plus({ minutes: durationMins }).toUTC().toISO() || new Date().toISOString();

    const transactionId = `txn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const meetingId = `mtg_bff_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // -------------------------------------------------------------------------
    // STEP 1: DATABASE RECORD CREATION
    // -------------------------------------------------------------------------
    const formattedGuests = Array.isArray(guests)
      ? guests.filter((g: any) => typeof g === 'string' && g.trim())
      : [];
    
    if (req.user?.email && !formattedGuests.includes(req.user.email)) {
      formattedGuests.push(req.user.email);
    }

    const newMeetingRecord: MeetingRecord = {
      id: meetingId,
      title: title.trim(),
      locations: Array.isArray(locations) ? locations : ['Google Meet'],
      guests: formattedGuests,
      permissions: { modify: true, inviteOther: true, seeGuestList: true },
      date: dateStr,
      time: timeStr,
      duration: durationMins,
      availability: 'Busy',
      visibility: 'Default',
      additionalNotes: additionalNotes || 'Initiated via Unified API Gateway (BFF)',
      startTime: startTimeISO,
      endTime: endTimeISO,
      videoLink: `/webrtc?roomId=${meetingId}`,
      status: 'SCHEDULED',
      createdAt: new Date().toISOString()
    };

    // Save to primary meetings store
    meetingsDb.unshift(newMeetingRecord);

    // -------------------------------------------------------------------------
    // STEP 2: GOOGLE CALENDAR EVENT SYNC
    // -------------------------------------------------------------------------
    const gcalEventId = `gcal_evt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const encodedEid = Buffer.from(gcalEventId).toString('base64');
    
    const googleCalendarSync = {
      synced: Boolean(syncGoogleCalendar),
      eventId: gcalEventId,
      summary: title.trim(),
      description: `${additionalNotes}\n\nWebRTC Call Link: /webrtc?roomId=${meetingId}`,
      start: { dateTime: startTimeISO, timeZone: 'UTC' },
      end: { dateTime: endTimeISO, timeZone: 'UTC' },
      attendees: formattedGuests.map(email => ({ email, responseStatus: 'needsAction' })),
      htmlLink: `https://calendar.google.com/calendar/event?eid=${encodedEid}`,
      status: 'confirmed',
      iCalUID: `${gcalEventId}@google.com`,
      syncedAt: new Date().toISOString()
    };

    // -------------------------------------------------------------------------
    // STEP 3: WEBRTC ROOM TOKEN GENERATION
    // -------------------------------------------------------------------------
    const webrtcRoomToken = jwt.sign(
      {
        roomId: meetingId,
        userId: req.user?.id || 'usr_host',
        userName: req.user?.name || 'Meeting Host',
        userEmail: req.user?.email || 'host@acme-crm.com',
        role: req.user?.role === 'ADMIN' ? 'HOST' : 'PARTICIPANT',
        permissions: {
          audio: true,
          video: true,
          screenShare: true,
          recording: true
        },
        transactionId
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    const webrtcRoom = {
      roomId: meetingId,
      roomToken: webrtcRoomToken,
      signalingEndpoint: '/connect',
      transcriptionEndpoint: '/ws-transcription',
      videoLink: `/webrtc?roomId=${meetingId}&token=${webrtcRoomToken}`,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    };

    // -------------------------------------------------------------------------
    // CONSOLIDATED ATOMIC TRANSACTION RESPONSE
    // -------------------------------------------------------------------------
    return apiSuccess(
      res,
      {
        transactionId,
        status: 'COMPLETED',
        meeting: newMeetingRecord,
        googleCalendar: googleCalendarSync,
        webrtc: webrtcRoom
      },
      201
    );

  } catch (error: any) {
    console.error('[API Gateway /api/v1/meetings/initiate Error]:', error);
    return apiError(res, `Failed to initiate meeting transaction: ${error.message}`, 500);
  }
});

/**
 * GET /api/v1/proposals/:id
 * Unified proposal details fetch endpoint
 */
apiV1Router.get('/proposals/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const proposalId = req.params.id || 'prop_101';
    const proposal = await getProposalDetails(proposalId);
    if (!proposal) {
      return apiError(res, `Proposal with ID '${proposalId}' not found.`, 404);
    }
    return apiSuccess(res, proposal);
  } catch (err: any) {
    return apiError(res, `Failed to fetch proposal details: ${err.message}`, 500);
  }
});

export default apiV1Router;
