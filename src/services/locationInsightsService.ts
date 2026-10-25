import { LRUCache, LocationInsights, LRUCacheStats } from '../utils/lruCache';

// Initial Mock Dataset for Locations
const MOCK_LOCATIONS_DATA: Record<string, Omit<LocationInsights, 'fetchedAt' | 'quotaSavedUnits'>> = {
  "loc-101": {
    locationId: "loc-101",
    locationName: "San Francisco Downtown HQ",
    city: "San Francisco, CA",
    searchViews: 14250,
    mapViews: 8910,
    directionRequests: 3120,
    phoneCallClicks: 1450,
    websiteClicks: 5230,
    averageRating: 4.9,
    totalReviews: 384,
    recentReviews: [
      { id: "r1", author: "Sarah Jenkins", rating: 5, text: "Outstanding WebRTC CRM consultation and super fast setup!", date: "2 hours ago" },
      { id: "r2", author: "David Miller", rating: 5, text: "The audio call clarity and real-time transcription are incredible.", date: "1 day ago" }
    ]
  },
  "loc-102": {
    locationId: "loc-102",
    locationName: "New York Midtown Hub",
    city: "New York, NY",
    searchViews: 22800,
    mapViews: 15400,
    directionRequests: 5890,
    phoneCallClicks: 2840,
    websiteClicks: 8920,
    averageRating: 4.8,
    totalReviews: 512,
    recentReviews: [
      { id: "r3", author: "Marcus Vance", rating: 5, text: "Seamless enterprise VoIP integration and customer support.", date: "3 hours ago" },
      { id: "r4", author: "Elena Rostova", rating: 4, text: "Great analytics dashboard metrics for multi-location teams.", date: "2 days ago" }
    ]
  },
  "loc-103": {
    locationId: "loc-103",
    locationName: "London Canary Wharf Office",
    city: "London, UK",
    searchViews: 11400,
    mapViews: 7200,
    directionRequests: 2450,
    phoneCallClicks: 980,
    websiteClicks: 4110,
    averageRating: 4.7,
    totalReviews: 218,
    recentReviews: [
      { id: "r5", author: "Oliver Wright", rating: 5, text: "Superb uptime and excellent media node quality.", date: "5 hours ago" }
    ]
  },
  "loc-104": {
    locationId: "loc-104",
    locationName: "Tokyo Shibuya Technology Center",
    city: "Tokyo, Japan",
    searchViews: 18900,
    mapViews: 12300,
    directionRequests: 4100,
    phoneCallClicks: 1620,
    websiteClicks: 6780,
    averageRating: 4.9,
    totalReviews: 420,
    recentReviews: [
      { id: "r6", author: "Kenji Sato", rating: 5, text: "Very smooth WebRTC call quality and zero latency.", date: "4 hours ago" }
    ]
  },
  "loc-105": {
    locationId: "loc-105",
    locationName: "Austin Innovation Lab",
    city: "Austin, TX",
    searchViews: 9800,
    mapViews: 6100,
    directionRequests: 1980,
    phoneCallClicks: 820,
    websiteClicks: 3450,
    averageRating: 4.8,
    totalReviews: 189,
    recentReviews: [
      { id: "r7", author: "Rachel Green", rating: 5, text: "Fantastic team collaboration tools!", date: "Yesterday" }
    ]
  },
  "loc-106": {
    locationId: "loc-106",
    locationName: "Berlin Tech Campus",
    city: "Berlin, Germany",
    searchViews: 8400,
    mapViews: 5200,
    directionRequests: 1640,
    phoneCallClicks: 710,
    websiteClicks: 2980,
    averageRating: 4.6,
    totalReviews: 145,
    recentReviews: [
      { id: "r8", author: "Hans Schmidt", rating: 5, text: "Reliable API response time and security.", date: "3 days ago" }
    ]
  }
};

