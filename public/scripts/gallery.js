// Галерея
window.gallery = {
    async fetchMedia() {
        try {
            const res = await fetch('/api/media');
            window.mediaList = await res.json();
            await Promise.all([window.auth.fetchLikes(), window.auth.fetchComments()]);
            this.renderGallery();
        } catch (err) {
            window.utils.showToast('Ошибка загрузки');
        }
    },

    renderGallery() {
        const galleryEl = document.getElementById('gallery');
        if (!galleryEl) return;
        galleryEl.innerHTML = '';
        if (window.mediaList.length === 0) {
            galleryEl.innerHTML = '<div class="empty-message">🎈 Галерея пуста. Добавьте фото или видео!</div>';
            return;
        }
        window.mediaList.forEach((item, idx) => {
            const like = window.likesData[item.id] || { count: 0, liked: false };
            const comments = window.commentsData[item.id] || [];
            const post = this.createPostElement(item, idx, like, comments);
            galleryEl.appendChild(post);
            if (item.type.startsWith('video/')) {
                const videoUrl = `/uploads/${item.filename}`;
                const durationSpan = post.querySelector('.video-duration');
                window.utils.getVideoDuration(videoUrl, dur => {
                    if (durationSpan) durationSpan.innerText = window.utils.formatDuration(dur);
                });
            }
        });
        const counter = document.getElementById('mediaCounter');
        if (counter) counter.innerText = `📦 Медиа: ${window.mediaList.length}`;
    },

    createPostElement(item, idx, like, comments) {
        const div = document.createElement('div');
        div.className = 'post';
        div.dataset.id = item.id;
        const mediaDiv = document.createElement('div');
        mediaDiv.className = 'post-media';
        const fileUrl = `/uploads/${item.filename}`;
        if (item.type.startsWith('image/')) {
            const img = document.createElement('img');
            img.src = fileUrl;
            mediaDiv.appendChild(img);
        } else {
            const video = document.createElement('video');
            video.src = fileUrl;
            video.preload = 'metadata';
            mediaDiv.appendChild(video);
            const durSpan = document.createElement('div');
            durSpan.className = 'video-duration';
            durSpan.innerText = '0:00';
            mediaDiv.appendChild(durSpan);
        }
        const delBtn = document.createElement('button');
        delBtn.innerHTML = '❌';
        delBtn.className = 'delete-post-btn';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            this.deleteMedia(item.id);
        };
        mediaDiv.appendChild(delBtn);
        mediaDiv.onclick = () => window.lightbox.openLightbox(idx);
        div.appendChild(mediaDiv);
        const statsDiv = document.createElement('div');
        statsDiv.className = 'post-stats';
        const countsDiv = document.createElement('div');
        countsDiv.className = 'like-comment-count';
        const likeSpan = document.createElement('span');
        likeSpan.innerHTML = `<i class="${like.liked ? 'fas' : 'far'} fa-heart"></i> ${like.count}`;
        likeSpan.onclick = async (e) => {
            e.stopPropagation();
            const newLiked = await window.auth.saveLike(item.id);
            if (newLiked !== null) await window.auth.fetchLikes();
            this.renderGallery();
        };
        const commentSpan = document.createElement('span');
        commentSpan.innerHTML = `<i class="far fa-comment"></i> ${comments.length}`;
        commentSpan.onclick = (e) => {
            e.stopPropagation();
            window.lightbox.openLightbox(idx);
        };
        countsDiv.appendChild(likeSpan);
        countsDiv.appendChild(commentSpan);
        statsDiv.appendChild(countsDiv);
        div.appendChild(statsDiv);
        return div;
    },

    async deleteMedia(id) {
        if (!confirm('🗑️ Удалить этот пост?')) return;
        const pin = prompt('🔐 Введите пин-код для удаления поста:');
        if (pin !== '6666') {
            if (pin) window.utils.showToast('❌ Неверный пин-код');
            return;
        }
        try {
            const res = await fetch(`/api/media/${id}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin })
            });
            if (res.ok) {
                window.utils.showToast('✅ Пост удалён');
                await this.fetchMedia();
                if (document.getElementById('lightbox').classList.contains('active') &&
                    window.mediaList[window.currentLightboxIndex]?.id === id) {
                    window.lightbox.closeLightbox();
                }
            } else {
                const data = await res.json();
                window.utils.showToast(`❌ Ошибка: ${data.error || 'Не удалось удалить'}`);
            }
        } catch (err) {
            window.utils.showToast('❌ Ошибка соединения');
        }
    },

    async clearAllMedia() {
        const pin = prompt('🔐 Введите пин-код для очистки ВСЕЙ галереи:');
        if (pin !== '6666') {
            if (pin) window.utils.showToast('❌ Неверный пин-код');
            return;
        }
        if (!confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ публикации без возможности восстановления. Продолжить?')) return;
        try {
            const res = await fetch('/api/media', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin })
            });
            if (res.ok) {
                window.utils.showToast('✅ Вся галерея очищена');
                await this.fetchMedia();
            } else {
                const data = await res.json();
                window.utils.showToast(`❌ Ошибка: ${data.error || 'Не удалось очистить'}`);
            }
        } catch (err) {
            window.utils.showToast('❌ Ошибка соединения');
        }
    },

    async uploadFiles(files) {
        const fd = new FormData();
        let added = 0;
        for (let f of files) {
            if (f.type.startsWith('image/') || f.type.startsWith('video/')) {
                fd.append('files', f);
                added++;
            }
        }
        if (!added) {
            window.utils.showToast('Нет подходящих файлов');
            return;
        }
        try {
            const res = await fetch('/api/upload', { method: 'POST', body: fd });
            const result = await res.json();
            if (result.success) {
                window.utils.showToast(`✅ Загружено ${result.uploaded.length} файлов`);
                await this.fetchMedia();
            } else {
                window.utils.showToast('Ошибка');
            }
        } catch(e) {
            window.utils.showToast('Ошибка');
        }
    },

    setupDragDrop() {
        const dz = document.getElementById('dropZone');
        if (!dz) return;
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev =>
            dz.addEventListener(ev, e => e.preventDefault())
        );
        dz.addEventListener('dragenter', () => dz.classList.add('drag-over'));
        dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
        dz.addEventListener('drop', (e) => {
            dz.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length) this.uploadFiles(Array.from(files));
        });
        dz.addEventListener('click', () => document.getElementById('fileInput').click());
    },

    updateAvatar() {
        const container = document.getElementById('avatarContainer');
        if (!container) return;
        if (window.currentUser.avatar_url) {
            container.innerHTML = `<img class="avatar" src="${window.currentUser.avatar_url}">`;
        } else {
            container.innerHTML = `<div class="avatar-placeholder">👤</div>`;
        }
    },

    async renderMainApp() {
        const app = document.getElementById('app');
        app.innerHTML = `
            <div class="container">
                <div class="gallery-section">
                    <div class="hero"><h1>🎬 VasukHub 📸</h1><p>Сетка публикаций — загружай, лайкай, комментируй!</p></div>
                    <div class="profile-bar">
                        <div id="avatarContainer"></div>
                        <span><strong>${window.utils.escapeHtml(window.currentUser.username)}</strong></span>
                        <button class="btn" id="changeAvatarBtn" style="padding:4px 12px;">📷 Аватар</button>
                        <button class="btn" id="logoutBtn" style="padding:4px 12px;">🚪 Выйти</button>
                    </div>
                    <div class="upload-panel">
                        <div class="button-group">
                            <button class="btn btn-primary" id="uploadBtn">📁 + Добавить файлы</button>
                            <button class="btn btn-danger" id="clearAllBtn">🧹 Очистить всё</button>
                        </div>
                        <div class="drop-zone" id="dropZone">📀 Перетащи файлы сюда</div>
                        <input type="file" id="fileInput" multiple accept="image/*,video/*" style="display: none;">
                    </div>
                    <div class="stats">
                        <div class="counter-badge" id="mediaCounter">📦 Медиа: 0</div>
                        <div class="clear-info">❌ Удаление доступно всем</div>
                    </div>
                    <div class="gallery" id="gallery"><div class="empty-message">Загрузка...</div></div>
                </div>
                <div class="chat-section">
                    <div class="chat-header"><h3>💬 Чат</h3><button id="clearChatBtn" class="btn btn-small">🧹 Очистить</button></div>
                    <div class="chat-messages" id="chatMessages"></div>
                    <div class="chat-input-area">
                        <input type="text" id="chatInput" placeholder="Сообщение...">
                        <button id="sendBtn">➤</button>
                    </div>
                </div>
            </div>
        `;

        this.updateAvatar();

        document.getElementById('uploadBtn').onclick = () => document.getElementById('fileInput').click();
        document.getElementById('fileInput').onchange = (e) => {
            if (e.target.files.length) this.uploadFiles(e.target.files);
            e.target.value = '';
        };
        document.getElementById('clearAllBtn').onclick = () => this.clearAllMedia();
        document.getElementById('logoutBtn').onclick = async () => {
            await fetch('/api/logout', { method: 'POST', credentials: 'include' });
            window.currentUser = null;
            if (window.socket) window.socket.disconnect();
            window.auth.renderAuthForm();
        };
        document.getElementById('changeAvatarBtn').onclick = () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const fd = new FormData();
                fd.append('avatar', file);
                const res = await fetch('/api/avatar', { method: 'POST', body: fd, credentials: 'include' });
                const data = await res.json();
                if (res.ok) {
                    window.currentUser.avatar_url = data.avatar_url;
                    this.updateAvatar();
                    window.utils.showToast('Аватар обновлён');
                } else {
                    window.utils.showToast('Ошибка');
                }
            };
            input.click();
        };
        document.getElementById('clearChatBtn').onclick = async () => {
            const pin = prompt('Введите пин-код администратора:');
            if (pin !== '6666') {
                if (pin) window.utils.showToast('Неверный пин');
                return;
            }
            const res = await fetch('/api/chat', { method: 'DELETE', headers: { 'X-Pin': pin } });
            if (res.ok) window.utils.showToast('Чат очищен');
            else window.utils.showToast('Ошибка');
        };

        this.setupDragDrop();
        await this.fetchMedia();
        window.chat.initChat();
        setInterval(() => this.fetchMedia(), 10000);
    }
};