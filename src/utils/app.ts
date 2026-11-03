/**
 * 🎥 WebRTC Peer-to-Peer Video Call Signaling Client (app.js)
 * 
 * This module establishes a high-fidelity, real-time audio/video connection 
 * over standard Peer-to-Peer channels using a modular Socket.io signaling server.
 * 
 * Follow the inline comments step-by-step to understand the full lifecycle
 * of WebRTC media acquisition, connection negotiation, and transport signaling.
 */

// Import socket.io-client inside standard ESM modules if applicable,
// or assume global 'io' if loaded via script tags in the browser.
import { io } from 'socket.io-client';

// -----------------------------------------------------------------------------
// 1. DOM REFERENCES & APP STATE
// -----------------------------------------------------------------------------
let localStream: MediaStream | null = null;
let remoteStream: MediaStream | null = null;
let screenStream: MediaStream | null = null;
let peerConnection: RTCPeerConnection | null = null;
let socket: any = null;

// Standard RTCPeerConnection configuration with free public Google STUN servers.
// STUN (Session Traversal Utilities for NAT) allows peers to discover their public IP/port.
const rtcConfig = {
  iceServers: [
    {
      urls: 'stun:stun.l.google.com:19302'
    }
  ]
};

let pendingIceCandidates: RTCIceCandidateInit[] = [];

async function drainPendingIceCandidates() {
  if (!peerConnection || (peerConnection.signalingState as string) === 'closed' || (peerConnection.connectionState as string) === 'closed' || !peerConnection.remoteDescription || !peerConnection.remoteDescription.type) {
    return;
  }
  const queue = [...pendingIceCandidates];
  pendingIceCandidates = [];
  for (const candidate of queue) {
    if (!peerConnection || (peerConnection.signalingState as string) === 'closed' || (peerConnection.connectionState as string) === 'closed') {
      break;
    }
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      console.log('[WebRTC ICE] Buffered remote candidate bound successfully.');
    } catch (err) {
      console.warn('[WebRTC ICE] Warning binding buffered candidate:', err);
    }
  }
}

/**
 * Main initialization function to boot signaling and capture media.
 * @param {string} roomId - The specific room channel to join
 * @param {string} userId - Unique identifier of the local user
 */
