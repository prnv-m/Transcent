// frontend/src/hooks/useWebRTC.js
import { useState, useEffect, useRef, useCallback } from 'react';
import socket from '../utils/socket'; // Your Socket.IO client instance

const PEER_CONNECTION_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    // Consider adding your own TURN server here for production
    // {
    //   urls: 'turn:your.turn.server.com:3478',
    //   username: 'your_username',
    //   credential: 'your_password',
    // },
  ],
};

const DATA_CHANNEL_LABEL = 'subtitles';

const useWebRTC = (passedRoomId, onDataChannelMessage, onRemoteStreamChange) => {
  const [localStream, setLocalStream] = useState(null);
  const localStreamRef = useRef(null); // To hold the stream object without triggering re-renders on every assignment

  // Default to audio muted, video OFF for privacy and user control
  const [isAudioMuted, setIsAudioMuted] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);

  const [remoteStreams, setRemoteStreams] = useState({}); // { [peerId]: MediaStream }
  const peerConnectionsRef = useRef({}); // { [peerId]: RTCPeerConnection }
  const dataChannelsRef = useRef({});   // { [peerId]: RTCDataChannel }

  const [isSocketConnected, setIsSocketConnected] = useState(socket.connected);
  const [joinedRoom, setJoinedRoom] = useState(false);
  const hasAttemptedJoinRef = useRef(false); // To prevent redundant join attempts

  // Setup event listeners for an RTCDataChannel
  const setupDataChannelEvents = useCallback((dc, peerId) => {
    dc.onopen = () => console.log(`useWebRTC: Data channel with ${peerId} opened.`);
    dc.onclose = () => console.log(`useWebRTC: Data channel with ${peerId} closed.`);
    dc.onmessage = (event) => {
      if (onDataChannelMessage) {
        try {
          const message = JSON.parse(event.data);
          onDataChannelMessage(peerId, message);
        } catch (error) {
          console.error("useWebRTC: Failed to parse DC message:", error, "Raw data:", event.data);
          onDataChannelMessage(peerId, { type: 'error', text: 'Received malformed data' });
        }
      }
    };
    dc.onerror = (error) => console.error(`useWebRTC: Data channel error with ${peerId}:`, error);
    dataChannelsRef.current[peerId] = dc;
  }, [onDataChannelMessage]);

  // Create or get an existing RTCPeerConnection for a peer
  const createPeerConnection = useCallback(async (peerId, isInitiator) => {
    if (peerConnectionsRef.current[peerId]) {
      console.log(`useWebRTC: PeerConnection for ${peerId} already exists.`);
      return peerConnectionsRef.current[peerId];
    }

    console.log(`useWebRTC: Creating PeerConnection for ${peerId}. Is initiator: ${isInitiator}`);
    const pc = new RTCPeerConnection(PEER_CONNECTION_CONFIG);
    peerConnectionsRef.current[peerId] = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', {
          candidate: event.candidate,
          targetSocketId: peerId,
          roomId: passedRoomId,
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      console.log(`useWebRTC: ICE state change for ${peerId}: ${iceState}`);
      if (['failed', 'disconnected', 'closed'].includes(iceState)) {
        console.warn(`useWebRTC: ICE connection to ${peerId} is ${iceState}. Cleaning up...`);
        // Perform cleanup for this specific peer
        if (peerConnectionsRef.current[peerId]) {
            peerConnectionsRef.current[peerId].close();
            delete peerConnectionsRef.current[peerId];
        }
        if (dataChannelsRef.current[peerId]) {
            // Data channel might close itself, or you can explicitly close if open
            if(dataChannelsRef.current[peerId].readyState === 'open') {
                dataChannelsRef.current[peerId].close();
            }
            delete dataChannelsRef.current[peerId];
        }
        setRemoteStreams(prev => {
            const newStreams = { ...prev };
            delete newStreams[peerId];
            return newStreams;
        });
        if (onRemoteStreamChange) {
            onRemoteStreamChange(peerId, null); // Signal stream removal
        }
      }
    };

    pc.ontrack = (event) => {
      console.log(`useWebRTC: Track received from ${peerId}:`, event.streams[0]);
      if (event.streams && event.streams[0]) {
        setRemoteStreams(prev => ({ ...prev, [peerId]: event.streams[0] }));
        if (onRemoteStreamChange) {
          onRemoteStreamChange(peerId, event.streams[0]);
        }
      } else {
        console.warn(`useWebRTC: Track event from ${peerId} received without streams.`);
      }
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        try {
          pc.addTrack(track, localStreamRef.current);
        } catch (e) {
          console.error(`useWebRTC: Error adding track for ${peerId}:`, e);
        }
      });
    } else {
      console.warn("useWebRTC: Local stream not available when creating PeerConnection with", peerId);
    }

    if (isInitiator) {
      console.log(`useWebRTC: Creating data channel as initiator for ${peerId}`);
      const dc = pc.createDataChannel(DATA_CHANNEL_LABEL, { reliable: true });
      setupDataChannelEvents(dc, peerId);
    } else {
      pc.ondatachannel = (event) => {
        console.log(`useWebRTC: Data channel received from ${peerId}`);
        if (event.channel.label === DATA_CHANNEL_LABEL) {
          setupDataChannelEvents(event.channel, peerId);
        }
      };
    }
    return pc;
  }, [passedRoomId, setupDataChannelEvents, onRemoteStreamChange]); // localStreamRef.current is stable

  // Send an offer to a peer
  const sendOffer = useCallback(async (peerId) => {
    const pc = peerConnectionsRef.current[peerId];
    if (!pc) {
      console.error(`useWebRTC: No PeerConnection for ${peerId} to send offer.`);
      return;
    }
    try {
      console.log(`useWebRTC: Creating offer for ${peerId}`);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('offer', {
        sdp: pc.localDescription,
        targetSocketId: peerId,
        roomId: passedRoomId,
      });
      console.log(`useWebRTC: Offer sent to ${peerId}`);
    } catch (error) {
      console.error(`useWebRTC: Error creating/sending offer to ${peerId}:`, error);
    }
  }, [passedRoomId]);

  // Effect for initializing local media (microphone and camera)
  useEffect(() => {
    let isMounted = true;
    const initMedia = async () => {
      try {
        console.log("useWebRTC: Requesting local media access...");
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true // Request video, but control its 'enabled' state below
        });

        if (isMounted) {
          console.log("useWebRTC: Media stream acquired:", stream.id);
          // Apply initial desired states based on hook's state
          stream.getAudioTracks().forEach(track => {
            track.enabled = !isAudioMuted; // If isAudioMuted is true, track.enabled is false
            console.log(`  Initial Audio Track (${track.label || track.id}) enabled: ${track.enabled}`);
          });
          stream.getVideoTracks().forEach(track => {
            track.enabled = isVideoEnabled; // If isVideoEnabled is false, track.enabled is false
            console.log(`  Initial Video Track (${track.label || track.id}) enabled: ${track.enabled}`);
          });

          setLocalStream(stream);
          localStreamRef.current = stream;
        } else {
          console.log("useWebRTC: initMedia - component unmounted during media acquisition, stopping tracks.");
          stream.getTracks().forEach(track => track.stop());
        }
      } catch (error) {
        console.error('useWebRTC: Failed to get local media stream:', error);
        if (isMounted) {
          setLocalStream(null); // Ensure localStream is null on error to reflect failure
          // Optionally, set an error state here to inform the UI
        }
      }
    };

    initMedia();

    return () => {
      isMounted = false;
      if (localStreamRef.current) {
        console.log("useWebRTC: Cleaning up local media stream on component unmount.");
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
        // No need to setLocalStream(null) here as component is unmounting
      }
    };
  }, []); // Run once. isAudioMuted & isVideoEnabled are used for initial setup, not as reactive deps for re-acquiring stream.

  // Main effect for Socket.IO interactions and WebRTC signaling
  useEffect(() => {
    if (!socket || !passedRoomId || !localStreamRef.current) {
      console.log("useWebRTC: Waiting for prerequisites (socket, roomId, localStream).", {
          socketReady: !!socket,
          roomIdPresent: !!passedRoomId,
          localStreamPresent: !!localStreamRef.current,
      });
      hasAttemptedJoinRef.current = false;
      if (joinedRoom) setJoinedRoom(false);
      return;
    }

    const performJoinRoom = () => {
      if (hasAttemptedJoinRef.current && joinedRoom) {
        console.log("useWebRTC: Already successfully joined room.");
        return;
      }
      if (hasAttemptedJoinRef.current && !joinedRoom) {
        console.log("useWebRTC: Join room attempt already in progress.");
        return;
      }

      console.log(`useWebRTC: Initiating join room sequence for ${passedRoomId}.`);
      hasAttemptedJoinRef.current = true;
      setJoinedRoom(false); // Explicitly set to false before attempting

      socket.emit('join-room', passedRoomId, (response) => {
        if (!socket.connected) { // Check if socket disconnected during the callback
            console.warn("useWebRTC: Socket disconnected before join-room callback processed.");
            hasAttemptedJoinRef.current = false;
            setJoinedRoom(false);
            return;
        }
        if (response && response.success) {
          console.log(`useWebRTC: Successfully joined room ${passedRoomId}. Peers:`, response.peers);
          setJoinedRoom(true);
          response.peers.forEach(async (peerId) => {
            if (peerId !== socket.id) {
              const pc = await createPeerConnection(peerId, true); // This client initiates
              if (pc) await sendOffer(peerId);
            }
          });
        } else {
          console.error('useWebRTC: Failed to join room:', response ? response.message : 'No response or error from server.');
          hasAttemptedJoinRef.current = false;
          setJoinedRoom(false);
          // Optionally, inform UI about join failure
        }
      });
    };

    const onSocketConnect = () => {
      console.log("useWebRTC: Socket connected. ID:", socket.id);
      setIsSocketConnected(true);
      // Attempt to join room if all prerequisites are met and not already joined/attempting
      if (localStreamRef.current && passedRoomId && !joinedRoom && !hasAttemptedJoinRef.current) {
        performJoinRoom();
      }
    };

    const onSocketDisconnect = (reason) => {
      console.warn("useWebRTC: Socket disconnected.", reason);
      setIsSocketConnected(false);
      setJoinedRoom(false);
      hasAttemptedJoinRef.current = false;

      // Clean up all peer connections and remote streams
      console.log("useWebRTC: Cleaning up all peer connections due to socket disconnect.");
      Object.keys(peerConnectionsRef.current).forEach(peerId => {
        if (peerConnectionsRef.current[peerId]) {
          peerConnectionsRef.current[peerId].close();
        }
        if (dataChannelsRef.current[peerId]) {
          if(dataChannelsRef.current[peerId].readyState === 'open') {
            dataChannelsRef.current[peerId].close();
          }
        }
      });
      peerConnectionsRef.current = {};
      dataChannelsRef.current = {};
      setRemoteStreams({});
      // Inform RoomPage about all streams removed if onRemoteStreamChange handles multiple calls
      // Object.keys(remoteStreams).forEach(peerId => onRemoteStreamChange(peerId, null)); // If needed
    };

    const onOfferReceived = async ({ sdp, senderSocketId }) => {
      if (senderSocketId === socket.id || !localStreamRef.current) return;
      console.log(`useWebRTC: Received offer from ${senderSocketId}`);
      const pc = await createPeerConnection(senderSocketId, false); // This client receives offer
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        console.log(`useWebRTC: Creating answer for ${senderSocketId}`);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('answer', {
          sdp: pc.localDescription,
          targetSocketId: senderSocketId,
          roomId: passedRoomId,
        });
        console.log(`useWebRTC: Answer sent to ${senderSocketId}`);
      } catch (error) {
        console.error(`useWebRTC: Error handling offer from ${senderSocketId}:`, error);
      }
    };

    const onAnswerReceived = async ({ sdp, senderSocketId }) => {
      if (senderSocketId === socket.id) return;
      console.log(`useWebRTC: Received answer from ${senderSocketId}`);
      const pc = peerConnectionsRef.current[senderSocketId];
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          console.log(`useWebRTC: Remote description set for ${senderSocketId} from answer.`);
        } catch (error) {
          console.error(`useWebRTC: Error setting remote description for ${senderSocketId} from answer:`, error);
        }
      } else {
        console.warn(`useWebRTC: No PeerConnection found for ${senderSocketId} to set answer.`);
      }
    };

    const onIceCandidateReceived = async ({ candidate, senderSocketId }) => {
      if (senderSocketId === socket.id) return;
      const pc = peerConnectionsRef.current[senderSocketId];
      if (pc && candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
          // These errors are often minor and can be ignored if connection still establishes
          // console.warn(`useWebRTC: Error adding ICE candidate from ${senderSocketId}:`, error);
        }
      } else if (!pc) {
        // console.warn(`useWebRTC: No PeerConnection for ${senderSocketId} to add ICE candidate. Buffering might be needed if this happens often.`);
      }
    };

    const onPeerJoined = ({ peerId }) => {
      if (peerId === socket.id) return;
      console.log(`useWebRTC: Signaling server indicates peer ${peerId} joined room ${passedRoomId}.`);
      // Current logic: new peer initiates the offer. This client waits.
      // If this client was the first one and the new peer is joining, this client will send an offer
      // via the join-room callback logic. If this client joined later, it waits.
    };

    const onPeerLeft = ({ peerId }) => {
      if (peerId === socket.id) return;
      console.log(`useWebRTC: Peer ${peerId} left room ${passedRoomId}. Cleaning up.`);
      if (peerConnectionsRef.current[peerId]) {
        peerConnectionsRef.current[peerId].close();
        delete peerConnectionsRef.current[peerId];
      }
      if (dataChannelsRef.current[peerId]) {
        if(dataChannelsRef.current[peerId].readyState === 'open') {
            dataChannelsRef.current[peerId].close();
        }
        delete dataChannelsRef.current[peerId];
      }
      setRemoteStreams(prev => {
        const newStreams = { ...prev };
        delete newStreams[peerId];
        return newStreams;
      });
      if (onRemoteStreamChange) {
        onRemoteStreamChange(peerId, null); // Signal stream removal
      }
    };

    // Initial check and setup listeners
    if (socket.connected) {
      onSocketConnect();
    } else {
      setIsSocketConnected(false); // Ensure state reflects reality if not connected at hook init
      setJoinedRoom(false);
      hasAttemptedJoinRef.current = false;
    }

    socket.on('connect', onSocketConnect);
    socket.on('disconnect', onSocketDisconnect);
    socket.on('peer-joined', onPeerJoined);
    socket.on('offer', onOfferReceived);
    socket.on('answer', onAnswerReceived);
    socket.on('ice-candidate', onIceCandidateReceived);
    socket.on('peer-left', onPeerLeft);

    return () => {
      console.log("useWebRTC: Cleaning up main signaling useEffect for roomId:", passedRoomId);
      socket.off('connect', onSocketConnect);
      socket.off('disconnect', onSocketDisconnect);
      socket.off('peer-joined', onPeerJoined);
      socket.off('offer', onOfferReceived);
      socket.off('answer', onAnswerReceived);
      socket.off('ice-candidate', onIceCandidateReceived);
      socket.off('peer-left', onPeerLeft);

      // When roomId changes or component unmounts, ensure connections are closed
      // The onSocketDisconnect handler should also cover global disconnects.
      // This cleanup is more for when the component using the hook unmounts or `passedRoomId` changes.
      Object.keys(peerConnectionsRef.current).forEach(peerId => {
          if (peerConnectionsRef.current[peerId]) {
              peerConnectionsRef.current[peerId].close();
          }
          if (dataChannelsRef.current[peerId] && dataChannelsRef.current[peerId].readyState === 'open') {
              dataChannelsRef.current[peerId].close();
          }
      });
      peerConnectionsRef.current = {};
      dataChannelsRef.current = {};
      setRemoteStreams({});
      
      if (joinedRoom) setJoinedRoom(false);
      hasAttemptedJoinRef.current = false;
    };
  }, [passedRoomId, localStreamRef.current, onDataChannelMessage, onRemoteStreamChange, createPeerConnection, sendOffer]); // joinedRoom is managed internally

  const sendDataToAllPeers = useCallback((data) => {
    const jsonData = JSON.stringify(data);
    Object.values(dataChannelsRef.current).forEach(dc => {
      if (dc && dc.readyState === 'open') {
        try {
          dc.send(jsonData);
        } catch (error) {
          console.error("useWebRTC: Error sending data via DC:", error);
        }
      }
    });
  }, []); // dataChannelsRef is a ref, so it doesn't need to be a dependency

  const toggleAudio = useCallback(() => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      if (audioTracks.length > 0) {
        const currentTrackEnabledState = audioTracks[0].enabled;
        const newTrackEnabledState = !currentTrackEnabledState;
        audioTracks.forEach(track => {
          track.enabled = newTrackEnabledState;
        });
        setIsAudioMuted(!newTrackEnabledState); // Muted is the opposite of enabled
        console.log(`useWebRTC: Audio toggled. Track enabled: ${newTrackEnabledState}. IsMuted state: ${!newTrackEnabledState}`);
      }
    }
  }, [isAudioMuted]); // Dependency on isAudioMuted ensures the closure has the latest state for comparison if needed

  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      if (videoTracks.length > 0) {
        const currentTrackEnabledState = videoTracks[0].enabled;
        const newTrackEnabledState = !currentTrackEnabledState;
        videoTracks.forEach(track => {
          track.enabled = newTrackEnabledState;
        });
        setIsVideoEnabled(newTrackEnabledState);
        console.log(`useWebRTC: Video toggled. Track enabled: ${newTrackEnabledState}. IsVideoEnabled state: ${newTrackEnabledState}`);
      }
    }
  }, [isVideoEnabled]); // Dependency on isVideoEnabled

  return {
    localStream,
    remoteStreams,
    sendDataToAllPeers,
    isSocketConnected,
    joinedRoom,
    isAudioMuted,
    isVideoEnabled,
    toggleAudio,
    toggleVideo,
  };
};

export default useWebRTC;