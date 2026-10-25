import React, { useState, useRef } from 'react';
import { 
  X, Upload, Image as ImageIcon, Sparkles, Check, Trash2, 
  Building2, Globe, Sliders, RefreshCw, AlertCircle
} from 'lucide-react';

export interface BrandLogoCustomizerProps {
  isOpen: boolean;
  onClose: () => void;
  currentLogoUrl?: string;
  currentLogoHeight?: number;
  currentBusinessName?: string;
  onSave: (data: { logoUrl: string; logoHeight: number; businessName?: string }) => void;
}

// Preset vector logos that users can choose from immediately
export const PRESET_LOGOS = [
  {
    id: 'ace-monogram',
    name: 'Ace Minimalist',
    description: 'Crisp monochrome chevron badge',
    svgDataUrl: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="%230f172a"/><path d="m18 15-6-6-6 6" stroke="%23ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  },
  {
    id: 'obsidian-hexagon',
    name: 'Obsidian Tech',
    description: 'Geometric tech gradient badge',
    svgDataUrl: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="%232E308E"/><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" stroke="%23ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 8v8" stroke="%2338bdf8" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="2" fill="%23ffffff"/></svg>`
  },
  {
    id: 'diamond-crest',
    name: 'Sovereign Crest',
    description: 'Executive financial diamond',
    svgDataUrl: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="%231e1b4b"/><path d="M12 2L2 9l10 13 10-13-10-7z" stroke="%23a855f7" stroke-width="2" stroke-linejoin="round"/><path d="M2 9h20" stroke="%23c084fc" stroke-width="1.5"/><circle cx="12" cy="12" r="1.5" fill="%23ffffff"/></svg>`
  },
  {
    id: 'horizon-pulse',
    name: 'Horizon SaaS',
    description: 'Dynamic cloud wave symbol',
    svgDataUrl: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="%23065f46"/><path d="M4 14.5c2.5-3 5-3 8 0s5.5 3 8 0" stroke="%2334d399" stroke-width="2.5" stroke-linecap="round"/><circle cx="12" cy="7" r="3" fill="%236ee7b7"/></svg>`
  },
  {
    id: 'quantum-core',
    name: 'Quantum Studio',
    description: 'Modern concentric circles badge',
    svgDataUrl: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="%23000000"/><circle cx="12" cy="12" r="7" stroke="%23ffffff" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="%23f59e0b"/></svg>`
  }
];

export default function BrandLogoCustomizerModal({
  isOpen,
  onClose,
  currentLogoUrl = '',
  currentLogoHeight = 36,
  currentBusinessName = 'Ace Studio',
  onSave
}: BrandLogoCustomizerProps) {
  const [logoUrl, setLogoUrl] = useState<string>(currentLogoUrl || '');
  const [logoHeight, setLogoHeight] = useState<number>(currentLogoHeight || 36);
  const [businessName, setBusinessName] = useState<string>(currentBusinessName || '');
  const [urlInput, setUrlInput] = useState<string>('');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileUpload = (file: File) => {
    setErrorNotice(null);
    if (!file.type.startsWith('image/')) {
      setErrorNotice('Please select a valid image file (PNG, JPG, SVG, WebP).');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setErrorNotice('Image file size must be less than 5MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (result) {
        setLogoUrl(result);
      }
    };
    reader.onerror = () => {
      setErrorNotice('Error reading file. Please try another image.');
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleApplyUrl = () => {
    if (!urlInput.trim()) return;
    setErrorNotice(null);
    setLogoUrl(urlInput.trim());
    setUrlInput('');
  };

  const handleSelectPreset = (presetUrl: string) => {
    setLogoUrl(presetUrl);
    setErrorNotice(null);
  };

  const handleRemoveLogo = () => {
    setLogoUrl('');
    setErrorNotice(null);
  };

  const handleSaveAndApply = () => {
    try {
      localStorage.setItem('invoice_custom_business_logo', logoUrl);
      if (businessName.trim()) {
        localStorage.setItem('invoice_custom_business_name', businessName.trim());
      }
    } catch {
      // ignore storage errors
    }
    onSave({
      logoUrl,
      logoHeight,
      businessName: businessName.trim() || undefined
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="w-full max-w-xl bg-white rounded-3xl shadow-2xl border border-slate-200/90 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-5 sm:p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-black text-white flex items-center justify-center shadow-xs shrink-0">
              <Upload className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Customize Company Logo & Branding</h3>
              <p className="text-xs text-slate-500 font-medium">
                Upload your own logo to appear across all invoices, proposals, and SOW documents.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {errorNotice && (
            <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2 font-medium">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
              <span>{errorNotice}</span>
            </div>
          )}

          {/* Current Logo Live Preview */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 flex items-center justify-center p-2 shadow-xs shrink-0 overflow-hidden">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt="Logo preview"
                    className="max-w-full max-h-full object-contain"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-xl bg-black flex items-center justify-center text-white">
                    <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m18 15-6-6-6 6"/>
                    </svg>
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Live Preview</span>
                <h4 className="text-sm font-bold text-slate-900 truncate">{businessName || 'Your Business Name'}</h4>
                <p className="text-xs text-slate-500">
                  {logoUrl ? 'Custom logo applied' : 'Default brand badge'}
                </p>
              </div>
            </div>

            {logoUrl && (
              <button
                type="button"
                onClick={handleRemoveLogo}
                className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200/80 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Remove Logo</span>
              </button>
            )}
          </div>

          {/* 1. File Upload Dropzone */}
          <div>
            <label className="text-xs font-bold text-slate-800 mb-2 block flex items-center gap-1.5">
              <Upload className="w-3.5 h-3.5 text-indigo-600" />
              <span>Upload Custom Logo Image</span>
              <span className="text-[10px] font-normal text-slate-400">(PNG, JPG, SVG, WebP up to 5MB)</span>
            </label>

            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
                isDragging 
                  ? 'border-indigo-600 bg-indigo-50/50 scale-[0.99]' 
                  : 'border-slate-200 hover:border-slate-400 bg-slate-50/50 hover:bg-slate-50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center mx-auto mb-2">
                <ImageIcon className="w-5 h-5" />
              </div>
              <p className="text-xs font-bold text-slate-800">
                Click to browse or drag and drop your logo file here
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                Transparent PNG or crisp SVG vector recommended for crisp printing
              </p>
            </div>
          </div>

          {/* 2. Direct Image URL Input */}
          <div>
            <label className="text-xs font-bold text-slate-800 mb-2 block flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-slate-500" />
              <span>Or Import by Image URL</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://yourcompany.com/assets/logo.png"
                className="flex-1 bg-slate-50 border border-slate-200/80 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-black/5"
              />
              <button
                type="button"
                onClick={handleApplyUrl}
                disabled={!urlInput.trim()}
                className="px-4 py-2.5 rounded-xl bg-black hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition-colors cursor-pointer shrink-0"
              >
                Apply
              </button>
            </div>
          </div>

          {/* 3. Curated Vector Brand Presets */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>Or Choose from Professional Vector Badges</span>
              </label>
              <span className="text-[10px] text-slate-400 font-medium">1-Click Apply</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {PRESET_LOGOS.map((preset) => {
                const isSelected = logoUrl === preset.svgDataUrl;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset.svgDataUrl)}
                    className={`p-3 rounded-2xl border text-left flex items-center gap-3 transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-50/80 border-indigo-400 ring-2 ring-indigo-200 shadow-xs'
                        : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                    }`}
                  >
                    <img
                      src={preset.svgDataUrl}
                      alt={preset.name}
                      className="w-9 h-9 rounded-xl object-contain shrink-0 shadow-xs"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-900 truncate">{preset.name}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                      </div>
                      <p className="text-[10px] text-slate-500 truncate">{preset.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. Logo Sizing Control */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-800 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-slate-500" />
                <span>Logo Display Height on Sheet</span>
              </span>
              <span className="font-mono text-slate-600 font-bold bg-white px-2 py-0.5 rounded-md border border-slate-200">
                {logoHeight}px
              </span>
            </div>
            <input
              type="range"
              min={24}
              max={64}
              step={2}
              value={logoHeight}
              onChange={(e) => setLogoHeight(Number(e.target.value))}
              className="w-full accent-black cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>Compact (24px)</span>
              <span>Default (36px)</span>
              <span>Prominent (64px)</span>
            </div>
          </div>

          {/* 5. Company Name Editor */}
          <div>
            <label className="text-xs font-bold text-slate-800 mb-1.5 block flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-slate-500" />
              <span>Company / Agency Name</span>
            </label>
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="e.g. Ace Studio Inc."
              className="w-full bg-slate-50 border border-slate-200/80 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-black/5"
            />
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleSaveAndApply}
            className="px-6 py-2.5 rounded-xl bg-black hover:bg-slate-800 text-white text-xs font-bold transition-all shadow-md shadow-slate-900/10 flex items-center gap-2 cursor-pointer active:scale-98"
          >
            <Check className="w-4 h-4" />
            <span>Save & Apply Branding</span>
          </button>
        </div>
      </div>
    </div>
  );
}
