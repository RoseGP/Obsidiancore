import React, { useState } from 'react';
import { 
  Search, Filter, Plus, Star, MapPin, 
  ArrowUpDown, MoreHorizontal, ShieldCheck, 
  CheckSquare, Square, RefreshCw, FileDown,
  Megaphone, Zap, ChevronRight, ExternalLink
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { LocationItem, LocalPilotRoute } from '../types';

export interface LocationsViewProps {
  locations: LocationItem[];
  onSelectLocation: (locId: string) => void;
  onAddNewLocation: () => void;
  onRunAudit: (locIds: string[]) => void;
  onCreatePost: (locIds: string[]) => void;
}

export const LocationsView: React.FC<LocationsViewProps> = ({
  locations,
  onSelectLocation,
  onAddNewLocation,
  onRunAudit,
  onCreatePost
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Healthy' | 'Needs Attention' | 'Critical'>('All');
  const [selectedLocIds, setSelectedLocIds] = useState<string[]>([]);

  // Filtered locations
  const filtered = locations.filter((loc) => {
    const matchesSearch = 
      loc.name.toLowerCase().includes(search.toLowerCase()) ||
      loc.city.toLowerCase().includes(search.toLowerCase()) ||
      loc.category.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'All' || loc.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const healthyCount = locations.filter((l) => l.status === 'Healthy').length;
  const needsAttentionCount = locations.filter((l) => l.status === 'Needs Attention').length;
  const criticalCount = locations.filter((l) => l.status === 'Critical').length;

  const toggleSelectAll = () => {
    if (selectedLocIds.length === filtered.length) {
      setSelectedLocIds([]);
    } else {
      setSelectedLocIds(filtered.map((l) => l.id));
    }
  };

  const toggleSelectOne = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedLocIds.includes(id)) {
      setSelectedLocIds(selectedLocIds.filter((x) => x !== id));
    } else {
      setSelectedLocIds([...selectedLocIds, id]);
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-200" id="localpilot-locations-view">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Locations
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage and monitor all your business locations across Google Maps and Search.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRunAudit(locations.map(l => l.id))}
            leftIcon={<RefreshCw className="h-3.5 w-3.5 text-slate-500" />}
          >
            Sync All
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onAddNewLocation}
            leftIcon={<Plus className="h-3.5 w-3.5" />}
          >
            Add location
          </Button>
        </div>
      </div>

      {/* Stats Cards Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div 
          onClick={() => setStatusFilter('All')}
          className={`p-3.5 rounded-xl border bg-white cursor-pointer transition-all ${
            statusFilter === 'All' ? 'border-blue-600 ring-1 ring-blue-600' : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <span className="text-[11px] font-medium text-slate-500 block">Total Locations</span>
          <div className="text-xl font-bold text-slate-900 mt-0.5">
            {locations.length}
          </div>
        </div>

        <div 
          onClick={() => setStatusFilter('Healthy')}
          className={`p-3.5 rounded-xl border bg-white cursor-pointer transition-all ${
            statusFilter === 'Healthy' ? 'border-emerald-500 ring-1 ring-emerald-500' : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <span className="text-[11px] font-medium text-emerald-700 block">Healthy Profiles</span>
          <div className="text-xl font-bold text-slate-900 mt-0.5">
            {healthyCount}
          </div>
        </div>

        <div 
          onClick={() => setStatusFilter('Needs Attention')}
          className={`p-3.5 rounded-xl border bg-white cursor-pointer transition-all ${
            statusFilter === 'Needs Attention' ? 'border-amber-500 ring-1 ring-amber-500' : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <span className="text-[11px] font-medium text-amber-700 block">Needs Attention</span>
          <div className="text-xl font-bold text-slate-900 mt-0.5">
            {needsAttentionCount}
          </div>
        </div>

        <div 
          onClick={() => setStatusFilter('Critical')}
          className={`p-3.5 rounded-xl border bg-white cursor-pointer transition-all ${
            statusFilter === 'Critical' ? 'border-rose-500 ring-1 ring-rose-500' : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <span className="text-[11px] font-medium text-rose-700 block">Critical Issues</span>
          <div className="text-xl font-bold text-slate-900 mt-0.5">
            {criticalCount}
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name, city, category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-blue-500 shadow-2xs"
          />
        </div>

        {/* Bulk Action Toolbar if items selected */}
        {selectedLocIds.length > 0 ? (
          <div className="flex items-center gap-2 p-1.5 px-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800 font-medium animate-in fade-in duration-150">
            <span>{selectedLocIds.length} locations selected</span>
            <div className="h-3 w-px bg-blue-300 mx-1" />
            <button
              type="button"
              onClick={() => onRunAudit(selectedLocIds)}
              className="hover:underline flex items-center gap-1 cursor-pointer font-semibold"
            >
              <Zap className="h-3 w-3" /> Run Audit
            </button>
            <button
              type="button"
              onClick={() => onCreatePost(selectedLocIds)}
              className="hover:underline flex items-center gap-1 cursor-pointer font-semibold ml-2"
            >
              <Megaphone className="h-3 w-3" /> Create Post
            </button>
            <button
              type="button"
              onClick={() => setSelectedLocIds([])}
              className="text-slate-400 hover:text-slate-700 ml-2 cursor-pointer"
            >
              Deselect
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">
              Showing {filtered.length} of {locations.length} locations
            </span>
          </div>
        )}
      </div>

      {/* Main Data Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 border-b border-slate-100 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={selectedLocIds.length > 0 && selectedLocIds.length === filtered.length}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3">Location</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Visibility</th>
                <th className="px-3 py-3">Rating</th>
                <th className="px-3 py-3">Reviews</th>
                <th className="px-3 py-3">Profile</th>
                <th className="px-3 py-3">Last Sync</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-normal">
              {filtered.map((loc) => {
                const isSelected = selectedLocIds.includes(loc.id);
                return (
                  <tr
                    key={loc.id}
                    onClick={() => onSelectLocation(loc.id)}
                    className={`hover:bg-slate-50/80 transition-colors cursor-pointer group ${
                      isSelected ? 'bg-blue-50/30' : ''
                    }`}
                  >
                    <td className="px-4 py-3.5" onClick={(e) => toggleSelectOne(loc.id, e)}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                    </td>

                    {/* Location Name & Category */}
                    <td className="px-4 py-3.5">
                      <div className="font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">
                        {loc.name}
                      </div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                        <MapPin className="h-3 w-3 text-slate-400" />
                        <span>{loc.address}, {loc.city}, {loc.state}</span>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-3 py-3.5 whitespace-nowrap">
                      <Badge
                        variant={
                          loc.status === 'Healthy' ? 'success' :
                          loc.status === 'Needs Attention' ? 'warning' : 'danger'
                        }
                        size="sm"
                      >
                        {loc.status}
                      </Badge>
                    </td>

                    {/* Visibility */}
                    <td className="px-3 py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-900">{loc.visibilityScore}</span>
                        <span className="text-[10px] text-emerald-600 font-medium">
                          +{loc.visibilityChange}%
                        </span>
                      </div>
                    </td>

                    {/* Rating */}
                    <td className="px-3 py-3.5 whitespace-nowrap font-medium text-slate-900">
                      <div className="flex items-center gap-1">
                        <span>{loc.rating}</span>
                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                      </div>
                    </td>

                    {/* Reviews Count */}
                    <td className="px-3 py-3.5 whitespace-nowrap">
                      <div className="text-slate-900">
                        {loc.reviewsCount} total
                      </div>
                      {loc.unansweredReviewsCount > 0 && (
                        <div className="text-[10px] text-rose-600 font-semibold">
                          {loc.unansweredReviewsCount} unanswered
                        </div>
                      )}
                    </td>

                    {/* Profile Completeness */}
                    <td className="px-3 py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="w-12 bg-slate-100 rounded-full h-1.5">
                          <div
                            className="bg-blue-600 h-1.5 rounded-full"
                            style={{ width: `${loc.profileCompleteness}%` }}
                          />
                        </div>
                        <span className="font-medium text-slate-900">
                          {loc.profileCompleteness}%
                        </span>
                      </div>
                    </td>

                    {/* Last Sync */}
                    <td className="px-3 py-3.5 whitespace-nowrap text-slate-500">
                      {loc.lastSync}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3.5 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => onSelectLocation(loc.id)}
                        >
                          View
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => onRunAudit([loc.id])}
                          title="Run audit"
                        >
                          Audit
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};

export default LocationsView;