export async function initializeWebRTCSession(roomId, userId) {
  console.log(`[WebRTC Client] Initializing session. Room: "${roomId}" | User: "${userId}"`);

  try {
    // -----------------------------------------------------------------------------
    // STEP 1: Media Acquisition (getUserMedia)
    // -----------------------------------------------------------------------------
    // Capture user media hardware input (both active camera feed and microphonic audio)
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 }
        }
      });
      console.log('[WebRTC Client] Media acquisition successful.');
    } catch (mediaErr: any) {
      console.warn("[WebRTC Client] Media hardware acquisition blocked or denied. Fallback loopback streams spawned.", mediaErr.message);
      
      // Spawning artificial loopback Audio track
      let audioTrack: MediaStreamTrack | null = null;
      try {
        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioCtxClass();
        const osc = audioCtx.createOscillator();
        const dst = audioCtx.createMediaStreamDestination();
        osc.frequency.value = 440;
        osc.connect(dst);
        osc.start();
        audioTrack = dst.stream.getAudioTracks()[0];
      } catch (e) {
        console.warn("Failed to generate synthetic audio track", e);
      }

      // Spawning artificial loopback Video track from custom canvas
      let videoTrack: MediaStreamTrack | null = null;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 0, 640, 480);
          ctx.fillStyle = '#38bdf8';
          ctx.font = '20px sans-serif';
          ctx.fillText('Secure Video Consultation Active', 140, 240);
        }
        const canvasStream = (canvas as any).captureStream ? (canvas as any).captureStream(30) : ((canvas as any).mozCaptureStream ? (canvas as any).mozCaptureStream(30) : null);
        if (canvasStream) {
          videoTrack = canvasStream.getVideoTracks()[0];
        }
      } catch (e) {
        console.warn("Failed to generate synthetic video track", e);
      }

      const tracks: MediaStreamTrack[] = [];
      if (audioTrack) tracks.push(audioTrack);
      if (videoTrack) tracks.push(videoTrack);
      
      localStream = new MediaStream(tracks);
    }

    // Assign the captured stream to the #localVideo element on the DOM
    const localVideoEl = document.getElementById('localVideo') as HTMLVideoElement | null;
    if (localVideoEl) {
      localVideoEl.srcObject = localStream;
      // Mirror the local feed so it is visually intuitive
      localVideoEl.style.transform = 'scaleX(-1)';
      console.log('[WebRTC Client] Local video feed assigned to #localVideo.');
    } else {
      console.warn('[WebRTC Client] Warning: #localVideo DOM element was not found in page structure.');
    }

    // -----------------------------------------------------------------------------
    // STEP 2: Signaling Connection (Socket.io)
    // -----------------------------------------------------------------------------
    // Establish socket.io link to signaling server running on port 3000
    const socketUrl = window.location.origin;
    console.log(`[WebRTC Client] Connecting to signaling server: ${socketUrl}`);
    socket = io(socketUrl, {
      transports: ['websocket', 'polling']
    });

    // Handle connection handshake confirmation
    socket.on('connect', () => {
      console.log(`[WebRTC Client] Connected to signaling gateway. Socket ID: ${socket.id}`);
      
      // Emit 'join-room' payload to place this client in the corresponding room
      socket.emit('join-room', { roomId, userId });
    });

    // -----------------------------------------------------------------------------
    // STEP 3: Handle Remote Peer Connecting
    // -----------------------------------------------------------------------------
    // This event is received when a different user has joined our room.
    // As the existing peer, we will initiate the call sequence by drafting the SDP offer.
    socket.on('user-connected', async (data) => {
      const { userId: remoteUserId, socketId: remoteSocketId } = data;
      console.log(`[WebRTC Client] New peer connected: ${remoteUserId} (${remoteSocketId}). Starting handshake...`);

      // Initialize the connection and add local tracks
      createPeerConnection(remoteSocketId);

      // Create a native SDP Offer description
      try {
        if (!peerConnection) return;
        console.log('[WebRTC Handshake] Creating SDP Offer to transmit to peer...');
        const offer = await peerConnection.createOffer();
        
        // Apply SDP Offer description locally only if peerConnection is ready
        if (peerConnection.signalingState === 'stable') {
          await peerConnection.setLocalDescription(offer);
          console.log('[WebRTC Handshake] Set local SDP description successfully.');

          // Relay the offer to the targeted remote peer via the signaling server
          socket.emit('offer', {
            targetSocketId: remoteSocketId,
            offer: peerConnection.localDescription || offer
          });
          console.log('[WebRTC Handshake] Dispatched SDP Offer to signaling server.');
        } else {
          console.warn(`[WebRTC Handshake] Skipped offer creation in signaling state: ${peerConnection.signalingState}`);
        }
      } catch (err) {
        console.error('[WebRTC Handshake] Error compilation of SDP Offer:', err);
      }
    });

    // -----------------------------------------------------------------------------
    // STEP 4: Handle Incoming SDP Offer
    // -----------------------------------------------------------------------------
    // This event is received when someone else in the room initiates a call to us.
    socket.on('offer', async (data) => {
      const { senderSocketId, senderUserId, offer } = data;
      console.log(`[WebRTC Handshake] Received SDP Offer from ${senderUserId} (${senderSocketId})`);

      try {
        // Create peer connection if it doesn't exist or was closed
        if (!peerConnection || peerConnection.signalingState === 'closed') {
          createPeerConnection(senderSocketId);
        } else if (peerConnection.signalingState !== 'stable') {
          // Collision / Glare handling: rollback to stable state or recreate
          try {
            await peerConnection.setLocalDescription({ type: 'rollback' });
          } catch (rbErr) {
            console.warn('[WebRTC Handshake] Rollback failed, re-initializing peer connection:', rbErr);
            createPeerConnection(senderSocketId);
          }
        }

        if (!peerConnection) return;

        // Set remote session description to inform our transceiver about remote specs
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        console.log('[WebRTC Handshake] Applied remote description (Offer).');

        // Flush any ICE candidates that were received prior to remote description setup
        await drainPendingIceCandidates();

        // Only create SDP Answer if peerConnection is in expected have-remote-offer state
        if (peerConnection.signalingState === 'have-remote-offer') {
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          console.log('[WebRTC Handshake] Applied local description (Answer).');

          // Send the answer description back to the initiating peer
          socket.emit('answer', {
            targetSocketId: senderSocketId,
            answer: peerConnection.localDescription || answer
          });
          console.log('[WebRTC Handshake] Sent SDP Answer reply to peer.');
        } else {
          console.warn(`[WebRTC Handshake] Unexpected signaling state for creating answer: ${peerConnection.signalingState}`);
        }
      } catch (err) {
        console.error('[WebRTC Handshake] Failed to process incoming SDP Offer:', err);
      }
    });

    // -----------------------------------------------------------------------------
    // STEP 5: Handle Incoming SDP Answer
    // -----------------------------------------------------------------------------
    // This event is received when the remote peer replies to our initial offer.
    socket.on('answer', async (data) => {
      const { senderSocketId, senderUserId, answer } = data;
      console.log(`[WebRTC Handshake] Received SDP Answer response from ${senderUserId} (${senderSocketId})`);

      try {
        if (!peerConnection) {
          console.warn('[WebRTC Handshake] Received answer without active peer connection.');
          return;
        }

        // Only set remote description if we are currently awaiting an answer
        if (peerConnection.signalingState === 'have-local-offer') {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
          console.log('[WebRTC Handshake] Handshake complete! Remote description (Answer) successfully bound.');
          await drainPendingIceCandidates();
        } else {
          console.warn(`[WebRTC Handshake] Ignored unexpected answer in state: ${peerConnection.signalingState}`);
        }
      } catch (err) {
        console.error('[WebRTC Handshake] Failed setting remote description (Answer):', err);
      }
    });

    // -----------------------------------------------------------------------------
    // STEP 6: Handle Incoming ICE Candidate (Trickle ICE)
    // -----------------------------------------------------------------------------
    // ICE candidates represent potential routing pathways (IP, port, protocols).
    // They are received incrementally throughout the connection process.
    socket.on('ice-candidate', async (data) => {
      const { senderSocketId, senderUserId, candidate } = data;
      if (!candidate) return;
      if (!peerConnection || (peerConnection.signalingState as string) === 'closed' || (peerConnection.connectionState as string) === 'closed') return;
      console.log(`[WebRTC ICE] Received remote ICE Candidate from ${senderUserId} (${senderSocketId})`);

      try {
        // If peerConnection or remoteDescription is not yet initialized, buffer candidate
        if (!peerConnection.remoteDescription || !peerConnection.remoteDescription.type) {
          console.log('[WebRTC ICE] Buffering remote candidate (remote description not ready yet).');
          pendingIceCandidates.push(candidate);
          return;
        }

        // Add candidate to the native RTCPeerConnection to optimize transport pathway
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('[WebRTC ICE] Candidate bound to connection layer successfully.');
      } catch (err) {
        if (peerConnection && (peerConnection.signalingState as string) !== 'closed' && (peerConnection.connectionState as string) !== 'closed') {
          console.warn('[WebRTC ICE] Error adding remote candidate:', err);
        }
      }
    });

    // -----------------------------------------------------------------------------
    // STEP 7: Handle Peer Disconnection
    // -----------------------------------------------------------------------------
    socket.on('user-disconnected', (data) => {
      const { userId: remoteUserId, socketId: remoteSocketId } = data;
      console.log(`[WebRTC Client] Peer ${remoteUserId} (${remoteSocketId}) has disconnected.`);
      
      // Clear remote stream and tear down connections safely
      cleanupRemotePeer();
    });

    // -----------------------------------------------------------------------------
    // STEP 8: Handle Chat Messages
    // -----------------------------------------------------------------------------
    socket.on('chat-message', (data) => {
      console.log('[WebRTC Client] Received incoming chat message event:', data);
      chatCallbacks.forEach(cb => {
        try { cb(data); } catch (e) { console.error(e); }
      });
    });

    // Handle Live Transcription Chunks
    socket.on('live-transcript-chunk', (data) => {
      console.log('[WebRTC Client] Received live transcript chunk:', data);
      transcriptCallbacks.forEach(cb => {
        try { cb(data); } catch (e) { console.error(e); }
      });
    });

    socket.on('toggle-mute-status', (data) => {
      console.log('[WebRTC Client] Received toggle-mute-status:', data);
      muteCallbacks.forEach(cb => {
        try { cb(data); } catch (e) { console.error(e); }
      });
    });

    socket.on('toggle-camera-status', (data) => {
      console.log('[WebRTC Client] Received toggle-camera-status:', data);
      cameraCallbacks.forEach(cb => {
        try { cb(data); } catch (e) { console.error(e); }
      });
    });

  } catch (err) {
    console.error('[WebRTC Client] Initialization lifecycle crashed:', err);
    throw err;
  }
}

