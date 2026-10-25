export type SocialPlatform = 
  | 'linkedin' 
  | 'instagram' 
  | 'facebook' 
  | 'twitter' 
  | 'tiktok' 
  | 'youtube'
  | 'thread' 
  | 'pinterest';

export type SocialPostStatus = 'DRAFT' | 'REVIEW' | 'SCHEDULED' | 'PUBLISHED' | 'FAILED' | 'PROCESSING';

export interface SocialLinkPreview {
  url: string;
  title: string;
  description: string;
  image?: string;
  domain: string;
}

export interface SocialPost {
  id: string;
  caption: string;
  platforms: SocialPlatform[];
  scheduledAt: string; // ISO date string or formatted date string
  publishedAt?: string;
  status: SocialPostStatus | string;
  workflowStage?: 'draft' | 'review' | 'scheduled' | 'published' | 'failed';
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
  mediaUrl?: string;
  mediaUrls?: string[];
  mediaName?: string;
  mediaType?: 'image' | 'video';
  videoUrl?: string;
  linkPreview?: SocialLinkPreview;
  hashtags?: string[];
  mentions?: string[];
  errorLog?: string;
  retryCount?: number;
  createdAt?: string;
  updatedAt?: string;
  author?: {
    name: string;
    avatar: string;
    role?: string;
  };
}

export interface SocialDraft {
  id: string;
  caption: string;
  mediaUrl?: string;
  mediaName?: string;
  mediaType?: 'image' | 'video';
  platforms: SocialPlatform[];
  hashtags?: string[];
  mentions?: string[];
  linkPreview?: SocialLinkPreview;
  createdAt?: any;
  updatedAt?: any;
}

export interface PlatformConnection {
  connected: boolean;
  handle: string;
  metric: string;
  metricName: string;
  avatar?: string;
}

export type PlatformConnectionsMap = Record<SocialPlatform, PlatformConnection>;

export interface PlatformConfig {
  id: SocialPlatform;
  name: string;
  shortName: string;
  color: string;
  bgColor: string;
  borderColor: string;
  textColor: string;
  charLimit: number;
  maxMedia: number;
  iconName: string;
  description: string;
}

export const PLATFORM_CONFIGS: Record<SocialPlatform, PlatformConfig> = {
  linkedin: {
    id: 'linkedin',
    name: 'LinkedIn',
    shortName: 'in',
    color: '#0A66C2',
    bgColor: 'bg-[#0A66C2]',
    borderColor: 'border-blue-500/30',
    textColor: 'text-[#0A66C2]',
    charLimit: 3000,
    maxMedia: 9,
    iconName: 'Linkedin',
    description: 'B2B network, industry insights, company milestones'
  },
  twitter: {
    id: 'twitter',
    name: 'X (Twitter)',
    shortName: '𝕏',
    color: '#000000',
    bgColor: 'bg-neutral-900',
    borderColor: 'border-neutral-700',
    textColor: 'text-neutral-200',
    charLimit: 280,
    maxMedia: 4,
    iconName: 'Twitter',
    description: 'Fast-paced announcements, tech commentary, community engagement'
  },
  instagram: {
    id: 'instagram',
    name: 'Instagram',
    shortName: 'ig',
    color: '#E1306C',
    bgColor: 'bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600',
    borderColor: 'border-pink-500/30',
    textColor: 'text-pink-500',
    charLimit: 2200,
    maxMedia: 10,
    iconName: 'Instagram',
    description: 'Visual stories, product highlights, behind-the-scenes'
  },
  facebook: {
    id: 'facebook',
    name: 'Facebook',
    shortName: 'fb',
    color: '#1877F2',
    bgColor: 'bg-[#1877F2]',
    borderColor: 'border-blue-600/30',
    textColor: 'text-blue-500',
    charLimit: 5000,
    maxMedia: 10,
    iconName: 'Facebook',
    description: 'Community groups, business page updates, long-form discussions'
  },
  tiktok: {
    id: 'tiktok',
    name: 'TikTok',
    shortName: 'tt',
    color: '#000000',
    bgColor: 'bg-black',
    borderColor: 'border-cyan-500/30',
    textColor: 'text-cyan-400',
    charLimit: 2200,
    maxMedia: 1,
    iconName: 'Video',
    description: 'Short-form video, tutorials, viral trend participation'
  },
  youtube: {
    id: 'youtube',
    name: 'YouTube',
    shortName: 'yt',
    color: '#FF0000',
    bgColor: 'bg-[#FF0000]',
    borderColor: 'border-red-600/30',
    textColor: 'text-red-500',
    charLimit: 5000,
    maxMedia: 1,
    iconName: 'Youtube',
    description: 'Long-form video, Community updates, Shorts & channel subscribers'
  },
  thread: {
    id: 'thread',
    name: 'Threads',
    shortName: 'th',
    color: '#000000',
    bgColor: 'bg-neutral-800',
    borderColor: 'border-neutral-600',
    textColor: 'text-neutral-300',
    charLimit: 500,
    maxMedia: 10,
    iconName: 'MessageSquare',
    description: 'Text-first quick thoughts, casual discussions, micro-blogs'
  },
  pinterest: {
    id: 'pinterest',
    name: 'Pinterest',
    shortName: 'pin',
    color: '#E60023',
    bgColor: 'bg-[#E60023]',
    borderColor: 'border-rose-600/30',
    textColor: 'text-rose-500',
    charLimit: 500,
    maxMedia: 1,
    iconName: 'Share2',
    description: 'Moodboards, design systems, visual inspiration pins'
  }
};
