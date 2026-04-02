// Чат
window.chat = {
    initChat() {
        if (window.socket) window.socket.disconnect();
        window.socket = io();

        window.socket.on('connect', () => {
            window.socket.emit('join', window.currentUser.id);
        });

        window.socket.on('chat history', (msgs) => {
            const div = document.getElementById('chatMessages');
            if (div) {
                div.innerHTML = '';
                msgs.forEach(m => this.addMessageToChat(m.nickname, m.text, m.timestamp));
            }
        });

        window.socket.on('chat message', m => {
            this.addMessageToChat(m.nickname, m.text, m.timestamp);
        });

        window.socket.on('chat cleared', () => {
            const div = document.getElementById('chatMessages');
            if (div) div.innerHTML = '<div class="message">Чат очищен</div>';
            window.utils.showToast('Чат очищен');
        });

        const input = document.getElementById('chatInput');
        const btn = document.getElementById('sendBtn');
        if (input && btn) {
            const send = () => {
                const t = input.value.trim();
                if (t) {
                    window.socket.emit('chat message', { text: t });
                    input.value = '';
                    input.focus();
                }
            };
            btn.onclick = send;
            input.onkeypress = (e) => {
                if (e.key === 'Enter') send();
            };
        }
    },

    addMessageToChat(nick, text, ts) {
        const div = document.getElementById('chatMessages');
        if (!div) return;
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message';
        const timeStr = ts ? new Date(ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
        msgDiv.innerHTML = `<strong>${window.utils.escapeHtml(nick)}</strong> <small>${timeStr}</small><br>${window.utils.escapeHtml(text)}`;
        div.appendChild(msgDiv);
        div.scrollTop = div.scrollHeight;
    }
};