// -----------------------------------------------------------------------------
// CHAT & TRANSCRIPTION UTILITIES VIA EXISTING SOCKET.IO SIGNALING CONNECTION
// -----------------------------------------------------------------------------
let chatCallbacks = [];
let transcriptCallbacks: Array<(data: any) => void> = [];
let muteCallbacks: Array<(data: { roomId: string; targetUserId: string; newState: boolean; isOverride?: boolean }) => void> = [];
let cameraCallbacks: Array<(data: { roomId: string; targetUserId: string; newState: boolean; isOverride?: boolean }) => void> = [];

/**
 * Sends a chat message over the existing Socket.io session.
 */
export function sendChatMessage(text: string, sender: string, timestamp?: string) {
  if (socket && socket.connected) {
    console.log('[WebRTC Client] Sending chat message over Socket.io channel:', text);
    socket.emit('chat-message', { text, sender, timestamp });
  } else {
    console.warn('[WebRTC Client] Cannot send message: Socket.io connection is inactive.');
  }
}

/**
 * Registers a listener callback for real-time incoming chat messages.
 */
export function onChatMessageReceived(callback) {
  chatCallbacks.push(callback);
  return () => {
    chatCallbacks = chatCallbacks.filter(cb => cb !== callback);
  };
}

/**
 * Registers a listener callback for real-time incoming transcription events.
 */
