// WebRTC Call Canvas - Signaling, Media stream, and Client Coordinator
const socket = io();

// UI Elements
const joinForm = document.getElementById('join-room-form');
const roomIdInput = document.getElementById('room-id-input');
const userIdInput = document.getElementById('user-id-input');
const joinBtn = document.getElementById('join-btn');
const logsViewport = document.getElementById('logs-viewport');
const clearLogsBtn = document.getElementById('clear-logs');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const localPlaceholder = document.getElementById('local-placeholder');
const remotePlaceholder = document.getElementById('remote-placeholder');
const remoteStatusTxt = document.getElementById('remote-status-txt');
const localUserLabel = document.getElementById('local-user-label');
const remoteUserLabel = document.getElementById('remote-user-label');
const remoteIndicator = document.getElementById('remote-indicator');
const hardwareStatusBadge = document.getElementById('hardware-status');
const peerCountDisplay = document.getElementById('telemetry-peer-cnt');
const socketIdDisplay = document.getElementById('socket-id-display');

// Action Controls
const btnToggleMic = document.getElementById('btn-toggle-mic');
const btnToggleVideo = document.getElementById('btn-toggle-video');
const btnLeaveCall = document.getElementById('btn-leave-call');

// WebRTC State variables
let localStream = null;
let peerConnections = {}; // Map of targetSocketId -> RTCPeerConnection
let activeRoom = null;
let activeUserId = 'Lead Director'; // Default fallback

// STUN configuration for peer connections
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Logging helper to simulate terminal outputs
function log(msg, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const logDiv = document.createElement('div');
  
  let colorClass = 'text-neutral-400';
  let prefix = '[INFO]';
  
  if (type === 'success') {
    colorClass = 'text-emerald-400 font-bold';
    prefix = '[SUCCESS]';
  } else if (type === 'warning') {
    colorClass = 'text-amber-400 font-semibold';
    prefix = '[WARN]';
  } else if (type === 'error') {
    colorClass = 'text-rose-400 font-black';
    prefix = '[ERROR]';
  } else if (type === 'signal') {
    colorClass = 'text-blue-400 font-medium';
    prefix = '[SIGNAL]';
  } else if (type === 'system') {
    colorClass = 'text-neutral-500';
    prefix = '[SYS]';
  }

  logDiv.className = `space-x-1.5 ${colorClass}`;
  logDiv.innerHTML = `<span class="text-neutral-600">${timestamp}</span> <span>${prefix}</span> <span>${msg}</span>`;
  logsViewport.appendChild(logDiv);
  logsViewport.scrollTop = logsViewport.scrollHeight;
}

// Clear terminal logs
clearLogsBtn.addEventListener('click', () => {
  logsViewport.innerHTML = '<div class="text-neutral-500">[System] Terminal trace cleared. Monitoring active...</div>';
});

// Update socket connection metadata UI
socket.on('connect', () => {
  log(`Sio WebSocket connected. Session ID: ${socket.id}`, 'success');
  socketIdDisplay.innerText = `SOCKET: ${socket.id.substring(0, 10)}...`;
  socketIdDisplay.className = 'font-mono text-[9px] uppercase tracking-wider text-emerald-400';
});

socket.on('disconnect', () => {
  log('Sio WebSocket disconnected.', 'error');
  socketIdDisplay.innerText = 'SOCKET: DISCONNECTED';
  socketIdDisplay.className = 'font-mono text-[9px] uppercase tracking-wider text-rose-500';
  cleanupAllCalls();
});

