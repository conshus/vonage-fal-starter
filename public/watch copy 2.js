const urlParams = new URLSearchParams(window.location.search);
const room = urlParams.get('room') || 'hackbarna';
document.getElementById('displayRoomName').innerText = room;

const ui = {
    video: document.getElementById('hlsPlayer'),
    chatHistory: document.getElementById('chatHistory'),
    chatInput: document.getElementById('chatInput'),
    sendChatBtn: document.getElementById('sendChatBtn'),
    avatarBtns: document.querySelectorAll('.viewer-avatar-btn'),
    joinModal: document.getElementById('joinModal'),
    viewerNameInput: document.getElementById('viewerName')
};

let vonageSession;
let viewerName = 'Anonymous';

// 1. Force the native dialog open on top of the rest of the UI
ui.joinModal.showModal();

// Prevent the user from bypassing the form by pressing the Escape key
ui.joinModal.addEventListener('cancel', (e) => {
    e.preventDefault(); 
});

function appendChat(sender, message) {
    const msgEl = document.createElement('div');
    msgEl.innerHTML = `<strong>${sender}:</strong> ${message}`;
    ui.chatHistory.appendChild(msgEl);
    ui.chatHistory.scrollTop = ui.chatHistory.scrollHeight;
}

// 2. The 'close' event automatically fires when the form inside is submitted
ui.joinModal.addEventListener('close', async () => {
    viewerName = ui.viewerNameInput.value.trim() || 'Anonymous';
    
    // Check if stream is live and get HLS URL
    const hlsRes = await fetch(`/api/broadcast/hls/${room}`);
    if (hlsRes.ok) {
        const { hlsUrl } = await hlsRes.json();
        
        // Play HLS (Autoplay works perfectly because they interacted with the dialog)
        if (Hls.isSupported()) {
            const hls = new Hls();
            hls.loadSource(hlsUrl);
            hls.attachMedia(ui.video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => ui.video.play());
        } else if (ui.video.canPlayType('application/vnd.apple.mpegurl')) {
            ui.video.src = hlsUrl;
            ui.video.addEventListener('loadedmetadata', () => ui.video.play());
        }
    } else {
        appendChat('System', 'Broadcast is not currently live. Wait a moment and refresh.');
    }

    // Connect to Vonage Session for Signaling
    const vonageRes = await fetch(`/room/${room}`);
    const vonageData = await vonageRes.json();
    
    vonageSession = OT.initSession(vonageData.applicationId, vonageData.sessionId);
    
    vonageSession.on('signal:chat', (event) => {
        const msgData = JSON.parse(event.data);
        appendChat(msgData.sender, msgData.text);
    });

    vonageSession.connect(vonageData.token, (err) => {
        if (!err) console.log("Connected to Signaling channel");
    });
});

ui.sendChatBtn.addEventListener('click', () => {
    if (vonageSession && ui.chatInput.value) {
        vonageSession.signal({ 
            type: 'chat', 
            data: JSON.stringify({ sender: viewerName, text: ui.chatInput.value }) 
        });
        ui.chatInput.value = '';
    }
});

ui.avatarBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        if (vonageSession) {
            vonageSession.signal({ type: 'avatar', data: e.target.getAttribute('data-prompt') });
        }
    });
});