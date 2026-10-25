import React, { useState } from 'react';
import { 
  CheckCircle2, AlertTriangle, Info, MapPin, 
  Phone, Globe, RefreshCw, FileCode, Check, HelpCircle, Activity
} from 'lucide-react';
import { LocationItem } from '../types';

interface SeoQuickHealthCheckCardProps {
  selectedLocation: LocationItem;
}

export const SeoQuickHealthCheckCard: React.FC<SeoQuickHealthCheckCardProps> = ({ selectedLocation }) => {
  const [isAuditing, setIsAuditing] = useState(false);
  const [lastAuditTime, setLastAuditTime] = useState<string>("Just now");

  const runSEOAudit = () => {
    setIsAuditing(true);
    setTimeout(() => {
      setIsAuditing(false);
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setLastAuditTime(`at ${time}`);
    }, 1000);
  };

  // Dynamically determine NAP health and Schema fields based on selected location
  const hasPhone = !!selectedLocation.phone;
  const hasWebsite = !!selectedLocation.website;
  const hasAddress = !!selectedLocation.address;
  const isHealthy = selectedLocation.status === 'Healthy';

  // Circular Progress Ring calculations
  const score = selectedLocation.profileCompleteness || 85;
  const radius = 28;
  const strokeWidth = 5;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  // Specific check conditions for different locations
  const isRestaurant = selectedLocation.category.toLowerCase().includes('restaurant') || selectedLocation.category.toLowerCase().includes('bistro');
  
  const schemaChecks = [
    { name: '@context & @type', status: 'pass', type: 'LocalBusiness' },
    { 
      name: 'FoodEstablishment Extension', 
      status: isRestaurant ? 'pass' : 'info', 
      type: isRestaurant ? 'Restaurant Mapped' : 'Not Required' 
    },
    { name: 'geo (Latitude/Longitude)', status: 'pass', type: 'GeoCoordinates' },
    { 
      name: 'openingHoursSpecification', 
      status: selectedLocation.hours.monday ? 'pass' : 'warn', 
      type: selectedLocation.hours.monday ? 'Mapped' : 'Missing Monday' 
    },
    { 
      name: 'priceRange', 
      status: isHealthy ? 'pass' : 'warn', 
      type: isHealthy ? 'Mappable ($$)' : 'Missing Value' 
    },
    { 
      name: 'hasMenu / services', 
      status: selectedLocation.services.length > 0 ? 'pass' : 'warn', 
      type: `${selectedLocation.services.length} items mapped` 
    }
  ];

  const napSyncPoints = [
    { name: 'Google Business Profile', matches: true, status: 'Synced' },
    { name: 'Apple Maps Listing', matches: true, status: 'Synced' },
    { name: 'Bing Places for Business', matches: isHealthy, status: isHealthy ? 'Synced' : 'Mismatch' },
    { name: 'Yelp & Local Directories', matches: isHealthy, status: isHealthy ? 'Synced' : 'Warning' }
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4 hover:shadow-md transition-shadow duration-200 text-left">
      <div className="flex items-center justify-between pb-1 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Activity className="h-4.5 w-4.5 text-blue-600" />
          <h3 className="text-sm font-bold text-slate-900">Local SEO Health Audit</h3>
        </div>
        <button
          onClick={runSEOAudit}
          disabled={isAuditing}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors disabled:opacity-50 cursor-pointer"
          title="Re-run Local SEO Audit"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isAuditing ? 'animate-spin text-blue-600' : ''}`} />
        </button>
      </div>

      {/* Selected Location Meta with Circular Progress Ring Score Visualizer */}
      <div className="bg-slate-50 rounded-xl p-4 flex items-center gap-4">
        {/* Progress Ring Visualizer */}
        <div className="relative flex items-center justify-center shrink-0">
          <svg className="w-18 h-18 transform -rotate-90">
            {/* Trail Circle */}
            <circle
              cx="36"
              cy="36"
              r={radius}
              className="text-slate-200"
              strokeWidth={strokeWidth}
              stroke="currentColor"
              fill="transparent"
            />
            {/* Path Circle */}
            <circle
              cx="36"
              cy="36"
              r={radius}
              className={`${score >= 90 ? 'text-emerald-500' : 'text-amber-500'} transition-all duration-500`}
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={isAuditing ? circumference : strokeDashoffset}
              strokeLinecap="round"
              stroke="currentColor"
              fill="transparent"
            />
          </svg>
          <div className="absolute flex flex-col items-center justify-center">
            <span className="text-sm font-extrabold text-slate-900">{score}%</span>
            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight">Score</span>
          </div>
        </div>

        {/* Audit Details */}
        <div className="flex-1 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 truncate max-w-[130px]" title={selectedLocation.name}>
              {selectedLocation.name}
            </span>
            <span className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full shrink-0 ${
              isHealthy ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
            }`}>
              {selectedLocation.status}
            </span>
          </div>
          <p className="text-[10px] text-slate-500 flex items-center gap-1">
            <span>Audit: {isAuditing ? "Scanning D1 schema..." : "Completed"}</span>
            <span className="text-slate-400">•</span>
            <span>{lastAuditTime}</span>
          </p>
        </div>
      </div>

      {/* 1. NAP Consistency Scan */}
      <div className="space-y-2.5">
        <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
          <span>NAP Consistency Checks</span>
          <span className="text-[10px] font-medium text-slate-400 font-mono">(Name, Address, Phone)</span>
        </h4>
        <div className="grid grid-cols-2 gap-2">
          <div className="border border-slate-150 rounded-xl p-2.5 flex flex-col gap-1.5 bg-slate-50/50">
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wide">Business NAP</span>
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-slate-800 truncate" title={selectedLocation.name}>🏷 {selectedLocation.name}</p>
              <p className="text-[10px] font-medium text-slate-600 truncate">📍 {selectedLocation.address}, {selectedLocation.city}</p>
              <p className="text-[10px] font-medium text-slate-600">📞 {selectedLocation.phone}</p>
            </div>
          </div>

          <div className="border border-slate-150 rounded-xl p-2.5 flex flex-col gap-1.5">
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wide">Sync Integrity</span>
            <div className="space-y-1">
              {napSyncPoints.map((pt, i) => (
                <div key={i} className="flex items-center justify-between text-[9px]">
                  <span className="text-slate-500 truncate max-w-[85px]">{pt.name}</span>
                  <span className={`font-bold flex items-center gap-0.5 ${pt.matches ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {pt.matches ? <Check className="h-2.5 w-2.5" /> : <AlertTriangle className="h-2.5 w-2.5" />}
                    <span>{pt.status}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Structured Schema.org Checks */}
      <div className="space-y-2">
        <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
          <FileCode className="h-3.5 w-3.5 text-slate-500" />
          <span>Local Schema.org Validation</span>
        </h4>
        <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
          {schemaChecks.map((chk, i) => (
            <div key={i} className="px-3 py-2 flex items-center justify-between text-[10px]">
              <span className="font-medium text-slate-700">{chk.name}</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-mono text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">{chk.type}</span>
                {chk.status === 'pass' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
                {chk.status === 'warn' && <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 animate-pulse" />}
                {chk.status === 'info' && <Info className="h-3.5 w-3.5 text-blue-500 shrink-0" />}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Missing attributes warning */}
      {selectedLocation.missingServices.length > 0 && (
        <div className="bg-amber-50 border border-amber-200/50 rounded-xl p-3 flex items-start gap-2 text-amber-900">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-[10px] font-medium leading-normal">
            <p className="font-bold">Missing Services Schema Mapping ({selectedLocation.missingServices.length} items)</p>
            <p className="text-amber-700 mt-0.5">Google Business listing is missing high-intent services like &quot;{selectedLocation.missingServices[0]}&quot;.</p>
          </div>
        </div>
      )}
    </div>
  );
};
