import { WebSocket } from 'ws';
import { getSocketIO } from './signalingServer';

interface ClientMetadata {
  roomId: string;
  speaker: string;
  userId: string;
}

/**
 * Node.js Streaming Transcription Utility.
 * Establishes a continuous pipe from the client PCM stream to Deepgram Live (or mock transcription service if no API key is present).
 */
export function initializeAudioTranscriber(clientWs: WebSocket, req: any) {
  console.log('[AudioTranscriber] Client connected for live PCM stream.');

  const apiKey = process.env.DEEPGRAM_API_KEY;
  let transcriptionWs: WebSocket | null = null;
  let isConnectedToProvider = false;
  
  // Default metadata associated with the stream connection
  const clientMetadata: ClientMetadata = {
    roomId: 'real_estate_proposal_review_group',
    speaker: 'Christina Mant',
    userId: 'p2' // Defaults to Christina Mant
  };

  // Helper to safely broadcast back to Socket.io clients
  const broadcastTranscript = (text: string, confidence: number, isFinal: boolean) => {
    const io = getSocketIO();
    if (!io) return;

    const payload = {
      sender: clientMetadata.speaker,
      userId: clientMetadata.userId,
      text: text,
      confidence: confidence,
      isFinal: isFinal,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      roomId: clientMetadata.roomId
    };

    console.log(`[AudioTranscriber] Emitting live-transcript-chunk: "${text}" (Final: ${isFinal})`);
    // Broadcast to the specific meeting room
    io.to(clientMetadata.roomId).emit('live-transcript-chunk', payload);
  };

  if (apiKey && apiKey !== 'MY_DEEPGRAM_API_KEY') {
    console.log('[AudioTranscriber] Deepgram API key detected. Connecting to Deepgram Live...');
    
    // Connect to Deepgram Nova-2 streaming transcription
    const deepgramUrl = 'wss://api.deepgram.com/v1/listen?model=nova-2&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&utterance_end_ms=1000&vad_turn_complete_delay_ms=500';
    
    transcriptionWs = new WebSocket(deepgramUrl, {
      headers: {
        Authorization: `Token ${apiKey}`
      }
    });

    transcriptionWs.on('open', () => {
      console.log('[AudioTranscriber] Connected to Deepgram Live Transcription Service.');
      isConnectedToProvider = true;
    });

    transcriptionWs.on('message', (data) => {
      try {
        const response = JSON.parse(data.toString());
        const transcript = response.channel?.alternatives?.[0]?.transcript;
        const confidence = response.channel?.alternatives?.[0]?.confidence || 1.0;
        const isFinal = response.is_final || response.speech_final || false;

        if (transcript && transcript.trim()) {
          broadcastTranscript(transcript.trim(), confidence, isFinal);
        }
      } catch (err: any) {
        console.error('[AudioTranscriber] Error parsing Deepgram message:', err.message);
      }
    });

    transcriptionWs.on('close', (code, reason) => {
      console.log(`[AudioTranscriber] Deepgram Live closed connection. Code: ${code}, Reason: ${reason}`);
      isConnectedToProvider = false;
    });

    transcriptionWs.on('error', (err) => {
      console.error('[AudioTranscriber] Deepgram Live WebSocket error:', err.message);
    });

  } else {
    console.log('[AudioTranscriber] Deepgram API key missing or default. Operating in High-Fidelity Mock Stream Mode.');
    
    // Simulate speech-to-text feedback on raw audio buffers
    let mockSpeakInterval: NodeJS.Timeout | null = null;
    let speakStep = 0;

    const mockConversations = [
      { text: "Thanks for sending all those completed proposals through.", isFinal: false },
      { text: "Thanks for sending all those completed proposals through – we've been really happy.", isFinal: true },
      { text: "We must change strategy to boost revenue this month.", isFinal: false },
      { text: "We must change strategy to boost revenue this month. I've sent the deck through chat.", isFinal: true },
      { text: "Let's check the financial sheets on Slide 4 first! 📈", isFinal: true }
    ];

    clientWs.on('message', (data, isBinary) => {
      if (isBinary) {
        // When client sends raw PCM audio bytes, start generating mock transcripts on interval if not already active
        if (!mockSpeakInterval) {
          console.log('[AudioTranscriber] Received client PCM binary audio bytes. Activating simulation...');
          mockSpeakInterval = setInterval(() => {
            const currentItem = mockConversations[speakStep % mockConversations.length];
            broadcastTranscript(currentItem.text, 0.98, currentItem.isFinal);
            
            if (currentItem.isFinal) {
              speakStep++;
            }
          }, 3500);
        }
      }
    });

    clientWs.on('close', () => {
      if (mockSpeakInterval) {
        clearInterval(mockSpeakInterval);
        mockSpeakInterval = null;
      }
    });
  }

  // Handle client browser communications
  clientWs.on('message', (message, isBinary) => {
    if (isBinary) {
      // Pipe raw binary PCM chunk straight to the provider with low latency
      if (transcriptionWs && isConnectedToProvider && transcriptionWs.readyState === WebSocket.OPEN) {
        transcriptionWs.send(message);
      }
    } else {
      // Parse client JSON config/meta frames if sent
      try {
        const metadata = JSON.parse(message.toString());
        if (metadata.type === 'config') {
          if (metadata.roomId) clientMetadata.roomId = metadata.roomId;
          if (metadata.speaker) clientMetadata.speaker = metadata.speaker;
          if (metadata.userId) clientMetadata.userId = metadata.userId;
          console.log('[AudioTranscriber] Client updated stream metadata:', clientMetadata);
        }
      } catch (e) {
        // ignore malformed text messages
      }
    }
  });

  clientWs.on('close', () => {
    console.log('[AudioTranscriber] Client stream WebSocket connection closed.');
    if (transcriptionWs && transcriptionWs.readyState === WebSocket.OPEN) {
      // Send close frame to Deepgram
      transcriptionWs.send(JSON.stringify({ type: 'CloseStream' }));
      transcriptionWs.close();
    }
  });

  clientWs.on('error', (err) => {
    console.error('[AudioTranscriber] Client stream WebSocket error:', err.message);
  });
}