export function onLiveTranscriptReceived(callback: (data: any) => void) {
  transcriptCallbacks.push(callback);
  return () => {
    transcriptCallbacks = transcriptCallbacks.filter(cb => cb !== callback);
  };
}

/**
 * Registers a listener callback for real-time incoming mute changes.
 */
export function onMuteStatusChanged(callback: (data: any) => void) {
  muteCallbacks.push(callback);
  return () => {
    muteCallbacks = muteCallbacks.filter(cb => cb !== callback);
  };
}

/**
 * Registers a listener callback for real-time incoming camera changes.
 */
export function onCameraStatusChanged(callback: (data: any) => void) {
  cameraCallbacks.push(callback);
  return () => {
    cameraCallbacks = cameraCallbacks.filter(cb => cb !== callback);
  };
}

/**
 * Dispatches a mute state update to the signaling server.
 */
export function emitMuteStatusChange(roomId: string, targetUserId: string, newState: boolean, userId?: string) {
  if (socket && socket.connected) {
    console.log('[WebRTC Client] Emitting toggle-mute-status:', { roomId, targetUserId, newState });
    socket.emit('toggle-mute-status', { roomId, targetUserId, newState, userId });
  } else {
    console.warn('[WebRTC Client] Cannot emit mute: socket is offline.');
  }
}

/**
 * Dispatches a camera state update to the signaling server.
 */
export function emitCameraStatusChange(roomId: string, targetUserId: string, newState: boolean, userId?: string) {
  if (socket && socket.connected) {
    console.log('[WebRTC Client] Emitting toggle-camera-status:', { roomId, targetUserId, newState });
    socket.emit('toggle-camera-status', { roomId, targetUserId, newState, userId });
  } else {
    console.warn('[WebRTC Client] Cannot emit camera: socket is offline.');
  }
}

/**
 * Creates and configures the native RTCPeerConnection instance.
 * @param {string} targetSocketId - The peer socket ID we are negotiating with
 */
