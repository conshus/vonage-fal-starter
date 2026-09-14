const ui = {
    roomName: document.getElementById('roomName'),
    hlsUrl: document.getElementById('hlsUrl'),
    joinBtn: document.getElementById('joinBtn'),
    video: document.getElementById('hlsPlayer'),
    chatHistory: document.getElementById('chatHistory'),
    chatInput: document.getElementById('chatInput'),
    sendChatBtn: document.getElementById('sendChatBtn'),
    avatarBtns: document.querySelectorAll('.viewer-avatar-btn')
};

let vonageSession;

function appendChat(sender, message) {
    const msgEl = document.createElement('div');
    msgEl.innerHTML = `<strong>${sender}:</strong> ${message}`;
    ui.chatHistory.appendChild(msgEl);
    ui.chatHistory.scrollTop = ui.chatHistory.scrollHeight;
}

ui.joinBtn.addEventListener('click', async () => {
    const room = ui.roomName.value.trim();
    const hlsUrl = ui.hlsUrl.value.trim();
    
    if (Hls.isSupported() && hlsUrl) {
        const hls = new Hls();
        hls.loadSource(hlsUrl);
        hls.attachMedia(ui.video);
    }

    const vonageRes = await fetch(`/room/${room}`);
    const vonageData = await vonageRes.json();
    
    vonageSession = OT.initSession(vonageData.applicationId, vonageData.sessionId);
    
    vonageSession.on('signal:chat', (event) => {
        const msgData = JSON.parse(event.data);
        appendChat(msgData.sender, msgData.text);
    });

    vonageSession.connect(vonageData.token, (err) => {
        if (!err) console.log("Connected for Signaling");
    });
});

ui.sendChatBtn.addEventListener('click', () => {
    if (vonageSession && ui.chatInput.value) {
        vonageSession.signal({ type: 'chat', data: JSON.stringify({ sender: 'Viewer', text: ui.chatInput.value }) });
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