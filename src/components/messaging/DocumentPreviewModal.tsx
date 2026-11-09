import React from 'react';
import { X, Download, FileText, ExternalLink, ZoomIn, ZoomOut, Check, Share2, Eye } from 'lucide-react';

interface DocumentPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  document: {
    name: string;
    url?: string;
    size?: string;
    mime?: string;
    senderName?: string;
    timestamp?: string;
  } | null;
}

export const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({
  isOpen,
  onClose,
  document
}) => {
  const [zoomLevel, setZoomLevel] = React.useState(100);
  const [copied, setCopied] = React.useState(false);

  if (!isOpen || !document) return null;

  const isImage = document.mime?.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(document.name);
  const isPdf = document.mime === 'application/pdf' || /\.pdf$/i.test(document.name);

  const handleCopyLink = () => {
    navigator.clipboard?.writeText(document.url || window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-neutral-900 border border-white/10 rounded-2xl w-full max-w-4xl h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header Bar */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-neutral-950/60">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white truncate">{document.name}</h3>
              <p className="text-xs text-neutral-400 flex items-center gap-2">
                <span>{document.size || '1.8 MB'}</span>
                {document.senderName && (
                  <>
                    <span>•</span>
                    <span>Shared by {document.senderName}</span>
                  </>
                )}
                {document.timestamp && (
                  <>
                    <span>•</span>
                    <span>{document.timestamp}</span>
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setZoomLevel((z) => Math.max(50, z - 20))}
              title="Zoom Out"
              className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono text-neutral-400 w-12 text-center">{zoomLevel}%</span>
            <button
              onClick={() => setZoomLevel((z) => Math.min(200, z + 20))}
              title="Zoom In"
              className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
            >
              <ZoomIn className="w-4 h-4" />
            </button>

            <div className="h-4 w-px bg-white/10 mx-1" />

            <button
              onClick={handleCopyLink}
              title="Copy Document Link"
              className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer flex items-center gap-1 text-xs"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
            </button>

            {document.url && (
              <a
                href={document.url}
                target="_blank"
                rel="noreferrer"
                download={document.name}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium flex items-center gap-1.5 shadow transition cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download</span>
              </a>
            )}

            <button
              onClick={onClose}
              className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition cursor-pointer ml-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Document Content Stage */}
        <div className="flex-1 overflow-auto p-6 bg-neutral-950 flex items-center justify-center relative">
          {isImage && document.url ? (
            <div
              style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: 'center center' }}
              className="transition-transform duration-150 flex items-center justify-center max-w-full max-h-full"
            >
              <img
                src={document.url}
                alt={document.name}
                className="max-h-[60vh] max-w-full rounded-lg shadow-2xl border border-white/10 object-contain"
              />
            </div>
          ) : isPdf && document.url && /^(https?:|blob:|\/)/.test(document.url) ? (
            <iframe
              title={document.name}
              src={document.url}
              className="w-full h-full min-h-[60vh] rounded-xl bg-white border border-white/10"
            />
          ) : (
            <div className="text-center p-8 max-w-md bg-neutral-900 border border-white/5 rounded-2xl">
              <FileText className="w-12 h-12 text-blue-400 mx-auto mb-3 opacity-80" />
              <h4 className="text-sm font-semibold text-white mb-1">{document.name}</h4>
              <p className="text-xs text-neutral-400 mb-4">
                {document.url ? `This file${document.size ? ` (${document.size})` : ''} can't be previewed here. Download it to open it.` : 'This file isn\'t available to preview or download.'}
              </p>
              {document.url && (
                <a
                  href={document.url}
                  download={document.name}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition"
                >
                  <Download className="w-4 h-4" />
                  Download File
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