// Capture Audio & Video feeds with graceful headless fallbacks
async function setupLocalMedia() {
  log('Requesting access to the user\'s camera and microphone...', 'system');
  try {
    // Attempt to access user media hardware devices
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: { width: 640, height: 480 }
    });

    log('User camera and microphone access granted successfully.', 'success');
    hardwareStatusBadge.innerText = 'Active (Real Hardware)';
    hardwareStatusBadge.className = 'text-[10px] font-bold text-emerald-400 border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1 rounded-full uppercase tracking-wider';
    
    // Ensure the local video is muted to prevent painful audio echoes
    localVideo.muted = true;
    localVideo.srcObject = localStream;
    localPlaceholder.classList.add('opacity-0');
    localPlaceholder.classList.add('pointer-events-none');
    localUserLabel.innerText = `${activeUserId} (Broadcasting)`;

    // Enable hardware controls
    btnToggleMic.disabled = false;
    btnToggleVideo.disabled = false;

  } catch (err) {
    log(`Permission Denied or Hardware Missing: ${err.message}. Initializing graceful software loopback...`, 'error');
    
    // Fallback dummy audio track generation
    let audioTrack = null;
    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtxClass();
      const osc = audioCtx.createOscillator();
      const dst = audioCtx.createMediaStreamDestination();
      osc.frequency.value = 440;
      osc.connect(dst);
      osc.start();
      audioTrack = dst.stream.getAudioTracks()[0];
    } catch (e) {
      log('Could not initialize audio synthesis fallback.', 'error');
    }

    // Fallback animated canvas video track generation
    let videoTrack = null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      
      let angle = 0;
      const drawFrame = () => {
        if (!localStream) return;
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, 640, 480);
        
        // Dynamic futuristic scanning grids
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        for (let i = 0; i < 640; i += 40) {
          ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 480); ctx.stroke();
        }
        for (let j = 0; j < 480; j += 40) {
          ctx.beginPath(); ctx.moveTo(0, j); ctx.lineTo(640, j); ctx.stroke();
        }

        // Circular sweep orbit
        ctx.fillStyle = '#2563eb';
        ctx.beginPath();
        const x = 320 + Math.cos(angle) * 120;
        const y = 240 + Math.sin(angle) * 120;
        ctx.arc(x, y, 20, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 22px monospace';
        ctx.fillText('SECURE VIDEO DIALER ACTIVE', 140, 220);
        ctx.font = '14px monospace';
        ctx.fillText(`User Node: ${activeUserId}`, 140, 250);
        ctx.fillStyle = '#ef4444';
        ctx.fillText('Hardware Access Blocked / Denied', 140, 285);
        
        angle += 0.05;
        requestAnimationFrame(drawFrame);
      };
      
      setTimeout(drawFrame, 100);
      const canvasStream = canvas.captureStream ? canvas.captureStream(30) : (canvas.mozCaptureStream ? canvas.mozCaptureStream(30) : null);
      if (canvasStream) {
        videoTrack = canvasStream.getVideoTracks()[0];
      }
    } catch (e) {
      log('Could not initialize video synthesis fallback.', 'error');
    }

    const tracks = [];
    if (audioTrack) tracks.push(audioTrack);
    if (videoTrack) tracks.push(videoTrack);
    localStream = new MediaStream(tracks);

    hardwareStatusBadge.innerText = 'Simulated Loopback';
    hardwareStatusBadge.className = 'text-[10px] font-bold text-amber-400 border border-amber-500/20 bg-amber-500/5 px-2.5 py-1 rounded-full uppercase tracking-wider';

    localVideo.muted = true;
    localVideo.srcObject = localStream;
    localPlaceholder.classList.add('opacity-0');
    localPlaceholder.classList.add('pointer-events-none');
    localUserLabel.innerText = `${activeUserId} (Simulated Broadcaster)`;

    // Enable control items with synthetic capability
    btnToggleMic.disabled = false;
    btnToggleVideo.disabled = false;
  }
}

// Automatically trigger media capture immediately upon window load
window.addEventListener('DOMContentLoaded', async () => {
  log('Workspace initialized. Automatically starting media stream acquisition...', 'system');
  await setupLocalMedia();
});

// Join room handler
joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  
  const roomId = roomIdInput.value.trim();
  const userId = userIdInput.value.trim();
  
  if (!roomId || !userId) return;

  activeRoom = roomId;
  activeUserId = userId;

  log(`Requesting subscription to room node: "${roomId}"...`, 'system');
  
  // Disable configuration form inputs to preserve session continuity
  roomIdInput.disabled = true;
  userIdInput.disabled = true;
  joinBtn.disabled = true;
  joinBtn.classList.add('opacity-50');

  // Update local label with personalized moniker
  localUserLabel.innerText = `${activeUserId} (Broadcasting)`;

  // Transmit join-room event to Socket.io server
  socket.emit('join-room', { roomId, userId });
  btnLeaveCall.disabled = false;
});

