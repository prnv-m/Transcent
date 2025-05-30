import { useState, useEffect, useRef, useCallback } from 'react';

const VOSK_WEBSOCKET_URL = import.meta.env.VITE_VOSK_URL || 'ws://localhost:2700';

const TARGET_SAMPLE_RATE = 16000; // Desired sample rate for Vosk

const useSubtitle = (sendDataToAllPeers, enabled = false) => {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [localSubtitle, setLocalSubtitle] = useState('');
  const [voskSocketReady, setVoskSocketReady] = useState(false);
  const [statusMessage, setStatusMessage] = useState(''); // For user feedback

  const audioContextRef = useRef(null);
  const mediaStreamSourceRef = useRef(null);
  const audioWorkletNodeRef = useRef(null);
  const mediaStreamRef = useRef(null); // For the getUserMedia stream
  const voskSocketRef = useRef(null);

  // Handles messages received from the Vosk WebSocket server
  const handleVoskMessage = useCallback((event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.partial) {
        setLocalSubtitle(message.partial);
      } else if (message.text && message.text.trim() !== '') {
        // Final result
        setLocalSubtitle(message.text);
        if (sendDataToAllPeers) {
          // console.log('Sending final transcript to peers:', message.text);
          sendDataToAllPeers({
            type: 'subtitle',
            text: message.text,
            timestamp: Date.now(),
          });
        }
      } else if (message.result) {
        // This contains message.text, already handled.
        // console.log('Vosk full result object:', message);
      }
    } catch (error) {
      console.error('Error parsing Vosk message or updating subtitle:', error, event.data);
      setStatusMessage('Error processing transcription result.');
    }
  }, [sendDataToAllPeers]);

  // Internal function to stop all parts of the transcription pipeline
  const stopTranscriptionInternal = useCallback((sendEofToVosk = true) => {
    setStatusMessage('Stopping transcription...');
    // 1. Stop AudioWorklet processing (optional: send stop message)
    if (audioWorkletNodeRef.current) {
      // audioWorkletNodeRef.current.port.postMessage('stop'); // If audio-processor.js handles it
      audioWorkletNodeRef.current.disconnect();
      audioWorkletNodeRef.current = null;
      // console.log('AudioWorkletNode disconnected.');
    }

    // 2. Disconnect MediaStreamSource
    if (mediaStreamSourceRef.current) {
      mediaStreamSourceRef.current.disconnect();
      mediaStreamSourceRef.current = null;
      // console.log('MediaStreamSource disconnected.');
    }

    // 3. Stop the microphone stream tracks
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
      // console.log('Microphone stream stopped.');
    }

    // 4. Handle Vosk WebSocket
    if (voskSocketRef.current) {
      if (voskSocketRef.current.readyState === WebSocket.OPEN && sendEofToVosk) {
        // console.log('Sending EOF to Vosk.');
        voskSocketRef.current.send(JSON.stringify({ eof: 1 }));
        // Don't close immediately; let Vosk process EOF and send final result.
        // Vosk server usually closes the connection after processing EOF.
      } else if (voskSocketRef.current.readyState === WebSocket.OPEN && !sendEofToVosk) {
        // If not sending EOF (e.g. error occurred), just close.
        voskSocketRef.current.close(1000, "Client stopping transcription without EOF");
      }
      // voskSocketRef.current will be nulled by its onclose handler
    }
    
    // We don't close the AudioContext here as it might be reused or managed globally.
    // If it was created specifically for this hook and won't be reused, closing it would be:
    // if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
    //   audioContextRef.current.close().then(() => console.log('AudioContext closed.'));
    //   audioContextRef.current = null;
    // }

    if (isTranscribing) setIsTranscribing(false); // Update state only if it was true
    // voskSocketReady will be set to false by the voskSocket.onclose handler
    setStatusMessage(sendEofToVosk ? 'Transcription stopped.' : 'Transcription stopped due to an issue.');
    if (!sendEofToVosk) setLocalSubtitle(''); // Clear subtitle on error stop
  }, [isTranscribing]); // Add isTranscribing to deps

  // Main function to start the transcription process
  const startTranscription = useCallback(async () => {
    if (isTranscribing) {
      // console.log('Transcription already active.');
      return;
    }
    if (!VOSK_WEBSOCKET_URL) {
      setStatusMessage('Vosk WebSocket URL is not configured.');
      console.error('Vosk WebSocket URL is not configured.');
      return;
    }

    setStatusMessage('Starting transcription...');
    setLocalSubtitle(''); // Clear previous subtitles
    setIsTranscribing(true); // Set transcribing state immediately

    try {
      // 1. Get User Media (Microphone)
      setStatusMessage('Requesting microphone access...');
      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: TARGET_SAMPLE_RATE, // Request 16kHz, browser might give something else
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const audioTracks = mediaStreamRef.current.getAudioTracks();
      if (audioTracks.length === 0) throw new Error('No audio tracks found.');
      // const trackSettings = audioTracks[0].getSettings();
      // console.log('Microphone stream acquired. Settings:', trackSettings);
      setStatusMessage('Microphone access granted.');

      // 2. Setup Vosk WebSocket Connection
      setStatusMessage('Connecting to Vosk server...');
      voskSocketRef.current = new WebSocket(VOSK_WEBSOCKET_URL);
      voskSocketRef.current.onmessage = handleVoskMessage;

      voskSocketRef.current.onerror = (error) => {
        console.error('Vosk WebSocket error:', error);
        setStatusMessage('Vosk WebSocket error. Check console.');
        // stopTranscriptionInternal might be called by onclose too, avoid double actions
        if (isTranscribing) stopTranscriptionInternal(false);
      };

      voskSocketRef.current.onclose = (event) => {
        console.log('Vosk WebSocket closed:', event.code, event.reason);
        setStatusMessage(`Vosk connection closed: ${event.reason || event.code}`);
        setVoskSocketReady(false);
        // Ensure everything is stopped if the socket closes unexpectedly
        if (isTranscribing) stopTranscriptionInternal(false);
      };

      // Wait for Vosk WebSocket to open
      await new Promise((resolve, reject) => {
        if (!voskSocketRef.current) { // Should not happen if code flows correctly
            reject(new Error("Vosk WebSocket was not initialized."));
            return;
        }
        voskSocketRef.current.onopen = () => {
          setVoskSocketReady(true);
          resolve();
        };
        // Add a timeout for onopen
        const openTimeout = setTimeout(() => {
            reject(new Error("Vosk WebSocket connection timed out."));
        }, 5000); // 5 second timeout
        voskSocketRef.current.addEventListener('open', () => clearTimeout(openTimeout), {once: true});
        voskSocketRef.current.addEventListener('error', (errEvent) => { // Handle error during opening phase
            clearTimeout(openTimeout);
            reject(new Error("Vosk WebSocket failed to open."));
        }, {once: true});

      });
      setStatusMessage('Vosk server connected.');
      
      // Send Vosk configuration (sample rate)
      const configMessage = JSON.stringify({ config: { sample_rate: TARGET_SAMPLE_RATE } });
      voskSocketRef.current.send(configMessage);
      // console.log('Sent Vosk config:', configMessage);

      // 3. Setup Web Audio API and AudioWorklet
      setStatusMessage('Setting up audio processing...');
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
           // Try to set the context sample rate. Browsers may override this with hardware rate.
           // The audio-processor.js will handle resampling from context's actual rate.
           // sampleRate: TARGET_SAMPLE_RATE 
        });
        // console.log("AudioContext created. Actual context sample rate:", audioContextRef.current.sampleRate);
      } else if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
        // console.log("AudioContext resumed.");
      }
      
      // Ensure the audio worklet module is added only once or handle errors if already added
      try {
        await audioContextRef.current.audioWorklet.addModule('/audio-processor.js'); // Path relative to public folder
      } catch (e) {
        if (e.name === 'InvalidStateError' && e.message.includes('already been loaded')) {
          // console.log('AudioWorklet module "audio-processor.js" already loaded.');
        } else {
          throw e; // Re-throw other errors
        }
      }
      
      mediaStreamSourceRef.current = audioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
      
      audioWorkletNodeRef.current = new AudioWorkletNode(audioContextRef.current, 'pcm-processor', {
        processorOptions: {
          targetSampleRate: TARGET_SAMPLE_RATE,
          // bufferSize: 4096 // Example: If your worklet supports custom buffer sizes for its output
        }
      });

      audioWorkletNodeRef.current.port.onmessage = (event) => {
        // event.data is an ArrayBuffer of Int16 PCM data from the worklet
        if (voskSocketRef.current && voskSocketRef.current.readyState === WebSocket.OPEN) {
          voskSocketRef.current.send(event.data);
        }
      };

      mediaStreamSourceRef.current.connect(audioWorkletNodeRef.current);
      // Do NOT connect audioWorkletNodeRef.current to audioContextRef.current.destination
      // unless you want to hear the raw audio being processed (can cause feedback).

      setStatusMessage('Transcription started. Speak now.');
      // console.log('AudioWorklet pipeline setup complete.');

    } catch (error) {
      console.error('Full error in startTranscription:', error);
      setStatusMessage(`Error starting transcription: ${error.message}. Check console.`);
      // Ensure cleanup if error occurs at any stage
      stopTranscriptionInternal(false); // false: don't send EOF on error
    }
  }, [isTranscribing, handleVoskMessage, stopTranscriptionInternal]); // Dependencies

  // Public function to stop transcription
  const stopTranscription = useCallback(() => {
    // console.log("User explicitly called stopTranscription.");
    if(isTranscribing) { // Only if actually transcribing
        stopTranscriptionInternal(true); // true: send EOF to Vosk
    }
  }, [stopTranscriptionInternal, isTranscribing]);

  // Effect to automatically start/stop based on the 'enabled' prop
  useEffect(() => {
    if (enabled) {
      if (!isTranscribing) { // Prevent re-starting if already enabled and transcribing
        startTranscription();
      }
    } else {
      if (isTranscribing) { // Only stop if it was actually running
        stopTranscription();
      }
    }
  }, [enabled, startTranscription, stopTranscription, isTranscribing]); // Add isTranscribing here

  // Effect for cleanup on component unmount
  useEffect(() => {
    return () => {
      // console.log("useSubtitle unmounting. Cleaning up...");
      // Ensure everything is stopped, send EOF if it was transcribing
      if (isTranscribing) {
        stopTranscriptionInternal(true);
      } else {
        stopTranscriptionInternal(false); // Less critical to send EOF if not actively transcribing
      }
      
      // Close AudioContext if it was created by this hook and is no longer needed.
      // This is often better handled at a more global level if AudioContext is shared.
      // For this hook, if we created it, we can consider closing it.
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        // console.log('Considering closing AudioContext on unmount.');
        // audioContextRef.current.close().catch(e => console.error("Error closing audio context on unmount", e));
        // audioContextRef.current = null;
      }
    };
  }, [stopTranscriptionInternal, isTranscribing]); // Add isTranscribing here

  return {
    isTranscribing,
    localSubtitle,
    voskSocketReady,
    statusMessage, // Provide status for UI
    startTranscription, // Expose for manual control if 'enabled' prop is not used
    stopTranscription,
  };
};

export default useSubtitle;