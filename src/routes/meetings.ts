import { Router, Request, Response } from 'express';
import { DateTime } from 'luxon';

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

export default router;
