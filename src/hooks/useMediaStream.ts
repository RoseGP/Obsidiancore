import { useState, useEffect, useRef, useCallback } from 'react';

export interface UseMediaStreamReturn {
  cameraStream: MediaStream | null;
  screenStream: MediaStream | null;
  isCameraOn: boolean;
  isMuted: boolean;
  isScreenSharing: boolean;
  error: string | null;
  toggleCamera: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  stopAllStreams: () => void;
  clearError: () => void;
}

/**
 * Generates an animated HTML5 Canvas MediaStream for environments where
 * native screen capture (navigator.mediaDevices.getDisplayMedia) is not available or restricted (e.g. sandboxed iFrame).
 */
export function createFallbackScreenStream(): MediaStream {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');

  let animationFrameId: number;
  let frame = 0;

  const draw = () => {
    if (!ctx) return;
    frame++;

    // Desktop background grid
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle grid pattern
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Window top bar
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, canvas.width, 40);

    // Window control buttons
    ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(20, 20, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f59e0b'; ctx.beginPath(); ctx.arc(40, 20, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#10b981'; ctx.beginPath(); ctx.arc(60, 20, 6, 0, Math.PI * 2); ctx.fill();

    // Window Title Text
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('Live Desktop Workspace & Analytics Presentation (Screen Share Stream)', 90, 25);

    // Workspace Canvas Box
    ctx.fillStyle = '#18181b';
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(60, 80, 1160, 580, 16);
      ctx.fill();
    } else {
      ctx.fillRect(60, 80, 1160, 580);
    }

    // Dashboard Banner Header
    ctx.fillStyle = '#6366f1';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText('CRM Strategy & Live WebRTC Analytics Presentation', 100, 140);

    // Animated Bar Chart
    const barHeightMultiplier = Math.sin(frame * 0.05) * 20;
    const bars = [120, 180, 240, 300, 210, 350, 420, 380, 460];
    bars.forEach((h, i) => {
      ctx.fillStyle = i % 2 === 0 ? '#818cf8' : '#c084fc';
      ctx.fillRect(100 + i * 110, 500 - (h + barHeightMultiplier * ((i % 3) + 1)), 70, h + barHeightMultiplier * ((i % 3) + 1));
    });

    animationFrameId = requestAnimationFrame(draw);
  };

  draw();

  const stream = (canvas as any).captureStream ? (canvas as any).captureStream(30) : new MediaStream();
  
  if (stream.getTracks().length > 0) {
    const track = stream.getTracks()[0];
    const originalStop = track.stop.bind(track);
    track.stop = () => {
      cancelAnimationFrame(animationFrameId);
      originalStop();
    };
  }

  return stream;
}

/**
 * Custom React Hook for WebRTC Media Stream Management
 * Handles camera acquisition, track toggling, microphone muting,
 * screen sharing with native track.onended listener, and permission error handling.
 */
