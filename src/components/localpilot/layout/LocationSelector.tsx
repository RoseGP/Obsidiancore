import React, { useState, useRef, useEffect } from 'react';
import { MapPin, ChevronDown, Check, Search, Plus } from 'lucide-react';
import { LocationItem } from '../types';

export interface LocationSelectorProps {
  locations: LocationItem[];
  selectedLocationId: string; // 'all' or specific loc id
  onSelectLocation: (id: string) => void;
  onAddNewLocation?: () => void;
}

export const LocationSelector: React.FC<LocationSelectorProps> = ({
  locations,
  selectedLocationId,
  onSelectLocation,
  onAddNewLocation
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedLoc = locations.find((l) => l.id === selectedLocationId);
  const filtered = locations.filter((l) => 
    l.name.toLowerCase().includes(search.toLowerCase()) ||
    l.city.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-900 flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
      >
        <MapPin className="h-3.5 w-3.5 text-slate-500" />
        <span className="max-w-[140px] truncate">
          {selectedLocationId === 'all' ? `All locations (${locations.length})` : selectedLoc?.name || 'Select location'}
        </span>
        <ChevronDown className="h-3 w-3 text-slate-400" />
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-1.5 w-72 bg-white rounded-xl border border-slate-200 shadow-lg py-1.5 z-40 animate-in fade-in zoom-in-95 duration-100">
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search locations..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-2.5 py-1 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:bg-white focus:border-blue-500"
                autoFocus
              />
            </div>
          </div>

          <div className="max-h-56 overflow-y-auto py-1 text-xs">
            {/* All locations option */}
            <button
              type="button"
              onClick={() => {
                onSelectLocation('all');
                setIsOpen(false);
              }}
              className={`w-full px-3 py-2 flex items-center justify-between text-left hover:bg-slate-50 transition cursor-pointer ${
                selectedLocationId === 'all' ? 'bg-blue-50/70 text-blue-800 font-semibold' : 'text-slate-900'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-blue-600" />
                <span>All Locations ({locations.length} total)</span>
              </div>
              {selectedLocationId === 'all' && <Check className="h-3.5 w-3.5 text-blue-600" />}
            </button>

            {/* Filtered list */}
            {filtered.map((loc) => {
              const isSelected = loc.id === selectedLocationId;
              return (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => {
                    onSelectLocation(loc.id);
                    setIsOpen(false);
                  }}
                  className={`w-full px-3 py-2 flex items-center justify-between text-left hover:bg-slate-50 transition cursor-pointer ${
                    isSelected ? 'bg-blue-50/70 text-blue-800 font-semibold' : 'text-slate-900'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium">
                      {loc.name}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate">
                      {loc.city}, {loc.state} • {loc.rating}★ ({loc.reviewsCount})
                    </div>
                  </div>
                  {isSelected && <Check className="h-3.5 w-3.5 text-blue-600 shrink-0 ml-2" />}
                </button>
              );
            })}
          </div>

          {onAddNewLocation && (
            <div className="p-1.5 border-t border-slate-100 bg-slate-50/50">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onAddNewLocation();
                }}
                className="w-full py-1.5 px-2 rounded-md text-xs font-medium text-blue-600 hover:bg-blue-50 flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Connect new location</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
