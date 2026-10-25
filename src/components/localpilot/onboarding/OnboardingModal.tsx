import React, { useState } from 'react';
import { 
  Building2, ShieldCheck, CheckCircle2, 
  ArrowRight, Sparkles, RefreshCw, Check, Lock 
} from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';

export interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  onClose,
  onComplete
}) => {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([
    'downtown', 'southbeach', 'bayside', 'coral'
  ]);
  const [isScanning, setIsScanning] = useState(false);

  const sampleDiscovered = [
    { id: 'downtown', name: 'Downtown Miami Flagship', address: '250 Biscayne Blvd', rating: 4.9 },
    { id: 'southbeach', name: 'South Beach Oceanfront Lounge', address: '1120 Ocean Dr', rating: 4.2 },
    { id: 'bayside', name: 'Bayside Marina Grill', address: '401 Biscayne Blvd', rating: 4.7 },
    { id: 'coral', name: 'Coral Gables Bistro', address: '300 Miracle Mile', rating: 4.8 },
  ];

  const handleNextStep2 = () => {
    setStep(2);
  };

  const handleRunInitialScan = () => {
    setStep(3);
    setIsScanning(true);
    setTimeout(() => {
      setIsScanning(false);
      setStep(4);
    }, 1500);
  };

  const toggleLocation = (id: string) => {
    if (selectedLocations.includes(id)) {
      setSelectedLocations(selectedLocations.filter((item) => item !== id));
    } else {
      setSelectedLocations([...selectedLocations, id]);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={
        step === 1 ? 'Connect Google Business Profiles' :
        step === 2 ? 'Import Managed Locations' :
        step === 3 ? 'Running Automated Local SEO Baseline Scan...' :
        '🎉 Workspace Ready!'
      }
      description={
        step === 1 ? 'Authorize secure read & write API access to manage your profiles.' :
        step === 2 ? 'Select which business locations you want to monitor and optimize.' :
        step === 3 ? 'Analyzing rankings, photo recency, hours, and review sentiment.' :
        'Your initial local visibility baseline has been established.'
      }
      size="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="font-semibold text-slate-900">Step {step} of 4</span>
          </div>

          <div className="flex items-center gap-2">
            {step === 1 && (
              <Button variant="primary" size="sm" onClick={handleNextStep2} rightIcon={<ArrowRight className="h-3.5 w-3.5" />}>
                Authorize Google Account
              </Button>
            )}

            {step === 2 && (
              <Button variant="primary" size="sm" onClick={handleRunInitialScan} rightIcon={<Sparkles className="h-3.5 w-3.5" />}>
                Import ({selectedLocations.length}) Locations & Run Baseline
              </Button>
            )}

            {step === 4 && (
              <Button variant="primary" size="sm" onClick={() => { onComplete(); onClose(); }}>
                Launch LocalPilot Command Center
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4 text-xs">
        
        {/* Step 1: Google OAuth Authorization */}
        {step === 1 && (
          <div className="p-5 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <h4 className="font-bold text-sm text-slate-900">Google Business Profile Integration</h4>
                <p className="text-xs text-slate-500">Official Google Business Profile API v1 Connection</p>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-slate-200 text-slate-900">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                <span>Read & update location hours, categories, and attributes</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                <span>Publish approved posts, photos, and review replies</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                <span>Monitor security access & unauthorized third-party changes</span>
              </div>
            </div>

            <div className="p-3 bg-white rounded-lg border border-slate-200 flex items-center gap-2 text-[11px] text-slate-500">
              <Lock className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
              <span>LocalPilot never makes changes without your explicit approval.</span>
            </div>
          </div>
        )}

        {/* Step 2: Location selection */}
        {step === 2 && (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold text-slate-500 mb-1">
              Discovered 4 locations under your Google account:
            </div>
            {sampleDiscovered.map((loc) => {
              const isChecked = selectedLocations.includes(loc.id);
              return (
                <div
                  key={loc.id}
                  onClick={() => toggleLocation(loc.id)}
                  className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition ${
                    isChecked ? 'border-blue-600 bg-blue-50/20' : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {}}
                      className="rounded border-slate-300 text-blue-600 focus:ring-0"
                    />
                    <div>
                      <div className="font-bold text-slate-900">{loc.name}</div>
                      <div className="text-[11px] text-slate-500">{loc.address}</div>
                    </div>
                  </div>

                  <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                    ★ {loc.rating}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Step 3: Scanning animation */}
        {step === 3 && (
          <div className="p-8 text-center space-y-4">
            <RefreshCw className="h-8 w-8 text-blue-600 animate-spin mx-auto" />
            <div>
              <h4 className="font-bold text-sm text-slate-900">Analyzing Profile Ranking Factors</h4>
              <p className="text-xs text-slate-500 mt-1">Benchmarking 4 locations against local competitors in Miami...</p>
            </div>
          </div>
        )}

        {/* Step 4: Ready! */}
        {step === 4 && (
          <div className="p-5 bg-emerald-50/50 border border-emerald-200 rounded-xl space-y-4 text-center">
            <div className="h-12 w-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-6 w-6" />
            </div>

            <div>
              <h3 className="text-base font-bold text-emerald-950">Baseline Score: 92 / 100</h3>
              <p className="text-xs text-emerald-800 mt-1">
                4 locations connected. We identified 7 actionable opportunities to increase map pack discovery.
              </p>
            </div>
          </div>
        )}

      </div>
    </Dialog>
  );
};

export default OnboardingModal;
