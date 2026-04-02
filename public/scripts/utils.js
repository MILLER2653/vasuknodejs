// Утилиты
window.utils = {
    formatDuration(sec) {
        if (isNaN(sec)) return '0:00';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    },

    getVideoDuration(url, cb) {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => {
            cb(v.duration);
            v.remove();
        };
        v.onerror = () => {
            cb(null);
            v.remove();
        };
        v.src = url;
    },

    escapeHtml(s) {
        return s.replace(/[&<>]/g, m => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;'
        }[m]));
    },

    showToast(msg, dur = 2000) {
        let t = document.querySelector('.toast-notify');
        if (t) t.remove();
        const toast = document.createElement('div');
        toast.className = 'toast-notify';
        toast.innerText = msg;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), dur);
    }
};

// Глобальные переменные
window.currentUser = null;
window.socket = null;
window.mediaList = [];
window.currentLightboxIndex = 0;
window.likesData = {};
window.commentsData = {};