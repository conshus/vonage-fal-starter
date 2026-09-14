import { fal } from "https://esm.sh/@fal-ai/client";

const ui = {
    roomName: document.getElementById('roomName'),
    joinBtn: document.getElementById('joinBtn'),
    stopBtn: document.getElementById('stopBtn'),
    toggleAIBtn: document.getElementById('toggleAIBtn'),
    startComposerBtn: document.getElementById('startComposerBtn'),
    startBroadcastBtn: document.getElementById('startBroadcastBtn'),
    startArchiveBtn: document.getElementById('startArchiveBtn'),
    actionBar: document.getElementById('actionBar'),
    codespaceUrl: document.getElementById('codespaceUrl'),
    statusMsg: document.getElementById('statusMsg'),
    chatHistory: document.getElementById('chatHistory'),
    chatInput: document.getElementById('chatInput'),
    sendChatBtn: document.getElementById('sendChatBtn'),
    avatarBtns: document.querySelectorAll('.avatar-btn')
};

let vonageSession, vonagePublisher, falConnection, localStream, peerConnection;
let activeRenderId = null, activeRenderStreamId = null;
let activeBroadcastId = null, activeArchiveId = null;
let isAIFilterOn = false;

// --- Canvas Proxy Setup ---
const canvas = document.createElement('canvas');
canvas.width = 1280;
canvas.height = 720;
const ctx = canvas.getContext('2d');

const rawVideo = document.createElement('video');
rawVideo.autoplay = true;
rawVideo.playsInline = true;
rawVideo.muted = true; // Prevent local audio feedback

const aiVideo = document.createElement('video');
aiVideo.autoplay = true;
aiVideo.playsInline = true;
aiVideo.muted = true;

// The central loop that continuously draws the active video feed to the canvas
function renderLoop() {
    if (isAIFilterOn && aiVideo.readyState >= 2) {
        ctx.drawImage(aiVideo, 0, 0, canvas.width, canvas.height);
    } else if (!isAIFilterOn && rawVideo.readyState >= 2) {
        ctx.drawImage(rawVideo, 0, 0, canvas.width, canvas.height);
    } else {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    requestAnimationFrame(renderLoop);
}
renderLoop(); // Start the loop immediately
// --------------------------

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
        if (falConnection) {
            falConnection.send({ prompt: prompt, enable_prompt_expansion: true });
            setStatus(`Avatar changed to: ${e.target.innerText}`);
        }
    });
});

ui.joinBtn.addEventListener('click', async () => {
    const room = ui.roomName.value.trim();
    ui.joinBtn.disabled = true;

    // 1. Get raw webcam and feed it to our hidden rawVideo element
    localStream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true });
    rawVideo.srcObject = localStream;
    const rawAudioTrack = localStream.getAudioTracks()[0];

    // 2. Capture the continuous video feed from our canvas proxy at 30 FPS
    const proxyStream = canvas.captureStream(30);
    const proxyVideoTrack = proxyStream.getVideoTracks()[0];

    const vonageRes = await fetch(`/room/${room}`);
    const vonageData = await vonageRes.json();

    // 3. Initialize Vonage with the permanent Canvas track
    initializeVonage(vonageData, proxyVideoTrack, rawAudioTrack);

    ui.stopBtn.disabled = false;
    ui.toggleAIBtn.disabled = false;
});

function initializeVonage(data, videoTrack, audioTrack) {
    vonageSession = OT.initSession(data.applicationId, data.sessionId);
    const customStream = new MediaStream([videoTrack, audioTrack]);

    vonagePublisher = OT.initPublisher('publisher', {
        videoSource: customStream.getVideoTracks()[0],
        audioSource: customStream.getAudioTracks()[0],
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
            setStatus("Live! Raw camera broadcasting.");
        }
    });
}

ui.toggleAIBtn.addEventListener('click', () => {
    if (isAIFilterOn) {
        // --- TURN AI OFF ---
        // Instantly switch the canvas back to the raw camera
        isAIFilterOn = false;
        ui.toggleAIBtn.innerText = "Turn AI On";

        aiVideo.srcObject = null;

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
        ui.toggleAIBtn.innerText = "Starting AI...";
        ui.toggleAIBtn.disabled = true;
        startAIFilter();
    }
});

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

                peerConnection.ontrack = (event) => {
                    const aiVideoTrack = event.streams[0].getVideoTracks()[0];
                    if (aiVideoTrack) {
                        // Feed the incoming AI track into our hidden AI video element
                        aiVideo.srcObject = new MediaStream([aiVideoTrack]);

                        // Tell the canvas loop to switch to drawing the AI feed
                        isAIFilterOn = true;

                        ui.toggleAIBtn.innerText = "Turn AI Off";
                        ui.toggleAIBtn.disabled = false;
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
            ui.toggleAIBtn.innerText = "Turn AI On";
            ui.toggleAIBtn.disabled = false;
            isAIFilterOn = false;
        }
    });

    falConnection.send({ prompt: "A cyberpunk hacker with glowing neon glasses", enable_prompt_expansion: true });
}

// --- Start / Stop Composer ---
ui.startComposerBtn.addEventListener('click', async () => {
    if (activeRenderId) {
        await fetch('/api/composer/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ renderId: activeRenderId }) });
        activeRenderId = null;
        activeRenderStreamId = null;
        ui.startComposerBtn.innerText = "1. Start Composer Layout";
        ui.startBroadcastBtn.disabled = true;
        ui.startArchiveBtn.disabled = true;
        setStatus("Composer Layout Stopped.");
    } else {
        setStatus("Starting Composer...");
        const res = await fetch('/api/composer/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: vonageSession.sessionId, roomName: ui.roomName.value, codespaceUrl: ui.codespaceUrl.value }) });
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
        await fetch('/api/broadcast/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ broadcastId: activeBroadcastId, sessionId: vonageSession.sessionId }) });
        ui.startBroadcastBtn.innerText = "2. Start HLS Broadcast";
        activeBroadcastId = null;
    } else {
        const res = await fetch('/api/broadcast/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: vonageSession.sessionId }) });
        const broadcastData = await res.json();
        console.log("Broadcast Data:", broadcastData);
        activeBroadcastId = broadcastData.id;

        // await fetch('/api/broadcast/add-stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ broadcastId: activeBroadcastId, streamId: activeRenderStreamId }) });
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
        // await fetch('/api/archive/add-stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archiveId: activeArchiveId, streamId: activeRenderStreamId }) });
        ui.startArchiveBtn.innerText = "Stop Recording";
    }
});

// --- Full Cleanup ---
ui.stopBtn.addEventListener('click', () => {
    isAIFilterOn = false;
    ui.toggleAIBtn.innerText = "Turn AI On";
    ui.toggleAIBtn.disabled = true;

    aiVideo.srcObject = null;
    rawVideo.srcObject = null;

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (falConnection) falConnection.close();
    if (vonageSession) vonageSession.disconnect();
    if (localStream) localStream.getTracks().forEach(track => track.stop());

    setStatus("Disconnected. Billing stopped.");
    ui.joinBtn.disabled = false;
    ui.stopBtn.disabled = true;
});