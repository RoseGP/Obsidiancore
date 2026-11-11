/**
 * "Add locations": the real Google Business Profile connection and location picker
 * (the same flow as the first-run screen). No sample locations, no simulated scan.
 */
import React from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { LiveConnectPanel } from '../live/LiveConnectPanel';

export interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Kept for callers; the panel itself saves the selection and syncs. */
  onComplete?: () => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, onClose }) => (
  <Dialog
    isOpen={isOpen}
    onClose={onClose}
    title="Connect and choose locations"
    description="Choose which Google Business Profile locations to manage here. Changes are saved and synced when you confirm."
    size="lg"
    footer={
      <div className="flex items-center justify-end w-full">
        <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
      </div>
    }
  >
    <div className="-my-10 text-left">
      <LiveConnectPanel />
    </div>
  </Dialog>
);

export default OnboardingModal;
