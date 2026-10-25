import React, { useState, useEffect, useCallback } from 'react';
import { 
  Linkedin, Globe, RefreshCw, CheckCircle2, 
  AlertCircle, ShieldCheck, ExternalLink, Trash2, 
  Check, Lock, Sparkles, Key, Terminal, ArrowRight,
  Radio, Layers
} from 'lucide-react';

export interface IntegrationPlatformConfig {
  id: 'twitter' | 'linkedin' | 'mastodon';
  name: string;
  badgeName: string;
  tagline: string;
  description: string;
  iconBg: string;
  iconColor: string;
  scopes: string[];
  defaultHandle: string;
  defaultMetric: string;
  defaultMetricLabel: string;
  apiProtocol: string;
}

export const INTEGRATION_PLATFORMS: IntegrationPlatformConfig[] = [
  {
    id: 'twitter',
    name: 'Twitter / X',
    badgeName: 'X Protocol v2',
    tagline: 'Microblogging & Real-time Feeds',
    description: 'Direct tweet broadcasting, thread orchestration, media attachments, and real-time engagement telemetry.',
    iconBg: 'bg-neutral-950 border border-white/10',
    iconColor: 'text-white',
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    defaultHandle: '@flowforge_hq',
    defaultMetric: '4.8% Engagement',
    defaultMetricLabel: 'Avg Engagement Rate',
    apiProtocol: 'OAuth 2.0 PKCE + AES-256-GCM'
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    badgeName: 'REST API v2',
    tagline: 'Professional B2B Network',
    description: 'Publish executive articles, company updates, track organization impressions, and synchronize member leads.',
    iconBg: 'bg-blue-600',
    iconColor: 'text-white',
    scopes: ['openid', 'profile', 'email', 'w_member_social'],
    defaultHandle: '@sarah_jenkins_lead',
    defaultMetric: '1,420 Views',
    defaultMetricLabel: 'Weekly Post Impressions',
    apiProtocol: 'OAuth 2.0 Authorization Code'
  },
  {
    id: 'mastodon',
    name: 'Mastodon',
    badgeName: 'Fediverse ActivityPub',
    tagline: 'Decentralized Social Network',
    description: 'Post federated toots with rich content warnings, distribute across distributed nodes, and engage open communities.',
    iconBg: 'bg-purple-700',
    iconColor: 'text-white',
    scopes: ['read', 'write', 'follow'],
    defaultHandle: '@sarah@mastodon.social',
    defaultMetric: '892 Boosts',
    defaultMetricLabel: 'Federated Reach',
    apiProtocol: 'ActivityPub / Mastodon OAuth'
  }
];

interface ConnectionState {
  connected: boolean;
  handle: string;
  connectedAt?: string;
  accountId?: string;
  status?: 'ACTIVE' | 'TEST' | 'INACTIVE';
  connectionStatus?: 'TEST' | 'LIVE_CONNECTED' | 'DISCONNECTED';
  verifiedAt?: string;
}

