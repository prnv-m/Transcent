import { useState, useEffect, useRef, useCallback } from 'react';
import useWebRTC from './hooks/useWebRTC';
import useSubtitle from './hooks/useSubtitle';
import socket from './utils/socket'; // For socket.id access
import './App.css';

const ROOM_ID = 'webrtc-subtitle-test-room'; // Hardcoded room ID for testing

function App() {
  const [myPeerId, setMyPeerId] = useState(null);
  const [remoteSubtitles, setRemoteSubtitles] = useState({}); // { [peerId]: { text, timestamp } }
  const [isTranscriptionEnabled, setIsTranscriptionEnabled] = useState(false);

  const localVideoRef = useRef(null);
  const remoteVideosRef = useRef({}); // To manage refs for remote video elements: { [peerId]: HTMLVideoElement }

  // Callback for when a data channel message is received from a peer
  // Memoized with useCallback to ensure stable reference for useWebRTC
  const handleDataChannelMessage = useCallback((peerId, message) => {
    // console.log(`App: Received data from ${peerId}:`, message);
    if (message && message.type === 'subtitle' && typeof message.text === 'string') {
      setRemoteSubtitles(prev => ({
        ...prev,
        [peerId]: { text: message.text, timestamp: message.timestamp || Date.now() },
      }));
    }
  }, []); // Empty dependency array: setRemoteSubtitles is stable

  // Callback for when a remote stream is added or removed
  // Memoized with useCallback to ensure stable reference for useWebRTC
  const handleRemoteStreamChange = useCallback((peerId, stream) => {
    console.log(`App: Remote stream for ${peerId} ${stream ? 'added' : 'removed'}.`);
    // If a stream is removed (peer left or stream ended), clear their subtitles
    if (!stream) {
      setRemoteSubtitles(prev => {
        const newSubs = {...prev};
        if (newSubs[peerId]) { // Only update if entry exists
          delete newSubs[peerId];
          return newSubs;
        }
        return prev; // No change needed
      });
    }
    // The remoteStreams object from useWebRTC will trigger re-renders for video elements.
    // This callback is mainly for auxiliary actions like clearing subtitles.
  }, []); // Empty dependency array: setRemoteSubtitles is stable

  // Initialize useWebRTC hook
  const {
    localStream,
    remoteStreams, // This is an object: { [peerId]: MediaStream }
    sendDataToAllPeers,
    isSocketConnected,
    joinedRoom, // Get joinedRoom status from the hook
  } = useWebRTC(ROOM_ID, handleDataChannelMessage, handleRemoteStreamChange);

  // Initialize useSubtitle hook
const {
  isTranscribing,
  localSubtitle,
  voskSocketReady,
  statusMessage, // <<< Get statusMessage
  // startTranscription, // Not needed if using 'enabled' prop
  // stopTranscription,  // Not needed if using 'enabled' prop
} = useSubtitle(sendDataToAllPeers, isTranscriptionEnabled);'enabled';


  // Effect to get and display local socket ID
  useEffect(() => {
    if (socket.connected) {
      setMyPeerId(socket.id);
    }
    const handleConnect = () => setMyPeerId(socket.id);
    socket.on('connect', handleConnect);
    return () => {
      socket.off('connect', handleConnect);
    };
  }, []);

  // Effect to attach local stream to the local video element
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      if (localVideoRef.current.srcObject !== localStream) {
        // console.log("Attaching local stream to video element.");
        localVideoRef.current.srcObject = localStream;
      }
    }
  }, [localStream]);

  // Effect to attach remote streams to their respective video elements
  useEffect(() => {
    // Attach streams for new or updated peers
    Object.entries(remoteStreams).forEach(([peerId, stream]) => {
      const videoElement = remoteVideosRef.current[peerId];
      if (videoElement && stream) {
        if (videoElement.srcObject !== stream) {
          // console.log(`Attaching remote stream from ${peerId} to its video element.`);
          videoElement.srcObject = stream;
        }
      }
    });

    // Clean up srcObject for peers that are no longer in remoteStreams
    Object.keys(remoteVideosRef.current).forEach(peerId => {
      if (!remoteStreams[peerId] && remoteVideosRef.current[peerId]?.srcObject) {
        // console.log(`Clearing srcObject for disconnected peer ${peerId}`);
        remoteVideosRef.current[peerId].srcObject = null;
      }
    });
  }, [remoteStreams]); // This effect runs when the remoteStreams object changes

  // Toggles the state for enabling/disabling transcription
  const toggleTranscription = () => {
    setIsTranscriptionEnabled(prev => !prev);
  };

  // Helper to get a ref for a dynamically created remote video element
  const getRemoteVideoRef = (peerId) => (element) => {
    if (element) {
      remoteVideosRef.current[peerId] = element;
    } else {
      // Element is being unmounted, remove from refs
      delete remoteVideosRef.current[peerId];
    }
  };

  return (
    <div className="App">
      <h1>WebRTC Real-time Subtitles</h1>
      <hr />
      <div className="status-panel">
        <p><strong>Room ID:</strong> {ROOM_ID}</p>
        <p><strong>My Peer ID:</strong> {myPeerId || 'Connecting...'}</p>
        <p><strong>Signaling Connected:</strong> <span style={{color: isSocketConnected ? 'green' : 'red'}}>{isSocketConnected ? 'Yes' : 'No'}</span></p>
        <p><strong>Joined Room:</strong> <span style={{color: joinedRoom ? 'green' : 'orange'}}>{joinedRoom ? 'Yes' : 'No/Pending'}</span></p>
      </div>
      <hr />

      <div className="controls">
        <button onClick={toggleTranscription} disabled={!localStream || !joinedRoom}>
          {isTranscriptionEnabled ? 'Stop My Subtitles' : 'Start My Subtitles'}
        </button>
      </div>
      
      <div className="status-messages">
        {isTranscriptionEnabled && !voskSocketReady && localStream && <p>Vosk Subtitles: Connecting to Vosk server...</p>}
        {isTranscriptionEnabled && voskSocketReady && <p style={{color: 'blue'}}>Vosk Subtitles: Transcribing...</p>}
        {!localStream && <p>Waiting for camera/microphone access...</p>}
      </div>
      <hr />

      <div className="videos-container">
        {localStream && (
          <div className="video-wrapper">
            <h2>My Video ({myPeerId ? myPeerId.substring(0, 6) : 'Me'})</h2>
            <video ref={localVideoRef} autoPlay playsInline muted />
            <div className="subtitle-overlay">
              {isTranscriptionEnabled ? (localSubtitle || '...') : '(My subtitles are off)'}
            </div>
          </div>
        )}

        {Object.keys(remoteStreams).map((peerId) => (
          <div key={peerId} className="video-wrapper">
            <h2>Peer ({peerId.substring(0, 6)})</h2>
            <video ref={getRemoteVideoRef(peerId)} autoPlay playsInline />
            <div className="subtitle-overlay">
              {remoteSubtitles[peerId]?.text || '(Peer subtitle pending)'}
            </div>
          </div>
        ))}
      </div>
      
      {localStream && Object.keys(remoteStreams).length === 0 && joinedRoom && (
        <p>Waiting for other peers to join...</p>
      )}
      {localStream && Object.keys(remoteStreams).length === 0 && !joinedRoom && isSocketConnected && (
        <p>Attempting to join room...</p>
      )}
    </div>
  );
}

export default App;