/** Live captions from the transcript: the last thing said in the past few seconds. */
import React, { useEffect, useState } from 'react';
import type { TranscriptItem } from '../../../context/MeetingSessionContext';

export function CaptionsOverlay({ transcript, transcribing, micMuted }: { transcript: TranscriptItem[]; transcribing: boolean; micMuted: boolean }) {
  const [now, setNow] = useState(Date.now());
  const last = transcript[transcript.length - 1];
  const [shownAt, setShownAt] = useState(0);
  useEffect(() => { if (last) setShownAt(Date.now()); }, [last?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const fresh = last && now - shownAt < 7000;
  const text = !transcribing ? 'Captions need live transcription. Turn it on in Settings → General.'
    : fresh ? null : micMuted ? 'Captions are on. Unmute to caption what you say.' : 'Listening…';
  return (
    <div className="m-captions" role="log" aria-live="polite" aria-label="Live captions">
      {text ? <span style={{ opacity: 0.75 }}>{text}</span> : <><b>{last!.speakerName}</b>{last!.text}</>}
    </div>
  );
}
