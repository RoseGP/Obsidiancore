import { Router, Request, Response } from 'express';
import { DateTime } from 'luxon';
import { 
  calculateAvailableSlots, 
  EVENT_TYPES_DB, 
  AvailabilityRequest 
} from '../services/availabilityService';

const router = Router();

/**
 * GET /api/availability/event-types
 * Returns metadata for all available scheduling event types.
 */
router.get('/event-types', (req: Request, res: Response) => {
  try {
    const eventTypes = Object.values(EVENT_TYPES_DB).map(evt => ({
      slug: evt.slug,
      name: evt.name,
      description: evt.description,
      durationMinutes: evt.durationMinutes,
      bufferBeforeMinutes: evt.bufferBeforeMinutes,
      bufferAfterMinutes: evt.bufferAfterMinutes,
      hostTimezone: evt.hostTimezone,
    }));

    return res.json({
      success: true,
      data: eventTypes
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/availability/:eventTypeSlug
 * 
 * Query Parameters:
 *  - startDate (optional, e.g. "2026-07-21")
 *  - endDate (optional, e.g. "2026-07-28")
 *  - visitorTimezone (optional, e.g. "America/Los_Angeles", "Europe/London", "UTC")
 */
router.get('/:eventTypeSlug', async (req: Request, res: Response) => {
  try {
    const { eventTypeSlug } = req.params;

    // Validate event type slug exists
    if (!EVENT_TYPES_DB[eventTypeSlug]) {
      return res.status(404).json({
        success: false,
        error: `Event type '${eventTypeSlug}' not found. Available event types: ${Object.keys(EVENT_TYPES_DB).join(', ')}`
      });
    }

    const hostZone = EVENT_TYPES_DB[eventTypeSlug].hostTimezone;

    // Default parameters if not explicitly provided
    const visitorTimezone = (req.query.visitorTimezone as string) || (req.query.tz as string) || 'America/Los_Angeles';
    
    const todayHost = DateTime.now().setZone(hostZone).toFormat('yyyy-MM-dd');
    const defaultEnd = DateTime.now().setZone(hostZone).plus({ days: 7 }).toFormat('yyyy-MM-dd');

    const startDate = (req.query.startDate as string) || todayHost;
    const endDate = (req.query.endDate as string) || defaultEnd;

    // Prepare availability payload calculation
    const availabilityPayload: AvailabilityRequest = {
      eventTypeSlug,
      startDate,
      endDate,
      visitorTimezone
    };

    const result = await calculateAvailableSlots(availabilityPayload);

    return res.json({
      success: true,
      data: result
    });

  } catch (error: any) {
    console.error('[Availability Engine API Error]:', error);
    return res.status(400).json({
      success: false,
      error: error.message || 'Failed to calculate scheduling availability slots.'
    });
  }
});

/**
 * POST /api/availability/book
 * Simulates reserving and creating a calendar booking appointment.
 */
router.post('/book', async (req: Request, res: Response) => {
  try {
    const { eventTypeSlug, startTimeISO, clientName, clientEmail, notes } = req.body;

    if (!eventTypeSlug || !startTimeISO || !clientEmail || !clientName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: eventTypeSlug, startTimeISO, clientName, clientEmail.'
      });
    }

    const eventType = EVENT_TYPES_DB[eventTypeSlug];
    if (!eventType) {
      return res.status(404).json({ success: false, error: 'Invalid event type slug.' });
    }

    const startDt = DateTime.fromISO(startTimeISO);
    if (!startDt.isValid) {
      return res.status(400).json({ success: false, error: 'Invalid startTimeISO format.' });
    }

    const endDt = startDt.plus({ minutes: eventType.durationMinutes });

    // In a production system, this creates a record in Firestore/SQL and dispatches a Google/Outlook Calendar API invite & Nodemailer confirmation
    const newAppointment = {
      id: `booking_${Date.now()}`,
      eventTypeSlug,
      eventTypeName: eventType.name,
      clientName,
      clientEmail,
      notes: notes || '',
      startTimeISO: startDt.toISO(),
      endTimeISO: endDt.toISO(),
      durationMinutes: eventType.durationMinutes,
      status: 'CONFIRMED',
      createdAt: new Date().toISOString()
    };

    return res.status(201).json({
      success: true,
      message: 'Appointment scheduled successfully!',
      data: newAppointment
    });

  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
