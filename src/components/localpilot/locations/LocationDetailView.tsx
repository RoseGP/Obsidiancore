import React, { useState } from 'react';
import { 
  Building2, MapPin, Phone, Globe, Star, 
  Sparkles, ShieldCheck, RefreshCw, Edit3, 
  ArrowLeft, CheckCircle2, AlertTriangle, Clock,
  Layers, ImageIcon, FileText, Check, Plus, ExternalLink
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { LocationItem, LocalPilotRoute } from '../types';

export interface LocationDetailViewProps {
  location: LocationItem;
  onBack: () => void;
  onRunAudit: (locId: string) => void;
  onNavigateTab?: (tab: string) => void;
  onOpenEditProfile?: () => void;
  /** Saves the fields Google lets owners change through the API (phone, website). */
  onSaveProfile?: (locId: string, patch: { phone: string; website: string }) => Promise<void> | void;
}

export const LocationDetailView: React.FC<LocationDetailViewProps> = ({
  location,
  onBack,
  onRunAudit,
  onOpenEditProfile,
  onSaveProfile
}) => {
  const [phone, setPhone] = useState(location.phone);
  const [website, setWebsite] = useState(location.website);
  const [saving, setSaving] = useState(false);
  React.useEffect(() => { setPhone(location.phone); setWebsite(location.website); }, [location.id, location.phone, location.website]);
  const [activeTab, setActiveTab] = useState<
    'Overview' | 'Profile' | 'Reviews' | 'Posts' | 'Analytics' | 'SEO' | 'Security'
  >('Overview');

  // Built from this app's profile checks (see the server audit). Nothing here is estimated.
  const checks = location.auditChecks || [];
  const completenessCategories = Array.from(new Set(checks.map((c) => c.group))).map((group) => {
    const inGroup = checks.filter((c) => c.group === group);
    const passed = inGroup.filter((c) => c.passed).length;
    const missing = inGroup.filter((c) => !c.passed).map((c) => c.label);
    return {
      name: group,
      score: inGroup.length ? Math.round((passed / inGroup.length) * 100) : 0,
      status: missing.length ? `${missing.length} to fix` : 'Complete',
      desc: missing.length ? `Missing: ${missing.join('; ')}` : `${passed} of ${inGroup.length} checks passed`,
    };
  });
  const failedChecks = checks.filter((c) => !c.passed).length;

  return (
    <div className="space-y-6 animate-in fade-in duration-200" id="localpilot-location-detail-view">
      
      {/* Header with back button */}
      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 mb-3 transition cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to all locations</span>
        </button>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div className="flex items-start gap-3.5">
            <div className="h-12 w-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-lg border border-blue-100 shrink-0">
              <Building2 className="h-6 w-6" />
            </div>

            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                  {location.name}
                </h1>
                <Badge
                  variant={location.status === 'Healthy' ? 'success' : 'warning'}
                  size="sm"
                >
                  Status: {location.status}
                </Badge>
              </div>

              <div className="flex items-center gap-3 text-xs text-slate-500 mt-1 flex-wrap">
                <span className="font-medium text-slate-900">{location.category}</span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3 text-slate-400" />
                  {location.address}, {location.city}, {location.state} {location.zip}
                </span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <Phone className="h-3 w-3 text-slate-400" />
                  {location.phone}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onRunAudit(location.id)}
              leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
            >
              Run Audit
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setActiveTab('Profile')}
              leftIcon={<Edit3 className="h-3.5 w-3.5" />}
            >
              Edit Profile
            </Button>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto text-xs font-semibold">
        {(['Overview', 'Profile', 'Reviews', 'Posts', 'Analytics', 'SEO', 'Security'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === tab
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'Overview' && (
        <div className="space-y-6">
          
          {/* Top 3 Metric Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                Profile health
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-slate-900">{location.visibilityScore}</span>
                <span className="text-xs font-normal text-slate-400">/ 100</span>
              </div>
              <p className="text-xs text-slate-500 mt-2 flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                Profile health from this app's checks. Search ranking tracking isn't available yet.
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                Profile Completeness
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-slate-900">{location.profileCompleteness}%</span>
                <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded ml-2">
                  Optimization score
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-2 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                {failedChecks ? `${failedChecks} profile check${failedChecks === 1 ? '' : 's'} to fix` : 'All profile checks passed'}
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                Reviews
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-slate-900 flex items-center gap-1">
                  {location.hasRating === false ? '—' : location.rating} <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
                </span>
                <span className="text-xs text-slate-500">({location.reviewsCount} reviews)</span>
              </div>
              <p className={`text-xs mt-2 font-medium ${location.unansweredReviewsCount ? 'text-rose-600' : 'text-slate-500'}`}>
                {location.unansweredReviewsCount ? `${location.unansweredReviewsCount} review${location.unansweredReviewsCount === 1 ? '' : 's'} waiting for a reply` : 'No reviews waiting for a reply'}
              </p>
            </div>

          </div>

          {/* Profile Completeness Categories Grid */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 tracking-tight">
                  Profile completeness breakdown
                </h3>
                <p className="text-xs text-slate-500">
                  Checks this app runs on the profile data synced from Google.
                </p>
              </div>
              <Button variant="outline" size="xs" onClick={() => setActiveTab('Profile')}>
                Edit profile
              </Button>
            </div>

            {completenessCategories.length === 0 && (
              <p className="text-xs text-slate-500">Sync from Google to run the profile checks.</p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {completenessCategories.map((cat) => (
                <div
                  key={cat.name}
                  className="p-3.5 rounded-lg border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition space-y-1.5"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-900">{cat.name}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      cat.score === 100 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                    }`}>
                      {cat.status}
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-1">
                    <div
                      className="bg-blue-600 h-1 rounded-full"
                      style={{ width: `${cat.score}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 leading-snug">
                    {cat.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Services & Operating Hours summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Services Card */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 tracking-tight">
                  Configured Services
                </h3>
                <a href="https://business.google.com/" target="_blank" rel="noreferrer" className="text-xs text-blue-600 font-semibold hover:underline inline-flex items-center gap-1">
                  Edit in Google <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              {location.services.length === 0 && (
                <p className="text-xs text-slate-500">Service names aren't loaded from Google here yet. Manage them in Google Business Profile.</p>
              )}
              <div className="flex flex-wrap gap-2">
                {location.services.map((svc) => (
                  <span
                    key={svc}
                    className="px-2.5 py-1 rounded-md bg-slate-100 text-xs text-slate-900 border border-slate-200 font-medium flex items-center gap-1.5"
                  >
                    <Check className="h-3 w-3 text-emerald-600" />
                    {svc}
                  </span>
                ))}
              </div>

              {location.missingServices.length > 0 && (
                <div className="pt-3 border-t border-slate-100">
                  <span className="text-[11px] font-semibold text-amber-700 block mb-1.5">
                    Recommended high-search services to add:
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {location.missingServices.map((ms) => (
                      <span
                        key={ms}
                        className="px-2.5 py-1 rounded-md bg-amber-50 text-xs text-amber-800 border border-amber-200 font-medium"
                      >
                        + {ms}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Operating Hours Card */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 tracking-tight">
                  Operating Hours
                </h3>
                <span className="text-[11px] text-slate-500">As listed on Google</span>
              </div>

              <div className="space-y-1.5 text-xs">
                {Object.entries(location.hours).map(([day, hrs]) => (
                  <div key={day} className="flex items-center justify-between py-1 border-b border-slate-50 last:border-0">
                    <span className="capitalize text-slate-500 font-medium">{day}</span>
                    <span className="text-slate-900 font-semibold">{hrs}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>
      )}

      {/* TAB 2: PROFILE EDITOR */}
      {activeTab === 'Profile' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Google Business Profile Fields
              </h3>
              <p className="text-xs text-slate-500">
                Phone and website are saved to Google from here. Edit the name and category in Google Business Profile; Google may review changes before they appear.
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              disabled={saving || !onSaveProfile || (phone === location.phone && website === location.website)}
              onClick={async () => {
                if (!onSaveProfile) return;
                setSaving(true);
                try { await onSaveProfile(location.id, { phone, website }); } finally { setSaving(false); }
              }}
            >
              {saving ? 'Saving…' : 'Save to Google'}
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="font-medium text-slate-900 block mb-1">Business Name</label>
              <input
                type="text"
                value={location.name}
                readOnly
                className="w-full p-2 bg-slate-100 border border-slate-200 rounded-lg text-slate-500"
              />
            </div>
            <div>
              <label className="font-medium text-slate-900 block mb-1">Primary Category</label>
              <input
                type="text"
                value={location.category}
                readOnly
                className="w-full p-2 bg-slate-100 border border-slate-200 rounded-lg text-slate-500"
              />
            </div>
            <div>
              <label className="font-medium text-slate-900 block mb-1">Phone Number</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
              />
            </div>
            <div>
              <label className="font-medium text-slate-900 block mb-1">Website URL</label>
              <input
                type="text"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
              />
            </div>
          </div>
        </div>
      )}

      {/* Fallback for other tabs within location detail */}
      {activeTab !== 'Overview' && activeTab !== 'Profile' && (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center shadow-2xs">
          <p className="text-xs text-slate-500">
            {activeTab} for {location.name} isn't shown per location here yet. Use the {activeTab} section in the side menu.
          </p>
        </div>
      )}

    </div>
  );
};

export default LocationDetailView;
