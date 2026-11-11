/**
 * /api/availability: the public booking page (PublicSchedulingPage).
 *
 *   GET  /status                 { configured }: whether online booking has a host organization
 *   GET  /event-types            the bookable meeting types
 *   GET  /:eventTypeSlug         free slots (?startDate&endDate&visitorTimezone)
 *   POST /book                   books a free slot: saved as a scheduled meeting in the host organization
 *                                (organizations/{orgId}/scheduled_meetings, source "public_booking"), so it
 *                                shows in the CRM calendar and blocks that time. 501 not_available when no
 *                                host is configured. Rate limited; the slot must still be free.
 *
 * The host organization comes from server configuration (BOOKING_HOST_ORG_ID + BOOKING_HOST_USER_ID),
 * never from the request. Nothing is simulated: a booking that isn't saved is never reported as booked.
 */
import { Router, Request, Response } from 'express';
import { DateTime } from 'luxon';
import { bookingHost, calculateAvailableSlots, EVENT_TYPES_DB } from '../services/availabilityService';
import { getDocStore, newId } from '../server/data/docStore';
import { sendError } from '../server/tenancy/middleware';
import { rateLimit } from '../features/social-accounts/server/http';
import { randomRoomCode } from '../server/meetings/sessions';

const router = Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const clientIp = (req: Request) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';

const NOT_AVAILABLE = { success: false, code: 'not_available', error: 'Online booking isn’t set up yet. Please contact us directly to arrange a time.' };

router.get('/status', (_req: Request, res: Response) => {
  res.json({ success: true, configured: bookingHost() !== null });
});

router.get('/event-types', (_req: Request, res: Response) => {
  const data = Object.values(EVENT_TYPES_DB).map((evt) => ({
    slug: evt.slug, name: evt.name, description: evt.description, durationMinutes: evt.durationMinutes,
    bufferBeforeMinutes: evt.bufferBeforeMinutes, bufferAfterMinutes: evt.bufferAfterMinutes, hostTimezone: evt.hostTimezone,
  }));
  res.json({ success: true, configured: bookingHost() !== null, data });
});

router.get('/:eventTypeSlug', async (req: Request, res: Response) => {
  try {
    const { eventTypeSlug } = req.params;
    const evt = EVENT_TYPES_DB[eventTypeSlug];
    if (!evt) return res.status(404).json({ success: false, code: 'not_found', error: 'That meeting type doesn’t exist.' });
    const hostZone = evt.hostTimezone;
    const visitorTimezone = str(req.query.visitorTimezone, 64) || str(req.query.tz, 64) || 'UTC';
    const startDate = str(req.query.startDate, 10) || DateTime.now().setZone(hostZone).toFormat('yyyy-MM-dd');
    const endDate = str(req.query.endDate, 10) || DateTime.now().setZone(hostZone).plus({ days: 7 }).toFormat('yyyy-MM-dd');
    if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
      return res.status(400).json({ success: false, code: 'invalid_input', error: 'Use dates like 2026-08-25.' });
    }
    let data;
    try {
      data = await calculateAvailableSlots({ eventTypeSlug, startDate, endDate, visitorTimezone });
    } catch {
      return res.status(400).json({ success: false, code: 'invalid_input', error: 'Check the dates: the end can’t be before the start, and the range can be at most 60 days.' });
    }
    res.json({ success: true, configured: bookingHost() !== null, data });
  } catch (err) { sendError(res, err, 'availability.slots'); }
});

const bookLimiter = rateLimit({ name: 'public-booking', windowMs: 10 * 60_000, max: 10, key: clientIp });

