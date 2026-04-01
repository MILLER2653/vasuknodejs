const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

app.use(session({
    secret: 'vasukhub_secret_key_2025',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));
app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/avatars', express.static(path.join(__dirname, 'avatars')));

const uploadDir = path.join(__dirname, 'uploads');
const avatarsDir = path.join(__dirname, 'avatars');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir);

// SQLite
const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'));

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        avatar_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        nickname TEXT,
        text TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS gallery (
        id TEXT PRIMARY KEY,
        filename TEXT,
        originalName TEXT,
        type TEXT,
        size INTEGER,
        uploadedAt DATETIME
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        media_id TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(media_id, user_id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        media_id TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        text TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// ========== ГАЛЕРЕЯ ==========
function loadGallery() {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM gallery ORDER BY uploadedAt DESC', (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}
function saveGalleryItem(item) {
    return new Promise((resolve, reject) => {
        db.run('INSERT INTO gallery (id, filename, originalName, type, size, uploadedAt) VALUES (?, ?, ?, ?, ?, ?)',
            [item.id, item.filename, item.originalName, item.type, item.size, item.uploadedAt],
            function(err) { if (err) reject(err); else resolve(); }
        );
    });
}
function deleteGalleryItem(id) {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM gallery WHERE id = ?', [id], function(err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
}
function clearGallery() {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM gallery', function(err) { if (err) reject(err); else resolve(); });
    });
}

// ========== ЛАЙКИ ==========
async function toggleLike(mediaId, userId) {
    const existing = await new Promise((resolve, reject) => {
        db.get('SELECT id FROM likes WHERE media_id = ? AND user_id = ?', [mediaId, userId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
    if (existing) {
        await new Promise((resolve, reject) => {
            db.run('DELETE FROM likes WHERE media_id = ? AND user_id = ?', [mediaId, userId], function(err) {
                if (err) reject(err);
                else resolve();
            });
        });
        return false; // лайк удалён
    } else {
        await new Promise((resolve, reject) => {
            db.run('INSERT INTO likes (media_id, user_id) VALUES (?, ?)', [mediaId, userId], function(err) {
                if (err) reject(err);
                else resolve();
            });
        });
        return true; // лайк добавлен
    }
}
function getLikesForMedia(mediaId) {
    return new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM likes WHERE media_id = ?', [mediaId], (err, row) => {
            if (err) reject(err);
            else resolve(row ? row.count : 0);
        });
    });
}
function getUserLikeStatus(mediaId, userId) {
    if (!userId) return Promise.resolve(false);
    return new Promise((resolve, reject) => {
        db.get('SELECT id FROM likes WHERE media_id = ? AND user_id = ?', [mediaId, userId], (err, row) => {
            if (err) reject(err);
            else resolve(!!row);
        });
    });
}

// ========== КОММЕНТАРИИ ==========
function addComment(mediaId, userId, text) {
    return new Promise((resolve, reject) => {
        db.run('INSERT INTO comments (media_id, user_id, text) VALUES (?, ?, ?)', [mediaId, userId, text], function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
        });
    });
}
function getCommentsForMedia(mediaId) {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT c.id, c.text, c.created_at, u.username as user
            FROM comments c
            JOIN users u ON c.user_id = u.id
            WHERE c.media_id = ?
            ORDER BY c.created_at ASC
        `, [mediaId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}
function deleteComment(commentId, userId) {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM comments WHERE id = ? AND user_id = ?', [commentId, userId], function(err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
}

// ========== API ==========
app.get('/api/media', async (req, res) => {
    try {
        const media = await loadGallery();
        res.json(media);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const multerStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, unique + ext);
    }
});
const upload = multer({ storage: multerStorage, limits: { fileSize: 500 * 1024 * 1024 } });

app.post('/api/upload', upload.array('files', 20), async (req, res) => {
    try {
        const newItems = req.files.map(file => ({
            id: Date.now() + '-' + Math.random().toString(36).substr(2, 8),
            filename: file.filename,
            originalName: file.originalname,
            type: file.mimetype,
            size: file.size,
            uploadedAt: new Date().toISOString()
        }));
        for (const item of newItems) await saveGalleryItem(item);
        res.json({ success: true, uploaded: newItems });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Удаление одного медиа
app.delete('/api/media/:id', async (req, res) => {
    // Пин-код может быть в теле или в заголовке (для совместимости)
    const pin = req.body.pin || req.headers['x-pin'];
    if (pin !== '6666') {
        return res.status(403).json({ error: 'Неверный пин-код' });
    }
    
    try {
        const item = await new Promise((resolve, reject) => {
            db.get('SELECT filename FROM gallery WHERE id = ?', [req.params.id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (item) {
            const filePath = path.join(uploadDir, item.filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            
            await deleteGalleryItem(req.params.id);
            
            // Удаляем связанные лайки и комментарии
            await new Promise((resolve, reject) => {
                db.run('DELETE FROM likes WHERE media_id = ?', [req.params.id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            
            await new Promise((resolve, reject) => {
                db.run('DELETE FROM comments WHERE media_id = ?', [req.params.id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Пост не найден' });
        }
    } catch (err) {
        console.error('Ошибка при удалении:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Очистка всей галереи
app.delete('/api/media', async (req, res) => {
    const pin = req.body.pin || req.headers['x-pin'];
    if (pin !== '6666') {
        return res.status(403).json({ error: 'Неверный пин-код' });
    }
    
    try {
        const items = await loadGallery();
        
        // Удаляем все файлы из папки uploads
        for (const item of items) {
            const filePath = path.join(uploadDir, item.filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        
        // Очищаем базу данных
        await clearGallery();
        
        await new Promise((resolve, reject) => {
            db.run('DELETE FROM likes', (err) => { 
                if (err) reject(err); 
                else resolve(); 
            });
        });
        
        await new Promise((resolve, reject) => {
            db.run('DELETE FROM comments', (err) => { 
                if (err) reject(err); 
                else resolve(); 
            });
        });
        
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка при очистке:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ЛАЙКИ
app.post('/api/likes', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { mediaId, isLiked } = req.body;
    try {
        const result = await toggleLike(mediaId, req.session.userId);
        res.json({ liked: result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/likes', async (req, res) => {
    const media = await loadGallery();
    const result = {};
    for (const item of media) {
        const count = await getLikesForMedia(item.id);
        const liked = req.session.userId ? await getUserLikeStatus(item.id, req.session.userId) : false;
        result[item.id] = { count, liked };
    }
    res.json(result);
});

// КОММЕНТАРИИ
app.post('/api/comments', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { mediaId, text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Пустой комментарий' });
    try {
        await addComment(mediaId, req.session.userId, text.trim());
        const comments = await getCommentsForMedia(mediaId);
        res.json({ success: true, comments });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/comments', async (req, res) => {
    const media = await loadGallery();
    const result = {};
    for (const item of media) {
        result[item.id] = await getCommentsForMedia(item.id);
    }
    res.json(result);
});

app.delete('/api/comments/:id', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const deleted = await deleteComment(req.params.id, req.session.userId);
        res.json({ success: deleted > 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// АВАТАР
const avatarStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, avatarsDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, unique + ext);
    }
});
const avatarUpload = multer({ storage: avatarStorage, limits: { fileSize: 5 * 1024 * 1024 } });

app.post('/api/avatar', avatarUpload.single('avatar'), async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    const avatarUrl = `/avatars/${req.file.filename}`;
    await new Promise((resolve, reject) => {
        db.run('UPDATE users SET avatar_url = ? WHERE id = ?', [avatarUrl, req.session.userId], function(err) {
            if (err) reject(err);
            else resolve();
        });
    });
    const user = await new Promise((resolve, reject) => {
        db.get('SELECT id, username, avatar_url FROM users WHERE id = ?', [req.session.userId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
    res.json({ success: true, avatar_url: user.avatar_url });
});

// АУТЕНТИФИКАЦИЯ
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Заполните поля' });
    try {
        const existing = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM users WHERE username = ?', [username], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        if (existing) return res.status(409).json({ error: 'Пользователь уже существует' });
        const hash = await bcrypt.hash(password, 10);
        const userId = await new Promise((resolve, reject) => {
            db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, hash], function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        });
        console.log(`✅ Регистрация: ${username} (${password})`);
        req.session.userId = userId;
        const user = await new Promise((resolve, reject) => {
            db.get('SELECT id, username, avatar_url FROM users WHERE id = ?', [userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        res.json({ success: true, user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Заполните поля' });
    try {
        const user = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        if (!user) return res.status(401).json({ error: 'Неверные данные' });
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(401).json({ error: 'Неверные данные' });
        req.session.userId = user.id;
        const safeUser = { id: user.id, username: user.username, avatar_url: user.avatar_url };
        res.json({ success: true, user: safeUser });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/me', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const user = await new Promise((resolve, reject) => {
            db.get('SELECT id, username, avatar_url FROM users WHERE id = ?', [req.session.userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        if (!user) {
            req.session.destroy();
            return res.status(401).json({ error: 'Сессия недействительна' });
        }
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// ЧАТ
app.delete('/api/chat', (req, res) => {
    const pin = req.headers['x-pin'];
    if (pin !== '6666') return res.status(403).json({ error: 'Неверный пин' });
    db.run('DELETE FROM messages', (err) => {
        if (err) return res.status(500).json({ error: err.message });
        io.emit('chat cleared');
        res.json({ success: true });
    });
});

// Socket.IO
io.on('connection', (socket) => {
    socket.on('join', (userId) => {
        socket.userId = userId;
        db.all('SELECT * FROM messages ORDER BY timestamp ASC LIMIT 100', (err, rows) => {
            if (!err) socket.emit('chat history', rows);
        });
    });
    socket.on('chat message', async (msg) => {
        if (!socket.userId) return;
        const user = await new Promise((resolve, reject) => {
            db.get('SELECT username FROM users WHERE id = ?', [socket.userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        if (!user) return;
        const newMsg = {
            id: Date.now(),
            user_id: socket.userId,
            nickname: user.username,
            text: msg.text,
            timestamp: new Date().toISOString()
        };
        db.run('INSERT INTO messages (user_id, nickname, text, timestamp) VALUES (?, ?, ?, ?)',
            [socket.userId, user.username, msg.text, newMsg.timestamp],
            (err) => { if (!err) io.emit('chat message', newMsg); }
        );
    });
});

server.listen(PORT, () => {
    console.log(`Сервер запущен: http://localhost:${PORT}`);
});