// Handle room joining response (both room-joined and room-roster for absolute resilience)
socket.on('room-roster', (data) => {
  log(`Successfully assigned to room: "${data.roomId}"`, 'success');
  
  // Reset any previous connections before establishing clean ones
  Object.keys(peerConnections).forEach((id) => {
    removePeerConnection(id);
  });

  peerCountDisplay.innerText = data.peers.length;

  // If there are other peers already in the room, initiate WebRTC handshake with each of them
  data.peers.forEach((peer) => {
    log(`Discovered active peer: ${peer.userId} (${peer.socketId}). Initiating WebRTC caller handshake...`, 'system');
    createPeerConnection(peer.socketId, true);
  });
});

socket.on('room-joined', (data) => {
  log(`Successfully assigned to room: "${data.roomId}"`, 'success');
  log(`Established connection channel for ID: ${data.userId}`, 'success');
  
  peerCountDisplay.innerText = data.peers.length;

  data.peers.forEach((peer) => {
    const peerSocketId = typeof peer === 'object' ? peer.socketId : peer;
    const peerUserId = typeof peer === 'object' ? peer.userId : peer;
    log(`Discovered active peer: ${peerUserId}. Initiating WebRTC caller handshake...`, 'system');
    createPeerConnection(peerSocketId, true);
  });
});

// Creating WebRTC Peer Connections for reliable signaling
function createPeerConnection(targetSocketId, isCaller) {
  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections[targetSocketId] = pc;

  log(`Assembling candidate gatherers for peer: ${targetSocketId}`, 'system');

  // Push local tracks to peer stream channels
  if (localStream) {
    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);
    });
  }

  // Track ICE candidates gathered and relay them immediately
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        targetSocketId: targetSocketId,
        candidate: event.candidate
      });
    }
  };

  // Assign incoming video tracks to remote canvas viewport
  pc.ontrack = (event) => {
    log(`Received video track payload from peer ${targetSocketId}`, 'success');
    if (event.streams && event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
    } else {
      const inboundStream = new MediaStream([event.track]);
      remoteVideo.srcObject = inboundStream;
    }
    remotePlaceholder.classList.add('opacity-0');
    remotePlaceholder.classList.add('pointer-events-none');
    remoteUserLabel.innerText = `ACTIVE PARTICIPANT`;
    remoteIndicator.className = 'inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse';
  };

  // On connection state changes
  pc.onconnectionstatechange = () => {
    log(`WebRTC Connection state with ${targetSocketId} updated: ${pc.connectionState}`, 'system');
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      removePeerConnection(targetSocketId);
    }
  };

  // If we are the caller, build and dispatch SDP Offer
  if (isCaller) {
    pc.onnegotiationneeded = async () => {
      try {
        log(`Generating SDP Offer description for target ${targetSocketId}...`, 'signal');
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', {
          targetSocketId: targetSocketId,
          offer: pc.localDescription
        });
      } catch (err) {
        log(`Failed generating SDP Offer: ${err.message}`, 'error');
      }
    };
  }
}

// Handle incoming WebRTC SDP Offer from another peer
socket.on('offer', async (data) => {
  const senderId = data.senderSocketId || data.senderId;
  const offer = data.offer;
  log(`Received remote WebRTC SDP Offer from peer ${senderId}`, 'signal');
  
  if (!peerConnections[senderId]) {
    createPeerConnection(senderId, false);
  }

  const pc = peerConnections[senderId];
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    log(`Remote offer description set successfully for peer ${senderId}. Designing Answer...`, 'signal');
    
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    log(`Dispatched WebRTC SDP Answer to peer ${senderId}`, 'signal');
    socket.emit('answer', {
      targetSocketId: senderId,
      answer: pc.localDescription
    });
  } catch (err) {
    log(`Error processing incoming offer: ${err.message}`, 'error');
  }
});

// Handle incoming WebRTC SDP Answer
socket.on('answer', async (data) => {
  const senderId = data.senderSocketId || data.senderId;
  const answer = data.answer;
  log(`Received remote WebRTC SDP Answer from peer ${senderId}`, 'signal');
  
  const pc = peerConnections[senderId];
  if (pc) {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      log(`Remote answer session established with peer ${senderId}`, 'success');
    } catch (err) {
      log(`Error assigning remote answer: ${err.message}`, 'error');
    }
  }
});

// Handle incoming remote ICE Candidate details
socket.on('ice-candidate', async (data) => {
  const senderId = data.senderSocketId || data.senderId;
  const candidate = data.candidate;
  const pc = peerConnections[senderId];
  if (pc) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      log(`Error adding ICE Candidate: ${err.message}`, 'error');
    }
  }
});

