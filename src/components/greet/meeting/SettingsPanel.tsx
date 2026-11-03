/** Meeting settings: audio, video and general preferences. Changes apply immediately. */
import React, { useEffect, useRef, useState } from 'react';
import { Mic, Settings, Video, Volume2 } from 'lucide-react';
import { useMeetingSession } from '../../../context/MeetingSessionContext';
import { VIDEO_FILTERS, applyVideoQuality, type VideoFilterId } from '../../../lib/meetingMedia';
import { MeetingDialog } from './MeetingDialog';
import { useMeetingUi, type SettingsTab } from './useMeetingUi';

function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: 'var(--m-raised)' }}>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium">{label}</span>
        {hint && <span className="m-muted block text-[12px]">{hint}</span>}
      </span>
      <input id={id} type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="m-switch" data-on={checked} aria-hidden />
    </label>
  );
}

const QUALITY_HINT: Record<string, string> = { '1080p': 'Full HD · most bandwidth', '720p': 'HD · balanced', '480p': 'Standard', '360p': 'Data saver' };

export function SettingsPanel() {
  const ui = useMeetingUi();
  const {
    meetingSettings, updateMeetingSettings, availableDevices, refreshDevices, testSpeakerSound,
    localStream, isCamOff, isMicMuted, micAudioLevel, isTranscribing, setTranscribing,
  } = useMeetingSession();
  const open = ui.dialog === 'settings';
  const tab: SettingsTab = ui.settingsTab === 'devices' ? 'audio' : ui.settingsTab;
  const [testing, setTesting] = useState(false);
  const previewRef = useRef<HTMLVideoElement>(null);

  useEffect(() => { if (open) refreshDevices(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const v = previewRef.current;
    if (open && tab === 'video' && v && localStream && !isCamOff) { v.srcObject = localStream; v.play().catch(() => {}); }
  }, [open, tab, localStream, isCamOff]);

  const setTab = (t: SettingsTab) => ui.openDialog('settings', { settingsTab: t });
  const level = isMicMuted ? 0 : Math.min(100, micAudioLevel * 1.2);

  return (
    <MeetingDialog open={open} onClose={ui.closeDialog} title="Settings" description="Changes apply right away." icon={<Settings size={19} />} width={560}
      footer={<button type="button" className="m-btn m-btn-primary" onClick={ui.closeDialog}>Done</button>}>
      <div className="m-seg mb-4 w-full" role="tablist" aria-label="Settings sections">
        {(['audio', 'video', 'preferences'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className="flex-1" onClick={() => setTab(t)}>
            {t === 'audio' ? 'Audio' : t === 'video' ? 'Video' : 'General'}
          </button>
        ))}
      </div>

      {tab === 'audio' && (
        <div className="space-y-4" role="tabpanel">
          <div>
            <label className="m-label" htmlFor="set-mic"><Mic size={13} className="mr-1 inline -translate-y-px" aria-hidden />Microphone</label>
            <select id="set-mic" className="m-input" value={meetingSettings.selectedMicrophoneId} onChange={(e) => updateMeetingSettings({ selectedMicrophoneId: e.target.value })}>
              {availableDevices.audioInputs.length ? availableDevices.audioInputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${d.deviceId.slice(0, 6)}`}</option>)
                : <option value="default">System default</option>}
            </select>
            <div className="mt-2 flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--m-raised)' }} role="meter" aria-label="Microphone level" aria-valuenow={Math.round(level)} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full transition-[width] duration-150" style={{ width: `${level}%`, background: 'var(--m-speaking)' }} />
              </div>
              <span className="m-muted m-num w-20 text-right text-[12px]">{isMicMuted ? 'Muted' : 'Speak to test'}</span>
            </div>
          </div>
          <div>
            <label className="m-label" htmlFor="set-speaker"><Volume2 size={13} className="mr-1 inline -translate-y-px" aria-hidden />Speaker</label>
            <div className="flex gap-2">
              <select id="set-speaker" className="m-input" value={meetingSettings.selectedSpeakerId} onChange={(e) => updateMeetingSettings({ selectedSpeakerId: e.target.value })}>
                {availableDevices.audioOutputs.length ? availableDevices.audioOutputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Speaker ${d.deviceId.slice(0, 6)}`}</option>)
                  : <option value="default">System default</option>}
              </select>
              <button type="button" className="m-btn flex-none" onClick={() => { testSpeakerSound(); setTesting(true); setTimeout(() => setTesting(false), 900); }}>
                {testing ? 'Playing…' : 'Test'}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Toggle id="set-noise" label="Noise cancellation" hint="Filters keyboard, fan and room noise" checked={meetingSettings.noiseSuppression} onChange={(v) => updateMeetingSettings({ noiseSuppression: v })} />
            <Toggle id="set-echo" label="Echo cancellation" hint="Stops feedback when you use speakers" checked={meetingSettings.echoCancellation} onChange={(v) => updateMeetingSettings({ echoCancellation: v })} />
          </div>
        </div>
      )}

      {tab === 'video' && (
        <div className="space-y-4" role="tabpanel">
          <div>
            <label className="m-label" htmlFor="set-cam"><Video size={13} className="mr-1 inline -translate-y-px" aria-hidden />Camera</label>
            <select id="set-cam" className="m-input" value={meetingSettings.selectedCameraId} onChange={(e) => updateMeetingSettings({ selectedCameraId: e.target.value })}>
              {availableDevices.videoInputs.length ? availableDevices.videoInputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0, 6)}`}</option>)
                : <option value="default">System default</option>}
            </select>
            <div className="mt-2 overflow-hidden rounded-xl" style={{ aspectRatio: '16 / 9', background: 'var(--m-tile)' }}>
              {isCamOff || !localStream ? (
                <div className="m-muted flex h-full items-center justify-center text-[13px]">Your camera is off</div>
              ) : (
                <video ref={previewRef} autoPlay playsInline muted className="h-full w-full object-cover"
                  style={{ transform: 'scaleX(-1)', filter: VIDEO_FILTERS[ui.videoFilter]?.css }} aria-label="Camera preview" />
              )}
            </div>
          </div>
          <div>
            <span className="m-label">Video quality</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Video quality">
              {(['1080p', '720p', '480p', '360p'] as const).map((q) => (
                <button key={q} type="button" role="radio" aria-checked={meetingSettings.videoQuality === q && !ui.lowBandwidth}
                  disabled={ui.lowBandwidth}
                  className="rounded-xl px-3 py-2 text-left" onClick={() => updateMeetingSettings({ videoQuality: q })}
                  style={{ background: meetingSettings.videoQuality === q && !ui.lowBandwidth ? 'var(--m-accent-tint)' : 'var(--m-raised)', border: `1px solid ${meetingSettings.videoQuality === q && !ui.lowBandwidth ? 'var(--m-accent)' : 'transparent'}`, color: 'var(--m-text)', font: 'inherit', cursor: 'pointer', opacity: ui.lowBandwidth ? 0.5 : 1 }}>
                  <span className="block text-[13.5px] font-semibold">{q}</span>
                  <span className="m-muted block text-[11.5px]">{QUALITY_HINT[q]}</span>
                </button>
              ))}
            </div>
          </div>
          <Toggle id="set-lowbw" label="Low-bandwidth mode" hint="Sends 180p video at 12 fps and hides incoming video" checked={ui.lowBandwidth}
            onChange={(v) => { ui.setPref('lowBandwidth', v); applyVideoQuality(localStream, meetingSettings.videoQuality, v); }} />
          <div>
            <span className="m-label">Appearance</span>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(VIDEO_FILTERS) as VideoFilterId[]).map((f) => (
                <button key={f} type="button" className="m-btn m-btn-sm" aria-pressed={ui.videoFilter === f} onClick={() => ui.setPref('videoFilter', f)}
                  style={ui.videoFilter === f ? { background: 'var(--m-accent-tint)', borderColor: 'var(--m-accent)', color: 'var(--m-accent)' } : undefined}>
                  {VIDEO_FILTERS[f].label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'preferences' && (
        <div className="space-y-4" role="tabpanel">
          <div>
            <span className="m-label">Theme</span>
            <div className="m-seg" role="radiogroup" aria-label="Theme">
              <button type="button" role="radio" aria-checked={ui.theme === 'dark'} onClick={() => ui.setPref('theme', 'dark')}>Dark</button>
              <button type="button" role="radio" aria-checked={ui.theme === 'light'} onClick={() => ui.setPref('theme', 'light')}>Light</button>
            </div>
          </div>
          <div>
            <span className="m-label">Layout</span>
            <div className="m-seg" role="radiogroup" aria-label="Layout">
              <button type="button" role="radio" aria-checked={ui.layout === 'gallery'} onClick={() => ui.setPref('layout', 'gallery')}>Gallery</button>
              <button type="button" role="radio" aria-checked={ui.layout === 'speaker'} onClick={() => ui.setPref('layout', 'speaker')}>Speaker</button>
            </div>
          </div>
          <div className="space-y-2">
            <Toggle id="set-self" label="Show my video" hint="Hide your own tile when others are in the meeting" checked={ui.showSelfView} onChange={(v) => ui.setPref('showSelfView', v)} />
            <Toggle id="set-transcribe" label="Live transcription" hint="Turns speech into text while your mic is on" checked={isTranscribing} onChange={setTranscribing} />
            <Toggle id="set-autotranscribe" label="Transcribe new meetings automatically" checked={meetingSettings.autoTranscribe} onChange={(v) => updateMeetingSettings({ autoTranscribe: v })} />
            <Toggle id="set-chime" label="Join and leave sounds" hint="Play a sound and show a notice when people arrive" checked={meetingSettings.notifyOnParticipantJoin} onChange={(v) => updateMeetingSettings({ notifyOnParticipantJoin: v })} />
          </div>
        </div>
      )}
    </MeetingDialog>
  );
}