router.post('/book', bookLimiter, async (req: Request, res: Response) => {
  try {
    const host = bookingHost();
    if (!host) return res.status(501).json(NOT_AVAILABLE);
    const b = req.body ?? {};
    const eventTypeSlug = str(b.eventTypeSlug, 64);
    const clientName = str(b.clientName, 120);
    const clientEmail = str(b.clientEmail, 254).toLowerCase();
    const notes = str(b.notes, 2000);
    const company = str(b.company, 160);
    const phone = str(b.phone, 40);
    const fields: Record<string, string> = {};
    if (!clientName) fields.clientName = 'Enter your name.';
    if (!EMAIL_RE.test(clientEmail)) fields.clientEmail = 'Enter a valid email address.';
    const eventType = EVENT_TYPES_DB[eventTypeSlug];
    if (!eventType) fields.eventTypeSlug = 'Choose a meeting type.';
    const startDt = DateTime.fromISO(str(b.startTimeISO, 64), { setZone: true });
    if (!startDt.isValid) fields.startTimeISO = 'Choose a time.';
    if (Object.keys(fields).length) return res.status(400).json({ success: false, code: 'invalid_input', error: 'Check the highlighted fields.', fields });

    // The slot must still be free (working hours, buffers, existing bookings and the host's calendar).
    const hostDate = startDt.setZone(eventType.hostTimezone).toFormat('yyyy-MM-dd');
    const avail = await calculateAvailableSlots({ eventTypeSlug, startDate: hostDate, endDate: hostDate, visitorTimezone: 'UTC' });
    const slot = avail.slots.find((s) => Date.parse(s.startTimeUTC) === startDt.toMillis());
    if (!slot) return res.status(409).json({ success: false, code: 'slot_unavailable', error: 'That time is no longer available. Please pick another time.' });

    const start = DateTime.fromISO(slot.startTimeUTC, { zone: 'utc' });
    const end = start.plus({ minutes: eventType.durationMinutes });
    const roomCode = randomRoomCode();
    const base = (process.env.APP_URL || '').replace(/\/+$/, '');
    const now = new Date().toISOString();
    const occurrence = { startTime: start.toISO()!, endTime: end.toISO()! };
    const meeting = {
      id: newId('smt'), orgId: host.orgId,
      title: `${eventType.name}: ${clientName}`,
      guests: [clientEmail], locations: [], permissions: { modify: false, inviteOther: false, seeGuestList: false },
      date: start.toFormat('yyyy-MM-dd'), time: start.toFormat('HH:mm'), timezone: 'utc', duration: eventType.durationMinutes,
      availability: 'Busy', visibility: 'Default Visibility', additionalNotes: notes,
      recurrence: { frequency: 'none', count: 1 }, occurrences: [occurrence], startTime: occurrence.startTime, endTime: occurrence.endTime,
      roomCode, videoLink: base ? `${base}/?view=greet&meet=${roomCode}` : '', status: 'SCHEDULED',
      source: 'public_booking', eventTypeSlug, bookedBy: { name: clientName, email: clientEmail, company, phone },
      createdBy: host.userId, createdAt: now,
    };

    // One booking per slot, even when two visitors submit at the same moment.
    const st = await getDocStore();
    const lockPath = `organizations/${host.orgId}/booking_slots/${eventTypeSlug}_${start.toMillis()}`;
    const saved = await st.transaction(async (tx) => {
      if (await tx.get(lockPath)) return false;
      tx.set(lockPath, { meetingId: meeting.id, createdAt: now });
      tx.set(`organizations/${host.orgId}/scheduled_meetings/${meeting.id}`, meeting);
      return true;
    });
    if (!saved) return res.status(409).json({ success: false, code: 'slot_unavailable', error: 'That time was just booked. Please pick another time.' });

    res.status(201).json({
      success: true,
      message: 'Your meeting is booked.',
      data: {
        id: meeting.id, eventTypeSlug, eventTypeName: eventType.name, clientName, clientEmail,
        startTimeISO: occurrence.startTime, endTimeISO: occurrence.endTime, durationMinutes: eventType.durationMinutes,
        meetingLink: meeting.videoLink, status: 'CONFIRMED', createdAt: now,
      },
    });
  } catch (err) { sendError(res, err, 'availability.book'); }
});

export default router;