// Handle new remote peer joining after us
socket.on('user-connected', (data) => {
  log(`Peer connected: ${data.userId} (${data.socketId})`, 'system');
  peerCountDisplay.innerText = Object.keys(peerConnections).length + 1;
});

// Handle remote peer leaving the workspace
socket.on('user-disconnected', (data) => {
  log(`Peer disconnected: ${data.userId || data.socketId}`, 'warning');
  removePeerConnection(data.socketId);
});

// Clean up peer resources
function removePeerConnection(socketId) {
  if (peerConnections[socketId]) {
    peerConnections[socketId].close();
    delete peerConnections[socketId];
    log(`Cleanly dismantled connection context for peer ${socketId}`, 'system');
  }

  // Update peer count representation in terminal
  const currentCount = Math.max(0, parseInt(peerCountDisplay.innerText) - 1);
  peerCountDisplay.innerText = currentCount;

  if (Object.keys(peerConnections).length === 0) {
    remoteVideo.srcObject = null;
    remotePlaceholder.classList.remove('opacity-0');
    remotePlaceholder.classList.remove('pointer-events-none');
    remoteStatusTxt.innerText = 'Awaiting Peer Connection...';
    remoteUserLabel.innerText = 'PEER FEED - OFFLINE';
    remoteIndicator.className = 'inline-flex h-2 w-2 rounded-full bg-neutral-600';
  }
}

// Leave call and reset entire context
function cleanupAllCalls() {
  Object.keys(peerConnections).forEach((id) => {
    removePeerConnection(id);
  });

  remoteVideo.srcObject = null;
  remotePlaceholder.classList.remove('opacity-0');
  remotePlaceholder.classList.remove('pointer-events-none');
  remoteStatusTxt.innerText = 'Awaiting Peer Connection...';
  remoteUserLabel.innerText = 'PEER FEED - OFFLINE';
  remoteIndicator.className = 'inline-flex h-2 w-2 rounded-full bg-neutral-600';

  // Restore configuration layout input forms
  roomIdInput.disabled = false;
  userIdInput.disabled = false;
  joinBtn.disabled = false;
  joinBtn.classList.remove('opacity-50');

  btnLeaveCall.disabled = true;

  activeRoom = null;
  peerCountDisplay.innerText = '0';
  
  log('Call Canvas safely disconnected. Ready to join a new room.', 'success');
}

btnLeaveCall.addEventListener('click', () => {
  log('Voluntarily disconnecting from the active room node...', 'warning');
  socket.emit('leave-room', { roomId: activeRoom });
  cleanupAllCalls();
});

// Audio/Video hardware toggle controllers
let micActive = true;
btnToggleMic.addEventListener('click', () => {
  if (localStream) {
    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length > 0) {
      micActive = !micActive;
      audioTracks.forEach((track) => {
        track.enabled = micActive;
      });
      
      // Update UI button state and text dynamically
      if (micActive) {
        btnToggleMic.classList.remove('bg-rose-600/20', 'text-rose-400');
        btnToggleMic.classList.add('bg-neutral-800', 'text-neutral-300');
        btnToggleMic.querySelector('span').innerText = 'Mute Audio';
      } else {
        btnToggleMic.classList.add('bg-rose-600/20', 'text-rose-400');
        btnToggleMic.classList.remove('bg-neutral-800', 'text-neutral-300');
        btnToggleMic.querySelector('span').innerText = 'Unmute Audio';
      }
      log(`Microphone hardware status set to: ${micActive ? 'Active (Unmuted)' : 'Muted'}`, 'system');
    } else {
      log('No active audio tracks detected on this device.', 'warning');
    }
  }
});

