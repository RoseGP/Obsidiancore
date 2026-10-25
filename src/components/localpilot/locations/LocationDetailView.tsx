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
  onOpenEditProfile: () => void;
}

export const LocationDetailView: React.FC<LocationDetailViewProps> = ({
  location,
  onBack,
  onRunAudit,
  onOpenEditProfile
}) => {
  const [activeTab, setActiveTab] = useState<
    'Overview' | 'Profile' | 'Reviews' | 'Posts' | 'Analytics' | 'SEO' | 'Security'
  >('Overview');

  const completenessCategories = [
    { name: 'Business Information', score: 100, status: 'Complete', desc: 'Name, address, phone, and website verified' },
    { name: 'Operating Hours', score: 100, status: 'Complete', desc: 'Regular and holiday hours configured' },
    { name: 'Categories', score: 100, status: 'Complete', desc: 'Primary & 2 secondary categories indexed' },
    { name: 'Services & Products', score: 85, status: '3 Missing', desc: '3 high-traffic services not listed' },
    { name: 'Photos & Visuals', score: 90, status: 'Healthy', desc: '142 photos uploaded, active 3d ago' },
    { name: 'Attributes & Badges', score: 100, status: 'Complete', desc: 'Accessibility, payment, and amenities set' },
  ];

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
              onClick={onOpenEditProfile}
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
                Local Visibility Score
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-slate-900">{location.visibilityScore}</span>
                <span className="text-xs font-normal text-slate-400">/ 100</span>
                <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded ml-2">
                  +{location.visibilityChange}% vs last month
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-2 flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                Ranked #1 for 18 primary keywords in Miami metro
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
                3 recommended services missing from profile
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                Review Health & Velocity
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-slate-900 flex items-center gap-1">
                  {location.rating} <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
                </span>
                <span className="text-xs text-slate-500">({location.reviewsCount} reviews)</span>
              </div>
              <p className="text-xs text-rose-600 mt-2 font-medium">
                {location.unansweredReviewsCount} reviews waiting for response
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
                  Ensure every Google Business Profile attribute is thoroughly populated.
                </p>
              </div>
              <Button variant="outline" size="xs" onClick={onOpenEditProfile}>
                Manage all attributes
              </Button>
            </div>

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
                <span className="text-xs text-blue-600 font-semibold cursor-pointer hover:underline" onClick={onOpenEditProfile}>
                  + Add service
                </span>
              </div>
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
                <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Open Now
                </span>
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
                Changes are validated and synced directly with Google Business Profile APIs upon approval.
              </p>
            </div>
            <Button variant="primary" size="sm" onClick={onOpenEditProfile}>
              Save Profile Changes
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="font-medium text-slate-900 block mb-1">Business Name</label>
              <input
                type="text"
                defaultValue={location.name}
                className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
              />
            </div>
            <div>
              <label className="font-medium text-slate-900 block mb-1">Primary Category</label>
              <input
                type="text"
                defaultValue={location.category}
                className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
              />
            </div>
            <div>
              <label className="font-medium text-slate-900 block mb-1">Phone Number</label>
              <input
                type="text"
                defaultValue={location.phone}
                className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
              />
            </div>
            <div>
              <label className="font-medium text-slate-900 block mb-1">Website URL</label>
              <input
                type="text"
                defaultValue={location.website}
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
            Showing filtered <strong>{activeTab}</strong> for {location.name}.
          </p>
        </div>
      )}

    </div>
  );
};

export default LocationDetailView;
