import { fal } from "https://esm.sh/@fal-ai/client";

// Tell the fal client to route auth requests through our Express server
fal.config({
    proxyUrl: "/api/fal/proxy",
});

const roomInput = document.getElementById('roomName');
const promptInput = document.getElementById('promptText');
const joinBtn = document.getElementById('joinBtn');
const publisherEl = document.getElementById('publisher');
const subscribersEl = document.getElementById('subscribers');
const statusMsg = document.getElementById('statusMsg');
const stopBtn = document.getElementById('stopBtn');


let vonageSession;
let falConnection;
let localStream;
let rawAudioTrack;
let peerConnection;
let isVonageInitialized = false;

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
    stopBtn.disabled = false;

    try {
        await startCall(roomName, promptText);
    } catch (err) {
        console.error(err);
        setStatus("Error: " + err.message, true);
        joinBtn.disabled = false;
    }
});



stopBtn.addEventListener('click', () => {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null; // Mark for JavaScript garbage collection
    }
    // 1. Kill the AI WebSocket connection (Stops fal.ai billing)
    if (falConnection) falConnection.close();

    // 2. Disconnect from Vonage
    if (vonageSession) vonageSession.disconnect();

    // 3. Turn off webcam and microphone hardware lights
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }

    isVonageInitialized = false;

    setStatus("Disconnected. Billing stopped.");
    joinBtn.disabled = false;
    stopBtn.disabled = true;
});

async function startCall(roomName, promptText) {
    // 1. Get raw webcam and microphone
    localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true
    });

    // Save raw audio so we can merge it later (preventing mute)
    rawAudioTrack = localStream.getAudioTracks()[0];

    setStatus("Fetching Vonage tokens...");

    // 2. Fetch Vonage session info from our Express backend
    const vonageRes = await fetch(`/room/${roomName}`);
    if (!vonageRes.ok) throw new Error("Failed to fetch Vonage session data");
    const vonageData = await vonageRes.json();
    console.log("Fetched Vonage session data:", vonageData);

    setStatus("Connecting to AI inference over WebRTC...");

    // 3. Connect to fal.ai (Lucy 2.5) over WebRTC
    // The client automatically negotiates the token via /api/fal/proxy
    // falConnection = fal.realtime.connect("decart/lucy-2-5/realtime", {
    //     onRemoteStream: (remoteStream) => {
    //         setStatus("AI Avatar received. Joining Vonage room...");

    //         // Extract the processed video track from fal.ai
    //         const aiVideoTrack = remoteStream.getVideoTracks()[0];

    //         // Fire up the Vonage Pipeline
    //         initializeVonage(vonageData, aiVideoTrack, rawAudioTrack);
    //     },
    //     onError: (err) => {
    //         console.error("fal.ai error:", err);
    //         setStatus("AI generation error: " + err.message, true);
    //     }
    // });



    // falConnection = fal.realtime.connect("decart/lucy-2-5/realtime", {
    //     // fal automatically provides the 'app' argument here
    //     tokenProvider: async (app) => {
    //         console.log("Requesting token for app:", app);
    //         const tokenRes = await fetch('/api/fal/token', {
    //             method: 'POST',
    //             headers: { 'Content-Type': 'application/json' },
    //             // Send the exact app string the WebSocket needs to authorize
    //             body: JSON.stringify({ app })
    //         });
    //         const tokenData = await tokenRes.json();
    //         console.log("Fetched token data:", tokenData);
    //         return tokenData.token;
    //     },
    //     onRemoteStream: (remoteStream) => {
    //         setStatus("AI Avatar received. Joining Vonage room...");

    //         const aiVideoTrack = remoteStream.getVideoTracks()[0];
    //         initializeVonage(vonageData, aiVideoTrack, rawAudioTrack);
    //     },
    //     onResult: (result) => {
    //         console.log("onResult:",result);
    //     },
    //     onError: (err) => {
    //         console.error("fal.ai error:", err);
    //         setStatus("AI generation error: " + err.message, true);
    //     },
    //     tokenExpirationSeconds: 120,
    // });

    // // 4. Send the raw video stream to fal.ai with the user's text prompt
    // falConnection.send({
    //     stream: localStream,
    //     prompt: promptText,
    //     enable_prompt_expansion: true
    // });

    // 3. Connect to fal.ai (Lucy 2.5) via WebSocket for Signaling
    falConnection = fal.realtime.connect("decart/lucy-2-5/realtime", {
        tokenProvider: async (app) => {
            const tokenRes = await fetch('/api/fal/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ app: app })
            });
            const tokenData = await tokenRes.json();
            return tokenData.token;
        },
        // Replaced onRemoteStream with onResult to handle WebRTC signaling
        onResult: async (result) => {
            if (result.error) {
                console.error("Server Error:", result.error);
                return;
            }

            // A. The server is ready. Initialize our local WebRTC Peer Connection.
            if (result.type === 'ready') {

                // Use a public STUN server to get through NAT/Firewalls
                peerConnection = new RTCPeerConnection({
                    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
                });

                // Feed our raw webcam stream into the Peer Connection
                localStream.getTracks().forEach(track => {
                    peerConnection.addTrack(track, localStream);
                });

                // Listen for the AI-processed video track coming back from fal.ai
                peerConnection.ontrack = (event) => {
                    if (isVonageInitialized) return;
                    const aiVideoTrack = event.streams[0].getVideoTracks()[0];
                    // setStatus("AI Avatar received. Joining Vonage room...");
                    // initializeVonage(vonageData, aiVideoTrack, rawAudioTrack);
                    if (aiVideoTrack) {
                        isVonageInitialized = true; // Lock the gate
                        setStatus("AI Avatar received. Joining Vonage room...");
                        initializeVonage(vonageData, aiVideoTrack, rawAudioTrack);
                    }
                };

                // Forward ICE candidates generated by our browser to fal.ai
                peerConnection.onicecandidate = (event) => {
                    if (event.candidate) {
                        falConnection.send({
                            type: 'candidate',
                            candidate: event.candidate.candidate,
                            sdpMid: event.candidate.sdpMid,
                            sdpMLineIndex: event.candidate.sdpMLineIndex
                        });
                    }
                };

                // Create the WebRTC Offer and send it to fal.ai over the WebSocket
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);

                falConnection.send({
                    type: 'offer',
                    sdp: offer.sdp
                });
            }

            // B. fal.ai responds with an SDP Answer
            if (result.type === 'answer' && result.sdp) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription({
                    type: 'answer',
                    sdp: result.sdp
                }));
            }

            // C. fal.ai sends its ICE candidates to establish the connection
            if (result.type === 'candidate' && result.candidate) {
                await peerConnection.addIceCandidate(new RTCIceCandidate({
                    candidate: result.candidate,
                    sdpMid: result.sdpMid,
                    sdpMLineIndex: result.sdpMLineIndex
                }));
            }
        },
        onError: (err) => {
            console.error("fal.ai error:", err);
            setStatus("AI generation error: " + err.message, true);
        }
    });

    // 4. Send the prompt configuration as a standard WebSocket message
    // Note: We no longer send 'stream: localStream' here. The video travels over RTCPeerConnection.
    falConnection.send({
        prompt: promptText,
        enable_prompt_expansion: true
    });
}

function initializeVonage(vonageData, aiVideoTrack, rawAudioTrack) {
    // Initialize the Vonage Session
    console.log("Initializing Vonage with data:", vonageData);
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