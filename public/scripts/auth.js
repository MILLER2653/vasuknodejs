// Авторизация
window.auth = {
    async fetchLikes() {
        try {
            const res = await fetch('/api/likes', { credentials: 'include' });
            window.likesData = await res.json();
        } catch (err) {
            console.error(err);
        }
    },

    async fetchComments() {
        try {
            const res = await fetch('/api/comments', { credentials: 'include' });
            window.commentsData = await res.json();
        } catch (err) {
            console.error(err);
        }
    },

    async saveLike(mediaId) {
        try {
            const res = await fetch('/api/likes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mediaId, isLiked: true }),
                credentials: 'include'
            });
            const data = await res.json();
            return data.liked;
        } catch (err) {
            console.error(err);
            return null;
        }
    },

    async addComment(mediaId, text) {
        try {
            const res = await fetch('/api/comments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mediaId, text }),
                credentials: 'include'
            });
            const data = await res.json();
            if (data.success) {
                await this.fetchComments();
                return true;
            }
            return false;
        } catch (err) {
            console.error(err);
            return false;
        }
    },

    showKeyPage() {
        const savedKey = sessionStorage.getItem('vasukhub_key');
        if (savedKey === '6666') {
            this.startApp();
            return;
        }
        const overlay = document.createElement('div');
        overlay.className = 'key-overlay';
        overlay.innerHTML = `
            <div class="key-card">
                <div class="key-icon"><i class="fas fa-shield-alt"></i></div>
                <h2>Доступ ограничен</h2>
                <p>Введите секретный ключ для входа</p>
                <div class="key-input-group">
                    <i class="fas fa-key"></i>
                    <input type="password" class="key-input" id="secretKeyInput" placeholder="****" maxlength="4" autofocus>
                </div>
                <button class="key-submit" id="submitKeyBtn"><i class="fas fa-arrow-right"></i> Войти</button>
                <div class="key-error" id="keyError"></div>
            </div>
        `;
        document.body.appendChild(overlay);
        const input = overlay.querySelector('#secretKeyInput');
        const btn = overlay.querySelector('#submitKeyBtn');
        const errorDiv = overlay.querySelector('#keyError');
        const handle = () => {
            if (input.value.trim() === '6666') {
                sessionStorage.setItem('vasukhub_key', '6666');
                overlay.remove();
                this.startApp();
            } else {
                errorDiv.innerHTML = '<i class="fas fa-exclamation-circle"></i> Неверный ключ доступа!';
                input.value = '';
                input.focus();
                input.style.borderColor = '#e53e3e';
                setTimeout(() => input.style.borderColor = '#e2e8f0', 1000);
            }
        };
        btn.onclick = handle;
        input.onkeypress = (e) => { if (e.key === 'Enter') handle(); };
        input.focus();
    },

    async startApp() {
        await this.checkAuth();
    },

    async checkAuth() {
        try {
            const res = await fetch('/api/me', { credentials: 'include' });
            if (res.ok) {
                window.currentUser = await res.json();
                window.gallery.renderMainApp();
            } else {
                this.renderAuthForm();
            }
        } catch (err) {
            this.renderAuthForm();
        }
    },

    renderAuthForm() {
        const app = document.getElementById('app');
        app.innerHTML = `
            <div class="auth-container">
                <div class="auth-card">
                    <h2>🎬 VasukHub</h2>
                    <div id="authForm">
                        <input type="text" id="authUsername" placeholder="Имя пользователя">
                        <input type="password" id="authPassword" placeholder="Пароль">
                        <div id="confirmPasswordGroup" style="display:none;">
                            <input type="password" id="confirmPassword" placeholder="Подтвердите пароль">
                        </div>
                        <div class="auth-buttons">
                            <button class="btn btn-primary" id="authLoginBtn">Войти</button>
                            <button class="btn" id="authRegisterBtn">Зарегистрироваться</button>
                        </div>
                        <div id="authError" style="color:red; margin-top:10px;"></div>
                    </div>
                </div>
            </div>
        `;
        let isLoginMode = true;
        const loginBtn = document.getElementById('authLoginBtn');
        const registerBtn = document.getElementById('authRegisterBtn');
        const confirmGroup = document.getElementById('confirmPasswordGroup');
        const username = document.getElementById('authUsername');
        const password = document.getElementById('authPassword');
        const errorDiv = document.getElementById('authError');
        const update = () => {
            if (isLoginMode) {
                loginBtn.style.background = 'linear-gradient(95deg, #FF8066, #F94C6A)';
                registerBtn.style.background = 'white';
                confirmGroup.style.display = 'none';
            } else {
                loginBtn.style.background = 'white';
                registerBtn.style.background = 'linear-gradient(95deg, #FF8066, #F94C6A)';
                confirmGroup.style.display = 'block';
            }
        };
        registerBtn.onclick = () => {
            if (isLoginMode) {
                isLoginMode = false;
                update();
            } else {
                const uname = username.value.trim();
                const pwd = password.value;
                const confirm = document.getElementById('confirmPassword').value;
                if (!uname || !pwd) {
                    errorDiv.innerText = 'Заполните поля';
                    return;
                }
                if (pwd !== confirm) {
                    errorDiv.innerText = 'Пароли не совпадают';
                    return;
                }
                this.registerUser(uname, pwd);
            }
        };
        loginBtn.onclick = () => {
            if (!isLoginMode) {
                isLoginMode = true;
                update();
            } else {
                const uname = username.value.trim();
                const pwd = password.value;
                if (!uname || !pwd) {
                    errorDiv.innerText = 'Заполните поля';
                    return;
                }
                this.loginUser(uname, pwd);
            }
        };
        update();
    },

    async registerUser(username, password) {
        try {
            const res = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
                credentials: 'include'
            });
            const data = await res.json();
            if (res.ok) {
                window.currentUser = data.user;
                window.gallery.renderMainApp();
            } else {
                document.getElementById('authError').innerText = data.error;
            }
        } catch (err) {
            document.getElementById('authError').innerText = 'Ошибка соединения';
        }
    },

    async loginUser(username, password) {
        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
                credentials: 'include'
            });
            const data = await res.json();
            if (res.ok) {
                window.currentUser = data.user;
                window.gallery.renderMainApp();
            } else {
                document.getElementById('authError').innerText = data.error;
            }
        } catch (err) {
            document.getElementById('authError').innerText = 'Ошибка соединения';
        }
    }
};