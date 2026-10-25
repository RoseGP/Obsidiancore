/**
 * High-Performance In-Memory LRU (Least Recently Used) Cache
 * Implements O(1) time complexity for get and put operations using a
 * Doubly Linked List combined with a Hash Map.
 *
 * Used for caching location insights (search views, calls, directions, reviews)
 * to prevent API quota exhaustion and eliminate redundant network roundtrips.
 */

export class LRUNode<K, V> {
  public key: K;
  public val: V;
  public prev: LRUNode<K, V> | null = null;
  public next: LRUNode<K, V> | null = null;
  public timestamp: number;

  constructor(key: K, val: V) {
    this.key = key;
    this.val = val;
    this.timestamp = Date.now();
  }
}

export interface LRUCacheStats {
  capacity: number;
  size: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRatioPct: number;
}

export class LRUCache<K, V> {
  private capacity: number;
  private map: Map<K, LRUNode<K, V>> = new Map();
  private head: LRUNode<K, V>; // Dummy head (Most Recently Used)
  private tail: LRUNode<K, V>; // Dummy tail (Least Recently Used)
  
  private hitsCount: number = 0;
  private missesCount: number = 0;
  private evictionsCount: number = 0;

  constructor(capacity: number = 50) {
    this.capacity = capacity;

    // Initialize dummy head and tail
    this.head = new LRUNode<K, V>(null as unknown as K, null as unknown as V);
    this.tail = new LRUNode<K, V>(null as unknown as K, null as unknown as V);

    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  /**
   * O(1) Get Operation:
   * Retrieves value from Hash Map, moves node to head (MRU), and updates stats.
   */
  public get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) {
      this.missesCount++;
      return undefined;
    }

    this.hitsCount++;
    this.moveToHead(node);
    return node.val;
  }

  /**
   * O(1) Put Operation:
   * Inserts or updates node. If cache exceeds capacity, evicts tail.prev (LRU).
   */
  public put(key: K, value: V): void {
    const existingNode = this.map.get(key);

    if (existingNode) {
      existingNode.val = value;
      existingNode.timestamp = Date.now();
      this.moveToHead(existingNode);
      return;
    }

    // Insert new node
    const newNode = new LRUNode(key, value);
    this.map.set(key, newNode);
    this.addNodeToHead(newNode);

    // Evict least recently used if over capacity
    if (this.map.size > this.capacity) {
      this.evictLRU();
    }
  }

  /**
   * O(1) Remove Operation
   */
  public remove(key: K): boolean {
    const node = this.map.get(key);
    if (!node) return false;

    this.removeNode(node);
    this.map.delete(key);
    return true;
  }

  /**
   * Resize cache capacity dynamically
   */
  public setCapacity(newCapacity: number): void {
    this.capacity = newCapacity;
    while (this.map.size > this.capacity) {
      this.evictLRU();
    }
  }

  /**
   * Clear cache completely
   */
  public clear(): void {
    this.map.clear();
    this.head.next = this.tail;
    this.tail.prev = this.head;
    this.hitsCount = 0;
    this.missesCount = 0;
    this.evictionsCount = 0;
  }

  /**
   * Returns list of cached items ordered from Most Recently Used (MRU) to Least Recently Used (LRU)
   */
  public getOrderedEntries(): Array<{ key: K; value: V; timestamp: number }> {
    const entries: Array<{ key: K; value: V; timestamp: number }> = [];
    let curr = this.head.next;

    while (curr && curr !== this.tail) {
      entries.push({
        key: curr.key,
        value: curr.val,
        timestamp: curr.timestamp
      });
      curr = curr.next;
    }

    return entries;
  }

  /**
   * Returns live performance telemetry stats
   */
  public getStats(): LRUCacheStats {
    const totalRequests = this.hitsCount + this.missesCount;
    const hitRatioPct = totalRequests > 0 ? (this.hitsCount / totalRequests) * 100 : 0;

    return {
      capacity: this.capacity,
      size: this.map.size,
      hits: this.hitsCount,
      misses: this.missesCount,
      evictions: this.evictionsCount,
      hitRatioPct: Number(hitRatioPct.toFixed(1))
    };
  }

  // --- Internal Doubly Linked List Operations O(1) ---

  private addNodeToHead(node: LRUNode<K, V>): void {
    node.prev = this.head;
    node.next = this.head.next;

    if (this.head.next) {
      this.head.next.prev = node;
    }
    this.head.next = node;
  }

  private removeNode(node: LRUNode<K, V>): void {
    const prevNode = node.prev;
    const nextNode = node.next;

    if (prevNode) prevNode.next = nextNode;
    if (nextNode) nextNode.prev = prevNode;
  }

  private moveToHead(node: LRUNode<K, V>): void {
    this.removeNode(node);
    this.addNodeToHead(node);
  }

  private evictLRU(): void {
    const lruNode = this.tail.prev;
    if (lruNode && lruNode !== this.head) {
      this.removeNode(lruNode);
      this.map.delete(lruNode.key);
      this.evictionsCount++;
    }
  }
}

/**
 * Interface representing location insights data cached in LRU cache
 */
export interface LocationInsights {
  locationId: string;
  locationName: string;
  city: string;
  searchViews: number;
  mapViews: number;
  directionRequests: number;
  phoneCallClicks: number;
  websiteClicks: number;
  averageRating: number;
  totalReviews: number;
  recentReviews: Array<{
    id: string;
    author: string;
    rating: number;
    text: string;
    date: string;
  }>;
  fetchedAt: string;
  quotaSavedUnits: number;
}
