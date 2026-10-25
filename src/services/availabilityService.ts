import { DateTime, Interval } from 'luxon';
import { gcalDataStore } from './gcalTokenService';

// --- TYPES & INTERFACES ---

export interface EventTypeConfig {
  id: string;
  slug: string;
  name: string;
  description: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  slotIntervalMinutes: number; // Increment step between potential start times (e.g., every 15 or 30 mins)
  hostTimezone: string; // e.g. 'America/New_York'
  workingHours: WorkingHourRule[];
}

export interface WorkingHourRule {
  dayOfWeek: number; // 1 = Monday, 7 = Sunday (Luxon weekday standard)
  startTime: string; // "09:00"
  endTime: string;   // "17:00"
}

export interface BusyBlock {
  start: string; // ISO 8601 string
  end: string;   // ISO 8601 string
  source: 'INTERNAL_BOOKING' | 'GOOGLE_CALENDAR' | 'OUTLOOK_CALENDAR' | 'HOLIDAY';
  summary?: string;
}

export interface AvailabilityRequest {
  eventTypeSlug: string;
  startDate: string; // "YYYY-MM-DD"
  endDate: string;   // "YYYY-MM-DD"
  visitorTimezone: string; // e.g. "America/Los_Angeles"
}

export interface CalculatedSlot {
  startTimeISO: string;      // ISO string formatted in visitor's local timezone
  endTimeISO: string;        // ISO string formatted in visitor's local timezone
  startTimeUTC: string;      // UTC ISO string
  endTimeUTC: string;        // UTC ISO string
  visitorFormattedTime: string; // e.g. "09:00 AM"
  visitorFormattedDate: string; // e.g. "Tuesday, Jul 21, 2026"
  hostFormattedTime: string;    // e.g. "12:00 PM EDT"
}

export interface AvailabilityResponse {
  eventType: {
    slug: string;
    name: string;
    durationMinutes: number;
    hostTimezone: string;
  };
  range: {
    startDate: string;
    endDate: string;
    visitorTimezone: string;
  };
  totalSlotsAvailable: number;
  groupedByDate: Record<string, CalculatedSlot[]>; // "YYYY-MM-DD" -> slots
  slots: CalculatedSlot[];
}

// --- MOCK HOST CONFIGURATION & DATABASE RETRIEVAL ---