class LocationInsightsService {
  private cache: LRUCache<string, LocationInsights>;
  private activityLogs: Array<{
    id: string;
    action: 'HIT' | 'MISS (API Call)' | 'EVICTION' | 'PUT';
    key: string;
    locationName: string;
    responseTimeMs: number;
    timestamp: string;
  }> = [];

  constructor(capacity: number = 4) { // Default capacity set to 4 to demonstrate LRU eviction clearly
    this.cache = new LRUCache<string, LocationInsights>(capacity);
    
    // Warm up cache with initial entries
    this.fetchLocationInsights("loc-101", false);
    this.fetchLocationInsights("loc-102", false);
    this.fetchLocationInsights("loc-103", false);
  }

  /**
   * Fetch Location Insights with LRU Cache layer O(1)
   */
  public async fetchLocationInsights(
    locationId: string, 
    simulateNetworkDelay: boolean = true
  ): Promise<{ data: LocationInsights; isFromCache: boolean; latencyMs: number }> {
    const startTime = performance.now();

    // 1. Check LRU Cache O(1)
    const cachedData = this.cache.get(locationId);

    if (cachedData) {
      const endTime = performance.now();
      const latencyMs = Number((endTime - startTime).toFixed(2));

      this.logActivity('HIT', locationId, cachedData.locationName, latencyMs);

      return {
        data: cachedData,
        isFromCache: true,
        latencyMs: Math.max(0.1, latencyMs)
      };
    }

    // 2. Cache Miss -> Simulate external Google Business API / Reviews API call (180ms - 350ms delay)
    if (simulateNetworkDelay) {
      await new Promise(resolve => setTimeout(resolve, 220));
    }

    const mockSource = MOCK_LOCATIONS_DATA[locationId] || {
      locationId,
      locationName: `Enterprise Branch ${locationId}`,
      city: "Global Hub",
      searchViews: 5000 + Math.floor(Math.random() * 5000),
      mapViews: 3000 + Math.floor(Math.random() * 3000),
      directionRequests: 1200 + Math.floor(Math.random() * 1000),
      phoneCallClicks: 500 + Math.floor(Math.random() * 500),
      websiteClicks: 2000 + Math.floor(Math.random() * 2000),
      averageRating: 4.8,
      totalReviews: 120,
      recentReviews: [
        { id: `r-${Date.now()}`, author: "Verified Client", rating: 5, text: "Great service and fast response times.", date: "Just now" }
      ]
    };

    const fetchedInsights: LocationInsights = {
      ...mockSource,
      fetchedAt: new Date().toLocaleTimeString(),
      quotaSavedUnits: 15 // Each API fetch saves 15 quota units when cached
    };

    // 3. Store in LRU Cache O(1)
    this.cache.put(locationId, fetchedInsights);

    const endTime = performance.now();
    const latencyMs = Number((endTime - startTime).toFixed(2));

    this.logActivity('MISS (API Call)', locationId, fetchedInsights.locationName, latencyMs);

    return {
      data: fetchedInsights,
      isFromCache: false,
      latencyMs
    };
  }

  public getCacheStats(): LRUCacheStats {
    return this.cache.getStats();
  }

  public getCacheEntries() {
    return this.cache.getOrderedEntries();
  }

  public setCapacity(newCapacity: number): void {
    this.cache.setCapacity(newCapacity);
  }

  public clearCache(): void {
    this.cache.clear();
    this.activityLogs = [];
  }

  public getActivityLogs() {
    return [...this.activityLogs];
  }

  private logActivity(
    action: 'HIT' | 'MISS (API Call)' | 'EVICTION' | 'PUT', 
    key: string, 
    locationName: string, 
    responseTimeMs: number
  ): void {
    this.activityLogs.unshift({
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      action,
      key,
      locationName,
      responseTimeMs,
      timestamp: new Date().toLocaleTimeString()
    });

    if (this.activityLogs.length > 20) {
      this.activityLogs.pop();
    }
  }
}

export const locationInsightsService = new LocationInsightsService(4);
