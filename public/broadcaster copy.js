import { fal } from "https://esm.sh/@fal-ai/client";

fal.config({
    proxyUrl: "/api/fal/proxy",
});

const ui = {
    roomName: document.getElementById('roomName'),
    joinBtn: document.getElementById('joinBtn'),
    stopBtn: document.getElementById('stopBtn'),
    startComposerBtn: document.getElementById('startComposerBtn'),
    startBroadcastBtn: document.getElementById('startBroadcastBtn'),
    startArchiveBtn: document.getElementById('startArchiveBtn'),
    actionBar: document.getElementById('actionBar'),
    codespaceUrl: document.getElementById('codespaceUrl'),
    statusMsg: document.getElementById('statusMsg'),
    chatHistory: document.getElementById('chatHistory'),
    chatInput: document.getElementById('chatInput'),
    sendChatBtn: document.getElementById('sendChatBtn'),
    avatarBtns: document.querySelectorAll('.avatar-btn'),
    toggleAIBtn: document.getElementById('toggleAIBtn'),
};

let vonageSession, vonagePublisher, falConnection, localStream, peerConnection;
let activeRenderId = null, activeRenderStreamId = null;
let activeBroadcastId = null, activeArchiveId = null;
let isVonageInitialized = false;
let isAIFilterOn = false;

function setStatus(msg, error = false) {
    ui.statusMsg.innerText = msg;
    ui.statusMsg.style.color = error ? '#ff4757' : '#00ff88';
}

function appendChat(sender, message) {
    const msgEl = document.createElement('div');
    msgEl.innerHTML = `<strong>${sender}:</strong> ${message}`;
    ui.chatHistory.appendChild(msgEl);
    ui.chatHistory.scrollTop = ui.chatHistory.scrollHeight;
}

ui.sendChatBtn.addEventListener('click', () => {
    if (vonageSession && ui.chatInput.value) {
        vonageSession.signal({ type: 'chat', data: JSON.stringify({ sender: 'Broadcaster', text: ui.chatInput.value }) });
        ui.chatInput.value = '';
    }
});

ui.avatarBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        const prompt = e.target.getAttribute('data-prompt');
        console.log("Avatar prompt selected:", prompt);
        if (falConnection) {
            falConnection.send({ prompt: prompt, enable_prompt_expansion: true });
            setStatus(`Avatar changed to: ${e.target.innerText}`);
        }
    });
});

ui.joinBtn.addEventListener('click', async () => {
    const room = ui.roomName.value.trim();
    ui.joinBtn.disabled = true;
    
    localStream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true });
    const rawAudioTrack = localStream.getAudioTracks()[0];
    
    const vonageRes = await fetch(`/room/${room}`);
    const vonageData = await vonageRes.json();

    initializeVonage(vonageData, localStream.getVideoTracks()[0], localStream.getAudioTracks()[0]);

    // falConnection = fal.realtime.connect("decart/lucy-2-5/realtime", {
    //     tokenProvider: async (app) => {
    //         const res = await fetch('/api/fal/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app }) });
    //         return (await res.json()).token;
    //     },
    //     onResult: async (result) => {
    //         if (result.error) return console.error("Server Error:", result.error);
            
    //         if (result.type === 'ready') {
    //             peerConnection = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    //             localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
                
    //             peerConnection.ontrack = (event) => {
    //                 if (isVonageInitialized) return;
    //                 const aiVideoTrack = event.streams[0].getVideoTracks()[0];
    //                 if (aiVideoTrack) {
    //                     isVonageInitialized = true;
    //                     initializeVonage(vonageData, aiVideoTrack, rawAudioTrack);
    //                 }
    //             };
                
    //             peerConnection.onicecandidate = (event) => {
    //                 if (event.candidate) falConnection.send({ type: 'candidate', candidate: event.candidate.candidate, sdpMid: event.candidate.sdpMid, sdpMLineIndex: event.candidate.sdpMLineIndex });
    //             };
                
    //             const offer = await peerConnection.createOffer();
    //             await peerConnection.setLocalDescription(offer);
    //             falConnection.send({ type: 'offer', sdp: offer.sdp });
    //         }
    //         if (result.type === 'answer' && result.sdp) await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: result.sdp }));
    //         if (result.type === 'candidate' && result.candidate) await peerConnection.addIceCandidate(new RTCIceCandidate({ candidate: result.candidate, sdpMid: result.sdpMid, sdpMLineIndex: result.sdpMLineIndex }));
    //     },
    //     onError: (err) => setStatus("AI error: " + err.message, true)
    // });

    // falConnection.send({ prompt: "A cyberpunk hacker with glowing neon glasses", enable_prompt_expansion: true });
    ui.stopBtn.disabled = false;
    ui.toggleAIBtn.disabled = false;
});

