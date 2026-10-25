import React from 'react';
import MeetingMediaControls from './MeetingMediaControls';

export { MeetingMediaControls };

interface VideoPreviewContainerProps {
  title?: string;
  onClose?: () => void;
}

/**
 * VideoPreviewContainer Component
 * Renders the WebRTC Dashboard with MeetingMediaControls
 */
export default function VideoPreviewContainer({
  title = 'WebRTC Video Preview & Screen Sharing',
  onClose,
}: VideoPreviewContainerProps) {
  return (
    <div className="relative w-full">
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-50 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition-colors cursor-pointer border border-slate-700 shadow"
        >
          ✕ Close Dashboard
        </button>
      )}
      <MeetingMediaControls />
    </div>
  );
}