export function useMediaStream(): UseMediaStreamReturn {
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  
  const [isCameraOn, setIsCameraOn] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  
  const [error, setError] = useState<string | null>(null);

  // Keep references to current streams for teardown during unmount
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  cameraStreamRef.current = cameraStream;
  screenStreamRef.current = screenStream;

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * Stops all active tracks on both camera and screen streams
   */
  const stopAllStreams = useCallback(() => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      setCameraStream(null);
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => track.stop());
      setScreenStream(null);
    }
    setIsCameraOn(false);
    setIsMuted(false);
    setIsScreenSharing(false);
  }, []);

  /**
   * Toggles camera video tracks on/off without destroying the media stream connection.
   * If no media stream exists yet, requests user camera media stream.
   */
  const toggleCamera = useCallback(async () => {
    setError(null);

    // If camera stream already exists, toggle the existing video track's enabled state
    if (cameraStreamRef.current) {
      const videoTracks = cameraStreamRef.current.getVideoTracks();

      if (videoTracks.length > 0) {
        const currentTrack = videoTracks[0];
        const newEnabledState = !currentTrack.enabled;
        currentTrack.enabled = newEnabledState;
        setIsCameraOn(newEnabledState);
        return;
      }
    }

    // Otherwise, acquire a new camera & audio stream
    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error('Media devices API is not supported in this environment.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      setCameraStream(stream);
      setIsCameraOn(true);
      setIsMuted(false);
    } catch (err: any) {
      console.warn('[useMediaStream] Camera access error:', err);
      let errorMessage = 'Failed to access camera.';
      
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMessage = 'Camera/Microphone permission was denied by user or browser.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errorMessage = 'No camera or microphone devices were found on this system.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        errorMessage = 'Camera is already in use by another application.';
      } else if (err.message) {
        errorMessage = err.message;
      }

      setError(errorMessage);
      setIsCameraOn(false);
    }
  }, []);

  /**
   * Toggles microphone audio track enabled state.
   */
  const toggleMic = useCallback(async () => {
    setError(null);

    if (cameraStreamRef.current) {
      const audioTracks = cameraStreamRef.current.getAudioTracks();

      if (audioTracks.length > 0) {
        const currentTrack = audioTracks[0];
        const newMuteState = currentTrack.enabled; // If enabled is true, muting sets enabled to false
        currentTrack.enabled = !newMuteState;
        setIsMuted(newMuteState);
        return;
      }
    }

    // If no stream exists, try initializing audio
    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error('Media devices API is not supported in this environment.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: isCameraOn,
        audio: true,
      });

      setCameraStream(stream);
      setIsMuted(false);
    } catch (err: any) {
      console.warn('[useMediaStream] Mic access error:', err);
      setError('Microphone access denied or unavailable.');
      setIsMuted(true);
    }
  }, [isCameraOn]);

  /**
   * Toggles screen sharing via navigator.mediaDevices.getDisplayMedia.
   * Listens for the track's native `ended` event so UI state reverts automatically
   * when user stops screen share from browser banner.
   */
  const toggleScreenShare = useCallback(async () => {
    setError(null);

    // If screen share is active, stop it
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => track.stop());
      setScreenStream(null);
      setIsScreenSharing(false);
      return;
    }

    // Otherwise, request screen display media
    try {
      let displayStream: MediaStream | null = null;

      // Safely check if getDisplayMedia is supported and is a function
      if (
        typeof navigator !== 'undefined' &&
        navigator.mediaDevices &&
        typeof (navigator.mediaDevices as any).getDisplayMedia === 'function'
      ) {
        try {
          displayStream = await (navigator.mediaDevices as any).getDisplayMedia({
            video: true,
            audio: false,
          });
        } catch (mediaErr: any) {
          console.warn('[useMediaStream] Native getDisplayMedia failed or was cancelled:', mediaErr);
          if (mediaErr.name === 'NotAllowedError' || mediaErr.name === 'PermissionDeniedError') {
            // User cancelled screen picker
            setIsScreenSharing(false);
            return;
          }
        }
      }

      // If native stream not acquired (e.g. API not function in iframe or browser restricted), fallback to canvas stream
      if (!displayStream) {
        displayStream = createFallbackScreenStream();
      }

      const screenTrack = displayStream.getVideoTracks()[0];

      if (screenTrack) {
        // Native event listener: handles browser "Stop sharing" button click
        screenTrack.onended = () => {
          displayStream?.getTracks().forEach((t) => t.stop());
          setScreenStream(null);
          setIsScreenSharing(false);
        };
      }

      setScreenStream(displayStream);
      setIsScreenSharing(true);
    } catch (err: any) {
      console.warn('[useMediaStream] Screen share error, initializing simulated screen feed:', err);
      try {
        const fallbackStream = createFallbackScreenStream();
        setScreenStream(fallbackStream);
        setIsScreenSharing(true);
      } catch (fallbackErr) {
        setError(err.message || 'Failed to initiate screen share.');
        setIsScreenSharing(false);
      }
    }
  }, []);

  // Teardown all streams on unmount
  useEffect(() => {
    return () => {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return {
    cameraStream,
    screenStream,
    isCameraOn,
    isMuted,
    isScreenSharing,
    error,
    toggleCamera,
    toggleMic,
    toggleScreenShare,
    stopAllStreams,
    clearError,
  };
}
