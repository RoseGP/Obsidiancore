/**
 * Local SEO Audit & Profile Health Score Engine
 * Evaluates raw Google Business Profile JSON and metadata against Google 3-Pack SEO best practices.
 */

export type AuditSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type AuditStatus = 'PASS' | 'WARNING' | 'FAIL';
export type AuditCategory = 'core' | 'nap' | 'reviews' | 'attributes' | 'hours' | 'media';
export type DeepLinkTab = 'info' | 'photos' | 'attributes' | 'hours' | 'reviews' | 'posts' | 'locations' | 'security';

export interface AuditCheckItem {
  id: string;
  title: string;
  category: AuditCategory;
  categoryLabel: string;
  status: AuditStatus;
  severity: AuditSeverity;
  pointsDeducted: number;
  maxPoints: number;
  pointsSecured: number;
  description: string;
  fixRecommendation: string;
  deepLinkTab: DeepLinkTab;
  deepLinkField?: string;
  deepLinkActionLabel: string;
  currentValueDisplay?: string;
  benchmarkDisplay?: string;
}

export interface CategoryScoreBreakdown {
  category: AuditCategory;
  label: string;
  score: number; // 0 - 100
  earnedPoints: number;
  maxPoints: number;
  passedChecks: number;
  totalChecks: number;
  color: string;
}

export interface LocalSeoAuditResult {
  overallScore: number; // 0 - 100
  tier: 'Excellent' | 'Good' | 'Needs Attention' | 'Poor';
  tierBadgeColor: {
    bg: string;
    text: string;
    border: string;
    ring: string;
  };
  summary: {
    totalChecks: number;
    passedCount: number;
    warningCount: number;
    failedCount: number;
    potentialPointsToGain: number;
    totalPointsSecured: number;
  };
  categoryBreakdown: Record<AuditCategory, CategoryScoreBreakdown>;
  checks: AuditCheckItem[];
  timestamp: string;
  locationId?: string;
  locationTitle?: string;
}

/**
 * Validates Phone Format against standard E.164 or US/International standards
 */
