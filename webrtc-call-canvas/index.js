import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';

// Setup modern __dirname reference in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// Initialize Socket.io with open CORS configuration for developer flexibility
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Serve all static assets from the public folder
app.use(express.static(path.join(__dirname, 'public')));

// Root route placeholder linking to the dynamic WebRTC call page
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    activeConnections: io.engine.clientsCount,
    timestamp: new Date().toISOString()
  });
});

// Socket.io connection state & room orchestration handler
io.on('connection', (socket) => {
  console.log(`\x1b[32m[Socket Connection]\x1b[0m Client connected: ${socket.id}`);

  // Track room assignment for active socket session
  let currentRoom = null;
  let clientUserId = null;

  // Custom event: join-room
  socket.on('join-room', (data) => {
    const { roomId, userId } = data || {};
    
    if (!roomId) {
      console.warn(`\x1b[31m[Socket join-room Rejected]\x1b[0m No roomId provided by socket ${socket.id}`);
      socket.emit('error', { message: 'A valid roomId is required to join a call.' });
      return;
    }

    clientUserId = userId || `User_${Math.random().toString(36).substr(2, 5)}`;
    currentRoom = roomId;

    // Join the Socket.io room segment
    socket.join(roomId);
    console.log(`\x1b[36m[Room Join]\x1b[0m Socket ${socket.id} (${clientUserId}) joined room ID: ${roomId}`);

    // Broadcast user-connected event to other peers in the room
    socket.to(roomId).emit('user-connected', {
      socketId: socket.id,
      userId: clientUserId
    });

    // Provide the newly joined client with a list of other active peers in that room
    const clientsInRoom = io.sockets.adapter.rooms.get(roomId);
    const peers = [];
    if (clientsInRoom) {
      for (const clientId of clientsInRoom) {
        if (clientId !== socket.id) {
          peers.push(clientId);
        }
      }
    }

    // Acknowledge successful room subscription
    socket.emit('room-joined', {
      roomId,
      userId: clientUserId,
      peers
    });
  });

  // Relay WebRTC Handshake: SDP Offer
  socket.on('offer', (data) => {
    const { targetId, offer } = data || {};
    if (targetId && offer && currentRoom) {
      console.log(`\x1b[34m[WebRTC Signal]\x1b[0m Relaying SDP Offer from ${socket.id} to peer ${targetId}`);
      socket.to(targetId).emit('offer', {
        senderId: socket.id,
        offer
      });
    }
  });

  // Relay WebRTC Handshake: SDP Answer
  socket.on('answer', (data) => {
    const { targetId, answer } = data || {};
    if (targetId && answer && currentRoom) {
      console.log(`\x1b[34m[WebRTC Signal]\x1b[0m Relaying SDP Answer from ${socket.id} to peer ${targetId}`);
      socket.to(targetId).emit('answer', {
        senderId: socket.id,
        answer
      });
    }
  });

  // Relay WebRTC Handshake: ICE Candidates
  socket.on('ice-candidate', (data) => {
    const { targetId, candidate } = data || {};
    if (targetId && candidate && currentRoom) {
      socket.to(targetId).emit('ice-candidate', {
        senderId: socket.id,
        candidate
      });
    }
  });

  // Handle sudden client connection termination
  socket.on('disconnect', () => {
    console.log(`\x1b[33m[Socket Disconnected]\x1b[0m Client closed socket session: ${socket.id}`);
    if (currentRoom) {
      // Notify remaining peers in the room about client exit
      socket.to(currentRoom).emit('user-disconnected', {
        socketId: socket.id,
        userId: clientUserId
      });
    }
  });
});

// Launch the HTTP server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 WebRTC Call Canvas server listening on http://localhost:${PORT}`);
  console.log(`📁 Serving static public client from: ${path.join(__dirname, 'public')}`);
  console.log(`======================================================\n`);
});
