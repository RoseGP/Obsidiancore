import React from 'react';
import { useDatabase } from '../context/DatabaseContext';
import GrowthApp from '../features/gbp/client/GrowthApp';

export interface GoogleBusinessLocation {
  id: string;
  name: string;
  locationId: string;
  locationName: string;
  title: string;
  storeCode: string;
  primaryCategory: string;
  status: 'VERIFIED' | 'PENDING_REVIEW' | 'NEEDS_REVIEW' | 'SUSPENDED' | string;
  verificationStatus: string;
  address: string;
  phone?: string;
  websiteUrl?: string;
  description?: string;
  rating: number;
  reviewsCount: number;
  responseRate: number;
  visibilityScore: number;
  missingAttributes: string[];
  isPrimary?: boolean;
  lastSyncedAt?: string;
}

export interface GoogleBusinessAccount {
  name: string;
  accountName: string;
  type: string;
  role: string;
  verificationState: string;
  locationCount: number;
}

export interface GoogleReview {
  id: string;
  reviewerName: string;
  reviewerAvatar: string;
  rating: number;
  comment: string;
  createTime: string;
  reply?: {
    comment: string;
    updateTime: string;
  };
}

export interface GooglePost {
  id: string;
  summary: string;
  callToAction?: {
    actionType: 'LEARN_MORE' | 'BOOK' | 'CALL' | 'SIGN_UP';
    url: string;
  };
  createTime: string;
  state: 'LIVE' | 'SCHEDULED' | 'DRAFT';
}

export const GbpView: React.FC = () => {
  const db = useDatabase() as any;
  return <GrowthApp devUser={db?.userId || 'demo-user-123'} />;
};

export default GbpView;
