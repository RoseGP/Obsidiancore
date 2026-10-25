/**
 * Min-Heap Priority Queue & Interval Sweep Algorithm
 * Inspired by LeetCode #253 (Meeting Rooms II) & #56 (Merge Intervals)
 * 
 * Used for dynamic allocation of media server resources, tracking active
 * WebRTC streams, detecting room capacity spikes, and calculating 
 * bandwidth consumption in O(log N) time complexity.
 */

export interface ActiveMeetingSession {
  id: string;
  title: string;
  host: string;
  startTime: number; // Unix timestamp or minutes from midnight
  endTime: number;   // Unix timestamp or minutes from midnight
  bandwidthMbps: number;
  serverNode: string;
  participantsCount: number;
}

export class MeetingMinHeap {
  private heap: ActiveMeetingSession[] = [];

  constructor(initialSessions: ActiveMeetingSession[] = []) {
    for (const session of initialSessions) {
      this.insert(session);
    }
  }

  public get size(): number {
    return this.heap.length;
  }

  public peek(): ActiveMeetingSession | null {
    return this.heap.length > 0 ? this.heap[0] : null;
  }

  public insert(session: ActiveMeetingSession): void {
    this.heap.push(session);
    this.bubbleUp(this.heap.length - 1);
  }

  public extractMin(): ActiveMeetingSession | null {
    if (this.heap.length === 0) return null;
    if (this.heap.length === 1) return this.heap.pop()!;

    const min = this.heap[0];
    this.heap[0] = this.heap.pop()!;
    this.sinkDown(0);
    return min;
  }

  public toArray(): ActiveMeetingSession[] {
    return [...this.heap];
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.heap[index].endTime >= this.heap[parentIndex].endTime) break;
      this.swap(index, parentIndex);
      index = parentIndex;
    }
  }

  private sinkDown(index: number): void {
    const length = this.heap.length;
    while (true) {
      let smallest = index;
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;

      if (leftChild < length && this.heap[leftChild].endTime < this.heap[smallest].endTime) {
        smallest = leftChild;
      }
      if (rightChild < length && this.heap[rightChild].endTime < this.heap[smallest].endTime) {
        smallest = rightChild;
      }

      if (smallest === index) break;
      this.swap(index, smallest);
      index = smallest;
    }
  }

  private swap(i: number, j: number): void {
    const temp = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = temp;
  }
}

/**
 * Calculates required media server rooms, peak concurrency, and server node load
 * using Min-Heap (LeetCode #253 Meeting Rooms II algorithm).
 */
export function calculateConcurrentRooms(sessions: ActiveMeetingSession[]): {
  minRoomsRequired: number;
  peakBandwidthMbps: number;
  overlappingClusters: Array<{
    concurrentCount: number;
    sessions: ActiveMeetingSession[];
    totalBandwidth: number;
  }>;
  serverNodeDistribution: Record<string, number>;
} {
  if (sessions.length === 0) {
    return {
      minRoomsRequired: 0,
      peakBandwidthMbps: 0,
      overlappingClusters: [],
      serverNodeDistribution: {}
    };
  }

  // Sort sessions by start time O(N log N)
  const sortedSessions = [...sessions].sort((a, b) => a.startTime - b.startTime);

  const heap = new MeetingMinHeap();
  let maxConcurrentRooms = 0;
  let peakBandwidth = 0;
  const serverNodeMap: Record<string, number> = {};

  for (const session of sortedSessions) {
    // Free rooms whose meetings have ended before this session starts
    while (heap.size > 0 && heap.peek()!.endTime <= session.startTime) {
      heap.extractMin();
    }

    // Allocate room for current session
    heap.insert(session);

    // Track server node load
    serverNodeMap[session.serverNode] = (serverNodeMap[session.serverNode] || 0) + 1;

    // Evaluate peak state
    if (heap.size > maxConcurrentRooms) {
      maxConcurrentRooms = heap.size;
    }

    const currentBandwidth = heap.toArray().reduce((acc, curr) => acc + curr.bandwidthMbps, 0);
    if (currentBandwidth > peakBandwidth) {
      peakBandwidth = currentBandwidth;
    }
  }

  return {
    minRoomsRequired: maxConcurrentRooms,
    peakBandwidthMbps: peakBandwidth,
    overlappingClusters: [
      {
        concurrentCount: maxConcurrentRooms,
        sessions: sortedSessions,
        totalBandwidth: peakBandwidth
      }
    ],
    serverNodeDistribution: serverNodeMap
  };
}