export const EVENT_TYPES_DB: Record<string, EventTypeConfig> = {
  'discovery-call': {
    id: 'evt_101',
    slug: 'discovery-call',
    name: '15-Min Strategy Discovery',
    description: 'Quick introductory call to align on high-impact growth strategy.',
    durationMinutes: 15,
    bufferBeforeMinutes: 5,
    bufferAfterMinutes: 10,
    slotIntervalMinutes: 15,
    hostTimezone: 'America/New_York',
    workingHours: [
      { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' }, // Monday
      { dayOfWeek: 2, startTime: '09:00', endTime: '17:00' }, // Tuesday
      { dayOfWeek: 3, startTime: '09:00', endTime: '17:00' }, // Wednesday
      { dayOfWeek: 4, startTime: '09:00', endTime: '17:00' }, // Thursday
      { dayOfWeek: 5, startTime: '09:00', endTime: '16:00' }, // Friday
    ],
  },
  'strategy-session': {
    id: 'evt_102',
    slug: 'strategy-session',
    name: '30-Min Growth Strategy Session',
    description: 'Deep dive consultation to build your custom marketing roadmap.',
    durationMinutes: 30,
    bufferBeforeMinutes: 15,
    bufferAfterMinutes: 15,
    slotIntervalMinutes: 30,
    hostTimezone: 'America/New_York',
    workingHours: [
      { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
      { dayOfWeek: 2, startTime: '09:00', endTime: '17:00' },
      { dayOfWeek: 3, startTime: '09:00', endTime: '17:00' },
      { dayOfWeek: 4, startTime: '09:00', endTime: '17:00' },
      { dayOfWeek: 5, startTime: '09:00', endTime: '16:00' },
    ],
  },
  'product-demo': {
    id: 'evt_103',
    slug: 'product-demo',
    name: '45-Min Enterprise Product Demo',
    description: 'Live interactive demonstration of omnichannel CRM features and WebRTC engine.',
    durationMinutes: 45,
    bufferBeforeMinutes: 15,
    bufferAfterMinutes: 15,
    slotIntervalMinutes: 15,
    hostTimezone: 'America/New_York',
    workingHours: [
      { dayOfWeek: 1, startTime: '10:00', endTime: '16:00' },
      { dayOfWeek: 2, startTime: '10:00', endTime: '16:00' },
      { dayOfWeek: 3, startTime: '10:00', endTime: '16:00' },
      { dayOfWeek: 4, startTime: '10:00', endTime: '16:00' },
      { dayOfWeek: 5, startTime: '10:00', endTime: '15:00' },
    ],
  },
};

/**
 * Simulates fetching existing booked CRM appointments from the internal database.
 */
async function fetchInternalBookings(hostId: string, rangeStart: DateTime, rangeEnd: DateTime): Promise<BusyBlock[]> {
  // Mock internal bookings in UTC
  const sampleDate = rangeStart.toFormat('yyyy-MM-dd');
  return [
    {
      start: `${sampleDate}T13:00:00Z`,
      end: `${sampleDate}T14:00:00Z`,
      source: 'INTERNAL_BOOKING',
      summary: 'Executive Client Review',
    },
    {
      start: `${sampleDate}T18:30:00Z`,
      end: `${sampleDate}T19:00:00Z`,
      source: 'INTERNAL_BOOKING',
      summary: 'Team Standup',
    },
  ];
}

/**
 * Fetches external calendar busy blocks (Google Calendar / Microsoft Outlook Graph API)
 * including live synchronized events received via Webhooks.
 */
async function fetchExternalCalendarBusyBlocks(hostId: string, rangeStart: DateTime, rangeEnd: DateTime): Promise<BusyBlock[]> {
  const sampleDate = rangeStart.toFormat('yyyy-MM-dd');
  
  const defaultExternalBusy: BusyBlock[] = [
    {
      start: `${sampleDate}T15:00:00Z`,
      end: `${sampleDate}T16:00:00Z`,
      source: 'GOOGLE_CALENDAR',
      summary: 'External Doctor Appointment',
    },
    {
      start: `${sampleDate}T20:00:00Z`,
      end: `${sampleDate}T21:00:00Z`,
      source: 'OUTLOOK_CALENDAR',
      summary: 'Board Meeting',
    },
  ];

  // Fetch live synchronized Google Calendar events from gcalDataStore
  const liveSyncedGCalEvents = gcalDataStore.getSyncedEvents();
  const liveGCalBusyBlocks: BusyBlock[] = liveSyncedGCalEvents
    .filter(evt => evt.status === 'confirmed' && evt.startISO && evt.endISO)
    .map(evt => ({
      start: evt.startISO,
      end: evt.endISO,
      source: 'GOOGLE_CALENDAR',
      summary: evt.summary,
    }));

  return [...defaultExternalBusy, ...liveGCalBusyBlocks];
}

// --- CORE ALGORITHM ENGINE ---

/**
 * High-performance interval merging algorithm.
 * Takes a list of time intervals [start, end] and merges overlapping or contiguous blocks into disjoint sorted blocks.
 * O(N log N) complexity.
 */
export function mergeBusyIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length <= 1) return intervals;

  // Filter out invalid intervals (e.g. start >= end)
  const validIntervals = intervals.filter(i => i.isValid && i.length('minutes') > 0);
  if (validIntervals.length === 0) return [];

  // Sort intervals by start time ascending
  const sorted = validIntervals.sort((a, b) => a.start.toMillis() - b.start.toMillis());

  const merged: Interval[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const lastMerged = merged[merged.length - 1];

    // If current interval overlaps with or abuts last merged interval
    if (current.start <= lastMerged.end) {
      // Extend the end of the last merged interval if current ends later
      if (current.end > lastMerged.end) {
        merged[merged.length - 1] = Interval.fromDateTimes(lastMerged.start, current.end);
      }
    } else {
      merged.push(current);
    }
  }

  return merged;
}

/**
 * Expand busy blocks by pre/post event buffer times.
 * Example: A meeting from 10:00 to 11:00 with 15 min buffer before and after becomes 09:45 to 11:15.
 */
export function applyBuffersToBusyBlocks(
  busyBlocks: BusyBlock[],
  bufferBeforeMinutes: number,
  bufferAfterMinutes: number
): Interval[] {
  return busyBlocks.map(block => {
    const startDt = DateTime.fromISO(block.start).minus({ minutes: bufferBeforeMinutes });
    const endDt = DateTime.fromISO(block.end).plus({ minutes: bufferAfterMinutes });
    return Interval.fromDateTimes(startDt, endDt);
  });
}

/**
 * Main Availability Calculation Function
 */
