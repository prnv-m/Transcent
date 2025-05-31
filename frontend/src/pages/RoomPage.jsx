// frontend/src/pages/RoomPage.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useWebRTC from '../hooks/useWebRTC'; // Assuming useWebRTC.js is updated as per previous discussions
import useSubtitle from '../hooks/useSubtitle';
import socket from '../utils/socket';
import { ModeToggle } from '@/components/mode-toggle';
// ShadCN/UI Imports
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"; // Using Avatar

// Lucide Icons
import { Mic, MicOff, Video, VideoOff, Copy, Languages, Settings2, UserCircle2 } from 'lucide-react';

function RoomPage() {
    const { roomID } = useParams(); // Using roomID as specified
    const navigate = useNavigate();

    const [myPeerId, setMyPeerId] = useState(null);
    const [remoteSubtitles, setRemoteSubtitles] = useState({});
    const [isTranscriptionEnabled, setIsTranscriptionEnabled] = useState(false);

    const localVideoRef = useRef(null);
    const remoteVideosRef = useRef({});

    const handleDataChannelMessage = useCallback((peerId, message) => {
        if (message && message.type === 'subtitle' && typeof message.text === 'string') {
            setRemoteSubtitles(prev => ({
                ...prev,
                [peerId]: { text: message.text, timestamp: message.timestamp || Date.now() },
            }));
        }
    }, []);

    const handleRemoteStreamChange = useCallback((peerId, stream) => {
        console.log(`RoomPage: Remote stream for ${peerId} ${stream ? 'added' : 'removed'}.`);
        if (!stream) {
            setRemoteSubtitles(prev => {
                const newSubs = { ...prev };
                if (newSubs[peerId]) {
                    delete newSubs[peerId];
                    return newSubs;
                }
                return prev;
            });
        }
    }, []);

    const {
        localStream, remoteStreams, sendDataToAllPeers,
        isSocketConnected, joinedRoom,
        isAudioMuted, isVideoEnabled,
        toggleAudio, toggleVideo,
    } = useWebRTC(roomID, handleDataChannelMessage, handleRemoteStreamChange);

    const {
        isTranscribing, localSubtitle,
        voskSocketReady, statusMessage: voskStatusMessage,
    } = useSubtitle(sendDataToAllPeers, isTranscriptionEnabled);

    useEffect(() => {
        if (socket.connected) setMyPeerId(socket.id);
        const handleConnect = () => setMyPeerId(socket.id);
        socket.on('connect', handleConnect);
        return () => socket.off('connect', handleConnect);
    }, []);

    useEffect(() => {
        if (localStream) {
            console.log("RoomPage: localStream available. Video track enabled state from stream:", localStream.getVideoTracks()[0]?.enabled);
            console.log("RoomPage: isVideoEnabled state from hook:", isVideoEnabled);
            if (localVideoRef.current) {
                if (localVideoRef.current.srcObject !== localStream) {
                    console.log("RoomPage: Attaching localStream to video element.");
                    localVideoRef.current.srcObject = localStream;
                }
            }
        } else {
            if (localVideoRef.current && localVideoRef.current.srcObject) {
                console.log("RoomPage: localStream is null, clearing srcObject.");
                localVideoRef.current.srcObject = null;
            }
        }
    }, [localStream]);

    useEffect(() => {
        Object.entries(remoteStreams).forEach(([peerId, stream]) => {
            const videoElement = remoteVideosRef.current[peerId];
            if (videoElement && stream) {
                if (videoElement.srcObject !== stream) videoElement.srcObject = stream;
            }
        });
        Object.keys(remoteVideosRef.current).forEach(peerId => {
            if (!remoteStreams[peerId] && remoteVideosRef.current[peerId]?.srcObject) {
                remoteVideosRef.current[peerId].srcObject = null;
            }
        });
    }, [remoteStreams]);

    const toggleTranscriptionHandler = () => setIsTranscriptionEnabled(prev => !prev);

    const getRemoteVideoRef = (peerId) => (element) => {
        if (element) remoteVideosRef.current[peerId] = element;
        else delete remoteVideosRef.current[peerId];
    };

    const handleCopyLink = () => {
        navigator.clipboard.writeText(window.location.href)
            .then(() => {
                alert('Meeting link copied to clipboard!'); // Replace with Toast later if desired
            })
            .catch(err => console.error('Failed to copy link: ', err));
    };

    if (!roomID) {
        useEffect(() => { navigate('/'); }, [navigate]); // Redirect if roomID is falsy on mount
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
                <p className="text-lg text-gray-600">Invalid Room URL. Redirecting...</p>
            </div>
        );
    }

    return (
        <TooltipProvider delayDuration={300}>
            <div className="min-h-screen bg-slate-100 dark:bg-slate-900 flex flex-col items-center p-3 md:p-6 lg:p-8 selection:bg-sky-200 dark:selection:bg-sky-700">
                <div className="absolute top-4 right-4">
                    <ModeToggle />
                </div>
                <div className="w-full max-w-7xl">
                    <header className="mb-6 text-center">
                        <h1 className="text-3xl md:text-4xl font-bold text-slate-800">Transcent Meeting</h1>
                    </header>

                    <Card className="mb-6 shadow-lg">
                        <CardHeader>
                            <CardTitle className="text-xl text-slate-700">Session Info</CardTitle>
                        </CardHeader>
                        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-sm text-slate-700">
                            <div className="flex items-center justify-between sm:col-span-2 lg:col-span-1">
                                <span className="font-semibold">Room ID: {roomID}</span>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="outline" size="sm" onClick={handleCopyLink}>
                                            <Copy size={14} className="mr-2" /> Copy Link
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent><p>Copy meeting link</p></TooltipContent>
                                </Tooltip>
                            </div>
                            <p><span className="font-semibold">My ID:</span> {myPeerId ? myPeerId.substring(0, 6) : '...'}</p>
                            <p><span className="font-semibold">Signaling:</span> <span className={isSocketConnected ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>{isSocketConnected ? 'Connected' : 'Disconnected'}</span></p>
                            <p><span className="font-semibold">Room:</span> <span className={joinedRoom ? 'text-green-600 font-medium' : 'text-yellow-500 font-medium'}>
                                {joinedRoom ? 'Joined' : (isSocketConnected && localStream ? 'Joining...' : 'Not Joined')}
                            </span></p>
                            <p><span className="font-semibold">Vosk:</span> <span className={isTranscriptionEnabled ? (voskSocketReady ? 'text-green-600 font-medium' : 'text-yellow-500 font-medium') : 'text-slate-500 font-medium'}>
                                {isTranscriptionEnabled ? (voskSocketReady ? 'Ready' : 'Connecting...') : 'Off'}
                            </span></p>
                        </CardContent>
                    </Card>

                    <Separator className="my-6 bg-slate-300" />

                    <div className="my-6 flex flex-wrap justify-center items-center gap-3 md:gap-4">
                        {localStream && (
                            <>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            onClick={toggleAudio}
                                            disabled={!joinedRoom}
                                            variant={isAudioMuted ? "destructive" : "outline"}
                                            size="lg"
                                            className="min-w-[130px]"
                                        >
                                            {isAudioMuted ? <MicOff className="mr-2 h-5 w-5" /> : <Mic className="mr-2 h-5 w-5" />}
                                            {isAudioMuted ? 'Unmute' : 'Mute'}
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent><p>{isAudioMuted ? "Unmute Microphone" : "Mute Microphone"}</p></TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            onClick={toggleVideo}
                                            disabled={!joinedRoom}
                                            variant={!isVideoEnabled ? "secondary" : "outline"}
                                            size="lg"
                                            className="min-w-[130px]"
                                        >
                                            {isVideoEnabled ? <VideoOff className="mr-2 h-5 w-5" /> : <Video className="mr-2 h-5 w-5" />}
                                            {isVideoEnabled ? 'Cam Off' : 'Cam On'}
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent><p>{isVideoEnabled ? "Turn Off Camera" : "Turn On Camera"}</p></TooltipContent>
                                </Tooltip>
                            </>
                        )}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    onClick={toggleTranscriptionHandler}
                                    disabled={!localStream || !joinedRoom || (isTranscriptionEnabled && !voskSocketReady)}
                                    variant={isTranscriptionEnabled ? "default" : "outline"}
                                    size="lg"
                                    className={`min-w-[130px] ${isTranscriptionEnabled ? "bg-sky-600 hover:bg-sky-700 text-white" : ""}`}
                                >
                                    <Languages className="mr-2 h-5 w-5" />
                                    {isTranscriptionEnabled ? 'Subs Off' : 'Subs On'}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>{isTranscriptionEnabled ? "Stop Subtitles" : "Start Subtitles"}</p></TooltipContent>
                        </Tooltip>
                        {/* <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="outline" size="lg" disabled>
                                    <Settings2 className="mr-2 h-5 w-5" /> Settings
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Room Settings (Coming Soon)</p></TooltipContent>
                        </Tooltip> */}
                    </div>

                    {(isTranscriptionEnabled && voskStatusMessage) && (
                        <div className="text-center p-2 mb-4 text-sm italic rounded-md bg-slate-200 max-w-md mx-auto">
                            <p className={voskStatusMessage.toLowerCase().includes('error') ? 'text-red-600' : 'text-slate-700'}>
                                Vosk: {voskStatusMessage}
                            </p>
                        </div>
                    )}
                    {!localStream && <p className="text-center p-2 mb-4 text-sm italic text-orange-600">Requesting camera/microphone access...</p>}

                    <Separator className="my-6 bg-slate-300" />

                    <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                        {localStream && (
                            <Card className="local-video-card shadow-xl border-slate-300">
                                <CardHeader className="py-2 px-4 border-b border-slate-200">
                                    <CardTitle className="text-md flex items-center text-slate-700">
                                        <UserCircle2 size={20} className="mr-2 text-blue-600"/>
                                        You ({myPeerId ? myPeerId.substring(0, 6) : ''})
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="p-0 aspect-video bg-black rounded-b-md overflow-hidden relative">
                                    {/* DEBUGGING CAMERA: Video element always rendered, visibility controlled by style */}
                                    <video
                                        ref={localVideoRef}
                                        autoPlay
                                        playsInline
                                        muted
                                        className="w-full h-full object-cover"
                                        style={{ display: isVideoEnabled ? 'block' : 'none' }}
                                    />
                                    {!isVideoEnabled && (
                                        <div className="absolute inset-0 w-full h-full flex flex-col items-center justify-center bg-slate-800 text-slate-400">
                                            {/* You can use Avatar here if 'myPeerId' or a name is available */}
                                            {/* <Avatar className="w-20 h-20 mb-2">
                                                <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
                                                <AvatarFallback>{myPeerId ? myPeerId.substring(0,1).toUpperCase() : 'U'}</AvatarFallback>
                                            </Avatar> */}
                                            <VideoOff size={56} className="mb-2 opacity-60" />
                                            <span>Camera Off</span>
                                        </div>
                                    )}
                                    <div className="absolute bottom-0 left-0 right-0 p-2.5 bg-gradient-to-t from-black/70 to-transparent text-white text-sm text-center min-h-[3em] flex items-end justify-center pointer-events-none">
                                        <span className="bg-black/40 px-2 py-1 rounded backdrop-blur-sm">
                                            {isTranscriptionEnabled && localSubtitle ? localSubtitle : (isTranscriptionEnabled ? '...' : '')}
                                        </span>
                                    </div>
                                </CardContent>
                            </Card>
                        )}

                        {Object.keys(remoteStreams).map((peerId) => (
                            <Card key={peerId} className="remote-video-card shadow-xl border-slate-300">
                                <CardHeader className="py-2 px-4 border-b border-slate-200">
                                    <CardTitle className="text-md flex items-center text-slate-700">
                                        <UserCircle2 size={20} className="mr-2 text-teal-600"/>
                                        Peer ({peerId.substring(0, 6)})
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="p-0 aspect-video bg-black rounded-b-md overflow-hidden relative">
                                    <video ref={getRemoteVideoRef(peerId)} autoPlay playsInline className="w-full h-full object-cover" />
                                    <div className="absolute bottom-0 left-0 right-0 p-2.5 bg-gradient-to-t from-black/70 to-transparent text-white text-sm text-center min-h-[3em] flex items-end justify-center pointer-events-none">
                                        <span className="bg-black/40 px-2 py-1 rounded backdrop-blur-sm">
                                            {remoteSubtitles[peerId]?.text || ''}
                                        </span>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>

                    {localStream && Object.keys(remoteStreams).length === 0 && joinedRoom && (
                        <p className="text-center text-slate-500 italic mt-8 py-4">Waiting for other peers to join the room...</p>
                    )}
                    {!joinedRoom && localStream && isSocketConnected && (
                         <p className="text-center text-yellow-600 italic mt-8 py-4">Attempting to join room {roomID}...</p>
                    )}
                </div>
            </div>
        </TooltipProvider>
    );
}
export default RoomPage;