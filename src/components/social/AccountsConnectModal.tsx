import React, { useState } from 'react';
import { 
  X, ShieldCheck, Check, Sparkles, Building2, ExternalLink,
  Linkedin, Instagram, Facebook, Lock, RefreshCw, Layers
} from 'lucide-react';
import { motion } from 'motion/react';
import { SocialPlatform, PLATFORM_CONFIGS, PlatformConnectionsMap } from './SocialTypes';
import SocialAccountsConnect from './SocialAccountsConnect';

interface AccountsConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  connections: PlatformConnectionsMap;
  onToggleConnection: (platform: SocialPlatform, targetState: boolean, handle?: string) => void;
  onShowToast: (msg: string, type?: 'success' | 'error') => void;
  userId?: string;
  workspaceId?: string;
}

export default function AccountsConnectModal({
  isOpen,
  onClose,
  connections,
  onToggleConnection,
  onShowToast,
  userId = 'demo-user-123',
  workspaceId = 'ws-production-tenant-42'
}: AccountsConnectModalProps) {
  const [modalTab, setModalTab] = useState<'gateway' | 'all'>('gateway');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-neutral-900/60 backdrop-blur-xs"
      />

      {/* Modal Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        className="w-full max-w-4xl bg-white border border-neutral-200 rounded-3xl p-5 sm:p-7 shadow-2xl relative z-10 text-neutral-900 max-h-[92vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-neutral-100">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-2xs">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-neutral-900 tracking-tight">
                Multi-Tenant Social Accounts Gateway
              </h3>
              <p className="text-xs text-neutral-500">
                Connect Instagram, LinkedIn, X, and TikTok via hosted OAuth 2.0 gateway
              </p>
            </div>
          </div>
          
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-all cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab switch inside modal */}
        <div className="flex items-center gap-2 mt-4 mb-5 border-b border-neutral-100 pb-3">
          <button
            type="button"
            onClick={() => setModalTab('gateway')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              modalTab === 'gateway'
                ? 'bg-indigo-600 text-white shadow-2xs'
                : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Primary Networks (Instagram, LinkedIn, X, TikTok)</span>
          </button>

          <button
            type="button"
            onClick={() => setModalTab('all')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              modalTab === 'all'
                ? 'bg-indigo-600 text-white shadow-2xs'
                : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>All Channel Connections</span>
          </button>
        </div>

        {/* Tab 1: Primary Hosted Gateway component */}
        {modalTab === 'gateway' && (
          <SocialAccountsConnect
            userId={userId}
            workspaceId={workspaceId}
            onConnectionChange={(plat, isConnected, handle) => {
              const mappedPlat = plat === 'x' ? 'twitter' : (plat as SocialPlatform);
              onToggleConnection(mappedPlat, isConnected, handle);
              onShowToast(
                isConnected
                  ? `Successfully connected ${plat.toUpperCase()} (${handle || ''})!`
                  : `Disconnected ${plat.toUpperCase()}.`,
                isConnected ? 'success' : 'default'
              );
            }}
          />
        )}

        {/* Tab 2: All Channels List */}
        {modalTab === 'all' && (
          <div className="space-y-4">
            <div className="divide-y divide-neutral-100">
              {(Object.keys(PLATFORM_CONFIGS) as SocialPlatform[]).map((platform) => {
                const config = PLATFORM_CONFIGS[platform];
                const connection = connections[platform];
                const isConnected = connection?.connected;

                return (
                  <div
                    key={platform}
                    className="py-3.5 flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-xl bg-neutral-50 border border-neutral-200 flex items-center justify-center shrink-0">
                        {platform === 'linkedin' && <Linkedin className="h-5 w-5 text-[#0A66C2] fill-current" />}
                        {platform === 'twitter' && <span className="font-mono font-bold text-sm text-neutral-900">𝕏</span>}
                        {platform === 'instagram' && <Instagram className="h-5 w-5 text-pink-600" />}
                        {platform === 'facebook' && <Facebook className="h-5 w-5 text-blue-600 fill-current" />}
                        {platform === 'tiktok' && <span className="font-bold text-xs text-cyan-600">TT</span>}
                        {platform === 'thread' && <span className="font-bold text-xs text-neutral-700">@</span>}
                        {platform === 'pinterest' && <span className="font-bold text-xs text-rose-600">P</span>}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold text-neutral-900 truncate">{config.name}</h4>
                          {isConnected ? (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                              <Check className="h-2.5 w-2.5 text-emerald-600" />
                              <span>Connected</span>
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-500 border border-neutral-200">
                              Disconnected
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-neutral-500 truncate mt-0.5">
                          {isConnected ? connection.handle : config.description}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          onToggleConnection(platform, !isConnected);
                          onShowToast(
                            !isConnected ? `Connected ${config.name}!` : `Disconnected ${config.name}.`
                          );
                        }}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                          isConnected
                            ? 'border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700'
                            : 'border border-neutral-200 bg-neutral-50 hover:bg-neutral-100 text-neutral-800'
                        }`}
                      >
                        {isConnected ? 'Disconnect' : 'Connect'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-neutral-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-neutral-500">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>AES-256-GCM Hardware Encrypted. Seamless URL redirect handshake enabled.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer w-full sm:w-auto"
          >
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );
}