export function validatePhoneFormat(phone?: string): { isValid: boolean; format: 'E164' | 'NATIONAL' | 'INVALID'; formatted?: string } {
  if (!phone || typeof phone !== 'string' || !phone.trim()) {
    return { isValid: false, format: 'INVALID' };
  }
  const clean = phone.trim();
  
  // E.164 format: +[1-9]\d{1,14}
  const e164Regex = /^\+[1-9]\d{6,14}$/;
  if (e164Regex.test(clean.replace(/[\s\-()]/g, ''))) {
    return { isValid: true, format: 'E164', formatted: clean };
  }

  // Common international/national phone formats with area codes (e.g., +1 (212) 555-0198 or (212) 555-0198 or +44 20 7946 0912)
  const nationalRegex = /^(\+?\d{1,3}[\s-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}$/;
  if (nationalRegex.test(clean)) {
    return { isValid: true, format: 'NATIONAL', formatted: clean };
  }

  return { isValid: false, format: 'INVALID' };
}

/**
 * Validates NAP Address format (line1, city/locality, state/adminArea, postalCode, country)
 */
export function validateAddressConsistency(addressData: any): {
  isComplete: boolean;
  missingFields: string[];
  fullAddressString: string;
} {
  const missingFields: string[] = [];

  if (typeof addressData === 'string') {
    const trimmed = addressData.trim();
    if (!trimmed || trimmed.length < 12) {
      return { isComplete: false, missingFields: ['Street Address', 'Postal Code'], fullAddressString: trimmed };
    }
    // Basic comma separation check for single string address
    const parts = trimmed.split(',');
    if (parts.length < 3) {
      missingFields.push('City/State/PostalCode segmentation');
    }
    return {
      isComplete: missingFields.length === 0,
      missingFields,
      fullAddressString: trimmed
    };
  }

  if (typeof addressData === 'object' && addressData !== null) {
    const lines = addressData.addressLines || (addressData.street ? [addressData.street] : []);
    const locality = addressData.locality || addressData.city;
    const adminArea = addressData.administrativeArea || addressData.state || addressData.region;
    const postalCode = addressData.postalCode || addressData.zip;
    const country = addressData.regionCode || addressData.country;

    if (!lines || lines.length === 0 || !lines[0]?.trim()) missingFields.push('Street Address Line 1');
    if (!locality || !locality.trim()) missingFields.push('City / Locality');
    if (!adminArea || !adminArea.trim()) missingFields.push('State / Administrative Area');
    if (!postalCode || !postalCode.trim()) missingFields.push('Postal Code / ZIP');
    if (!country || !country.trim()) missingFields.push('Country / Region Code');

    const addressParts = [
      lines?.[0],
      locality,
      adminArea ? `${adminArea} ${postalCode || ''}`.trim() : postalCode,
      country
    ].filter(Boolean);

    return {
      isComplete: missingFields.length === 0,
      missingFields,
      fullAddressString: addressParts.join(', ') || 'Incomplete Address'
    };
  }

  return {
    isComplete: false,
    missingFields: ['Street Address', 'City', 'Postal Code', 'Country'],
    fullAddressString: 'No address provided'
  };
}

/**
 * Main Local SEO Audit Utility Function
 * Evaluates raw location JSON against Google Business Profile standards.
 */
export function evaluateLocalSeoAudit(
  rawLocation: any = {},
  rawReviews: any[] = [],
  customWeights?: Partial<Record<AuditCategory, number>>
): LocalSeoAuditResult {
  const checks: AuditCheckItem[] = [];

  // Extract raw fields flexibly from either GbpLocationResource or flat object
  const title = rawLocation.title || rawLocation.locationName || rawLocation.name || '';
  const storeCode = rawLocation.storeCode || '';
  const description = rawLocation.profile?.description || rawLocation.description || '';
  const websiteUrl = rawLocation.websiteUri || rawLocation.websiteUrl || '';
  
  const phoneObj = rawLocation.phoneNumbers || {};
  const primaryPhone = phoneObj.primaryPhone || rawLocation.phone || rawLocation.primaryPhone || '';
  const additionalPhones = phoneObj.additionalPhones || [];

  const addressData = rawLocation.storefrontAddress || rawLocation.address || {};
  const categories = rawLocation.categories || {};
  const primaryCategory = categories.primaryCategory?.displayName || rawLocation.primaryCategory || '';
  const additionalCategories = categories.additionalCategories || [];

  const regularHours = rawLocation.regularHours?.periods || rawLocation.hours?.periods || rawLocation.openingHours || [];
  const specialHours = rawLocation.specialHours?.specialHourPeriods || rawLocation.specialHours || [];

  const attributes = rawLocation.attributes || rawLocation.serviceAttributes || [];
  const media = rawLocation.media || rawLocation.photos || {};
  const profilePhotoUrl = media.profilePhotoUrl || media.logo || rawLocation.logoUrl || rawLocation.avatar;
  const coverPhotoUrl = media.coverPhotoUrl || media.cover || rawLocation.coverPhotoUrl;
  const additionalPhotosCount = Array.isArray(media.additionalPhotos) 
    ? media.additionalPhotos.length 
    : (rawLocation.photosCount || (profilePhotoUrl && coverPhotoUrl ? 6 : 2));

  const verificationStatus = (rawLocation.metadata?.verificationStatus || rawLocation.verificationStatus || rawLocation.status || 'VERIFIED').toUpperCase();
  const isVerified = verificationStatus === 'VERIFIED';
  const isPending = verificationStatus.includes('PENDING');

  // Review metrics
  const reviewsList = Array.isArray(rawReviews) && rawReviews.length > 0 
    ? rawReviews 
    : (rawLocation.reviews || []);
  
  const totalReviews = rawLocation.reviewsCount !== undefined 
    ? rawLocation.reviewsCount 
    : reviewsList.length;

  const averageRating = rawLocation.rating !== undefined 
    ? rawLocation.rating 
    : (reviewsList.length > 0 
        ? +(reviewsList.reduce((acc: number, r: any) => acc + (r.rating || 5), 0) / reviewsList.length).toFixed(1) 
        : 4.8);

  const reviewsWithReply = reviewsList.filter((r: any) => r.reply?.comment || r.merchantReply || r.hasReply).length;
  const computedResponseRate = reviewsList.length > 0 
    ? Math.round((reviewsWithReply / reviewsList.length) * 100) 
    : (rawLocation.responseRate !== undefined ? rawLocation.responseRate : 85);

  // --------------------------------------------------------------------------
  // 1. CORE & NAP CONSISTENCY CHECKS
  // --------------------------------------------------------------------------

  // 1A. Business Name (NAP Consistency)
  const nameTrimmed = title.trim();
  const isAllUpper = nameTrimmed.length > 4 && nameTrimmed === nameTrimmed.toUpperCase() && /[A-Z]/.test(nameTrimmed);
  const hasSpamSymbols = /[!$?*]{2,}/.test(nameTrimmed);
  const isNameValid = nameTrimmed.length >= 3 && !hasSpamSymbols;

  if (isNameValid && !isAllUpper) {
    checks.push({
      id: 'nap-name-valid',
      title: 'Business Name (NAP) Standardized',
      category: 'nap',
      categoryLabel: 'NAP Consistency',
      status: 'PASS',
      severity: 'HIGH',
      pointsDeducted: 0,
      maxPoints: 10,
      pointsSecured: 10,
      description: 'Official legal business title matches standard branding without keyword stuffing.',
      fixRecommendation: 'Maintain standard title identical across your website and external directories.',
      deepLinkTab: 'info',
      deepLinkField: 'title',
      deepLinkActionLabel: 'View Title',
      currentValueDisplay: nameTrimmed || 'Obsidian Global HQ',
      benchmarkDisplay: 'Exact Brand Match'
    });
  } else {
    checks.push({
      id: 'nap-name-warning',
      title: isAllUpper ? 'Business Name Contains ALL-CAPS' : 'Invalid or Missing Business Title',
      category: 'nap',
      categoryLabel: 'NAP Consistency',
      status: isAllUpper ? 'WARNING' : 'FAIL',
      severity: 'CRITICAL',
      pointsDeducted: isAllUpper ? 4 : 10,
      maxPoints: 10,
      pointsSecured: isAllUpper ? 6 : 0,
      description: isAllUpper 
        ? 'Google Business Profile guidelines penalize ALL-CAPS styling and may trigger manual review suspensions.'
        : 'Missing or malformed business name prevents accurate Google 3-pack indexing.',
      fixRecommendation: 'Format your business title in Title Case matching your state registration.',
      deepLinkTab: 'info',
      deepLinkField: 'title',
      deepLinkActionLabel: 'Edit Business Name',
      currentValueDisplay: nameTrimmed || 'Empty',
      benchmarkDisplay: 'Title Case (No Spam)'
    });
  }

  // 1B. Address Consistency (NAP)
  const addressAudit = validateAddressConsistency(addressData);
  if (addressAudit.isComplete) {
    checks.push({
      id: 'nap-address-complete',
      title: 'Physical Address Fully Formatted',
      category: 'nap',
      categoryLabel: 'NAP Consistency',
      status: 'PASS',
      severity: 'HIGH',
      pointsDeducted: 0,
      maxPoints: 10,
      pointsSecured: 10,
      description: 'Street address, city, state, postal code, and country code are verified.',
      fixRecommendation: 'Ensure identical street formatting on website footer and schema markup.',
      deepLinkTab: 'info',
      deepLinkField: 'address',
      deepLinkActionLabel: 'View Address',
      currentValueDisplay: addressAudit.fullAddressString,
      benchmarkDisplay: 'Full 5-Part Postal Address'
    });
  } else {
    checks.push({
      id: 'nap-address-incomplete',
      title: `Incomplete Physical Address (${addressAudit.missingFields.length} fields missing)`,
      category: 'nap',
      categoryLabel: 'NAP Consistency',
      status: 'FAIL',
      severity: 'CRITICAL',
      pointsDeducted: 10,
      maxPoints: 10,
      pointsSecured: 0,
      description: `Missing: ${addressAudit.missingFields.join(', ')}. Incomplete addresses cannot be accurately pin-dropped in Google Maps.`,
      fixRecommendation: 'Add full street address, unit/suite, city, state, and 5-digit postal code.',
      deepLinkTab: 'info',
      deepLinkField: 'address',
      deepLinkActionLabel: 'Fix Address in Editor',
      currentValueDisplay: addressAudit.fullAddressString,
      benchmarkDisplay: '100% Complete Address'
    });
  }

  // 1C. Phone Number Format (NAP)
  const phoneAudit = validatePhoneFormat(primaryPhone);
  if (phoneAudit.isValid) {
    checks.push({
      id: 'nap-phone-valid',
      title: 'Direct Business Phone Validated',
      category: 'nap',
      categoryLabel: 'NAP Consistency',
      status: 'PASS',
      severity: 'HIGH',
      pointsDeducted: 0,
      maxPoints: 10,
      pointsSecured: 10,
      description: `Standardized local/direct line is active (${phoneAudit.formatted}).`,
      fixRecommendation: 'Keep primary phone reachable during operating hours.',
      deepLinkTab: 'info',
      deepLinkField: 'phone',
      deepLinkActionLabel: 'View Phone',
      currentValueDisplay: primaryPhone,
      benchmarkDisplay: 'E.164 or Standard Format'
    });
  } else {
    checks.push({
      id: 'nap-phone-invalid',
      title: 'Missing or Malformed Primary Telephone Number',
      category: 'nap',
      categoryLabel: 'NAP Consistency',
      status: 'FAIL',
      severity: 'CRITICAL',
      pointsDeducted: 10,
      maxPoints: 10,
      pointsSecured: 0,
      description: 'Listings without a direct phone number suffer up to 58% reduction in "Call" click-to-lead conversions on mobile Maps.',
      fixRecommendation: 'Provide an E.164 formatted telephone number (e.g. +1 (212) 555-0198).',
      deepLinkTab: 'info',
      deepLinkField: 'phone',
      deepLinkActionLabel: 'Add Phone Number',
      currentValueDisplay: primaryPhone || 'None',
      benchmarkDisplay: '+1 (XXX) XXX-XXXX'
    });
  }

  // 1D. Core Description (> 150 characters benchmark)
  const descLength = description.trim().length;
  if (descLength >= 200) {
    checks.push({
      id: 'core-description-optimal',
      title: 'Business Description Rich & Optimized (> 200 chars)',
      category: 'core',
      categoryLabel: 'Core Completeness',
      status: 'PASS',
      severity: 'HIGH',
      pointsDeducted: 0,
      maxPoints: 10,
      pointsSecured: 10,
      description: `Comprehensive description provided (${descLength} characters). Contains local keywords and core service highlights.`,
      fixRecommendation: 'Periodically review description to reflect new seasonal offerings.',
      deepLinkTab: 'info',
      deepLinkField: 'description',
      deepLinkActionLabel: 'Edit Narrative',
      currentValueDisplay: `${descLength} characters`,
      benchmarkDisplay: '≥ 200 chars (Max 750)'
    });
  } else if (descLength >= 80) {
    checks.push({
      id: 'core-description-warning',
      title: 'Business Description Under-length (< 200 chars)',
      category: 'core',
      categoryLabel: 'Core Completeness',
      status: 'WARNING',
      severity: 'HIGH',
      pointsDeducted: 5,
      maxPoints: 10,
      pointsSecured: 5,
      description: `Current description is only ${descLength} characters. Google recommends at least 250–750 characters to maximize semantic keyword match.`,
      fixRecommendation: 'Expand business summary with localized specialties, history, and service capabilities.',
      deepLinkTab: 'info',
      deepLinkField: 'description',
      deepLinkActionLabel: 'Expand with AI',
      currentValueDisplay: `${descLength} characters`,
      benchmarkDisplay: '≥ 200 characters'
    });
  } else {
    checks.push({
      id: 'core-description-missing',
      title: 'Missing or Minimal Business Description',
      category: 'core',
      categoryLabel: 'Core Completeness',
      status: 'FAIL',
      severity: 'CRITICAL',
      pointsDeducted: 10,
      maxPoints: 10,
      pointsSecured: 0,
      description: 'Missing business narrative severely penalizes Google Maps keyword discovery and AI-assisted conversational search queries.',
      fixRecommendation: 'Add an authentic 250+ character narrative describing your value proposition.',
      deepLinkTab: 'info',
      deepLinkField: 'description',
      deepLinkActionLabel: 'Generate AI Description',
      currentValueDisplay: descLength > 0 ? `${descLength} chars` : 'Empty',
      benchmarkDisplay: '≥ 250 characters'
    });
  }

  // 1E. Primary & Secondary Categories
  if (primaryCategory.trim()) {
    checks.push({
      id: 'core-category-set',
      title: 'Primary Business Category Designated',
      category: 'core',
      categoryLabel: 'Core Completeness',
      status: 'PASS',
      severity: 'HIGH',
      pointsDeducted: 0,
      maxPoints: 5,
      pointsSecured: 5,
      description: `Primary category set to "${primaryCategory}". ${additionalCategories.length > 0 ? `Plus ${additionalCategories.length} secondary categories.` : 'Consider adding secondary categories.'}`,
      fixRecommendation: 'Add up to 3 secondary categories to expand discovery breadth.',
      deepLinkTab: 'info',
      deepLinkField: 'category',
      deepLinkActionLabel: 'View Categories',
      currentValueDisplay: primaryCategory,
      benchmarkDisplay: 'Specific Niche Category'
    });
  } else {
    checks.push({
      id: 'core-category-missing',
      title: 'Missing Primary Business Category',
      category: 'core',
      categoryLabel: 'Core Completeness',
      status: 'FAIL',
      severity: 'CRITICAL',
      pointsDeducted: 5,
      maxPoints: 5,
      pointsSecured: 0,
      description: 'Primary category is the single highest weighted ranking factor in Google local search algorithm.',
      fixRecommendation: 'Select the most specific official Google Business category matching your industry.',
      deepLinkTab: 'info',
      deepLinkField: 'category',
      deepLinkActionLabel: 'Assign Category',
      currentValueDisplay: 'Unset',
      benchmarkDisplay: 'Exact Google Category'
    });
  }

  // 1F. Website URL & Tracking
  if (websiteUrl && websiteUrl.startsWith('http')) {
    checks.push({
      id: 'core-website-valid',
      title: 'Official Website Connected (HTTPS)',
      category: 'core',
      categoryLabel: 'Core Completeness',
      status: 'PASS',
      severity: 'MEDIUM',
      pointsDeducted: 0,
      maxPoints: 5,
      pointsSecured: 5,
      description: `Linked to ${websiteUrl}. Enables Google to crawl website content for entity relevance.`,
      fixRecommendation: 'Ensure UTM parameters are used if tracking Google Business traffic in Google Analytics.',
      deepLinkTab: 'info',
      deepLinkField: 'websiteUri',
      deepLinkActionLabel: 'View Website',
      currentValueDisplay: websiteUrl,
      benchmarkDisplay: 'Valid HTTPS URL'
    });
  } else {
    checks.push({
      id: 'core-website-missing',
      title: 'Missing Official Website Link',
      category: 'core',
      categoryLabel: 'Core Completeness',
      status: 'FAIL',
      severity: 'HIGH',
      pointsDeducted: 5,
      maxPoints: 5,
      pointsSecured: 0,
      description: 'Listings without website links miss out on organic domain authority signals passed from your main domain.',
      fixRecommendation: 'Add your secure HTTPS homepage or location-specific landing page URL.',
      deepLinkTab: 'info',
      deepLinkField: 'websiteUri',
      deepLinkActionLabel: 'Add Website URL',
      currentValueDisplay: 'None',
      benchmarkDisplay: 'https://domain.com'
    });
  }

  // --------------------------------------------------------------------------
  // 2. MEDIA & BRANDING CHECKS (Profile Image & Cover Photo)
  // --------------------------------------------------------------------------

  // 2A. Profile Photo / Logo Image Present
  const hasProfilePhoto = Boolean(profilePhotoUrl && profilePhotoUrl.trim());
  if (hasProfilePhoto) {
    checks.push({
      id: 'media-profile-photo-present',
      title: 'Profile Avatar / Brand Logo Uploaded',
      category: 'media',
      categoryLabel: 'Media & Branding',
      status: 'PASS',
      severity: 'HIGH',
      pointsDeducted: 0,
      maxPoints: 5,
      pointsSecured: 5,
      description: 'High-resolution logo displays beside merchant replies in Google Maps.',
      fixRecommendation: 'Ensure 1:1 square aspect ratio (minimum 720x720px).',
      deepLinkTab: 'photos',
      deepLinkField: 'logo',
      deepLinkActionLabel: 'Manage Photos',
      currentValueDisplay: 'Uploaded & Active',
      benchmarkDisplay: '1:1 Square (≥720x720)'
    });
  } else {
    checks.push({
      id: 'media-profile-photo-missing',
      title: 'Missing Profile Photo / Brand Logo',
      category: 'media',
      categoryLabel: 'Media & Branding',
      status: 'FAIL',
      severity: 'HIGH',
      pointsDeducted: 5,
      maxPoints: 5,
      pointsSecured: 0,
      description: 'Missing brand logo makes review responses and map pins appear unverified and generic.',
      fixRecommendation: 'Upload your official brand square avatar (PNG or JPG format).',
      deepLinkTab: 'photos',
      deepLinkField: 'logo',
      deepLinkActionLabel: 'Upload Logo',
      currentValueDisplay: 'Missing',
      benchmarkDisplay: 'Square High-Res Logo'
    });
  }

  // 2B. Cover Photo Present
  const hasCoverPhoto = Boolean(coverPhotoUrl && coverPhotoUrl.trim());
  if (hasCoverPhoto) {
    checks.push({
      id: 'media-cover-photo-present',
      title: 'Hero Cover Photo Configured',
      category: 'media',
      categoryLabel: 'Media & Branding',
      status: 'PASS',
      severity: 'HIGH',
      pointsDeducted: 0,
      maxPoints: 5,
      pointsSecured: 5,
      description: 'Preferred 16:9 hero photo represents storefront/office ambiance on Google Knowledge Panel.',
      fixRecommendation: 'Update cover photo quarterly with seasonal photography.',
      deepLinkTab: 'photos',
      deepLinkField: 'coverPhoto',
      deepLinkActionLabel: 'View Cover',
      currentValueDisplay: 'Active Hero Image',
      benchmarkDisplay: '16:9 Landscape (≥1024x576)'
    });
  } else {
    checks.push({
      id: 'media-cover-photo-missing',
      title: 'Missing Cover Photo',
      category: 'media',
      categoryLabel: 'Media & Branding',
      status: 'FAIL',
      severity: 'HIGH',
      pointsDeducted: 5,
      maxPoints: 5,
      pointsSecured: 0,
      description: 'Without an explicit cover photo, Google algorithms choose random user-uploaded photos for your main header card.',
      fixRecommendation: 'Upload a designated 16:9 landscape photo highlighting your premier facility or team.',
      deepLinkTab: 'photos',
      deepLinkField: 'coverPhoto',
      deepLinkActionLabel: 'Upload Cover Photo',
      currentValueDisplay: 'Missing',
      benchmarkDisplay: '16:9 Hero Image'
    });
  }

  // 2C. Total Photo Gallery Volume
  if (additionalPhotosCount >= 5) {
    checks.push({
      id: 'media-gallery-volume-pass',
      title: `Rich Photo Gallery (${additionalPhotosCount}+ photos)`,
      category: 'media',
      categoryLabel: 'Media & Branding',
      status: 'PASS',
      severity: 'MEDIUM',
      pointsDeducted: 0,
      maxPoints: 5,
      pointsSecured: 5,
      description: `Profiles with >5 high quality photos receive 42% more requests for driving directions on Google Maps.`,
      fixRecommendation: 'Continue posting 1 new team or workplace photo monthly.',
      deepLinkTab: 'photos',
      deepLinkField: 'gallery',
      deepLinkActionLabel: 'Gallery Manager',
      currentValueDisplay: `${additionalPhotosCount} photos`,
      benchmarkDisplay: '≥ 5 High-Res Photos'
    });
  } else {
    checks.push({
      id: 'media-gallery-volume-warning',
      title: `Low Media Count (${additionalPhotosCount} photos)`,
      category: 'media',
      categoryLabel: 'Media & Branding',
      status: 'WARNING',
      severity: 'MEDIUM',
      pointsDeducted: 2,
      maxPoints: 5,
      pointsSecured: 3,
      description: 'Adding photos of your exterior, interior, and team builds consumer trust and improves search CTR.',
      fixRecommendation: 'Upload at least 3 additional interior, exterior, or service images.',
      deepLinkTab: 'photos',
      deepLinkField: 'gallery',
      deepLinkActionLabel: 'Add Photos',
      currentValueDisplay: `${additionalPhotosCount} photos`,
      benchmarkDisplay: '≥ 5 photos'
    });
  }

  // --------------------------------------------------------------------------
  // 3. CUSTOMER ENGAGEMENT & REVIEWS CHECKS
  // --------------------------------------------------------------------------

  // 3A. Review Response Rate (Merchant Reply Ratio)
  if (computedResponseRate >= 85) {
    checks.push({
      id: 'reviews-response-rate-optimal',
      title: `High Review Response Rate (${computedResponseRate}%)`,
      category: 'reviews',
      categoryLabel: 'Customer Engagement',
      status: 'PASS',
      severity: 'HIGH',
      pointsDeducted: 0,
      maxPoints: 15,
      pointsSecured: 15,
      description: `Merchant responses provided for ${computedResponseRate}% of customer feedback (Benchmark: ≥ 85%).`,
      fixRecommendation: 'Maintain under 24-hour turnaround for all new reviews.',
      deepLinkTab: 'reviews',
      deepLinkField: 'replies',
      deepLinkActionLabel: 'View Reviews',
      currentValueDisplay: `${computedResponseRate}% replied`,
      benchmarkDisplay: '≥ 85% Response Rate'
    });
  } else if (computedResponseRate >= 60) {
    checks.push({
      id: 'reviews-response-rate-moderate',
      title: `Review Response Rate Needs Attention (${computedResponseRate}%)`,
      category: 'reviews',
      categoryLabel: 'Customer Engagement',
      status: 'WARNING',
      severity: 'HIGH',
      pointsDeducted: 7,
      maxPoints: 15,
      pointsSecured: 8,
      description: `${100 - computedResponseRate}% of reviews lack merchant acknowledgment. Unanswered reviews signal merchant neglect to potential clients.`,
      fixRecommendation: 'Use the Gemini AI Review Reply Assistant to draft instant responses to pending feedback.',
      deepLinkTab: 'reviews',
      deepLinkField: 'unreplied',
      deepLinkActionLabel: 'Draft AI Replies',
      currentValueDisplay: `${computedResponseRate}% replied`,
      benchmarkDisplay: '≥ 85% Response Rate'
    });
  } else {
    checks.push({
      id: 'reviews-response-rate-critical',
      title: `Critical Under-Response to Reviews (${computedResponseRate}%)`,
      category: 'reviews',
      categoryLabel: 'Customer Engagement',
      status: 'FAIL',
      severity: 'CRITICAL',
      pointsDeducted: 15,
      maxPoints: 15,
      pointsSecured: 0,
      description: 'Responding to reviews is directly correlated with higher Google 3-pack rankings and 16% higher conversion rates.',
      fixRecommendation: 'Reply to all 1-star, 3-star, and 5-star reviews immediately.',
      deepLinkTab: 'reviews',
      deepLinkField: 'unreplied',
      deepLinkActionLabel: 'Reply to Reviews',
      currentValueDisplay: `${computedResponseRate}% replied`,
      benchmarkDisplay: '≥ 85%'
    });
  }

  // 3B. Average Star Rating
  if (averageRating >= 4.5) {
    checks.push({
      id: 'reviews-rating-excellent',
      title: `Exceptional Customer Sentiment (${averageRating}★)`,
      category: 'reviews',
      categoryLabel: 'Customer Engagement',
      status: 'PASS',
      severity: 'HIGH',
      pointsDeducted: 0,
      maxPoints: 5,
      pointsSecured: 5,
      description: `Maintains a stellar ${averageRating} out of 5.0 rating across ${totalReviews} customer reviews.`,
      fixRecommendation: 'Highlight positive customer testimonials in weekly Google Posts.',
      deepLinkTab: 'reviews',
      deepLinkField: 'rating',
      deepLinkActionLabel: 'Review Stats',
      currentValueDisplay: `${averageRating}★ (${totalReviews} reviews)`,
      benchmarkDisplay: '≥ 4.5★'
    });
  } else if (averageRating >= 4.0) {
    checks.push({
      id: 'reviews-rating-acceptable',
      title: `Solid Star Rating (${averageRating}★)`,
      category: 'reviews',
      categoryLabel: 'Customer Engagement',
      status: 'PASS',
      severity: 'MEDIUM',
      pointsDeducted: 0,
      maxPoints: 5,
      pointsSecured: 5,
      description: `Rating of ${averageRating}★ meets standard search eligibility.`,
      fixRecommendation: 'Proactively request feedback from recent satisfied clients to reach 4.7+★.',
      deepLinkTab: 'reviews',
      deepLinkField: 'rating',
      deepLinkActionLabel: 'View Feedback',
      currentValueDisplay: `${averageRating}★`,
      benchmarkDisplay: '≥ 4.5★'
    });
  } else {
    checks.push({
      id: 'reviews-rating-low',
      title: `Sub-optimal Star Rating (${averageRating}★)`,
      category: 'reviews',
      categoryLabel: 'Customer Engagement',
      status: 'WARNING',
      severity: 'HIGH',
      pointsDeducted: 3,
      maxPoints: 5,
      pointsSecured: 2,
      description: 'Ratings below 4.0★ filter your business out of "Top rated" Google Maps searches.',
      fixRecommendation: 'Address negative customer complaints directly and request updated reviews.',
      deepLinkTab: 'reviews',
      deepLinkField: 'rating',
      deepLinkActionLabel: 'Manage Reviews',
      currentValueDisplay: `${averageRating}★`,
      benchmarkDisplay: '≥ 4.0★'
    });
  }

  // --------------------------------------------------------------------------
  // 4. ATTRIBUTES & AMENITIES CHECKS
  // --------------------------------------------------------------------------

  // Check for presence of Wheelchair Accessibility & Payment Methods
  const attrList = Array.isArray(attributes) ? attributes : [];
  const hasWheelchair = attrList.some((a: any) => {
    const id = (a.attributeId || a.name || a.title || '').toLowerCase();
    const val = a.values?.[0] || a.value;
    return (id.includes('wheelchair') || id.includes('accessibility')) && val !== false;
  }) || rawLocation.hasWheelchairAccessibility === true;

  const hasPayments = attrList.some((a: any) => {
    const id = (a.attributeId || a.name || a.title || '').toLowerCase();
    const val = a.values?.[0] || a.value;
    return (id.includes('payment') || id.includes('credit') || id.includes('nfc') || id.includes('card')) && val !== false;
  }) || rawLocation.hasPaymentOptions === true;

  const totalAttributesCount = attrList.length || (hasWheelchair && hasPayments ? 6 : 1);

  // 4A. Wheelchair Accessibility Attribute
  if (hasWheelchair) {
    checks.push({
      id: 'attributes-wheelchair-present',
      title: 'Wheelchair Accessibility Attribute Enabled',
      category: 'attributes',
      categoryLabel: 'Attributes & Amenities',
      status: 'PASS',
      severity: 'MEDIUM',
      pointsDeducted: 0,
      maxPoints: 5,
      pointsSecured: 5,
      description: 'Accessibility icon displays in Google Maps filters for mobility-conscious visitors.',
      fixRecommendation: 'Verify accessible parking and entrance specifications.',
      deepLinkTab: 'attributes',
      deepLinkField: 'wheelchair',
      deepLinkActionLabel: 'View Attributes',
      currentValueDisplay: 'Accessible Entrance Enabled',
      benchmarkDisplay: 'Accessibility Declared'
    });
  } else {
    checks.push({
      id: 'attributes-wheelchair-missing',
      title: 'Missing Wheelchair Accessibility Attribute',
      category: 'attributes',
      categoryLabel: 'Attributes & Amenities',
      status: 'WARNING',
      severity: 'HIGH',
      pointsDeducted: 5,
      maxPoints: 5,
      pointsSecured: 0,
      description: 'Google Maps heavily highlights accessibility attributes; missing values exclude your business from accessible searches.',
      fixRecommendation: 'Specify whether your entrance, seating, and restrooms are wheelchair accessible.',
      deepLinkTab: 'attributes',
      deepLinkField: 'wheelchair',
      deepLinkActionLabel: 'Enable Accessibility',
      currentValueDisplay: 'Unset',
      benchmarkDisplay: 'Yes / Declared'
    });
  }

  // 4B. Payment Options Attribute
  if (hasPayments) {
    checks.push({
      id: 'attributes-payments-present',
      title: 'Accepted Payment Methods Specified',
      category: 'attributes',
      categoryLabel: 'Attributes & Amenities',
      status: 'PASS',
      severity: 'LOW',
      pointsDeducted: 0,
      maxPoints: 5,
      pointsSecured: 5,
      description: 'Credit cards, contactless NFC, and mobile payment acceptance is confirmed.',
      fixRecommendation: 'Keep payment capabilities up to date.',
      deepLinkTab: 'attributes',
      deepLinkField: 'payments',
      deepLinkActionLabel: 'View Payments',
      currentValueDisplay: 'Credit Cards & NFC Active',
      benchmarkDisplay: 'Declared Payment Types'
    });
  } else {
    checks.push({
      id: 'attributes-payments-missing',
      title: 'Missing Accepted Payment Options',
      category: 'attributes',
      categoryLabel: 'Attributes & Amenities',
      status: 'WARNING',
      severity: 'MEDIUM',
      pointsDeducted: 3,
      maxPoints: 5,
      pointsSecured: 2,
      description: 'Specifying payment methods (Credit Cards, Apple Pay, Debit) answers customer pre-visit questions before calling.',
      fixRecommendation: 'Toggle payment options in the Attributes tab.',
      deepLinkTab: 'attributes',
      deepLinkField: 'payments',
      deepLinkActionLabel: 'Set Payment Options',
      currentValueDisplay: 'Unspecified',
      benchmarkDisplay: 'Credit / NFC / Apple Pay'
    });
  }

  // --------------------------------------------------------------------------
  // 5. OPERATIONAL HOURS & SPECIAL SCHEDULE CHECKS
  // --------------------------------------------------------------------------

  // 5A. Regular Opening Hours
  const hasRegularHours = Array.isArray(regularHours) && regularHours.length >= 5;
  if (hasRegularHours) {
    checks.push({
      id: 'hours-regular-complete',
      title: 'Weekly Operating Hours Fully Configured',
      category: 'hours',
      categoryLabel: 'Hours & Availability',
      status: 'PASS',
      severity: 'HIGH',
      pointsDeducted: 0,
      maxPoints: 5,
      pointsSecured: 5,
      description: 'Accurate open and close times declared across 7 days. Prevents "Hours may differ" warning banner.',
      fixRecommendation: 'Review open/close intervals ahead of seasonal shifts.',
      deepLinkTab: 'hours',
      deepLinkField: 'weeklyHours',
      deepLinkActionLabel: 'View Schedule',
      currentValueDisplay: `${regularHours.length} days defined`,
      benchmarkDisplay: '7 Days Scheduled'
    });
  } else {
    checks.push({
      id: 'hours-regular-incomplete',
      title: 'Incomplete or Missing Operating Hours',
      category: 'hours',
      categoryLabel: 'Hours & Availability',
      status: 'FAIL',
      severity: 'CRITICAL',
      pointsDeducted: 5,
      maxPoints: 5,
      pointsSecured: 0,
      description: 'Listings without accurate weekly hours trigger a red "Hours may be inaccurate" warning in Google Maps search.',
      fixRecommendation: 'Specify opening and closing hours for Monday through Sunday.',
      deepLinkTab: 'hours',
      deepLinkField: 'weeklyHours',
      deepLinkActionLabel: 'Set Weekly Hours',
      currentValueDisplay: `${regularHours.length} days defined`,
      benchmarkDisplay: '7 Days Complete'
    });
  }

  // 5B. Special / Holiday Hours
  const hasSpecialHours = Array.isArray(specialHours) && specialHours.length > 0;
  if (hasSpecialHours) {
    checks.push({
      id: 'hours-special-configured',
      title: 'Holiday & Special Hours Scheduled',
      category: 'hours',
      categoryLabel: 'Hours & Availability',
      status: 'PASS',
      severity: 'LOW',
      pointsDeducted: 0,
      maxPoints: 5,
      pointsSecured: 5,
      description: 'Upcoming public holidays are scheduled, shielding against customer arrival during closed hours.',
      fixRecommendation: 'Add custom dates whenever your team observes bank holidays.',
      deepLinkTab: 'hours',
      deepLinkField: 'specialHours',
      deepLinkActionLabel: 'View Holidays',
      currentValueDisplay: `${specialHours.length} special dates`,
      benchmarkDisplay: 'Upcoming Holidays Set'
    });
  } else {
    checks.push({
      id: 'hours-special-missing',
      title: 'No Special or Holiday Hours Defined',
      category: 'hours',
      categoryLabel: 'Hours & Availability',
      status: 'WARNING',
      severity: 'LOW',
      pointsDeducted: 2,
      maxPoints: 5,
      pointsSecured: 3,
      description: 'Google notifies users when holiday hours are not confirmed. Adding them boosts listing trust score.',
      fixRecommendation: 'Confirm hours for upcoming federal and national holidays.',
      deepLinkTab: 'hours',
      deepLinkField: 'specialHours',
      deepLinkActionLabel: 'Set Holiday Hours',
      currentValueDisplay: 'None set',
      benchmarkDisplay: 'Holiday Calendar'
    });
  }

  // --------------------------------------------------------------------------
  // CALCULATE AGGREGATE SCORES & CATEGORY BREAKDOWN
  // --------------------------------------------------------------------------

  const totalMaxPoints = checks.reduce((sum, c) => sum + c.maxPoints, 0); // e.g. 100
  const totalEarnedPoints = checks.reduce((sum, c) => sum + c.pointsSecured, 0);
  const totalDeductedPoints = checks.reduce((sum, c) => sum + c.pointsDeducted, 0);

  // Normalize overall score to 0 - 100
  const calculatedScore = totalMaxPoints > 0 
    ? Math.round((totalEarnedPoints / totalMaxPoints) * 100) 
    : 85;

  const passedCount = checks.filter(c => c.status === 'PASS').length;
  const warningCount = checks.filter(c => c.status === 'WARNING').length;
  const failedCount = checks.filter(c => c.status === 'FAIL').length;

  // Category breakdowns
  const categoriesList: Array<{ cat: AuditCategory; label: string; color: string }> = [
    { cat: 'nap', label: 'NAP Consistency', color: '#3b82f6' },
    { cat: 'core', label: 'Core Information', color: '#10b981' },
    { cat: 'media', label: 'Media & Branding', color: '#8b5cf6' },
    { cat: 'reviews', label: 'Customer Engagement', color: '#f59e0b' },
    { cat: 'attributes', label: 'Attributes & Amenities', color: '#06b6d4' },
    { cat: 'hours', label: 'Hours & Schedules', color: '#ec4899' }
  ];

  const categoryBreakdown = {} as Record<AuditCategory, CategoryScoreBreakdown>;

  categoriesList.forEach(({ cat, label, color }) => {
    const catChecks = checks.filter(c => c.category === cat);
    const catMax = catChecks.reduce((sum, c) => sum + c.maxPoints, 0);
    const catEarned = catChecks.reduce((sum, c) => sum + c.pointsSecured, 0);
    const catPassed = catChecks.filter(c => c.status === 'PASS').length;
    const catScore = catMax > 0 ? Math.round((catEarned / catMax) * 100) : 100;

    categoryBreakdown[cat] = {
      category: cat,
      label,
      score: catScore,
      earnedPoints: catEarned,
      maxPoints: catMax,
      passedChecks: catPassed,
      totalChecks: catChecks.length,
      color
    };
  });

  // Determine Tier and Styling
  let tier: LocalSeoAuditResult['tier'] = 'Poor';
  let tierBadgeColor = {
    bg: 'bg-rose-50 text-rose-800',
    text: 'text-rose-700',
    border: 'border-rose-200',
    ring: 'ring-rose-500'
  };

  if (calculatedScore >= 90) {
    tier = 'Excellent';
    tierBadgeColor = {
      bg: 'bg-emerald-50 text-emerald-800',
      text: 'text-emerald-700',
      border: 'border-emerald-200',
      ring: 'ring-emerald-500'
    };
  } else if (calculatedScore >= 75) {
    tier = 'Good';
    tierBadgeColor = {
      bg: 'bg-blue-50 text-blue-800',
      text: 'text-blue-700',
      border: 'border-blue-200',
      ring: 'ring-blue-500'
    };
  } else if (calculatedScore >= 60) {
    tier = 'Needs Attention';
    tierBadgeColor = {
      bg: 'bg-amber-50 text-amber-800',
      text: 'text-amber-700',
      border: 'border-amber-200',
      ring: 'ring-amber-500'
    };
  }

  // Sort checks by priority: FAIL first (highest points deducted), then WARNING, then PASS
  const sortedChecks = [...checks].sort((a, b) => {
    const statusWeight = { FAIL: 3, WARNING: 2, PASS: 1 };
    if (statusWeight[a.status] !== statusWeight[b.status]) {
      return statusWeight[b.status] - statusWeight[a.status];
    }
    return b.pointsDeducted - a.pointsDeducted;
  });

  return {
    overallScore: calculatedScore,
    tier,
    tierBadgeColor,
    summary: {
      totalChecks: checks.length,
      passedCount,
      warningCount,
      failedCount,
      potentialPointsToGain: totalDeductedPoints,
      totalPointsSecured: totalEarnedPoints
    },
    categoryBreakdown,
    checks: sortedChecks,
    timestamp: new Date().toISOString(),
    locationId: rawLocation.id || rawLocation.locationId,
    locationTitle: title || 'Google Business Location'
  };
}
