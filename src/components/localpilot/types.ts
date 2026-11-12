export type LocalPilotRoute = 
  | 'dashboard'
  | 'locations'
  | 'location-detail'
  | 'reviews'
  | 'posts'
  | 'seo'
  | 'analytics'
  | 'security'
  | 'forms'
  | 'reports'
  | 'ai'
  | 'settings'
  | 'settings/team'
  | 'settings/integrations'
  | 'settings/billing';

export type TimeRange = '7D' | '30D' | '90D' | '1Y';

export interface LocationItem {
  id: string;
  name: string;
  category: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  website: string;
  status: 'Healthy' | 'Needs Attention' | 'Critical' | 'Pending Review';
  visibilityScore: number;
  visibilityChange: number; // e.g. +7.2%
  rating: number;
  reviewsCount: number;
  unansweredReviewsCount: number;
  profileCompleteness: number; // e.g. 96
  securityScore: number; // e.g. 100
  openIssuesCount: number;
  lastSync: string;
  hours: {
    monday: string;
    tuesday: string;
    wednesday: string;
    thursday: string;
    friday: string;
    saturday: string;
    sunday: string;
  };
  services: string[];
  missingServices: string[];
  attributes: {
    wheelchairAccessible: boolean;
    outdoorSeating: boolean;
    freeWifi: boolean;
    curbsidePickup: boolean;
    delivery: boolean;
    creditCards: boolean;
  };
  photosCount: number;
  lastPhotoAdded: string;
  /** This app's profile checks (from the server audit), not a Google metric. */
  auditChecks?: { id: string; group: string; label: string; passed: boolean }[];
  /** The full audit: state (pass/fail/unknown), section (profile quality vs listing status), evidence, action. */
  auditFindings?: AuditFinding[];
  /** Regular hours as Google returns them (for the hours editor). */
  regularHoursRaw?: { day: string; open: string; close: string }[];
  mapsUri?: string;
  /** Average rating is null when the location has no reviews yet. */
  hasRating?: boolean;
}

export interface ReviewItem {
  id: string;
  locationId: string;
  locationName: string;
  authorName: string;
  authorAvatar: string;
  rating: number;
  date: string;
  createdAt: string;
  content: string;
  sentiment: 'Positive' | 'Neutral' | 'Negative';
  topics: string[];
  status: 'unanswered' | 'answered' | 'flagged';
  reply?: {
    text: string;
    repliedAt: string;
    author: string;
  };
  suggestedAiReply?: string;
  aiThemes?: string[];
}

export type PostType = 'Announcement' | 'Offer' | 'Event' | 'Update';

export interface PostItem {
  id: string;
  locationId: string;
  locationName: string;
  type: PostType;
  title?: string;
  content: string;
  ctaType: 'LEARN_MORE' | 'BOOK' | 'ORDER' | 'CALL' | 'SIGN_UP' | 'NONE';
  ctaUrl?: string;
  imageUrl?: string;
  status: 'Published' | 'Scheduled' | 'Draft' | 'Needs Approval';
  isAiGenerated?: boolean;
  scheduledDate?: string; // YYYY-MM-DD
  publishedAt?: string;
  /** ISO time Google reports for the post (used for the calendar). */
  createdAt?: string;
  viewsCount?: number;
  clicksCount?: number;
  offerDetails?: {
    couponCode?: string;
    discountPercent?: number;
    terms?: string;
    expiresAt?: string;
  };
  eventDetails?: {
    startDate: string;
    endDate: string;
  };
}

export interface SeoOpportunity {
  id: string;
  title: string;
  description: string;
  category: 'Services' | 'Photos' | 'Reviews' | 'Profile' | 'Content' | 'Keywords';
  impact: 'High' | 'Medium' | 'Low';
  effort: 'Low' | 'Medium' | 'High';
  estimatedTime: string;
  locationId?: string;
  locationName?: string;
  actionType: 'fix_services' | 'add_photos' | 'reply_reviews' | 'create_post' | 'verify_hours' | 'update_attributes' | 'open_in_google';
  actionLabel: string;
}

export interface SeoAuditLog {
  id: string;
  date: string;
  score: number;
  scoreDelta: number;
  issuesCount: number;
  resolvedIssuesCount: number;
  status: 'Passed' | 'Action Needed' | 'Critical Warnings';
  auditedBy: string;
}

export interface SecurityActivity {
  id: string;
  date: string;
  time: string;
  event: string;
  actor: string;
  actorEmail: string;
  actorRole: string;
  locationName: string;
  status: 'verified' | 'warning' | 'alert';
  details: string;
}

export interface SecurityRecommendation {
  id: string;
  title: string;
  description: string;
  severity: 'High' | 'Medium' | 'Low';
  actionLabel: string;
  type: 'inactive_users' | '2fa_enforce' | 'permission_scope' | 'oauth_refresh';
}

export interface ReportItem {
  id: string;
  title: string;
  period: string;
  generatedDate: string;
  visibilityScore: number;
  reviewsDelta: number;
  customerActionsDelta: number;
  seoOpportunitiesCount: number;
  locationsCovered: number;
  format: 'PDF' | 'CSV' | 'Executive Summary';
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: 'Owner' | 'Admin' | 'Manager' | 'Review Approver' | 'Viewer' | 'Location Manager' | 'Review Moderator';
  locationsAccess: 'All Locations' | string;
  status: 'Active' | 'Invited' | 'Suspended';
  lastActive: string;
  twoFactorEnabled: boolean;
}

export interface AiChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  timestamp: string;
  text: string;
  actionableRecommendations?: {
    id: string;
    title: string;
    impact: 'High' | 'Medium' | 'Low';
    buttonLabel: string;
    actionType: string;
  }[];
}

/** Settings → Integrations row. */
export interface IntegrationItem {
  id: string;
  name: string;
  description: string;
  status: 'Connected' | 'Disconnected' | 'Error' | string;
  lastSynced: string;
  icon: string;
}

/** Settings → Billing summary. */
export interface BillingPlan {
  planName: string;
  monthlyPrice: number;
  locationsIncluded: string;
  nextBillingDate: string;
}

export interface AuditFinding {
  id: string; label: string; group: string; section: 'profile' | 'listing'; state: 'pass' | 'fail' | 'unknown';
  severity: 'high' | 'medium' | 'low' | 'info'; evidence: string;
  fix?: { title: string; description: string; actionType: string; actionLabel: string };
}