function initializeVonage(data, videoTrack, audioTrack) {
    vonageSession = OT.initSession(data.applicationId, data.sessionId);
    // const customStream = new MediaStream([videoTrack, audioTrack]);
    
    // const publisher = OT.initPublisher('publisher', {
    //     videoSource: customStream.getVideoTracks()[0],
    //     audioSource: customStream.getAudioTracks()[0],
    //     insertMode: 'append', width: '100%', height: '100%'
    // });

    vonagePublisher = OT.initPublisher('publisher', {
        videoSource: videoTrack, 
        audioSource: audioTrack,
        insertMode: 'append', width: '100%', height: '100%'
    });

    vonageSession.on('signal:chat', (event) => {
        const msgData = JSON.parse(event.data);
        appendChat(msgData.sender, msgData.text);
    });

    vonageSession.on('signal:avatar', (event) => {
        if (falConnection) {
            falConnection.send({ prompt: event.data, enable_prompt_expansion: true });
            setStatus(`Viewer changed avatar to: ${event.data}`);
        }
    });

    vonageSession.connect(data.token, (err) => {
        if (!err) {
            vonageSession.publish(vonagePublisher);
            ui.actionBar.style.display = 'flex';
            setStatus("Live! Waiting for viewers.");
        }
    });
}


function startAIFilter() {
    falConnection = fal.realtime.connect("decart/lucy-2-5/realtime", {
        tokenProvider: async (app) => {
            const res = await fetch('/api/fal/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app }) });
            return (await res.json()).token;
        },
        onResult: async (result) => {
            if (result.error) return console.error("Server Error:", result.error);
            
            if (result.type === 'ready') {
                peerConnection = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
                localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
                
                peerConnection.ontrack = async (event) => {
                    const aiVideoTrack = event.streams[0].getVideoTracks()[0];
                    if (aiVideoTrack) {
                        // The magic line: Hot-swap the Vonage broadcast to the new AI track
                        await vonagePublisher.setVideoSource(aiVideoTrack);
                        
                        toggleAIBtn.innerText = "Turn AI Off";
                        toggleAIBtn.disabled = false;
                        setStatus("AI Avatar active!");
                    }
                };
                
                peerConnection.onicecandidate = (event) => {
                    if (event.candidate) falConnection.send({ type: 'candidate', candidate: event.candidate.candidate, sdpMid: event.candidate.sdpMid, sdpMLineIndex: event.candidate.sdpMLineIndex });
                };
                
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                falConnection.send({ type: 'offer', sdp: offer.sdp });
            }
            if (result.type === 'answer' && result.sdp) await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: result.sdp }));
            if (result.type === 'candidate' && result.candidate) await peerConnection.addIceCandidate(new RTCIceCandidate({ candidate: result.candidate, sdpMid: result.sdpMid, sdpMLineIndex: result.sdpMLineIndex }));
        },
        onError: (err) => {
            setStatus("AI error: " + err.message, true);
            toggleAIBtn.innerText = "Turn AI On";
            toggleAIBtn.disabled = false;
            isAIFilterOn = false;
        }
    });

    falConnection.send({ prompt: "A cyberpunk hacker with glowing neon glasses", enable_prompt_expansion: true });
}

