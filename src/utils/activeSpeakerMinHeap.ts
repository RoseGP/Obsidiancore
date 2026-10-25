/**
 * Top-K Active Speaker Min-Heap Utility
 * Inspired by LeetCode #347 (Top K Frequent Elements) & #703 (Kth Largest Element in a Stream)
 * 
 * Maintained as a Min-Heap of size K (e.g., K=4 or K=9 for video gallery grid layout).
 * Processes high-frequency audio decibel updates in O(N log K) time complexity,
 * eliminating unnecessary full array sorting O(N log N) on every WebRTC audio meter frame.
 */

export interface SpeakerParticipant {
  id: string;
  name: string;
  role: string;
  img: string;
  audioLevel: number; // Decibels / Audio intensity (0 to 100)
  isMuted: boolean;
  avatarColor?: string;
  isPinned?: boolean;
}

export class TopKSpeakerHeap {
  private heap: SpeakerParticipant[] = [];
  private k: number;

  constructor(k: number = 4) {
    this.k = k;
  }

  public setK(newK: number): void {
    this.k = newK;
    while (this.heap.length > this.k) {
      this.extractMin();
    }
  }

  public getK(): number {
    return this.k;
  }

  public size(): number {
    return this.heap.length;
  }

  public peek(): SpeakerParticipant | null {
    return this.heap.length > 0 ? this.heap[0] : null;
  }

  /**
   * Process a participant stream update into the bounded Size-K Min-Heap.
   * Time Complexity: O(log K) per participant -> O(N log K) for full participant scan.
   */
  public addOrUpdate(participant: SpeakerParticipant): void {
    if (participant.isMuted) return;

    // Check if participant already exists in current heap
    const existingIdx = this.heap.findIndex(p => p.id === participant.id);

    if (existingIdx !== -1) {
      // Update element and re-heapify
      this.heap[existingIdx] = participant;
      this.heapifyFrom(existingIdx);
      return;
    }

    if (this.heap.length < this.k) {
      this.heap.push(participant);
      this.bubbleUp(this.heap.length - 1);
    } else if (participant.audioLevel > this.heap[0].audioLevel) {
      // Replace min root if current speaker is louder than the K-th loudest speaker
      this.heap[0] = participant;
      this.sinkDown(0);
    }
  }

  public extractMin(): SpeakerParticipant | null {
    if (this.heap.length === 0) return null;
    if (this.heap.length === 1) return this.heap.pop()!;

    const min = this.heap[0];
    this.heap[0] = this.heap.pop()!;
    this.sinkDown(0);
    return min;
  }

  /**
   * Returns top K speakers sorted descending by audio intensity for grid layout
   */
  public getTopK(): SpeakerParticipant[] {
    return [...this.heap].sort((a, b) => b.audioLevel - a.audioLevel);
  }

  public getRawHeap(): SpeakerParticipant[] {
    return [...this.heap];
  }

  private heapifyFrom(index: number): void {
    this.bubbleUp(index);
    this.sinkDown(index);
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.heap[index].audioLevel >= this.heap[parentIndex].audioLevel) break;
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

      if (leftChild < length && this.heap[leftChild].audioLevel < this.heap[smallest].audioLevel) {
        smallest = leftChild;
      }
      if (rightChild < length && this.heap[rightChild].audioLevel < this.heap[smallest].audioLevel) {
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
 * Computes Top-K active speakers out of N total room participants using Size-K Min-Heap.
 */
export function selectTopKActiveSpeakers(
  allParticipants: SpeakerParticipant[],
  k: number = 4
): {
  topKSpeakers: SpeakerParticipant[];
  heapState: SpeakerParticipant[];
  comparisonsCount: number;
} {
  const heap = new TopKSpeakerHeap(k);
  let comparisons = 0;

  for (const participant of allParticipants) {
    comparisons++;
    heap.addOrUpdate(participant);
  }

  return {
    topKSpeakers: heap.getTopK(),
    heapState: heap.getRawHeap(),
    comparisonsCount: comparisons
  };
}
