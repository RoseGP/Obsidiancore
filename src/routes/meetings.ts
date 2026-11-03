import { Router, Request, Response } from 'express';
import { DateTime } from 'luxon';
import { GoogleGenAI, Type } from '@google/genai';
import { summarizeMeeting, type MeetingSummary, type SummaryInputLine } from '../lib/meetingSummary';

const router = Router();

export interface MeetingRecord {
  id: string;
  title: string;
  locations: string[];
  guests: string[];
  permissions: {
    modify: boolean;
    inviteOther: boolean;
    seeGuestList: boolean;
  };
  date: string;
  time: string;
  duration: number;
  availability: string;
  visibility: string;
  additionalNotes: string;
  startTime: string; // ISO 8601 UTC
  endTime: string;   // ISO 8601 UTC
  videoLink: string;
  status: string;
  createdAt: string;
}

// In-memory persistent database for meeting creation
export const meetingsDb: MeetingRecord[] = [
  {
    id: 'mtg_init_1',
    title: 'Product Design Sync',
    locations: ['New York', 'Canada'],
    guests: ['alex@example.com'],
    permissions: { modify: false, inviteOther: true, seeGuestList: true },
    date: '2026-07-22',
    time: '17:30',
    duration: 30,
    availability: 'Free',
    visibility: 'Default Visibility',
    additionalNotes: 'Initial portfolio review and design sprint discussion.',
    startTime: '2026-07-22T17:30:00.000Z',
    endTime: '2026-07-22T18:00:00.000Z',
    videoLink: 'https://meet.google.com/abc-defg-hij',
    status: 'SCHEDULED',
    createdAt: new Date().toISOString()
  }
];

/**
 * GET /api/meetings
 * Returns list of scheduled meetings
 */
router.get('/', (req: Request, res: Response) => {
  return res.json({
    success: true,
    meetings: meetingsDb
  });
});

/**
 * POST /api/meetings/create
 * Validate request payload, compute UTC ISO StartTime/EndTime, create record and video link placeholder
 */
router.post('/create', (req: Request, res: Response) => {
  try {
    const {
      title,
      locations = [],
      guests = [],
      permissions = { modify: false, inviteOther: true, seeGuestList: false },
      date,
      time,
      ampm,
      duration = 30,
      availability = 'Free',
      visibility = 'Default Visibility',
      additionalNotes = ''
    } = req.body;

    // 1. Validation for required fields
    const validationErrors: string[] = [];

    if (!title || typeof title !== 'string' || !title.trim()) {
      validationErrors.push('Field "title" is required.');
    }
    if (!date || typeof date !== 'string' || !date.trim()) {
      validationErrors.push('Field "date" is required.');
    }
    if (!time || typeof time !== 'string' || !time.trim()) {
      validationErrors.push('Field "time" is required.');
    }

    // Must have at least 1 guest or 1 location
    const hasGuests = Array.isArray(guests) && guests.filter(g => typeof g === 'string' && g.trim()).length > 0;
    const hasLocations = Array.isArray(locations) && locations.filter(l => typeof l === 'string' && l.trim()).length > 0;

    if (!hasGuests && !hasLocations) {
      validationErrors.push('Meeting must specify at least 1 guest email or at least 1 location.');
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        details: validationErrors
      });
    }

    // 2. Compute duration and UTC StartTime & EndTime ISO strings
    const durationMins = parseInt(String(duration), 10) || 30;
    const dateStr = date.trim();
    let timeStr = time.trim();

    if (ampm && (ampm === 'AM' || ampm === 'PM')) {
      if (!/am|pm/i.test(timeStr)) {
        timeStr = `${timeStr} ${ampm}`;
      }
    }

    const combinedStr = `${dateStr} ${timeStr}`;

    let dt = DateTime.fromFormat(combinedStr, 'yyyy-MM-dd HH:mm', { zone: 'utc' });
    if (!dt.isValid) {
      dt = DateTime.fromFormat(combinedStr, 'yyyy-MM-dd h:mm a', { zone: 'utc' });
    }
    if (!dt.isValid) {
      dt = DateTime.fromFormat(combinedStr, 'yyyy-MM-dd hh:mm a', { zone: 'utc' });
    }
    if (!dt.isValid) {
      const nativeDate = new Date(combinedStr);
      if (!isNaN(nativeDate.getTime())) {
        dt = DateTime.fromJSDate(nativeDate, { zone: 'utc' });
      } else {
        const fallbackDate = new Date(`${dateStr}T12:00:00Z`);
        dt = DateTime.fromJSDate(fallbackDate, { zone: 'utc' });
      }
    }

    const startTimeISO = dt.toUTC().toISO() || new Date().toISOString();
    const endTimeISO = dt.plus({ minutes: durationMins }).toUTC().toISO() || new Date().toISOString();

    // 3. Construct meeting payload object
    const meetingId = `mtg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const meetCode = `${Math.random().toString(36).substring(2, 5)}-${Math.random().toString(36).substring(2, 6)}-${Math.random().toString(36).substring(2, 5)}`;
    const videoLink = `https://meet.google.com/${meetCode}`;

    const newMeeting: MeetingRecord = {
      id: meetingId,
      title: title.trim(),
      locations: Array.isArray(locations) ? locations.filter((l: any) => typeof l === 'string' && l.trim()) : [],
      guests: Array.isArray(guests) ? guests.filter((g: any) => typeof g === 'string' && g.trim()) : [],
      permissions: {
        modify: Boolean(permissions?.modify),
        inviteOther: permissions?.inviteOther !== undefined ? Boolean(permissions.inviteOther) : true,
        seeGuestList: Boolean(permissions?.seeGuestList),
      },
      date: dateStr,
      time: timeStr,
      duration: durationMins,
      availability: String(availability),
      visibility: String(visibility),
      additionalNotes: String(additionalNotes || ''),
      startTime: startTimeISO,
      endTime: endTimeISO,
      videoLink,
      status: 'SCHEDULED',
      createdAt: new Date().toISOString()
    };

    // Save to database
    meetingsDb.unshift(newMeeting);

    // 4. Return success response
    return res.status(201).json({
      success: true,
      message: 'Meeting created successfully.',
      meeting: newMeeting
    });

  } catch (error: any) {
    console.error('[Meeting Creation API Error]:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create meeting',
      message: error.message || 'Internal server error'
    });
  }
});