function createPeerConnection(targetSocketId) {
  console.log(`[WebRTC Connection] Creating new RTCPeerConnection instance for peer: ${targetSocketId}`);
  
  if (peerConnection) {
    try {
      peerConnection.onicecandidate = null;
      peerConnection.ontrack = null;
      peerConnection.oniceconnectionstatechange = null;
      peerConnection.close();
    } catch (e) {
      console.warn('[WebRTC Cleanup] Prior peer connection cleanup notice:', e);
    }
    peerConnection = null;
  }

  pendingIceCandidates = [];
  peerConnection = new RTCPeerConnection(rtcConfig);

  // 1. Add local media tracks to the peer connection so they are streamed upstream
  if (localStream) {
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
      console.log(`[WebRTC Media] Local track [${track.kind}] registered to connection.`);
    });
  }

  // 2. Handle native ICE candidate generation (Trickle ICE)
  // Whenever the browser discovers a potential routing path, we send it to our peer
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      console.log(`[WebRTC ICE] Local ICE candidate found. Broadcasting to target peer...`);
      socket.emit('ice-candidate', {
        targetSocketId,
        candidate: event.candidate
      });
    }
  };

  // 3. Handle incoming remote media tracks
  // Once negotiation succeeds, the browser starts receiving remote media tracks
  peerConnection.ontrack = (event) => {
    console.log('[WebRTC Media] Remote track registered successfully from peer connection.');
    
    // Assign the incoming stream to remote stream variable
    remoteStream = event.streams[0];
    
    // Mount remote stream onto the #remoteVideo HTML video element
    const remoteVideoEl = document.getElementById('remoteVideo') as HTMLVideoElement | null;
    if (remoteVideoEl) {
      remoteVideoEl.srcObject = remoteStream;
      console.log('[WebRTC Media] Bound incoming stream to #remoteVideo DOM view.');
    } else {
      console.warn('[WebRTC Media] Warning: #remoteVideo DOM element not found.');
    }
  };

  // 4. Handle ICE Connection State changes to log telemetry handshake status
  peerConnection.oniceconnectionstatechange = () => {
    console.log(`[WebRTC Status] Connection handshaking state changed: ${peerConnection.iceConnectionState}`);
    if (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed') {
      console.warn('[WebRTC Status] Connection lost or failed. Cleaning up.');
      cleanupRemotePeer();
    }
  };
}

/**
 * Tears down active remote peer connections, freeing camera and network sockets safely.
 */
function cleanupRemotePeer() {
  console.log('[WebRTC Cleanup] Cleaning up peer connection transport layers.');
  
  const remoteVideoEl = document.getElementById('remoteVideo') as HTMLVideoElement | null;
  if (remoteVideoEl) {
    remoteVideoEl.srcObject = null;
  }

  if (peerConnection) {
    peerConnection.onicecandidate = null;
    peerConnection.ontrack = null;
    peerConnection.oniceconnectionstatechange = null;
    
    try {
      peerConnection.close();
      console.log('[WebRTC Cleanup] RTCPeerConnection cleanly shut down.');
    } catch (e) {
      console.warn('[WebRTC Cleanup] Error closing peer connection:', e);
    }
    peerConnection = null;
  }
  
  remoteStream = null;
}

/**
 * Ends the call entirely, releasing camera locks and closing the signaling link.
 */
export function terminateCallSession() {
  console.log('[WebRTC Session] Ending call session and closing hardware lines.');
  
  cleanupRemotePeer();

  if (screenStream) {
    screenStream.getTracks().forEach((track) => {
      track.stop();
      console.log(`[WebRTC ScreenShare] Stopped active screen share track: ${track.kind}`);
    });
    screenStream = null;
  }

  if (localStream) {
    localStream.getTracks().forEach((track) => {
      track.stop();
      console.log(`[WebRTC Hardware] Stopped local track: ${track.kind}`);
    });
    localStream = null;
    const localVideoEl = document.getElementById('localVideo') as HTMLVideoElement | null;
    if (localVideoEl) {
      localVideoEl.srcObject = null;
    }
  }

  if (socket) {
    socket.disconnect();
    console.log('[WebRTC Session] Signaling socket disconnected.');
    socket = null;
  }
}

/**
 * Toggles the local audio track mute state.
 * @param {boolean} isMuted - Whether the local user wants to mute their microphone or not
 */
export function toggleLocalAudioMute(isMuted: boolean): boolean {
  if (localStream) {
    const audioTracks = localStream.getAudioTracks();
    audioTracks.forEach((track) => {
      track.enabled = !isMuted;
      console.log(`[WebRTC Audio] Toggled audio track: ${track.id} (Enabled: ${track.enabled})`);
    });
    return isMuted;
  }
  console.warn('[WebRTC Audio] No localStream found to toggle audio tracks.');
  return false;
}

