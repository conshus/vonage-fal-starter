import { fal } from "https://esm.sh/@fal-ai/client";

const roomInput = document.getElementById('roomName');
const promptInput = document.getElementById('promptText');
const joinBtn = document.getElementById('joinBtn');
const publisherEl = document.getElementById('publisher');
const subscribersEl = document.getElementById('subscribers');
const statusMsg = document.getElementById('statusMsg');

let vonageSession;
let falConnection;
let localStream;
let rawAudioTrack;

// Update Status UI
function setStatus(message, isError = false) {
    statusMsg.innerText = message;
    if (isError) {
        statusMsg.classList.add('error');
    } else {
        statusMsg.classList.remove('error');
    }
}

joinBtn.addEventListener('click', async () => {
    const roomName = roomInput.value.trim();
    const promptText = promptInput.value.trim();

    if (!roomName || !promptText) {
        setStatus("Please enter both a room name and an avatar prompt.", true);
        return;
    }

    setStatus("Requesting camera and microphone access...");
    joinBtn.disabled = true;

    try {
        await startCall(roomName, promptText);
    } catch (err) {
        console.error(err);
        setStatus("Error: " + err.message, true);
        joinBtn.disabled = false;
    }
});

async function startCall(roomName, promptText) {
    // 1. Get raw webcam and microphone
    localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true
    });
    
    // Save raw audio so we can merge it later (preventing mute)
    rawAudioTrack = localStream.getAudioTracks()[0];

    setStatus("Fetching secure tokens from backend...");
    
    // 2. Fetch Vonage session info from our Express backend
    const vonageRes = await fetch(`/room/${roomName}`);
    if (!vonageRes.ok) throw new Error("Failed to fetch Vonage session data");
    const vonageData = await vonageRes.json();

    setStatus("Connecting to AI inference over WebRTC...");

    // 3. Connect to fal.ai (Lucy 2.5) over WebRTC
    falConnection = fal.realtime.connect("decart/lucy-2-5/realtime", {
        tokenProvider: async () => {
            const tokenRes = await fetch('/api/fal/token');
            const tokenData = await tokenRes.json();
            return tokenData.token;
        },
        onRemoteStream: (remoteStream) => {
            setStatus("AI Avatar received. Joining Vonage room...");
            
            // Extract the processed video track from fal.ai
            const aiVideoTrack = remoteStream.getVideoTracks()[0];
            
            // Fire up the Vonage Pipeline
            initializeVonage(vonageData, aiVideoTrack, rawAudioTrack);
        },
        onError: (err) => {
            console.error("fal.ai error:", err);
            setStatus("AI generation error: " + err.message, true);
        }
    });

    // 4. Send the raw video stream to fal.ai with the user's text prompt
    falConnection.send({
        stream: localStream,
        prompt: promptText,
        enable_prompt_expansion: true
    });
}

function initializeVonage(vonageData, aiVideoTrack, rawAudioTrack) {
    // Initialize the Vonage Session
    vonageSession = OT.initSession(vonageData.applicationId, vonageData.sessionId);

    // Create a new stream combining AI Video + Raw Audio
    const customMediaStream = new MediaStream([aiVideoTrack, rawAudioTrack]);

    // Setup publisher using the custom stream
    const publisher = OT.initPublisher(publisherEl, {
        videoSource: customMediaStream.getVideoTracks()[0],
        audioSource: customMediaStream.getAudioTracks()[0],
        insertMode: 'append',
        width: '100%',
        height: '100%',
        publishAudio: true,
        publishVideo: true
    }, (err) => {
        if (err) setStatus("Publisher error: " + err.message, true);
    });

    // Handle incoming video streams from other participants
    vonageSession.on('streamCreated', (event) => {
        vonageSession.subscribe(event.stream, subscribersEl, {
            insertMode: 'append',
            width: '100%',
            height: '100%'
        }, (err) => {
            if (err) console.error("Subscriber error:", err);
        });
    });

    // Connect to the Vonage Session and publish our AI stream
    vonageSession.connect(vonageData.token, (err) => {
        if (err) {
            setStatus("Session connect error: " + err.message, true);
            return;
        }
        
        setStatus("Connected and streaming! 🟢");
        
        vonageSession.publish(publisher, (pubErr) => {
            if (pubErr) {
                setStatus("Publishing error: " + pubErr.message, true);
            }
        });
    });
}