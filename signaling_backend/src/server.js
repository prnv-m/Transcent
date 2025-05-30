// signaling-backend/src/server.js
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

const io = new Server(server, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST'],
  },
});

// To store room information. A simple object mapping roomId to a Set of socketIds.
// For a more robust solution, you might use a Map or a dedicated data structure.
const rooms = {};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Event for a user to join a room
  socket.on('join-room', (roomId, callback) => {
    console.log(`User ${socket.id} attempting to join room ${roomId}`);

    // Leave any previous rooms (optional, depends on your app logic)
    // For simplicity, we assume a user is in one room at a time for this signaling
    Object.keys(socket.rooms).forEach(room => {
      if (room !== socket.id) { // socket.io automatically joins a room with the socket's ID
        socket.leave(room);
      }
    });

    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = new Set();
    }
    rooms[roomId].add(socket.id);
    socket.roomId = roomId; // Store roomId on the socket object for convenience

    // Notify other users in the room that a new peer has joined
    // (excluding the sender themselves)
    socket.to(roomId).emit('peer-joined', { peerId: socket.id });

    console.log(`User ${socket.id} joined room ${roomId}. Users in room: ${Array.from(rooms[roomId])}`);

    // Send back the list of other peers already in the room to the new joiner
    const otherPeers = Array.from(rooms[roomId]).filter(id => id !== socket.id);
    if (callback && typeof callback === 'function') {
      callback({ success: true, peers: otherPeers });
    }
  });

  // Relay offer to a specific peer or all others in the room
  socket.on('offer', (data) => {
    const { sdp, targetSocketId, roomId } = data;
    if (!roomId) {
      console.error(`Offer from ${socket.id} missing roomId`);
      return;
    }
    console.log(`Received offer from ${socket.id} for room ${roomId}, target: ${targetSocketId || 'all others'}`);

    if (targetSocketId) {
      // Send offer to a specific target peer in the room
      io.to(targetSocketId).emit('offer', { sdp, senderSocketId: socket.id });
    } else {
      // If no target, send to all others in the room (useful for initial connection to multiple peers)
      socket.to(roomId).except(socket.id).emit('offer', { sdp, senderSocketId: socket.id });
    }
  });

  // Relay answer to a specific peer
  socket.on('answer', (data) => {
    const { sdp, targetSocketId, roomId } = data; // roomId might be useful for context/validation
    if (!targetSocketId) {
      console.error(`Answer from ${socket.id} missing targetSocketId`);
      return;
    }
    console.log(`Received answer from ${socket.id} to ${targetSocketId}`);
    io.to(targetSocketId).emit('answer', { sdp, senderSocketId: socket.id });
  });

  // Relay ICE candidate to a specific peer or all others in the room
  socket.on('ice-candidate', (data) => {
    const { candidate, targetSocketId, roomId } = data;
    if (!roomId) {
      console.error(`ICE candidate from ${socket.id} missing roomId`);
      return;
    }
    // console.log(`Received ICE candidate from ${socket.id} for room ${roomId}, target: ${targetSocketId || 'all others'}`);

    if (targetSocketId) {
      io.to(targetSocketId).emit('ice-candidate', { candidate, senderSocketId: socket.id });
    } else {
      socket.to(roomId).except(socket.id).emit('ice-candidate', { candidate, senderSocketId: socket.id });
    }
});


  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    const roomId = socket.roomId; // Retrieve the room the user was in

    if (roomId && rooms[roomId]) {
      rooms[roomId].delete(socket.id);
      // Notify other users in the room that this peer has left
      socket.to(roomId).emit('peer-left', { peerId: socket.id });

      if (rooms[roomId].size === 0) {
        delete rooms[roomId];
        console.log(`Room ${roomId} is now empty and has been removed.`);
      } else {
        console.log(`User ${socket.id} left room ${roomId}. Users remaining: ${Array.from(rooms[roomId])}`);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Signaling server listening on port ${PORT}`);
  console.log(`CORS enabled for origin: ${CORS_ORIGIN}`);
});