// --- Toggle AI Filter ---
ui.toggleAIBtn.addEventListener('click', () => {
    if (isAIFilterOn) {
        // --- TURN AI OFF ---
        isAIFilterOn = false;
        toggleAIBtn.innerText = "Turn AI On";
        
        // 1. Hot-swap the broadcast back to the raw webcam
        vonagePublisher.setVideoSource(localStream.getVideoTracks()[0]);
        
        // 2. Kill the fal.ai WebRTC pipeline to instantly stop billing
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        if (falConnection) {
            falConnection.close();
            falConnection = null;
        }
        setStatus("AI Filter off. Broadcasting raw camera.");
    } else {
        // --- TURN AI ON ---
        isAIFilterOn = true;
        toggleAIBtn.innerText = "Starting AI...";
        toggleAIBtn.disabled = true; // Prevent double-clicking
        
        startAIFilter();
    }
});

// --- Start / Stop Composer ---
ui.startComposerBtn.addEventListener('click', async () => {
    if (activeRenderId) {
        await fetch('/api/composer/stop', { 
            method: 'POST', headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ renderId: activeRenderId }) 
        });
        activeRenderId = null;
        activeRenderStreamId = null;
        ui.startComposerBtn.innerText = "1. Start Composer Layout";
        ui.startBroadcastBtn.disabled = true;
        ui.startArchiveBtn.disabled = true;
        setStatus("Composer Layout Stopped.");
    } else {
        setStatus("Starting Composer...");
        const res = await fetch('/api/composer/start', { 
            method: 'POST', headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ sessionId: vonageSession.sessionId, roomName: ui.roomName.value, codespaceUrl: ui.codespaceUrl.value }) 
        });
        
        const composerData = await res.json();
        console.log("Composer Data:", composerData);
        activeRenderId = composerData.id;
        activeRenderStreamId = composerData.streamId; 
        
        ui.startComposerBtn.innerText = "Stop Composer Layout";
        ui.startBroadcastBtn.disabled = false;
        ui.startArchiveBtn.disabled = false;
        setStatus("Composer Layout initialized! Ready to broadcast.");
    }
});

// --- Start / Stop Broadcast ---
ui.startBroadcastBtn.addEventListener('click', async () => {
    if (activeBroadcastId) {
        await fetch('/api/broadcast/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ broadcastId: activeBroadcastId }) });
        ui.startBroadcastBtn.innerText = "2. Start HLS Broadcast";
        activeBroadcastId = null;
    } else {
        const res = await fetch('/api/broadcast/start', { 
            method: 'POST', headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ sessionId: vonageSession.sessionId }) 
        });
        const broadcastData = await res.json();
        console.log("Broadcast Data:", broadcastData);
        activeBroadcastId = broadcastData.id;

        await fetch('/api/broadcast/add-stream', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ broadcastId: activeBroadcastId, streamId: activeRenderStreamId })
        });

        ui.startBroadcastBtn.innerText = "Stop Broadcast";
        console.log("HLS URL FOR WATCH PAGE:", broadcastData.broadcastUrls.hls);
    }
});

// --- Start / Stop Archive ---
ui.startArchiveBtn.addEventListener('click', async () => {
    if (activeArchiveId) {
        await fetch('/api/archive/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archiveId: activeArchiveId }) });
        ui.startArchiveBtn.innerText = "3. Start Recording";
        activeArchiveId = null;
    } else {
        const res = await fetch('/api/archive/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: vonageSession.sessionId }) });
        activeArchiveId = (await res.json()).id;
        
        await fetch('/api/archive/add-stream', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ archiveId: activeArchiveId, streamId: activeRenderStreamId })
        });
        
        ui.startArchiveBtn.innerText = "Stop Recording";
    }
});

// --- Full Cleanup ---
ui.stopBtn.addEventListener('click', () => {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (falConnection) falConnection.close();
    if (vonageSession) vonageSession.disconnect();
    if (localStream) localStream.getTracks().forEach(track => track.stop());

    isVonageInitialized = false; 
    setStatus("Disconnected. Billing stopped.");
    ui.joinBtn.disabled = false;
    ui.stopBtn.disabled = true;
});