export async function calculateAvailableSlots(params: AvailabilityRequest): Promise<AvailabilityResponse> {
  const { eventTypeSlug, startDate, endDate, visitorTimezone } = params;

  // 1. Retrieve Event Type configuration
  const eventType = EVENT_TYPES_DB[eventTypeSlug];
  if (!eventType) {
    throw new Error(`Event type '${eventTypeSlug}' not found.`);
  }

  // Validate Visitor Timezone
  const validVisitorZone = DateTime.local().setZone(visitorTimezone).isValid ? visitorTimezone : 'UTC';

  // Parse start and end date boundaries in host timezone
  const hostZone = eventType.hostTimezone;
  const startDt = DateTime.fromISO(startDate, { zone: hostZone }).startOf('day');
  const endDt = DateTime.fromISO(endDate, { zone: hostZone }).endOf('day');

  if (!startDt.isValid || !endDt.isValid) {
    throw new Error('Invalid date parameters provided. Use YYYY-MM-DD format.');
  }

  if (endDt < startDt) {
    throw new Error('endDate must be greater than or equal to startDate.');
  }

  // Cap max search window to prevent excessive memory/CPU utilization (e.g. max 60 days)
  const daysDiff = endDt.diff(startDt, 'days').days;
  if (daysDiff > 60) {
    throw new Error('Requested date range exceeds maximum allowed limit of 60 days.');
  }

  // 2. Fetch existing busy blocks (Database + Google/Outlook APIs)
  const [internalBookings, externalBusy] = await Promise.all([
    fetchInternalBookings('host_1', startDt, endDt),
    fetchExternalCalendarBusyBlocks('host_1', startDt, endDt)
  ]);

  const rawBusyBlocks = [...internalBookings, ...externalBusy];

  // 3. Apply Buffer Times & Merge Overlapping Busy Intervals
  const bufferedIntervals = applyBuffersToBusyBlocks(
    rawBusyBlocks,
    eventType.bufferBeforeMinutes,
    eventType.bufferAfterMinutes
  );

  const mergedBusyIntervals = mergeBusyIntervals(bufferedIntervals);

  // 4. Generate Daily Working Windows & Slice Slots
  const availableSlots: CalculatedSlot[] = [];
  const groupedByDate: Record<string, CalculatedSlot[]> = {};

  const nowUTC = DateTime.utc();

  // Iterate through each calendar day in the date range
  let currentDay = startDt;
  while (currentDay <= endDt) {
    const dayOfWeek = currentDay.weekday; // 1 (Mon) -> 7 (Sun)
    const dayRules = eventType.workingHours.filter(rule => rule.dayOfWeek === dayOfWeek);

    for (const rule of dayRules) {
      // Parse working hours start & end in host timezone for this specific day
      const [startHour, startMin] = rule.startTime.split(':').map(Number);
      const [endHour, endMin] = rule.endTime.split(':').map(Number);

      const windowStartHost = currentDay.set({ hour: startHour, minute: startMin, second: 0, millisecond: 0 });
      const windowEndHost = currentDay.set({ hour: endHour, minute: endMin, second: 0, millisecond: 0 });

      if (!windowStartHost.isValid || !windowEndHost.isValid || windowStartHost >= windowEndHost) {
        continue;
      }

      // Slice window into candidate slots using increment step (e.g. every 15 or 30 mins)
      let candidateStart = windowStartHost;
      const duration = eventType.durationMinutes;
      const step = eventType.slotIntervalMinutes;

      while (candidateStart.plus({ minutes: duration }) <= windowEndHost) {
        const candidateEnd = candidateStart.plus({ minutes: duration });
        
        // Include buffer check for candidate slot itself
        const candidateSlotWithBuffer = Interval.fromDateTimes(
          candidateStart.minus({ minutes: eventType.bufferBeforeMinutes }),
          candidateEnd.plus({ minutes: eventType.bufferAfterMinutes })
        );

        // Check if candidate slot falls in the past (must be at least 15 mins in future)
        const isFuture = candidateStart.toUTC() > nowUTC.plus({ minutes: 15 });

        // Check for collision with any merged busy interval
        const hasCollision = mergedBusyIntervals.some(busy => busy.overlaps(candidateSlotWithBuffer));

        if (isFuture && !hasCollision) {
          // Convert times safely to visitor's requested local timezone
          const startVisitor = candidateStart.setZone(validVisitorZone);
          const endVisitor = candidateEnd.setZone(validVisitorZone);

          const slotDateKey = startVisitor.toFormat('yyyy-MM-dd');

          const slotObj: CalculatedSlot = {
            startTimeISO: startVisitor.toISO() || '',
            endTimeISO: endVisitor.toISO() || '',
            startTimeUTC: candidateStart.toUTC().toISO() || '',
            endTimeUTC: candidateEnd.toUTC().toISO() || '',
            visitorFormattedTime: startVisitor.toFormat('hh:mm a'),
            visitorFormattedDate: startVisitor.toFormat('EEEE, MMM d, yyyy'),
            hostFormattedTime: `${candidateStart.toFormat('hh:mm a')} ${candidateStart.offsetNameShort}`,
          };

          availableSlots.push(slotObj);

          if (!groupedByDate[slotDateKey]) {
            groupedByDate[slotDateKey] = [];
          }
          groupedByDate[slotDateKey].push(slotObj);
        }

        // Increment to next candidate start time
        candidateStart = candidateStart.plus({ minutes: step });
      }
    }

    currentDay = currentDay.plus({ days: 1 });
  }

  return {
    eventType: {
      slug: eventType.slug,
      name: eventType.name,
      durationMinutes: eventType.durationMinutes,
      hostTimezone: eventType.hostTimezone,
    },
    range: {
      startDate,
      endDate,
      visitorTimezone: validVisitorZone,
    },
    totalSlotsAvailable: availableSlots.length,
    groupedByDate,
    slots: availableSlots,
  };
}
