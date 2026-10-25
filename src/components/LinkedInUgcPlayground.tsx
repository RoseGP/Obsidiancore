import React, { useState, useEffect } from 'react';
import { 
  Linkedin, Sparkles, Copy, Check, Eye, AlertTriangle, Play, Plus, 
  Trash2, RefreshCw, CheckCircle2, Info, ArrowLeft, ShieldAlert 
} from 'lucide-react';
import { formatLinkedInUgcPayload, publishLinkedInUgcPost, LinkedInPublishingError } from '../utils/linkedinUgcFormatter';
import { copyToClipboard as safeCopyToClipboard } from '../utils/clipboard';

interface LinkedInUgcPlaygroundProps {
  onClose?: () => void;
}

export default function LinkedInUgcPlayground({ onClose }: LinkedInUgcPlaygroundProps) {
  // 1. Interactive Form States
  const [authorType, setAuthorType] = useState<'person' | 'organization'>('person');
  const [memberId, setMemberId] = useState('8X9k7p1qLw');
  const [organizationId, setOrganizationId] = useState('7420193');
  const [textBody, setTextBody] = useState(
    '🚀 Exciting News! We are launching our multi-tenant Social Planner dashboard today. Format scheduled posts to LinkedIn UGC Post API JSON standards in real-time!\n\n#socialmedia #productlaunch #crm'
  );
  
  // Dynamic list of image URLs
  const [imageUrls, setImageUrls] = useState<string[]>([
    'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=800&q=80'
  ]);
  const [newImageUrl, setNewImageUrl] = useState('');

  // 2. Token / Simulated Sandbox settings
  const [accessToken, setAccessToken] = useState('linkedin_oauth_live_token_simulated_xyz_987');
  const [isSimulated, setIsSimulated] = useState(true);
  const [force403Error, setForce403Error] = useState(false);

  // 3. Execution / Output States
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<any | null>(null);
  const [executionError, setExecutionError] = useState<LinkedInPublishingError | null>(null);
  const [copied, setCopied] = useState(false);
  const [successToast, setSuccessToast] = useState(false);

  // Derive authorUrn
  const authorUrn = authorType === 'person' 
    ? `urn:li:person:${memberId}` 
    : `urn:li:organization:${organizationId}`;

  // Formatted JSON payload calculated on the fly
  let formattedPayloadJson = '';
  let formattingError = '';
  try {
    const payload = formatLinkedInUgcPayload(authorUrn, textBody, imageUrls.filter(url => !!url.trim()));
    formattedPayloadJson = JSON.stringify(payload, null, 2);
  } catch (err: any) {
    formattingError = err.message;
  }

  // Handle image modifications
  const addImageUrl = () => {
    if (newImageUrl.trim()) {
      setImageUrls(prev => [...prev, newImageUrl.trim()]);
      setNewImageUrl('');
    }
  };

  const removeImageUrl = (index: number) => {
    setImageUrls(prev => prev.filter((_, idx) => idx !== index));
  };

  // Copy payload to clipboard
  const copyToClipboard = async () => {
    await safeCopyToClipboard(formattedPayloadJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Publish / Execute flow
  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsExecuting(true);
    setExecutionResult(null);
    setExecutionError(null);

    // Short simulated delay to make it feel extremely interactive and realistic
    await new Promise(resolve => setTimeout(resolve, 800));

    try {
      if (isSimulated) {
        // Mock execution path
        if (force403Error) {
          throw new LinkedInPublishingError(
            `[LinkedIn 403 Forbidden] Insufficient member permissions. The authenticated user does not have authorization to publish on behalf of URN: "${authorUrn}". Ensure your LinkedIn token includes 'w_member_social' (for profiles) or 'w_organization_social' (for brand pages).`,
            403,
            'PERMISSION_DENIED',
            {
              serviceErrorCode: 100,
              message: 'Not enough permissions to access /ugcPosts',
              status: 403
            }
          );
        }

        // Validate text and URN format via utility
        formatLinkedInUgcPayload(authorUrn, textBody, imageUrls);

        // Successful response structure
        const mockSuccessResponse = {
          id: `urn:li:share:sim-ugc-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
          status: 'SUCCESS',
          lifecycleState: 'PUBLISHED',
          author: authorUrn,
          specificContent: JSON.parse(formattedPayloadJson).specificContent,
          visibility: JSON.parse(formattedPayloadJson).visibility,
          timestamp: Date.now(),
          debugLogs: [
            'Request received by LinkedIn RESTli API router',
            `Validated OAuth permission scope w_member_social for ${authorUrn}`,
            'S3 binary media container status checks: READY',
            'Broadcasting post live on LinkedIn member feed'
          ]
        };

        setExecutionResult(mockSuccessResponse);
        setSuccessToast(true);
        setTimeout(() => setSuccessToast(false), 3000);
      } else {
        // Real API invocation
        const result = await publishLinkedInUgcPost(accessToken, authorUrn, textBody, imageUrls);
        setExecutionResult(result);
        setSuccessToast(true);
        setTimeout(() => setSuccessToast(false), 3000);
      }
    } catch (err: any) {
      console.error('[LinkedIn UGC Playground Error]', err);
      setExecutionError(err);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="bg-slate-50/25 rounded-3xl border border-slate-200/60 p-6 md:p-8 space-y-8 shadow-3xs max-w-5xl mx-auto w-full">
      {/* Header section with back action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div className="flex items-center gap-3">
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-xl transition-all cursor-pointer text-slate-500 hover:text-slate-900 border border-slate-200/50 bg-white"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest font-mono flex items-center gap-1.5">
              <Linkedin className="h-3 w-3 fill-current" />
              <span>LINKEDIN INTEGRATION SUITE</span>
            </span>
            <h1 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              <span>UGC Post API Formatter & Publisher</span>
              <span className="bg-emerald-50 text-emerald-800 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider border border-emerald-200/50">
                Active
              </span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setTextBody('🚀 Standardized UGC share payload formatting checks live!');
              setImageUrls(['https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=800&q=80']);
              setExecutionResult(null);
              setExecutionError(null);
            }}
            className="px-3.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-all cursor-pointer shadow-3xs"
          >
            Reset Form
          </button>
          <button 
            onClick={onClose}
            className="px-3.5 py-1.5 bg-[#063C2C] text-white rounded-xl text-xs font-bold hover:bg-[#052E22] transition-all cursor-pointer shadow-2xs"
          >
            Return to Planner
          </button>
        </div>
      </div>

      {/* Main split grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left Column: Form Settings (7 Cols) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 md:p-6 shadow-3xs space-y-5">
            <h2 className="text-xs font-black uppercase text-slate-400 tracking-wider flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-blue-500" />
              <span>Payload parameter builder</span>
            </h2>

            <form onSubmit={handlePublish} className="space-y-5">
              {/* Author URN Segment */}
              <div className="space-y-2.5">
                <label className="text-[10.5px] font-black uppercase text-slate-500 tracking-wider block">
                  Author URN Type
                </label>
                
                {/* Type Choice Toggle */}
                <div className="grid grid-cols-2 gap-3 p-1 bg-slate-100 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setAuthorType('person')}
                    className={`py-2 text-center text-xs font-extrabold rounded-lg transition-all cursor-pointer ${authorType === 'person' ? 'bg-white text-blue-600 shadow-3xs' : 'text-slate-500 hover:text-slate-900'}`}
                  >
                    Personal Profile (urn:li:person)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthorType('organization')}
                    className={`py-2 text-center text-xs font-extrabold rounded-lg transition-all cursor-pointer ${authorType === 'organization' ? 'bg-white text-blue-600 shadow-3xs' : 'text-slate-500 hover:text-slate-900'}`}
                  >
                    Organization Page (urn:li:organization)
                  </button>
                </div>

                {/* ID Inputs */}
                {authorType === 'person' ? (
                  <div className="space-y-1.5">
                    <label htmlFor="member-id-input" className="text-[10px] font-bold text-slate-400">
                      Member Profile ID / Handle
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-slate-400 text-xs font-mono select-none">
                        urn:li:person:
                      </span>
                      <input
                        id="member-id-input"
                        type="text"
                        value={memberId}
                        onChange={(e) => setMemberId(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 pl-26 pr-4 py-2 text-xs font-mono font-bold text-slate-800 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all bg-slate-50/20"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <label htmlFor="organization-id-input" className="text-[10px] font-bold text-slate-400">
                      Organization Brand ID
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-slate-400 text-xs font-mono select-none">
                        urn:li:organization:
                      </span>
                      <input
                        id="organization-id-input"
                        type="text"
                        value={organizationId}
                        onChange={(e) => setOrganizationId(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 pl-38 pr-4 py-2 text-xs font-mono font-bold text-slate-800 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all bg-slate-50/20"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Share commentary text body */}
              <div className="space-y-1.5">
                <label htmlFor="post-commentary-text" className="text-[10.5px] font-black uppercase text-slate-500 tracking-wider flex items-center justify-between">
                  <span>Share Commentary</span>
                  <span className="text-[9px] font-mono text-slate-400">{textBody.length} characters</span>
                </label>
                <textarea
                  id="post-commentary-text"
                  rows={4}
                  value={textBody}
                  onChange={(e) => setTextBody(e.target.value)}
                  placeholder="Share commentary details..."
                  className="w-full rounded-xl border border-slate-200 p-3.5 text-xs font-semibold leading-relaxed focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50/10"
                />
              </div>

              {/* Dynamic Image attachments array */}
              <div className="space-y-2.5">
                <label className="text-[10.5px] font-black uppercase text-slate-500 tracking-wider block">
                  Image URL Attachments (Optional)
                </label>

                {/* Attached URL list */}
                {imageUrls.length > 0 && (
                  <div className="space-y-2">
                    {imageUrls.map((url, index) => (
                      <div key={index} className="flex items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200/60">
                        <div className="h-8 w-8 rounded-lg overflow-hidden shrink-0 border border-slate-200">
                          <img src={url} alt="Attachment" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />
                        </div>
                        <span className="flex-1 text-[11px] font-semibold text-slate-600 truncate font-mono">
                          {url}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeImageUrl(index)}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add new url line */}
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={newImageUrl}
                    onChange={(e) => setNewImageUrl(e.target.value)}
                    placeholder="https://example.com/image.jpg"
                    className="flex-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-mono placeholder:text-slate-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50/10"
                  />
                  <button
                    type="button"
                    onClick={addImageUrl}
                    className="px-3.5 bg-blue-50 hover:bg-blue-100 text-blue-600 text-xs font-black rounded-xl border border-blue-200/55 transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Attach</span>
                  </button>
                </div>
              </div>

              {/* Sandbox Execution Controls */}
              <div className="border-t border-slate-100 pt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] font-black uppercase text-slate-500 tracking-wider">
                    Execution Mode Settings
                  </span>
                  <div className="flex items-center gap-1.5">
                    <input
                      id="simulated-checkbox"
                      type="checkbox"
                      checked={isSimulated}
                      onChange={(e) => setIsSimulated(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-3.5 w-3.5"
                    />
                    <label htmlFor="simulated-checkbox" className="text-xs font-bold text-slate-600 cursor-pointer select-none">
                      Enable Simulated Sandbox
                    </label>
                  </div>
                </div>

                {!isSimulated ? (
                  <div className="space-y-1.5 bg-slate-50 p-3 rounded-xl border border-slate-200/50">
                    <label htmlFor="access-token-input" className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                      Real LinkedIn OAuth Token
                    </label>
                    <input
                      id="access-token-input"
                      type="password"
                      value={accessToken}
                      onChange={(e) => setAccessToken(e.target.value)}
                      placeholder="Enter active w_member_social token..."
                      className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-mono text-slate-700 bg-white"
                    />
                  </div>
                ) : (
                  <div className="bg-amber-50/50 border border-amber-200/80 rounded-xl p-3.5 space-y-3">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="h-4.5 w-4.5 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <span className="text-xs font-black text-amber-950 block">Simulate Error Pathways</span>
                        <p className="text-[11px] text-amber-900 font-semibold mt-0.5">
                          Toggling the trigger below allows you to explicitly force a **403 Forbidden Error** to test user permission validation layers!
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        id="force-403-checkbox"
                        type="checkbox"
                        checked={force403Error}
                        onChange={(e) => setForce403Error(e.target.checked)}
                        className="rounded border-amber-300 text-amber-600 focus:ring-amber-500 h-4 w-4"
                      />
                      <label htmlFor="force-403-checkbox" className="text-xs font-extrabold text-amber-950 cursor-pointer select-none">
                        Force HTTP 403 Permission Denied Error
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Submit */}
              <button
                type="submit"
                disabled={isExecuting || !!formattingError}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black text-xs py-3.5 px-4 rounded-xl shadow-xs hover:shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isExecuting ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin text-white" />
                    <span>Processing LinkedIn RESTli handshakes...</span>
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-current text-white" />
                    <span>Publish UGC Share Payload</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Right Column: Live Formatter / Execution Logger (5 Cols) */}
        <div className="lg:col-span-5 space-y-6">
          
          {/* Format Payload Box */}
          <div className="bg-slate-900 rounded-2xl border border-slate-950 p-5 shadow-inner space-y-4 text-white">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider font-mono">
                  ugcSharePayload.json
                </span>
              </div>

              <button
                onClick={copyToClipboard}
                disabled={!!formattingError}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-black rounded-lg transition-colors cursor-pointer disabled:opacity-30"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy JSON</span>
                  </>
                )}
              </button>
            </div>

            {formattingError ? (
              <div className="bg-rose-950/40 border border-rose-900/60 p-3.5 rounded-xl flex items-start gap-2.5 text-rose-300 text-xs">
                <AlertTriangle className="h-4.5 w-4.5 shrink-0 text-rose-500 mt-0.5" />
                <div>
                  <span className="font-extrabold block">Formatting Error</span>
                  <p className="font-semibold text-rose-200 mt-0.5 leading-relaxed">
                    {formattingError}
                  </p>
                </div>
              </div>
            ) : (
              <div className="max-h-[300px] overflow-y-auto pr-1">
                <pre className="text-[11px] font-mono leading-relaxed text-blue-200 whitespace-pre-wrap select-all">
                  {formattedPayloadJson}
                </pre>
              </div>
            )}
            
            <div className="text-[9px] font-mono text-slate-500 border-t border-slate-800/80 pt-2 flex items-center justify-between">
              <span>FORMAT: com.linkedin.ugc.ShareContent</span>
              <span>STATE: {formattingError ? 'ERROR' : 'VALID'}</span>
            </div>
          </div>

          {/* Execution Outputs Console */}
          {(executionResult || executionError || isExecuting) && (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-3xs space-y-4">
              <h3 className="text-xs font-black uppercase text-slate-400 tracking-wider">
                API Handshake Console
              </h3>

              {isExecuting && (
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex items-center gap-3 text-xs text-slate-500">
                  <RefreshCw className="h-4.5 w-4.5 animate-spin text-blue-500" />
                  <span className="font-semibold">Transmitting RESTli payload to ugcPosts endpoint...</span>
                </div>
              )}

              {/* 403 Forbidden handling block */}
              {executionError && (
                <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4.5 space-y-3.5">
                  <div className="flex items-start gap-3">
                    <div className="h-8 w-8 rounded-xl bg-rose-100 flex items-center justify-center text-rose-600 shrink-0">
                      <ShieldAlert className="h-4.5 w-4.5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-rose-950 uppercase tracking-tight">
                        403 Forbidden Permission Blocked
                      </h4>
                      <p className="text-[11px] text-rose-900 font-semibold mt-0.5 leading-relaxed">
                        {executionError.message}
                      </p>
                    </div>
                  </div>

                  <div className="bg-white/80 rounded-xl p-3 border border-rose-100 text-[10.5px] text-rose-950 space-y-2">
                    <span className="font-extrabold block uppercase text-rose-900 tracking-wider text-[9.5px]">
                      🛡️ Required OAUTH Credentials Scope Fix:
                    </span>
                    <ul className="list-disc pl-4 space-y-1 leading-relaxed font-semibold">
                      <li>
                        For **Personal Profiles** (`urn:li:person:...`), verify your authorization request requested the **w_member_social** permission scope.
                      </li>
                      <li>
                        For **Organization Brand Pages** (`urn:li:organization:...`), verify the authenticating member is a designated Admin of the page and possesses the **w_organization_social** permission scope.
                      </li>
                    </ul>
                  </div>

                  <div className="bg-rose-900 text-white rounded-xl p-2.5 font-mono text-[9px] break-all leading-tight">
                    {JSON.stringify(executionError.details || { error: 'Access Denied', status: 403 }, null, 2)}
                  </div>
                </div>
              )}

              {/* Success handling block */}
              {executionResult && (
                <div className="bg-emerald-50/65 border border-emerald-200 rounded-2xl p-4.5 space-y-3.5">
                  <div className="flex items-start gap-3">
                    <div className="h-8 w-8 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
                      <CheckCircle2 className="h-4.5 w-4.5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-emerald-950 uppercase tracking-tight">
                        Broadcast Completed Successfully!
                      </h4>
                      <span className="text-[9.5px] font-mono text-emerald-800 font-bold block mt-0.5">
                        REF ID: {executionResult.id}
                      </span>
                    </div>
                  </div>

                  {executionResult.debugLogs && (
                    <div className="space-y-1.5 bg-white/70 border border-emerald-100 p-3 rounded-xl">
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">
                        Server Execution Logs:
                      </span>
                      {executionResult.debugLogs.map((log: string, idx: number) => (
                        <div key={idx} className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-700 leading-tight">
                          <span className="text-emerald-600 font-mono">▸</span>
                          <span>{log}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="bg-slate-900 text-slate-300 rounded-xl p-2.5 font-mono text-[9px] break-all leading-tight">
                    {JSON.stringify({ id: executionResult.id, status: executionResult.status, lifecycleState: executionResult.lifecycleState }, null, 2)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Overview guides card */}
      <div className="bg-white rounded-2xl border border-slate-200/85 p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 bg-blue-50 rounded-xl text-blue-600 flex items-center justify-center shrink-0">
            <Info className="h-4.5 w-4.5" />
          </div>
          <div>
            <span className="text-xs font-black text-slate-900 block">LinkedIn UGC Post JSON Specifications</span>
            <p className="text-[11.5px] text-slate-500 font-semibold mt-0.5 leading-relaxed">
              This interactive playground dynamically utilizes formatting structures matching standard RESTli specifications for the LinkedIn V2 API. Attachments automatically transition shareMediaCategory fields.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
