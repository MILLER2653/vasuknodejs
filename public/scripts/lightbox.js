// Лайтбокс
window.lightbox = {
    lightbox: null,

    init() {
        this.lightbox = document.createElement('div');
        this.lightbox.className = 'lightbox';
        this.lightbox.id = 'lightbox';
        document.body.appendChild(this.lightbox);
    },

    async openLightbox(index) {
        if (!window.mediaList.length) return;
        window.currentLightboxIndex = (index + window.mediaList.length) % window.mediaList.length;
        await this.renderLightbox();
        this.lightbox.classList.add('active');
    },

    closeLightbox() {
        this.lightbox.classList.remove('active');
        const video = this.lightbox.querySelector('video');
        if (video) video.pause();
    },

    async renderLightbox() {
        const item = window.mediaList[window.currentLightboxIndex];
        if (!item) return;
        const fileUrl = `/uploads/${item.filename}`;
        const like = window.likesData[item.id] || { count: 0, liked: false };
        const comments = window.commentsData[item.id] || [];

        this.lightbox.innerHTML = `
            <div class="lightbox-container">
                <span class="lightbox-close">&times;</span>
                <button class="lightbox-prev">❮</button>
                <button class="lightbox-next">❯</button>
                <div class="lightbox-media-area" id="lightbox-media-area">
                    ${item.type.startsWith('image/') ?
            `<img class="lightbox-media" src="${fileUrl}" alt="">` :
            `<video class="lightbox-media" src="${fileUrl}" controls autoplay></video>`}
                </div>
                <div class="lightbox-comments-area">
                    <div class="lightbox-header">
                        <h4><i class="far fa-comment"></i> Комментарии (${comments.length})</h4>
                        <button class="lightbox-like-btn ${like.liked ? 'liked' : ''}" id="lightbox-like-btn">
                            <i class="${like.liked ? 'fas' : 'far'} fa-heart"></i> 
                            <span id="lightbox-like-count">${like.count}</span>
                        </button>
                    </div>
                    <div class="lightbox-comments-list" id="lightbox-comments-list"></div>
                    <div class="lightbox-comment-input-area">
                        <input type="text" class="lightbox-comment-input" id="lightbox-comment-input" 
                               placeholder="Написать комментарий...">
                        <button class="btn btn-small" id="lightbox-send-comment">💬 Отправить</button>
                    </div>
                </div>
                <div class="lightbox-counter">${window.currentLightboxIndex + 1} / ${window.mediaList.length}</div>
            </div>
        `;

        const commentsList = document.getElementById('lightbox-comments-list');
        commentsList.innerHTML = comments.map(c => `
            <div class="lightbox-comment-item">
                <strong>${window.utils.escapeHtml(c.user)}</strong>
                <small>${new Date(c.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</small><br>
                ${window.utils.escapeHtml(c.text)}
            </div>
        `).join('');

        if (!comments.length) {
            commentsList.innerHTML = '<div style="color:#886b5e; text-align:center; padding:20px;">💬 Нет комментариев. Будьте первым!</div>';
        }

        this.attachLightboxEvents(item.id);
    },

    attachLightboxEvents(itemId) {
        const closeBtn = this.lightbox.querySelector('.lightbox-close');
        const prevBtn = this.lightbox.querySelector('.lightbox-prev');
        const nextBtn = this.lightbox.querySelector('.lightbox-next');
        const likeBtn = this.lightbox.querySelector('#lightbox-like-btn');
        const sendBtn = this.lightbox.querySelector('#lightbox-send-comment');
        const commentInput = this.lightbox.querySelector('#lightbox-comment-input');

        closeBtn.onclick = () => this.closeLightbox();
        prevBtn.onclick = async () => {
            window.currentLightboxIndex = (window.currentLightboxIndex - 1 + window.mediaList.length) % window.mediaList.length;
            await this.renderLightbox();
        };
        nextBtn.onclick = async () => {
            window.currentLightboxIndex = (window.currentLightboxIndex + 1) % window.mediaList.length;
            await this.renderLightbox();
        };
        likeBtn.onclick = async () => {
            const newLiked = await window.auth.saveLike(itemId);
            if (newLiked !== null) {
                await window.auth.fetchLikes();
                await this.renderLightbox();
            }
        };
        sendBtn.onclick = async () => {
            const text = commentInput.value.trim();
            if (text) {
                const ok = await window.auth.addComment(itemId, text);
                if (ok) {
                    commentInput.value = '';
                    await this.renderLightbox();
                }
            }
        };
        commentInput.onkeypress = async (e) => {
            if (e.key === 'Enter') {
                const text = commentInput.value.trim();
                if (text) {
                    const ok = await window.auth.addComment(itemId, text);
                    if (ok) {
                        commentInput.value = '';
                        await this.renderLightbox();
                    }
                }
            }
        };

        this.lightbox.onclick = (e) => {
            if (e.target === this.lightbox) this.closeLightbox();
        };

        const keyHandler = (e) => {
            if (!this.lightbox.classList.contains('active')) return;
            if (e.key === 'ArrowLeft') {
                window.currentLightboxIndex = (window.currentLightboxIndex - 1 + window.mediaList.length) % window.mediaList.length;
                this.renderLightbox();
            }
            if (e.key === 'ArrowRight') {
                window.currentLightboxIndex = (window.currentLightboxIndex + 1) % window.mediaList.length;
                this.renderLightbox();
            }
            if (e.key === 'Escape') this.closeLightbox();
        };

        document.removeEventListener('keydown', keyHandler);
        document.addEventListener('keydown', keyHandler);
    }
};