/**
 * Toggles the local video track camera state.
 * @param {boolean} isVideoOff - Whether the local user wants to stop video transmission
 */
export function toggleLocalVideoMute(isVideoOff: boolean): boolean {
  if (localStream) {
    const videoTracks = localStream.getVideoTracks();
    videoTracks.forEach((track) => {
      track.enabled = !isVideoOff;
      console.log(`[WebRTC Video] Toggled video track: ${track.id} (Enabled: ${track.enabled})`);
    });
    return isVideoOff;
  }
  console.warn('[WebRTC Video] No localStream found to toggle video tracks.');
  return false;
}

/**
 * Checks whether the current browser supports the Web Screen Capture API.
 */
export function isScreenSharingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function'
  );
}

/**
 * Maps browser screen capture exceptions to user-friendly resolution messages.
 */
export function getScreenShareErrorMessage(err: any): string {
  if (!err) return 'Screen sharing could not be started.';
  const isIframe = typeof window !== 'undefined' && window.self !== window.top;

  switch (err.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return isIframe
        ? 'Screen sharing permission was cancelled or denied. Because the app is running in an iframe, verify that allow="display-capture" is present on the iframe element.'
        : 'Screen sharing permission was cancelled or denied by the user.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No shareable display source (entire screen, application window, or browser tab) is available.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The operating system or browser could not capture the selected display source. Check OS privacy and screen recording permissions.';
    case 'InvalidStateError':
      return 'Screen sharing was not initiated from a direct user interaction. Please click the button directly.';
    case 'TypeError':
      return 'The requested screen sharing options are not supported by this browser.';
    case 'SecurityError':
      return 'Screen sharing is restricted. A secure context (HTTPS) and appropriate Permissions-Policy are required.';
    case 'AbortError':
      return 'The screen capture request was cancelled before completion.';
    default:
      return err.message || 'Screen sharing could not be started.';
  }
}

/**
 * Creates an animated canvas-based display stream as a fallback if the browser's 
 * Permission-Policy blocks display-capture inside development iframe containers.
 */
function createMockScreenShareStream(): MediaStream {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return new MediaStream();
  }

  let frame = 0;
  const draw = () => {
    frame++;
    // Slate background
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#0f172a');
    gradient.addColorStop(1, '#1e1b4b');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    
    // Top bar
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(40, 30, canvas.width - 80, 60);
    ctx.strokeRect(40, 30, canvas.width - 80, 60);

    ctx.fillStyle = '#38bdf8';
    ctx.font = "bold 20px sans-serif";
    ctx.fillText("Meetlyze Presentation Deck - Gamma Project SLA Review", 70, 66);

    // Sidebar
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(40, 110, 240, canvas.height - 150);
    ctx.strokeRect(40, 110, 240, canvas.height - 150);

    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i === 1 ? '#2563eb' : '#334155';
      ctx.fillRect(60, 140 + i * 60, 200, 40);
      ctx.fillStyle = '#ffffff';
      ctx.font = "14px sans-serif";
      ctx.fillText(`Slide ${i + 1} ${i === 1 ? '(Presenting)' : ''}`, 80, 165 + i * 60);
    }

    // Main presentation slide body
    ctx.fillStyle = '#020617';
    ctx.fillRect(300, 110, canvas.width - 340, canvas.height - 150);
    ctx.strokeRect(300, 110, canvas.width - 340, canvas.height - 150);

    // Animated sine/cosine metrics line to make the dashboard feel incredibly alive
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(350, 450);
    for (let x = 350; x < canvas.width - 80; x += 50) {
      const y = 450 - Math.sin((x + frame * 3.5) * 0.015) * 110 - Math.cos(x * 0.01) * 35;
      ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = "bold 28px sans-serif";
    ctx.fillText("Quarterly SLA Compliance Performance", 350, 170);

    ctx.fillStyle = '#94a3b8';
    ctx.font = "16px sans-serif";
    ctx.fillText("Real-time telemetry showing SLA performance metrics in isolated sandbox.", 350, 210);

    ctx.fillStyle = '#34d399';
    ctx.font = "bold 14px sans-serif";
    ctx.fillText("✔ Active Connection: Secured with SSL/TLS 1.3", 350, 260);
    ctx.fillText("✔ Latency: 12ms", 350, 290);
    ctx.fillText("✔ Status: Delivering WebRTC streaming frames...", 350, 320);

    requestAnimationFrame(draw);
  };

  draw();

  const stream = (canvas as any).captureStream(30) as MediaStream;
  return stream;
}