/**
 * POST /api/meetings/summary — AI meeting summary with action items.
 * Body: { title?: string, lines: { speaker, text, at? }[] }. Uses Gemini when
 * GEMINI_API_KEY is set, otherwise (or on failure) the on-device extractive summary.
 */
let summaryClient: GoogleGenAI | null | undefined;
function getSummaryClient(): GoogleGenAI | null {
  if (summaryClient !== undefined) return summaryClient;
  const key = process.env.GEMINI_API_KEY;
  summaryClient = key && !key.includes('placeholder') && !key.includes('YOUR_GEMINI_API_KEY') ? new GoogleGenAI({ apiKey: key }) : null;
  return summaryClient;
}

router.post('/summary', async (req: Request, res: Response) => {
  const raw = Array.isArray(req.body?.lines) ? req.body.lines : [];
  const title = typeof req.body?.title === 'string' ? req.body.title.slice(0, 200) : undefined;
  const lines: SummaryInputLine[] = raw.slice(0, 2000)
    .filter((l: any) => l && typeof l.text === 'string')
    .map((l: any) => ({ speaker: String(l.speaker || 'Unknown').slice(0, 80), text: String(l.text).slice(0, 2000), at: Number(l.at) || undefined }));
  const fallback = summarizeMeeting(lines, { title });

  const client = getSummaryClient();
  if (!client || lines.length === 0) return res.json(fallback);
  try {
    const transcript = lines.map((l) => `${l.speaker}: ${l.text}`).join('\n').slice(0, 60_000);
    const result = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Meeting: ${title || 'Untitled'}\n\n${transcript}`,
      config: {
        systemInstruction: 'Summarize this meeting for the attendees. Be factual; only use what is in the transcript. Keep each point to one sentence.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overview: { type: Type.STRING },
            keyPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
            decisions: { type: Type.ARRAY, items: { type: Type.STRING } },
            actionItems: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { text: { type: Type.STRING }, owner: { type: Type.STRING }, due: { type: Type.STRING } }, required: ['text'] } },
          },
          required: ['overview', 'keyPoints', 'actionItems'],
        },
      },
    });
    const parsed = JSON.parse(result.text || '{}');
    const summary: MeetingSummary = {
      overview: String(parsed.overview || fallback.overview),
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.map(String).slice(0, 10) : fallback.keyPoints,
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions.map(String).slice(0, 10) : fallback.decisions,
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.filter((a: any) => a?.text).map((a: any) => ({ text: String(a.text), ...(a.owner ? { owner: String(a.owner) } : {}), ...(a.due ? { due: String(a.due) } : {}) })).slice(0, 20) : fallback.actionItems,
      speakers: fallback.speakers,
      source: 'ai',
    };
    res.json(summary);
  } catch (err: any) {
    console.warn('[Meetings] AI summary failed, using on-device summary:', err?.message);
    res.json(fallback);
  }
});

export default router;
