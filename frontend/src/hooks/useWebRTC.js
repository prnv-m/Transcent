import { useState, useEffect, useRef, useCallback } from 'react';
import socket from '../utils/socket'; // Your Socket.IO client instance

const PEER_CONNECTION_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    // You can add TURN servers here if needed
  ],
};

const DATA_CHANNEL_LABEL = 'subtitles';

const useWebRTC = (roomId, onDataChannelMessage, onRemoteStreamChange) => {
  const [localStream, setLocalStream] = useState(null);
  const localStreamRef = useRef(null);

  const [remoteStreams, setRemoteStreams] = useState({});
  const peerConnectionsRef = useRef({});
  const dataChannelsRef = useRef({});

  const [isSocketConnected, setIsSocketConnected] = useState(socket.connected);
  const [joinedRoom, setJoinedRoom] = useState(false);
  const hasAttemptedJoinRef = useRef(false); // Prevents re-emitting join-room excessively

  // Helper to manage data channel event listeners
  const setupDataChannelEvents = useCallback((dc, peerId) => {
    dc.onopen = () => console.log(`Data channel with ${peerId} opened.`);
    dc.onclose = () => console.log(`Data channel with ${peerId} closed.`);
    dc.onmessage = (event) => {
      if (onDataChannelMessage) {
        try {
          const message = JSON.parse(event.data);
          onDataChannelMessage(peerId, message);
        } catch (error) {
          console.error("Failed to parse DC message:", error, "Raw:", event.data);
          onDataChannelMessage(peerId, { rawText: event.data });
        }
      }
    };
    dc.onerror = (error) => console.error(`Data channel error with ${peerId}:`, error);
    dataChannelsRef.current[peerId] = dc;
  }, [onDataChannelMessage]); // Depends on onDataChannelMessage from props

  // Creates or retrieves a peer connection
  const createPeerConnection = useCallback(async (peerId, isInitiator) => {
    if (peerConnectionsRef.current[peerId]) {
      // console.warn(`Peer connection for ${peerId} already exists.`);
      return peerConnectionsRef.current[peerId];
    }
    console.log(`Creating PeerConnection for ${peerId}. Initiator: ${isInitiator}`);
    const pc = new RTCPeerConnection(PEER_CONNECTION_CONFIG);
    peerConnectionsRef.current[peerId] = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', {
          candidate: event.candidate,
          targetSocketId: peerId,
          roomId: roomId,
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      // console.log(`ICE state change for ${peerId}: ${state}`);
      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        console.warn(`ICE connection to ${peerId} is ${state}.`);
        // Consider cleanup or retry logic here for robustness
      }
    };

    pc.ontrack = (event) => {
      console.log(`Track received from ${peerId}:`, event.streams[0]);
      if (event.streams && event.streams[0]) {
        setRemoteStreams(prev => ({ ...prev, [peerId]: event.streams[0] }));
        if (onRemoteStreamChange) {
          onRemoteStreamChange(peerId, event.streams[0]);
        }
      }
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
    } else {
      console.warn("Local stream not available for createPeerConnection with", peerId);
    }

    if (isInitiator) {
      const dc = pc.createDataChannel(DATA_CHANNEL_LABEL, { reliable: true });
      setupDataChannelEvents(dc, peerId);
    } else {
      pc.ondatachannel = (event) => {
        if (event.channel.label === DATA_CHANNEL_LABEL) {
          setupDataChannelEvents(event.channel, peerId);
        }
      };
    }
    return pc;
  }, [roomId, setupDataChannelEvents, onRemoteStreamChange]); // Depends on props and internal callbacks

  // Sends an offer to a peer
  const sendOffer = useCallback(async (peerId) => {
    const pc = peerConnectionsRef.current[peerId];
    if (!pc) {
      console.error(`No PC for ${peerId} to send offer.`);
      return;
    }
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('offer', {
        sdp: pc.localDescription,
        targetSocketId: peerId,
        roomId: roomId,
      });
    } catch (error) {
      console.error(`Error creating/sending offer to ${peerId}:`, error);
    }
  }, [roomId]); // Depends on roomId

  // Effect for initializing local media
  useEffect(() => {
    let isMounted = true;
    const initMedia = async () => {
      try {
        console.log("Requesting local media (WebRTC)...");
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        if (isMounted) {
          setLocalStream(stream);
          localStreamRef.current = stream;
          console.log("Local media stream acquired (WebRTC).");
        } else {
            stream.getTracks().forEach(track => track.stop()); // Stop if unmounted during async
        }
      } catch (error) {
        console.error('Failed to get local media stream:', error);
      }
    };
    initMedia();

    return () => {
      isMounted = false;
      if (localStreamRef.current) {
        console.log("Stopping local media stream (WebRTC).");
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
        setLocalStream(null); // Also clear state
      }
    };
  }, []); // Runs once on mount

  // Main effect for Socket.IO interactions and WebRTC signaling
  useEffect(() => {
    // Guard: Only proceed if essential prerequisites are met
    if (!socket || !roomId || !localStreamRef.current) {
      if (!localStreamRef.current) console.log("useWebRTC (main effect): Waiting for local stream.");
      // If these aren't ready, we can't join, so reset join attempt flags
      hasAttemptedJoinRef.current = false;
      // if (joinedRoom) setJoinedRoom(false); // Reset if somehow true without prerequisites
      return;
    }

    // --- Logic to handle joining the room ---
    const performJoinRoom = () => {
      if (hasAttemptedJoinRef.current && joinedRoom) { // Already joined and confirmed
        console.log("useWebRTC: Already successfully joined room.");
        return;
      }
      if (hasAttemptedJoinRef.current && !joinedRoom) { // Attempted but not yet confirmed (e.g. callback pending)
        console.log("useWebRTC: Join room attempt in progress.");
        return;
      }

      console.log(`useWebRTC: Initiating join room sequence for ${roomId}.`);
      hasAttemptedJoinRef.current = true; // Mark that we are attempting to join

      socket.emit('join-room', roomId, (response) => {
        if (response && response.success) {
          console.log(`Successfully joined room ${roomId}. Peers:`, response.peers);
          setJoinedRoom(true); // Confirm joined state

          response.peers.forEach(async (peerId) => {
            if (peerId !== socket.id) {
              const pc = await createPeerConnection(peerId, true); // I am initiator
              if (pc) await sendOffer(peerId);
            }
          });
        } else {
          console.error('Failed to join room:', response);
          hasAttemptedJoinRef.current = false; // Reset to allow another attempt
          setJoinedRoom(false);
        }
      });
    };

    // --- Socket event handlers ---
    const onSocketConnect = () => {
      console.log("useWebRTC: Socket connected event.");
      setIsSocketConnected(true);
      // If stream is ready and we haven't successfully joined, attempt to join
      if (localStreamRef.current && !joinedRoom) {
        performJoinRoom();
      }
    };

    const onSocketDisconnect = () => {
      console.log("useWebRTC: Socket disconnected.");
      setIsSocketConnected(false);
      setJoinedRoom(false); // No longer in the room
      hasAttemptedJoinRef.current = false; // Allow re-join on next connection
    };
    
    const onPeerJoined = async ({ peerId }) => {
      if (peerId === socket.id) return;
      console.log(`Peer ${peerId} joined room ${roomId}.`);
      // As per current server logic, the new peer initiates offers.
      // This client (if already in room) will wait for an offer.
      // We can preemptively create a PeerConnection object for them.
      // await createPeerConnection(peerId, false); // false = not initiator
    };

    const onOfferReceived = async ({ sdp, senderSocketId }) => {
      if (senderSocketId === socket.id) return;
      console.log(`Received offer from ${senderSocketId}`);
      const pc = await createPeerConnection(senderSocketId, false); // I am not initiator
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('answer', {
          sdp: pc.localDescription,
          targetSocketId: senderSocketId,
          roomId: roomId,
        });
      } catch (error) {
        console.error(`Error handling offer from ${senderSocketId}:`, error);
      }
    };

    const onAnswerReceived = async ({ sdp, senderSocketId }) => {
      if (senderSocketId === socket.id) return;
      console.log(`Received answer from ${senderSocketId}`);
      const pc = peerConnectionsRef.current[senderSocketId];
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        } catch (error) {
          console.error(`Error setting remote desc from ${senderSocketId}:`, error);
        }
      } else {
        console.warn(`No PC for ${senderSocketId} to set answer.`);
      }
    };

    const onIceCandidateReceived = async ({ candidate, senderSocketId }) => {
      if (senderSocketId === socket.id) return;
      const pc = peerConnectionsRef.current[senderSocketId];
      if (pc && candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
          // console.error(`Error adding ICE from ${senderSocketId}:`, error);
        }
      } else if (!pc) {
        // console.warn(`No PC for ${senderSocketId} to add ICE, buffering might be needed.`);
      }
    };
    
    const onPeerLeft = ({ peerId }) => {
      if (peerId === socket.id) return;
      console.log(`Peer ${peerId} left room ${roomId}`);
      if (peerConnectionsRef.current[peerId]) {
        peerConnectionsRef.current[peerId].close();
        delete peerConnectionsRef.current[peerId];
      }
      if (dataChannelsRef.current[peerId]) {
        delete dataChannelsRef.current[peerId];
      }
      setRemoteStreams(prev => {
        const newStreams = { ...prev };
        delete newStreams[peerId];
        return newStreams;
      });
      if (onRemoteStreamChange) {
        onRemoteStreamChange(peerId, null); // Signal removal
      }
      // If all peers leave, should we reset `joinedRoom` and `hasAttemptedJoinRef`?
      // Depends on desired app behavior. For now, only socket disconnect does full reset.
    };

    // --- Initial connection check and listener setup ---
    if (socket.connected) {
      onSocketConnect(); // If already connected, run the connect logic
    }
    socket.on('connect', onSocketConnect);
    socket.on('disconnect', onSocketDisconnect);
    socket.on('peer-joined', onPeerJoined);
    socket.on('offer', onOfferReceived);
    socket.on('answer', onAnswerReceived);
    socket.on('ice-candidate', onIceCandidateReceived);
    socket.on('peer-left', onPeerLeft);

    // --- Cleanup function ---
    return () => {
      console.log("Cleaning up useWebRTC main useEffect for roomId:", roomId);
      socket.off('connect', onSocketConnect);
      socket.off('disconnect', onSocketDisconnect);
      socket.off('peer-joined', onPeerJoined);
      socket.off('offer', onOfferReceived);
      socket.off('answer', onAnswerReceived);
      socket.off('ice-candidate', onIceCandidateReceived);
      socket.off('peer-left', onPeerLeft);

      Object.values(peerConnectionsRef.current).forEach(pc => pc.close());
      peerConnectionsRef.current = {};
      dataChannelsRef.current = {};
      setRemoteStreams({});
      
      // Reset states that indicate connection/room status
      if (joinedRoom) setJoinedRoom(false);
      hasAttemptedJoinRef.current = false;
      // Do NOT reset isSocketConnected here, as the socket itself might still be connected
      // if only the component unmounts or roomId changes.
    };
  }, [
    roomId,
    localStreamRef.current, // Re-run if localStream becomes available
    // Callbacks from App.jsx (ensure they are stable via useCallback in App.jsx)
    onDataChannelMessage, 
    onRemoteStreamChange,
    // Memoized functions within useWebRTC
    createPeerConnection, 
    sendOffer,
    // Note: `joinedRoom` is intentionally NOT in this dependency array.
    // Its changes are handled internally by the logic within the effect and its handlers.
    // Adding it could re-trigger the entire listener setup/teardown unnecessarily.
  ]);

  // Function to send data to all connected peers
  const sendDataToAllPeers = useCallback((data) => {
    const jsonData = JSON.stringify(data);
    Object.values(dataChannelsRef.current).forEach(dc => {
      if (dc && dc.readyState === 'open') {
        try {
          dc.send(jsonData);
        } catch (error) {
          console.error("Error sending data via DC:", error);
        }
      }
    });
  }, []); // No dependencies, dataChannelsRef.current is a ref

  return {
    localStream,
    remoteStreams,
    sendDataToAllPeers,
    isSocketConnected,
    joinedRoom, // Expose joinedRoom state
  };
};

export default useWebRTC;