let videoActive = true;
btnToggleVideo.addEventListener('click', () => {
  if (localStream) {
    const videoTracks = localStream.getVideoTracks();
    if (videoTracks.length > 0) {
      videoActive = !videoActive;
      videoTracks.forEach((track) => {
        track.enabled = videoActive;
      });
      
      // Update UI button state, text, and local video overlay placeholder
      if (videoActive) {
        btnToggleVideo.classList.remove('bg-rose-600/20', 'text-rose-400');
        btnToggleVideo.classList.add('bg-neutral-800', 'text-neutral-300');
        btnToggleVideo.querySelector('span').innerText = 'Disable Feed';
        
        localPlaceholder.classList.add('opacity-0');
        localPlaceholder.classList.add('pointer-events-none');
      } else {
        btnToggleVideo.classList.add('bg-rose-600/20', 'text-rose-400');
        btnToggleVideo.classList.remove('bg-neutral-800', 'text-neutral-300');
        btnToggleVideo.querySelector('span').innerText = 'Enable Feed';
        
        localPlaceholder.classList.remove('opacity-0');
        localPlaceholder.classList.remove('pointer-events-none');
      }
      log(`Video camera state set to: ${videoActive ? 'Enabled' : 'Disabled'}`, 'system');
    } else {
      log('No active video tracks detected on this device.', 'warning');
    }
  }
});

// Full-screen and Immersive Focus mode for Remote Video Container
const btnMaximizeRemote = document.getElementById('btn-maximize-remote');
const remoteContainer = document.getElementById('remote-container');
let isMaximized = false;

function toggleMaximize() {
  if (!remoteContainer || !btnMaximizeRemote) return;
  
  const maxIcon = btnMaximizeRemote.querySelector('.maximize-icon');
  const minIcon = btnMaximizeRemote.querySelector('.minimize-icon');
  
  isMaximized = !isMaximized;
  
  if (isMaximized) {
    // Enter immersive fixed fullscreen overlay
    remoteContainer.classList.add('fixed', 'inset-0', 'z-[100]', 'w-screen', 'h-screen', 'rounded-none', 'border-0');
    remoteContainer.classList.remove('rounded-3xl', 'aspect-[4/3]');
    if (maxIcon) maxIcon.classList.add('hidden');
    if (minIcon) minIcon.classList.remove('hidden');
    log('Immersive Remote Video viewport maximized.', 'success');
    
    // Attempt standard browser HTML5 requestFullscreen on the container
    try {
      if (remoteContainer.requestFullscreen) {
        remoteContainer.requestFullscreen().catch((err) => {
          console.warn("Native fullscreen blocked or restricted in sandbox/iframe:", err);
        });
      } else if (remoteContainer.webkitRequestFullscreen) {
        remoteContainer.webkitRequestFullscreen();
      }
    } catch (e) {
      console.warn("Native fullscreen APIs unavailable in current runtime:", e);
    }
  } else {
    // Exit immersive focus mode
    remoteContainer.classList.remove('fixed', 'inset-0', 'z-[100]', 'w-screen', 'h-screen', 'rounded-none', 'border-0');
    remoteContainer.classList.add('rounded-3xl', 'aspect-[4/3]');
    if (maxIcon) maxIcon.classList.remove('hidden');
    if (minIcon) minIcon.classList.add('hidden');
    log('Immersive Remote Video viewport restored.', 'system');
    
    // Exit standard browser HTML5 fullscreen
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      }
    } catch (e) {
      console.warn("Native exitFullscreen failed:", e);
    }
  }
}

if (btnMaximizeRemote) {
  btnMaximizeRemote.addEventListener('click', toggleMaximize);
}

// Keep local state in sync if user presses browser native escape key or standard window controls
const syncFullscreenState = () => {
  if (!btnMaximizeRemote || !remoteContainer) return;
  const isCurrentlyFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
  
  // If native state doesn't match our in-app maximizes state (e.g. exit on Esc key)
  if (!isCurrentlyFullscreen && isMaximized) {
    isMaximized = false;
    remoteContainer.classList.remove('fixed', 'inset-0', 'z-[100]', 'w-screen', 'h-screen', 'rounded-none', 'border-0');
    remoteContainer.classList.add('rounded-3xl', 'aspect-[4/3]');
    
    const maxIcon = btnMaximizeRemote.querySelector('.maximize-icon');
    const minIcon = btnMaximizeRemote.querySelector('.minimize-icon');
    if (maxIcon && minIcon) {
      maxIcon.classList.remove('hidden');
      minIcon.classList.add('hidden');
    }
    log('Immersive Remote Video viewport restored.', 'system');
  }
};

document.addEventListener('fullscreenchange', syncFullscreenState);
document.addEventListener('webkitfullscreenchange', syncFullscreenState);

log('Workspace loaded cleanly. WebRTC elements prepared.', 'success');