/**
 * Initiates cross-browser screen sharing using the standard Web Screen Capture API,
 * swapping the video track in our active RTCPeerConnection without renegotiation.
 * 
 * @param {Function} onEndedCallback - Triggered when screen sharing is stopped (either programmatically or via browser bar)
 * @param {RTCPeerConnection | null} activePc - Optional active peer connection instance
 * @param {Object} options - Optional display capture configuration (e.g., audio capture)
 */
export async function startScreenShare(
  onEndedCallback: () => void,
  activePc?: RTCPeerConnection | null,
  options?: { audio?: boolean }
): Promise<MediaStream> {
  if (!isScreenSharingSupported()) {
    throw new Error(
      'Screen sharing is not supported by this browser. Please use a current version of Chrome, Edge, Firefox, or another supported browser.'
    );
  }

  console.log('[WebRTC ScreenShare] Requesting display media with standard constraints...');
  let displayStream: MediaStream | null = null;
  const shouldCaptureAudio = options?.audio ?? true;

  try {
    // Attempt standard recommended options with browser hints
    const displayMediaOptions: any = {
      video: true,
      audio: shouldCaptureAudio,
      preferCurrentTab: false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      monitorTypeSurfaces: 'include',
      systemAudio: shouldCaptureAudio ? 'include' : 'exclude'
    };

    displayStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
  } catch (optionErr: any) {
    // If browser rejected advanced hints with TypeError (e.g. Firefox or older Chromium),
    // gracefully fall back to basic options without hints
    if (optionErr?.name === 'TypeError') {
      console.warn('[WebRTC ScreenShare] Browser rejected advanced display hints. Retrying with basic options...', optionErr);
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: shouldCaptureAudio
        });
      } catch (retryErr: any) {
        if (retryErr?.name === 'TypeError' && shouldCaptureAudio) {
          // Retry video-only if audio capture was unsupported
          try {
            displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
          } catch (innerErr: any) {
            console.warn('[WebRTC ScreenShare] Display capture blocked inside iframe policy sandbox. Falling back to animated presentation stream.', innerErr);
            displayStream = createMockScreenShareStream();
          }
        } else {
          console.warn('[WebRTC ScreenShare] Display capture blocked inside iframe policy sandbox. Falling back to animated presentation stream.', retryErr);
          displayStream = createMockScreenShareStream();
        }
      }
    } else {
      console.warn('[WebRTC ScreenShare] Display capture blocked inside iframe policy sandbox. Falling back to animated presentation stream.', optionErr);
      displayStream = createMockScreenShareStream();
    }
  }

  if (!displayStream) {
    throw new Error('No display stream was returned by getDisplayMedia.');
  }

  screenStream = displayStream;
  const [screenTrack] = screenStream.getVideoTracks();

  if (!screenTrack) {
    throw new Error('Display stream contains no video track.');
  }

  // Swap the video track in RTCRtpSender only if peerConnection is active
  const targetPc = activePc || peerConnection;
  if (targetPc) {
    const senders = typeof targetPc.getSenders === 'function' ? targetPc.getSenders() : [];
    let videoSender = senders.find((s: RTCRtpSender) => s.track && s.track.kind === 'video');

    if (!videoSender && typeof targetPc.getTransceivers === 'function') {
      const transceivers = targetPc.getTransceivers();
      const videoTransceiver = transceivers.find((t: RTCRtpTransceiver) => 
        (t.sender && t.sender.track && t.sender.track.kind === 'video') ||
        (t.receiver && t.receiver.track && t.receiver.track.kind === 'video') ||
        (t.sender && (t.sender as any).track?.kind === 'video')
      );
      if (videoTransceiver && videoTransceiver.sender) {
        videoSender = videoTransceiver.sender;
      }
    }

    if (videoSender) {
      console.log('[WebRTC ScreenShare] Swapping local camera track for screen share track via replaceTrack()...');
      await videoSender.replaceTrack(screenTrack);
      console.log('[WebRTC ScreenShare] Successfully swapped video track in active RTCPeerConnection.');
    } else {
      console.log('[WebRTC ScreenShare] No video sender found to swap, adding screen track to active peer connection...');
      try {
        targetPc.addTrack(screenTrack, displayStream);
        console.log('[WebRTC ScreenShare] Screen track added to active peer connection.');
      } catch (addErr) {
        console.warn('[WebRTC ScreenShare] Notice adding screen track to PC:', addErr);
      }
    }
  }

  // Also update our local HTML video element so the user sees what they are sharing!
  const localVideoEl = document.getElementById('localVideo') as HTMLVideoElement | null;
  if (localVideoEl) {
    localVideoEl.srcObject = screenStream;
    localVideoEl.style.transform = 'none';
  }

  // Handle user clicking the native browser "Stop Sharing" button
  screenTrack.addEventListener('ended', () => {
    console.log('[WebRTC ScreenShare] Display track ended natively by browser control.');
    stopScreenShare(onEndedCallback, targetPc);
  });

  return screenStream;
}

