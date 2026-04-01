const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Пул подключений к MySQL
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'vasukhub',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Multer для загрузки файлов
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, unique + ext);
    }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// === API ===

app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Заполните поля' });
    try {
        const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
        if (existing.length) return res.status(409).json({ error: 'Пользователь уже существует' });
        const hash = await bcrypt.hash(password, 10);
        const [result] = await pool.query('INSERT INTO users (username, password) VALUES (?, ?)', [username, hash]);
        const [user] = await pool.query('SELECT id, username, avatar FROM users WHERE id = ?', [result.insertId]);
        res.json({ success: true, user: user[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Заполните поля' });
    try {
        const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (!users.length) return res.status(401).json({ error: 'Неверные данные' });
        const user = users[0];
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: 'Неверные данные' });
        res.json({ success: true, user: { id: user.id, username: user.username, avatar: user.avatar } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/posts', async (req, res) => {
    try {
        const [posts] = await pool.query('SELECT * FROM posts ORDER BY uploaded_at DESC');
        res.json(posts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
    const { originalname, mimetype, path: filePath } = req.file;
    const userId = req.body.userId;
    const dataUrl = `/uploads/${path.basename(filePath)}`;
    const id = Date.now() + '-' + Math.random().toString(36).substr(2, 6);
    const type = mimetype.startsWith('image/') ? 'image' : 'video';
    try {
        await pool.query('INSERT INTO posts (id, type, data_url, original_name, user_id) VALUES (?, ?, ?, ?, ?)',
            [id, type, dataUrl, originalname, userId]);
        res.json({ success: true, post: { id, type, dataUrl, originalName: originalname } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/like', async (req, res) => {
    const { postId, userId } = req.body;
    try {
        const [existing] = await pool.query('SELECT id FROM likes WHERE post_id = ? AND user_id = ?', [postId, userId]);
        if (existing.length) {
            await pool.query('DELETE FROM likes WHERE post_id = ? AND user_id = ?', [postId, userId]);
        } else {
            await pool.query('INSERT INTO likes (post_id, user_id) VALUES (?, ?)', [postId, userId]);
        }
        const [countResult] = await pool.query('SELECT COUNT(*) as count FROM likes WHERE post_id = ?', [postId]);
        res.json({ liked: !existing.length, count: countResult[0].count });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/likes/:postId', async (req, res) => {
    const { postId } = req.params;
    const userId = req.query.userId;
    try {
        const [countResult] = await pool.query('SELECT COUNT(*) as count FROM likes WHERE post_id = ?', [postId]);
        let liked = false;
        if (userId) {
            const [likeRow] = await pool.query('SELECT id FROM likes WHERE post_id = ? AND user_id = ?', [postId, userId]);
            liked = likeRow.length > 0;
        }
        res.json({ liked, count: countResult[0].count });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/comment', async (req, res) => {
    const { postId, userId, text } = req.body;
    try {
        const [result] = await pool.query('INSERT INTO comments (post_id, user_id, text) VALUES (?, ?, ?)', [postId, userId, text]);
        const [comment] = await pool.query(`
            SELECT c.*, u.username
            FROM comments c
            JOIN users u ON c.user_id = u.id
            WHERE c.id = ?
        `, [result.insertId]);
        res.json({ comment: comment[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/comments/:postId', async (req, res) => {
    const { postId } = req.params;
    try {
        const [comments] = await pool.query(`
            SELECT c.*, u.username
            FROM comments c
            JOIN users u ON c.user_id = u.id
            WHERE c.post_id = ?
            ORDER BY c.created_at ASC
        `, [postId]);
        res.json(comments);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/posts/:id', async (req, res) => {
    const pin = req.headers['x-pin'];
    if (pin !== '6666') return res.status(403).json({ error: 'Неверный пин' });
    try {
        const [post] = await pool.query('SELECT data_url FROM posts WHERE id = ?', [req.params.id]);
        if (post.length && post[0].data_url.startsWith('/uploads/')) {
            const filePath = path.join(__dirname, post[0].data_url);
            fs.unlink(filePath, () => {});
        }
        await pool.query('DELETE FROM posts WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/posts', async (req, res) => {
    const pin = req.headers['x-pin'];
    if (pin !== '6666') return res.status(403).json({ error: 'Неверный пин' });
    try {
        const [posts] = await pool.query('SELECT data_url FROM posts');
        posts.forEach(post => {
            if (post.data_url.startsWith('/uploads/')) {
                const filePath = path.join(__dirname, post.data_url);
                fs.unlink(filePath, () => {});
            }
        });
        await pool.query('DELETE FROM posts');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/chat', async (req, res) => {
    const { userId, nickname, text } = req.body;
    try {
        const [result] = await pool.query('INSERT INTO messages (user_id, nickname, text) VALUES (?, ?, ?)', [userId, nickname, text]);
        const newMsg = { id: result.insertId, userId, nickname, text, created_at: new Date().toISOString() };
        io.emit('chat message', newMsg);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/chat', async (req, res) => {
    try {
        const [messages] = await pool.query('SELECT * FROM messages ORDER BY created_at ASC');
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/chat', async (req, res) => {
    const pin = req.headers['x-pin'];
    if (pin !== '6666') return res.status(403).json({ error: 'Неверный пин' });
    try {
        await pool.query('DELETE FROM messages');
        io.emit('chat cleared');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/avatar', upload.single('avatar'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    const userId = req.body.userId;
    const avatarUrl = `/uploads/${req.file.filename}`;
    try {
        await pool.query('UPDATE users SET avatar = ? WHERE id = ?', [avatarUrl, userId]);
        res.json({ success: true, avatar_url: avatarUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Socket.IO
io.on('connection', (socket) => {
    console.log('Новый пользователь подключился');
    socket.on('get messages', async () => {
        const [messages] = await pool.query('SELECT * FROM messages ORDER BY created_at ASC');
        socket.emit('chat history', messages);
    });
    socket.on('new message', async (msg) => {
        try {
            const [result] = await pool.query('INSERT INTO messages (user_id, nickname, text) VALUES (?, ?, ?)', [msg.userId, msg.nickname, msg.text]);
            const newMsg = { ...msg, id: result.insertId, created_at: new Date().toISOString() };
            io.emit('chat message', newMsg);
        } catch (err) {
            console.error(err);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
