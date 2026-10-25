/**
 * Sweepline Algorithm for Employee Free Time & Interval Intersections
 * Inspired by LeetCode #759 (Employee Free Time) & LeetCode #986 (Interval List Intersections)
 * 
 * Aggregates multi-user calendar schedules into time boundary events (+1 for start, -1 for end).
 * Sorts event points in O(N log N) time and sweeps across the timeline to detect mutual free slots.
 */

export interface ScheduleInterval {
  id: string;
  userId: string;
  userName: string;
  title: string;
  start: number; // Minutes from midnight (e.g., 540 = 09:00 AM)
  end: number;   // Minutes from midnight (e.g., 630 = 10:30 AM)
}

export interface FreeTimeSlot {
  id: string;
  start: number;
  end: number;
  durationMins: number;
  availableRooms: string[];
}

export interface SweeplineEvent {
  time: number;
  type: 'start' | 'end';
  userId: string;
  intervalId: string;
}

// Convert minutes from midnight to HH:MM display string
export function minsToTimeStr(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 === 0 ? 12 : h % 12;
  const mStr = m < 10 ? `0${m}` : `${m}`;
  return `${displayH}:${mStr} ${period}`;
}

const AVAILABLE_ROOMS = [
  "Conference Room Alpha (Cap: 12)",
  "Executive Boardroom B (Cap: 20)",
  "WebRTC Video Pod 1 (Cap: 4)",
  "Huddle Room Gamma (Cap: 6)"
];

/**
 * Sweepline algorithm to find common free time intervals for all users.
 * Time Complexity: O(N log N) where N is total number of busy intervals across all users.
 */
export function findMutualFreeTime(
  userSchedules: Record<string, ScheduleInterval[]>,
  workingHours: { start: number; end: number } = { start: 480, end: 1080 }, // 08:00 AM to 06:00 PM
  minDurationMins: number = 30
): {
  freeSlots: FreeTimeSlot[];
  eventPoints: SweeplineEvent[];
  totalBusyIntervalsCount: number;
  comparisonsCount: number;
} {
  const eventPoints: SweeplineEvent[] = [];
  let totalBusy = 0;

  // 1. Convert all intervals into Sweepline Event Points (+1 start, -1 end)
  Object.values(userSchedules).forEach((intervals) => {
    intervals.forEach((interval) => {
      // Clamp intervals to working hours
      const startClamped = Math.max(workingHours.start, interval.start);
      const endClamped = Math.min(workingHours.end, interval.end);

      if (startClamped < endClamped) {
        totalBusy++;
        eventPoints.push({
          time: startClamped,
          type: 'start',
          userId: interval.userId,
          intervalId: interval.id
        });
        eventPoints.push({
          time: endClamped,
          type: 'end',
          userId: interval.userId,
          intervalId: interval.id
        });
      }
    });
  });

  // 2. Sort event points by time:
  // If times match, 'end' (-1) events come BEFORE 'start' (+1) events to merge contiguous intervals.
  eventPoints.sort((a, b) => {
    if (a.time !== b.time) {
      return a.time - b.time;
    }
    // 'end' comes first
    if (a.type === 'end' && b.type === 'start') return -1;
    if (a.type === 'start' && b.type === 'end') return 1;
    return 0;
  });

  const freeSlots: FreeTimeSlot[] = [];
  let activeBusyCount = 0;
  let lastFreeStart = workingHours.start;
  let comparisons = 0;

  // 3. Sweepline processing across time boundary checkpoints
  for (const event of eventPoints) {
    comparisons++;

    if (activeBusyCount === 0 && event.time > lastFreeStart) {
      const gap = event.time - lastFreeStart;
      if (gap >= minDurationMins) {
        freeSlots.push({
          id: `slot-${lastFreeStart}-${event.time}`,
          start: lastFreeStart,
          end: event.time,
          durationMins: gap,
          availableRooms: AVAILABLE_ROOMS.slice(0, (gap >= 60 ? 4 : 2))
        });
      }
    }

    if (event.type === 'start') {
      activeBusyCount++;
    } else {
      activeBusyCount--;
    }

    if (activeBusyCount === 0) {
      lastFreeStart = event.time;
    }
  }

  // Final check between last busy event and working hours end
  if (lastFreeStart < workingHours.end) {
    const finalGap = workingHours.end - lastFreeStart;
    if (finalGap >= minDurationMins) {
      freeSlots.push({
        id: `slot-${lastFreeStart}-${workingHours.end}`,
        start: lastFreeStart,
        end: workingHours.end,
        durationMins: finalGap,
        availableRooms: AVAILABLE_ROOMS
      });
    }
  }

  return {
    freeSlots,
    eventPoints,
    totalBusyIntervalsCount: totalBusy,
    comparisonsCount: comparisons
  };
}