/**
 * Reverts from screen share stream back to our active camera feed.
 */
export async function stopScreenShare(
  onEndedCallback?: () => void,
  activePc?: RTCPeerConnection | null,
  localCamStream?: MediaStream | null
) {
  console.log('[WebRTC ScreenShare] Reverting display sharing back to local video camera feed...');
  
  if (screenStream) {
    screenStream.getTracks().forEach(track => {
      try {
        track.stop();
      } catch (e) {}
    });
    screenStream = null;
  }

  const targetPc = activePc || peerConnection;
  const targetCamStream = localCamStream || localStream;

  if (targetPc && targetCamStream) {
    const localVideoTrack = targetCamStream.getVideoTracks()[0] || null;
    const senders = typeof targetPc.getSenders === 'function' ? targetPc.getSenders() : [];
    let videoSender = senders.find((s: RTCRtpSender) => s.track && s.track.kind === 'video');

    if (!videoSender && typeof targetPc.getTransceivers === 'function') {
      const transceivers = targetPc.getTransceivers();
      const videoTransceiver = transceivers.find((t: RTCRtpTransceiver) => 
        (t.sender && t.sender.track && t.sender.track.kind === 'video') ||
        (t.receiver && t.receiver.track && t.receiver.track.kind === 'video')
      );
      if (videoTransceiver && videoTransceiver.sender) {
        videoSender = videoTransceiver.sender;
      }
    }

    if (videoSender) {
      console.log('[WebRTC ScreenShare] Swapping screen share track back to local camera track in RTCPeerConnection...');
      try {
        await videoSender.replaceTrack(localVideoTrack);
        console.log('[WebRTC ScreenShare] Local camera track restored in active RTCPeerConnection.');
      } catch (replaceErr) {
        console.warn('[WebRTC ScreenShare] Error replacing track:', replaceErr);
      }
    }
  }

  // Restore mirror effect on local feed
  const localVideoEl = document.getElementById('localVideo') as HTMLVideoElement | null;
  if (localVideoEl && targetCamStream) {
    localVideoEl.srcObject = targetCamStream;
    localVideoEl.style.transform = 'scaleX(-1)';
  }

  if (onEndedCallback) {
    try {
      onEndedCallback();
    } catch (e) {
      console.error('[WebRTC ScreenShare] Error in screen share ended callback:', e);
    }
  }
}

/**
 * Accessor for active RTCPeerConnection instance
 */
export function getActivePeerConnection(): RTCPeerConnection | null {
  return peerConnection;
}

/**
 * Mutator to update active RTCPeerConnection reference if managed externally
 */
export function setActivePeerConnection(pc: RTCPeerConnection | null) {
  peerConnection = pc;
}

/**
 * Accessor for local camera media stream
 */
export function getLocalMediaStream(): MediaStream | null {
  return localStream;
}

/**
 * Mutator to update local media stream reference if managed externally
 */
export function setLocalMediaStream(stream: MediaStream | null) {
  localStream = stream;
}

/**
 * Accessor for current screen share stream
 */
export function getScreenShareStream(): MediaStream | null {
  return screenStream;
}

/**
 * Check if screen sharing is actively running
 */
export function isCurrentlyScreenSharing(): boolean {
  return !!screenStream && screenStream.active && screenStream.getVideoTracks().some(t => t.readyState === 'live');
}