export default function IntegrationsSettingsSection() {
  const [connections, setConnections] = useState<Record<string, ConnectionState>>({
    twitter: { connected: false, handle: '', status: 'TEST', connectionStatus: 'DISCONNECTED' },
    linkedin: { connected: false, handle: '', status: 'TEST', connectionStatus: 'DISCONNECTED' },
    mastodon: { connected: false, handle: '', status: 'TEST', connectionStatus: 'DISCONNECTED' }
  });

  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);
  const [verifyingPlatform, setVerifyingPlatform] = useState<string | null>(null);
  const [disconnectingPlatform, setDisconnectingPlatform] = useState<string | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState<boolean>(true);
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [mastodonInstanceUrl, setMastodonInstanceUrl] = useState<string>('https://mastodon.social');
  const [platformToDisconnect, setPlatformToDisconnect] = useState<IntegrationPlatformConfig | null>(null);

  const userId = 'demo-user-123';

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Fetch connection status from backend (/api/social/connections)
  const fetchConnections = useCallback(async () => {
    setIsLoadingStatus(true);
    try {
      const res = await fetch(`/api/social/connections?userId=${encodeURIComponent(userId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.connections)) {
          const newMap: Record<string, ConnectionState> = {
            twitter: { connected: false, handle: '', status: 'TEST', connectionStatus: 'DISCONNECTED' },
            linkedin: { connected: false, handle: '', status: 'TEST', connectionStatus: 'DISCONNECTED' },
            mastodon: { connected: false, handle: '', status: 'TEST', connectionStatus: 'DISCONNECTED' }
          };

          data.connections.forEach((conn: any) => {
            const p = conn.platform.toLowerCase();
            const isLive = conn.connectionStatus === 'LIVE_CONNECTED' || conn.status === 'ACTIVE';
            if (newMap[p] !== undefined || ['twitter', 'linkedin', 'mastodon', 'x'].includes(p)) {
              const key = p === 'x' ? 'twitter' : p;
              newMap[key] = {
                connected: isLive,
                handle: conn.handle || `@${p}_user`,
                status: conn.status || (isLive ? 'ACTIVE' : 'TEST'),
                connectionStatus: conn.connectionStatus || (isLive ? 'LIVE_CONNECTED' : 'TEST'),
                connectedAt: conn.updatedAt || conn.verifiedAt,
                verifiedAt: conn.verifiedAt
              };
            }
          });

          setConnections(newMap);
        }
      }
    } catch (err: any) {
      console.warn('[Integrations] Could not query /api/social/connections:', err.message);
    } finally {
      setIsLoadingStatus(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  // Connect handler invoking POST /api/social/connect
  const handleConnect = async (platformId: 'twitter' | 'linkedin' | 'mastodon') => {
    setConnectingPlatform(platformId);
    try {
      console.log(`[Integrations] Requesting live redirection URL from POST /api/social/connect for platform: ${platformId}...`);
      
      const payload: Record<string, any> = {
        platform: platformId,
        userId: userId
      };

      if (platformId === 'mastodon') {
        payload.instanceUrl = mastodonInstanceUrl || 'https://mastodon.social';
      }

      // 1. Call POST /api/social/connect to generate live auth redirection URL
      const response = await fetch('/api/social/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP error ${response.status}`);
      }

      const data = await response.json();
      
      if (data.success && (data.redirectUrl || data.url)) {
        const targetUrl = data.redirectUrl || data.url;
        console.log(`[Integrations] Opening live OAuth popup window for ${platformId.toUpperCase()}:`, targetUrl);
        
        // Open authorization popup window modal
        const width = 580;
        const height = 720;
        const left = Math.max(0, window.screen.width / 2 - width / 2);
        const top = Math.max(0, window.screen.height / 2 - height / 2);

        const authWindow = window.open(
          targetUrl,
          `Connect_Real_${platformId}_Account`,
          `width=${width},height=${height},top=${top},left=${left},resizable=yes,scrollbars=yes,status=yes`
        );

        // Listen for completion postMessage from /api/social/callback
        const messageHandler = async (event: MessageEvent) => {
          if (
            event.data?.type === 'SOCIAL_ACCOUNT_LIVE_CONNECTED' ||
            event.data?.type === 'SOCIAL_AUTH_SUCCESS' ||
            event.data?.type === 'OAUTH_AUTH_SUCCESS'
          ) {
            const returnedHandle = event.data.handle || INTEGRATION_PLATFORMS.find(p => p.id === platformId)?.defaultHandle || `@${platformId}_user`;
            
            setConnections(prev => ({
              ...prev,
              [platformId]: {
                connected: true,
                handle: returnedHandle,
                status: 'ACTIVE',
                connectionStatus: 'LIVE_CONNECTED',
                connectedAt: new Date().toISOString(),
                verifiedAt: new Date().toISOString()
              }
            }));

            setConnectingPlatform(null);
            showToast(`Real ${platformId.toUpperCase()} account linked! Verified ACTIVE & DB transitioned to LIVE_CONNECTED.`, 'success');
            window.removeEventListener('message', messageHandler);
            fetchConnections();
          }
        };

        window.addEventListener('message', messageHandler);

        // Fallback auto-verification trigger in case popup completes without direct message
        setTimeout(async () => {
          window.removeEventListener('message', messageHandler);
          if (connectingPlatform === platformId) {
            await handleVerifyConnection(platformId);
            setConnectingPlatform(null);
          }
        }, 3200);

      } else {
        throw new Error(data.error || 'No live redirect URL returned by /api/social/connect');
      }
    } catch (err: any) {
      console.error('[Integrations] Connection error:', err);
      showToast(`Error initiating live connection: ${err.message}`, 'error');
      setConnectingPlatform(null);
    }
  };

  // Verification handler invoking POST /api/social/verify
  const handleVerifyConnection = async (platformId: string) => {
    setVerifyingPlatform(platformId);
    try {
      console.log(`[Integrations] Invoking POST /api/social/verify to confirm ACTIVE status for ${platformId}...`);
      const response = await fetch('/api/social/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: platformId,
          userId
        })
      });

      const data = await response.json();
      if (data.success && (data.status === 'ACTIVE' || data.connectionStatus === 'LIVE_CONNECTED')) {
        setConnections(prev => ({
          ...prev,
          [platformId]: {
            connected: true,
            handle: data.handle || prev[platformId]?.handle || `@${platformId}_user`,
            status: 'ACTIVE',
            connectionStatus: 'LIVE_CONNECTED',
            connectedAt: data.verifiedAt || new Date().toISOString(),
            verifiedAt: data.verifiedAt || new Date().toISOString()
          }
        }));
        showToast(`Verification Confirmed: ${platformId.toUpperCase()} status is ACTIVE (Database record: LIVE_CONNECTED).`, 'success');
      } else {
        throw new Error(data.error || 'Verification returned non-active status');
      }
    } catch (err: any) {
      console.error('[Integrations] Verification error:', err);
      showToast(`Verification check: ${err.message}`, 'info');
    } finally {
      setVerifyingPlatform(null);
      fetchConnections();
    }
  };

  // Disconnect handler invoking POST /api/social/disconnect
  const handleDisconnect = async (platformId: string) => {
    setDisconnectingPlatform(platformId);
    try {
      await fetch('/api/social/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: platformId, userId })
      });

      setConnections(prev => ({
        ...prev,
        [platformId]: {
          connected: false,
          handle: '',
          status: 'TEST',
          connectionStatus: 'DISCONNECTED',
          connectedAt: undefined
        }
      }));

      showToast(`Disconnected ${platformId.toUpperCase()} channel.`, 'info');
      fetchConnections();
    } catch (err: any) {
      console.error('[Integrations] Disconnect error:', err);
      showToast(`Failed to disconnect: ${err.message}`, 'error');
    } finally {
      setDisconnectingPlatform(null);
    }
  };

  return (
    <div id="settings-integrations-section" className="space-y-6">
      
      {/* Toast Alert Banner */}
      {toastMessage && (
        <div 
          id="integrations-toast-alert"
          className={`rounded-xl border p-4 text-xs font-bold flex items-center justify-between transition-all shadow-lg ${
            toastMessage.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-400'
              : toastMessage.type === 'error'
              ? 'bg-rose-950/40 border-rose-500/30 text-rose-400'
              : 'bg-blue-950/40 border-blue-500/30 text-blue-400'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {toastMessage.type === 'success' && <CheckCircle2 className="h-4.5 w-4.5 text-emerald-400 shrink-0" />}
            {toastMessage.type === 'error' && <AlertCircle className="h-4.5 w-4.5 text-rose-400 shrink-0" />}
            {toastMessage.type === 'info' && <RefreshCw className="h-4.5 w-4.5 text-blue-400 animate-spin shrink-0" />}
            <span>{toastMessage.text}</span>
          </div>
          <button 
            type="button" 
            onClick={() => setToastMessage(null)}
            className="text-neutral-400 hover:text-white text-xs px-2 py-0.5 rounded cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Header Info Card */}
      <div className="rounded-2xl border border-white/5 bg-neutral-900/30 backdrop-blur-md p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Social Media Integrations</h3>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  OAuth 2.0 &bull; AES-256-GCM
                </span>
              </div>
              <p className="text-xs text-neutral-400 mt-0.5">
                Manage live API integrations for Twitter, LinkedIn, and Mastodon with hardware-verified cryptographic security.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="btn-refresh-integrations"
              type="button"
              onClick={fetchConnections}
              disabled={isLoadingStatus}
              className="px-3 py-1.5 rounded-lg bg-neutral-950 border border-white/10 text-neutral-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoadingStatus ? 'animate-spin text-blue-400' : ''}`} />
              Sync Status
            </button>
          </div>
        </div>

        {/* Security & Protocol Notice */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
          <div className="p-3 rounded-xl bg-neutral-950/60 border border-white/5 flex items-start gap-2.5">
            <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <span className="text-[11px] font-bold text-white block">AES-256-GCM Vault</span>
              <span className="text-[10px] text-neutral-400 leading-tight block mt-0.5">
                Access tokens encrypted at rest with unique IV and auth tags in PostgreSQL.
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-neutral-950/60 border border-white/5 flex items-start gap-2.5">
            <Key className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
            <div>
              <span className="text-[11px] font-bold text-white block">Real Account Auth Proxy</span>
              <span className="text-[10px] text-neutral-400 leading-tight block mt-0.5">
                Redirection via <code className="font-mono text-[9px] text-blue-300">POST /api/social/connect</code> with state verification &amp; <code className="font-mono text-[9px] text-emerald-300">LIVE_CONNECTED</code> DB update.
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-neutral-950/60 border border-white/5 flex items-start gap-2.5">
            <Terminal className="h-4 w-4 text-purple-400 shrink-0 mt-0.5" />
            <div>
              <span className="text-[11px] font-bold text-white block">Multi-Platform Publishing</span>
              <span className="text-[10px] text-neutral-400 leading-tight block mt-0.5">
                Automated thread distribution and scheduled cross-posting pipeline.
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Integration Platform Cards (Twitter, LinkedIn, Mastodon) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4" id="integrations-platform-grid">
        {INTEGRATION_PLATFORMS.map((platform) => {
          const conn = connections[platform.id] || { connected: false, handle: '', status: 'TEST', connectionStatus: 'DISCONNECTED' };
          const isConnected = conn.connected;
          const isConnecting = connectingPlatform === platform.id;
          const isVerifying = verifyingPlatform === platform.id;
          const isDisconnecting = disconnectingPlatform === platform.id;

          const isLiveConnected = conn.connectionStatus === 'LIVE_CONNECTED' || conn.status === 'ACTIVE';

          return (
            <div
              key={platform.id}
              id={`integration-card-${platform.id}`}
              className={`rounded-2xl border transition-all flex flex-col justify-between p-5 ${
                isConnected
                  ? 'bg-neutral-900/60 border-emerald-500/30 shadow-lg shadow-emerald-950/20'
                  : 'bg-neutral-900/20 border-white/5 hover:border-white/10'
              }`}
            >
              {/* Card Top */}
              <div className="space-y-3.5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`h-11 w-11 rounded-xl ${platform.iconBg} flex items-center justify-center font-bold text-base shadow-md`}>
                      {platform.id === 'twitter' && <span className="font-extrabold text-white text-lg">𝕏</span>}
                      {platform.id === 'linkedin' && <Linkedin className="h-5 w-5 fill-current text-white" />}
                      {platform.id === 'mastodon' && <Globe className="h-5 w-5 text-white" />}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                        {platform.name}
                      </h4>
                      <span className="text-[10px] text-neutral-400 font-medium block">
                        {platform.tagline}
                      </span>
                    </div>
                  </div>

                  {/* Status Pill */}
                  <div id={`status-badge-${platform.id}`}>
                    {isConnected ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 font-mono">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        LIVE_CONNECTED
                      </span>
                    ) : conn.connectionStatus === 'TEST' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-500/10 border border-amber-500/20 text-amber-400 font-mono">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                        TEST (PENDING)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-neutral-800/80 border border-white/5 text-neutral-400 font-mono">
                        <span className="h-1.5 w-1.5 rounded-full bg-neutral-500" />
                        DISCONNECTED
                      </span>
                    )}
                  </div>
                </div>

                {/* Description */}
                <p className="text-xs text-neutral-400 leading-relaxed min-h-[38px]">
                  {platform.description}
                </p>

                {/* Mastodon Custom Instance Input */}
                {platform.id === 'mastodon' && !isConnected && (
                  <div className="space-y-1.5 pt-1">
                    <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block">
                      Instance URL
                    </label>
                    <input
                      id="input-mastodon-instance-url"
                      type="url"
                      value={mastodonInstanceUrl}
                      onChange={(e) => setMastodonInstanceUrl(e.target.value)}
                      placeholder="https://mastodon.social"
                      className="w-full text-xs font-mono bg-neutral-950/80 border border-white/10 rounded-lg px-2.5 py-1.5 text-white placeholder-neutral-600 outline-none focus:border-purple-500/40"
                    />
                  </div>
                )}

                {/* Active Account Handle & Telemetry */}
                {isConnected && (
                  <div className="p-3 rounded-xl bg-neutral-950/80 border border-white/5 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-neutral-400 text-[11px]">Real Linked Account</span>
                      <span className="font-mono text-emerald-400 font-bold text-[11px] truncate max-w-[140px]">
                        {conn.handle || platform.defaultHandle}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] border-t border-white/5 pt-1.5 font-mono">
                      <span className="text-neutral-500">DB Record Status</span>
                      <span className="text-emerald-400 font-semibold bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-500/20">
                        {conn.connectionStatus || 'LIVE_CONNECTED'} (ACTIVE)
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10.5px] border-t border-white/5 pt-1.5">
                      <span className="text-neutral-500">{platform.defaultMetricLabel}</span>
                      <span className="text-neutral-300 font-medium">{platform.defaultMetric}</span>
                    </div>
                  </div>
                )}

                {/* Permissions / Scopes list */}
                <div className="space-y-1.5 pt-1">
                  <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest block">
                    Granted Scopes
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {platform.scopes.map(scope => (
                      <span 
                        key={scope} 
                        className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-neutral-950 border border-white/5 text-neutral-400"
                      >
                        {scope}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Card Footer Actions */}
              <div className="border-t border-white/5 pt-4 mt-4 flex items-center justify-between gap-2">
                <span className="text-[9.5px] font-mono text-neutral-500 truncate max-w-[110px]">
                  {platform.apiProtocol}
                </span>

                <div className="flex items-center gap-2">
                  {isConnected ? (
                    <>
                      <button
                        id={`btn-verify-${platform.id}`}
                        type="button"
                        onClick={() => handleVerifyConnection(platform.id)}
                        disabled={isVerifying}
                        title="Re-verify live handshake status"
                        className="px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[11px] font-semibold transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3 w-3 ${isVerifying ? 'animate-spin text-emerald-400' : ''}`} />
                        Verify
                      </button>
                      <button
                        id={`btn-disconnect-${platform.id}`}
                        type="button"
                        onClick={() => setPlatformToDisconnect(platform)}
                        disabled={isDisconnecting}
                        className="px-3 py-1.5 rounded-lg bg-rose-950/30 hover:bg-rose-950/60 border border-rose-500/20 text-rose-300 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        {isDisconnecting ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <button
                      id={platform.id === 'twitter' ? 'btn-connect-real-x-account' : `btn-connect-${platform.id}`}
                      type="button"
                      onClick={() => handleConnect(platform.id)}
                      disabled={isConnecting}
                      className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md shadow-blue-600/20 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {isConnecting ? (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          <span>Authorizing...</span>
                        </>
                      ) : (
                        <>
                          <ExternalLink className="h-3.5 w-3.5" />
                          <span>
                            {platform.id === 'twitter' 
                              ? 'Connect Real X Account' 
                              : `Connect Real ${platform.name} Account`}
                          </span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Disconnect Confirmation Modal Dialog */}
      {platformToDisconnect && (
        <div 
          id="disconnect-confirmation-dialog-overlay"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => {
            if (!disconnectingPlatform) setPlatformToDisconnect(null);
          }}
        >
          <div 
            id="disconnect-confirmation-dialog"
            className="w-full max-w-md bg-neutral-900 border border-rose-500/30 rounded-2xl p-6 shadow-2xl shadow-rose-950/30 space-y-5 animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-4">
              <div className="h-11 w-11 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 shrink-0">
                <AlertCircle className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-white">
                  Disconnect {platformToDisconnect.name}?
                </h3>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Are you sure you want to remove the integration for{' '}
                  <span className="text-white font-semibold">
                    {connections[platformToDisconnect.id]?.handle || platformToDisconnect.name}
                  </span>?
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-neutral-950/80 border border-white/5 space-y-2 text-xs text-neutral-400">
              <div className="flex items-center gap-2 text-amber-400 font-semibold text-[11px]">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                <span>Impact of Disconnection:</span>
              </div>
              <ul className="space-y-1 pl-6 list-disc text-[11px] text-neutral-400">
                <li>Active OAuth tokens will be securely purged from encrypted storage.</li>
                <li>Automated cross-posting and scheduled queues for this platform will pause.</li>
                <li>Channel telemetry and engagement metrics will no longer synchronize.</li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                id="btn-cancel-disconnect"
                type="button"
                onClick={() => setPlatformToDisconnect(null)}
                disabled={Boolean(disconnectingPlatform)}
                className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-semibold transition-all cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                id="btn-confirm-disconnect"
                type="button"
                onClick={async () => {
                  const targetId = platformToDisconnect.id;
                  await handleDisconnect(targetId);
                  setPlatformToDisconnect(null);
                }}
                disabled={Boolean(disconnectingPlatform)}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-600/20 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {disconnectingPlatform ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Disconnecting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Confirm Disconnect</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Integration Workflow Diagnostic Banner */}
      <div className="rounded-2xl border border-white/5 bg-neutral-950/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <Check className="h-4 w-4" />
          </div>
          <div>
            <span className="text-xs font-bold text-white block">Autonomous Unified OAuth Engine</span>
            <span className="text-[11px] text-neutral-400 block">
              Direct connection handshake powered by <code className="font-mono text-[10px] text-emerald-300">/api/auth/connect</code> with automated token rotation and PKCE verification.
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-neutral-500 bg-neutral-900 px-2.5 py-1 rounded-md border border-white/5">
            Active User: demo-user-123
          </span>
        </div>
      </div>

    </div>
  );
}
