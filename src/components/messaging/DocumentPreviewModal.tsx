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
          {isImage ? (
            <div
              style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: 'center center' }}
              className="transition-transform duration-150 flex items-center justify-center max-w-full max-h-full"
            >
              <img
                src={document.url || 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&q=80&w=800'}
                alt={document.name}
                className="max-h-[60vh] max-w-full rounded-lg shadow-2xl border border-white/10 object-contain"
              />
            </div>
          ) : isPdf ? (
            <div
              style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: 'top center' }}
              className="w-full max-w-2xl bg-white text-neutral-900 rounded-xl shadow-2xl p-10 font-sans transition-transform duration-150 border border-neutral-300"
            >
              <div className="border-b border-neutral-200 pb-6 mb-6 flex justify-between items-start">
                <div>
                  <h1 className="text-xl font-bold tracking-tight text-neutral-900">AlphaTech Cloud Enterprise Architecture</h1>
                  <p className="text-xs text-neutral-500 mt-1">Confidential Specification Document • Reference: SLA-2026-v2.4</p>
                </div>
                <span className="px-2.5 py-1 rounded bg-neutral-100 text-neutral-700 text-xs font-semibold">VERIFIED</span>
              </div>
              <div className="space-y-4 text-xs leading-relaxed text-neutral-700">
                <p className="font-semibold text-neutral-900">1. Executive Summary & Topology</p>
                <p>
                  This specification governs the high-availability failover cluster across the primary region us-east1 and secondary region us-central1. WebRTC signaling gateways and screen capture streaming channels operate with redundant SIP trunk fallbacks and sub-45ms media routing.
                </p>
                <p className="font-semibold text-neutral-900">2. Security & Regulatory Compliance</p>
                <p>
                  All audio and video streams enforce DTLS 1.2 with SRTP AES-GCM-256 cipher suites. Client data is segregated using dedicated tenant keys, preventing cross-organization query leakage.
                </p>
                <p className="font-semibold text-neutral-900">3. Verification Checklist</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Mutual TLS Handshake established within 80ms.</li>
                  <li>Screen capture stream resolution locked at 1080p 30fps with adaptive bitrate reduction.</li>
                  <li>Audit trail exported to customer SIEM destination daily.</li>
                </ul>
              </div>
              <div className="mt-8 pt-4 border-t border-neutral-200 flex justify-between items-center text-[10px] text-neutral-400">
                <span>Page 1 of 12</span>
                <span>Obsidian Core CRM Integration Node</span>
              </div>
            </div>
          ) : (
            <div className="text-center p-8 max-w-md bg-neutral-900 border border-white/5 rounded-2xl">
              <FileText className="w-12 h-12 text-blue-400 mx-auto mb-3 opacity-80" />
              <h4 className="text-sm font-semibold text-white mb-1">{document.name}</h4>
              <p className="text-xs text-neutral-400 mb-4">
                This document ({document.size || 'Document file'}) can be downloaded or inspected in an external viewer.
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
