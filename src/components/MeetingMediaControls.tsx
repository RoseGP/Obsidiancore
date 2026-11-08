import React, { useState, useRef, useEffect, useCallback } from 'react';
import { getActivePeerConnection } from '../utils/app';

export default function MeetingMediaControls() {
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const isCapturingRef = useRef<boolean>(false);

  // Browser support check
  const canShareScreen =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function';

  // Toggle Camera (User Media)
  const toggleCamera = async () => {
    setErrorMessage(null);
    if (isCameraOn) {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
      if (!isScreenSharing && localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
      setIsCameraOn(false);
    } else {
      try {
        if (!navigator?.mediaDevices?.getUserMedia) {
          throw new Error('getUserMedia is not supported on this device/browser.');
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720 },
          audio: true
        });
        mediaStreamRef.current = stream;
        if (!isScreenSharing && localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        setIsCameraOn(true);
      } catch (err: any) {
        console.error('Error accessing camera:', err);
        setErrorMessage(
          err.name === 'NotAllowedError'
            ? 'Camera permission denied.'
            : 'Could not access camera or microphone: ' + (err.message || 'Permission denied')
        );
      }
    }
  };

  // Stop Screen Share & restore camera track
  const stopScreenShare = useCallback(async () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {}
      });
      screenStreamRef.current = null;
    }

    // Restore camera stream in video preview if active
    if (mediaStreamRef.current && localVideoRef.current) {
      localVideoRef.current.srcObject = mediaStreamRef.current;
      localVideoRef.current.play().catch(() => {});
    } else if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    // WebRTC: Restore user's camera track using replaceTrack()
    const activePc = getActivePeerConnection();
    if (activePc) {
      const sender = activePc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) {
        const cameraTrack = mediaStreamRef.current?.getVideoTracks()[0] || null;
        try {
          await sender.replaceTrack(cameraTrack);
          console.log('[MeetingMediaControls] Restored camera track in peer connection.');
        } catch (err) {
          console.warn('[MeetingMediaControls] Error restoring camera track:', err);
        }
      }
    }

    setIsScreenSharing(false);
    isCapturingRef.current = false;
  }, []);

  // Toggle Screen Share using standard Web Screen Capture API
  const toggleScreenShare = async () => {
    setErrorMessage(null);

    if (isScreenSharing) {
      await stopScreenShare();
      return;
    }

    if (!canShareScreen) {
      setErrorMessage(
        'Screen sharing is not supported by this browser. Please use a current version of Chrome, Edge, Firefox, or another supported browser.'
      );
      return;
    }

    if (isCapturingRef.current) {
      return;
    }

    isCapturingRef.current = true;

    try {
      let stream: MediaStream | null = null;

      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
          preferCurrentTab: false,
          selfBrowserSurface: 'exclude' as any,
          surfaceSwitching: 'include' as any,
          monitorTypeSurfaces: 'include' as any,
          systemAudio: 'include' as any
        } as DisplayMediaStreamOptions);
      } catch (optionErr: any) {
        if (optionErr?.name === 'TypeError') {
          try {
            stream = await navigator.mediaDevices.getDisplayMedia({
              video: true,
              audio: true
            });
          } catch (retryErr: any) {
            if (retryErr?.name === 'TypeError') {
              stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            } else {
              throw retryErr;
            }
          }
        } else {
          throw optionErr;
        }
      }

      if (!stream) {
        throw new Error('No display stream returned.');
      }

      screenStreamRef.current = stream;

      // Display captured stream in video preview
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        await localVideoRef.current.play();
      }

      // Detect when the user stops sharing from native browser controls
      const [videoTrack] = stream.getVideoTracks();
      if (videoTrack) {
        videoTrack.addEventListener('ended', () => {
          stopScreenShare();
        });

        // WebRTC integration: replace track in existing RTCPeerConnection
        const activePc = getActivePeerConnection();
        if (activePc) {
          const sender = activePc.getSenders().find((s) => s.track?.kind === 'video');
          if (sender) {
            await sender.replaceTrack(videoTrack);
            console.log('[MeetingMediaControls] Replaced video track with screen share track.');
          }
        }
      }

      setIsScreenSharing(true);
    } catch (err: any) {
      console.warn('Screen share error:', err);
      const isIframe = typeof window !== 'undefined' && window.self !== window.top;

      let msg = 'Could not share screen.';
      switch (err.name) {
        case 'NotAllowedError':
        case 'PermissionDeniedError':
          msg = isIframe
            ? 'Screen sharing cancelled or denied. Check iframe allow="display-capture" permission.'
            : 'Screen sharing was cancelled or denied by the user.';
          break;
        case 'NotFoundError':
          msg = 'No shareable display source is available.';
          break;
        case 'NotReadableError':
          msg = 'The operating system or browser could not capture the selected source.';
          break;
        case 'InvalidStateError':
          msg = 'Sharing must be initiated from a direct user interaction.';
          break;
        case 'TypeError':
          msg = 'The requested capture options are not supported by this browser.';
          break;
        default:
          msg = err.message || 'Could not start screen sharing.';
      }
      setErrorMessage(msg);
      await stopScreenShare();
    } finally {
      isCapturingRef.current = false;
    }
  };

  // Cleanup tracks on unmount
  useEffect(() => {
    return () => {
      if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      if (screenStreamRef.current) screenStreamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[500px] bg-slate-950 text-white p-6 font-sans rounded-3xl border border-slate-800">
      {/* Video Container */}
      <div className="relative w-full max-w-4xl aspect-video bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex items-center justify-center">
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-contain ${
            isScreenSharing ? '' : isCameraOn ? 'scale-x-[-1]' : ''
          }`}
        />

        {!isCameraOn && !isScreenSharing && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/90 text-slate-500">
            <span className="text-4xl mb-2">📷</span>
            <p className="text-sm font-medium">Camera and Screen Sharing are Inactive</p>
          </div>
        )}

        {isScreenSharing && (
          <span className="absolute top-4 left-4 bg-red-600/90 text-white text-xs font-semibold px-3 py-1 rounded-full backdrop-blur-md flex items-center gap-1.5 shadow-lg animate-pulse">
            <span className="h-2 w-2 rounded-full bg-white" />
            <span>You are sharing your screen</span>
          </span>
        )}
      </div>

      {/* Error Banner */}
      {errorMessage && (
        <div className="mt-4 p-3 bg-red-500/20 border border-red-500/40 text-red-300 text-xs rounded-xl max-w-4xl w-full flex items-center justify-between">
          <span>{errorMessage}</span>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-red-400 hover:text-white font-bold px-2 py-0.5"
          >
            ✕
          </button>
        </div>
      )}

      {/* Control Bar */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-4 bg-slate-900/80 border border-slate-800 p-3 rounded-2xl backdrop-blur-xl">
        <button
          onClick={toggleCamera}
          className={`px-5 py-2.5 rounded-xl font-medium text-xs transition-all cursor-pointer ${
            isCameraOn ? 'bg-slate-800 text-slate-200 hover:bg-slate-700' : 'bg-blue-600 text-white hover:bg-blue-500'
          }`}
        >
          {isCameraOn ? 'Turn Camera Off' : 'Turn Camera On'}
        </button>

        <button
          onClick={toggleScreenShare}
          disabled={!canShareScreen}
          className={`px-5 py-2.5 rounded-xl font-medium text-xs transition-all cursor-pointer ${
            !canShareScreen
              ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
              : isScreenSharing
              ? 'bg-red-600 text-white hover:bg-red-500 shadow-lg shadow-red-900/30'
              : 'bg-indigo-600 text-white hover:bg-indigo-500'
          }`}
          title={
            !canShareScreen
              ? 'Screen sharing is not supported by this browser. Please use a current version of Chrome, Edge, Firefox, or another supported browser.'
              : isScreenSharing
              ? 'Stop Sharing Screen'
              : 'Share Screen'
          }
        >
          {isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
        </button>
      </div>
    </div>
  );
}
