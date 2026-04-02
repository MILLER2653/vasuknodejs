const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { createClient } = require('@supabase/supabase-js');

// ==================== НАСТРОЙКИ SUPABASE ====================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ Ошибка: не заданы SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
// ============================================================

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

// Middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'vasukhub_secret_key_2025',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Multer для временного хранения в памяти
const memoryStorage = multer.memoryStorage();
const upload = multer({ storage: memoryStorage, limits: { fileSize: 500 * 1024 * 1024 } });
const avatarUpload = multer({ storage: memoryStorage, limits: { fileSize: 5 * 1024 * 1024 } });

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
async function uploadFileToStorage(bucket, fileBuffer, originalName, mimetype) {
    const ext = path.extname(originalName);
    const fileName = `${Date.now()}-${Math.random().toString(36).substr(2, 8)}${ext}`;
    const { data, error } = await supabase.storage
        .from(bucket)
        .upload(fileName, fileBuffer, { contentType: mimetype });
    if (error) throw error;
    const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(fileName);
    return publicUrlData.publicUrl;
}

async function deleteFileFromStorage(bucket, fileUrl) {
    const fileName = fileUrl.split('/').pop();
    const { error } = await supabase.storage.from(bucket).remove([fileName]);
    if (error) console.error('Ошибка удаления файла:', error);
}

// ==================== API ====================

// --- ГАЛЕРЕЯ ---
app.get('/api/media', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('gallery')
            .select('*')
            .order('uploadedat', { ascending: false });
        if (error) {
            console.error('Ошибка Supabase при получении медиа:', error);
            return res.status(500).json({ error: error.message });
        }
        res.json(data);
    } catch (err) {
        console.error('Ошибка в /api/media:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/upload', upload.array('files', 20), async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    try {
        const newItems = [];
        for (const file of req.files) {
            const publicUrl = await uploadFileToStorage('uploads', file.buffer, file.originalname, file.mimetype);
            const id = Date.now() + '-' + Math.random().toString(36).substr(2, 8);
            const item = {
                id,
                filename: publicUrl,
                originalname: file.originalname,
                type: file.mimetype,
                size: file.size,
                uploadedAt: new Date().toISOString()
            };
            const { error } = await supabase.from('gallery').insert(item);
            if (error) {
                console.error('Ошибка вставки в gallery:', error);
                throw error;
            }
            newItems.push(item);
        }
        res.json({ success: true, uploaded: newItems });
    } catch (err) {
        console.error('Ошибка в /api/upload:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/media/:id', async (req, res) => {
    const pin = req.body.pin || req.headers['x-pin'];
    if (pin !== '6666') return res.status(403).json({ error: 'Неверный пин-код' });
    try {
        const { data: item, error: fetchError } = await supabase
            .from('gallery')
            .select('filename')
            .eq('id', req.params.id)
            .single();
        if (fetchError || !item) return res.status(404).json({ error: 'Пост не найден' });
        await deleteFileFromStorage('uploads', item.filename);
        const { error } = await supabase.from('gallery').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка в DELETE /api/media/:id:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/media', async (req, res) => {
    const pin = req.body.pin || req.headers['x-pin'];
    if (pin !== '6666') return res.status(403).json({ error: 'Неверный пин-код' });
    try {
        const { data: items, error: fetchError } = await supabase.from('gallery').select('filename');
        if (fetchError) throw fetchError;
        for (const item of items) {
            await deleteFileFromStorage('uploads', item.filename);
        }
        const { error } = await supabase.from('gallery').delete().neq('id', '');
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка в DELETE /api/media:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- ЛАЙКИ ---
app.post('/api/likes', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { mediaId } = req.body;
    try {
        const { data: existing } = await supabase
            .from('likes')
            .select('id')
            .eq('media_id', mediaId)
            .eq('user_id', req.session.userId)
            .maybeSingle();
        if (existing) {
            await supabase.from('likes').delete().eq('id', existing.id);
        } else {
            await supabase.from('likes').insert({ media_id: mediaId, user_id: req.session.userId });
        }
        res.json({ liked: !existing });
    } catch (err) {
        console.error('Ошибка в /api/likes:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/likes', async (req, res) => {
    try {
        const { data: media, error: mediaError } = await supabase.from('gallery').select('id');
        if (mediaError) throw mediaError;
        const result = {};
        for (const item of media) {
            const { count, error: countError } = await supabase
                .from('likes')
                .select('*', { count: 'exact', head: true })
                .eq('media_id', item.id);
            if (countError) throw countError;
            let liked = false;
            if (req.session.userId) {
                const { data: like } = await supabase
                    .from('likes')
                    .select('id')
                    .eq('media_id', item.id)
                    .eq('user_id', req.session.userId)
                    .maybeSingle();
                liked = !!like;
            }
            result[item.id] = { count, liked };
        }
        res.json(result);
    } catch (err) {
        console.error('Ошибка в GET /api/likes:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- КОММЕНТАРИИ ---
app.post('/api/comments', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { mediaId, text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Пустой комментарий' });
    try {
        await supabase.from('comments').insert({
            media_id: mediaId,
            user_id: req.session.userId,
            text: text.trim()
        });
        const { data: comments, error } = await supabase
            .from('comments')
            .select(`
                id,
                text,
                created_at,
                users (username)
            `)
            .eq('media_id', mediaId)
            .order('created_at', { ascending: true });
        if (error) throw error;
        const formatted = comments.map(c => ({
            id: c.id,
            text: c.text,
            created_at: c.created_at,
            user: c.users.username
        }));
        res.json({ success: true, comments: formatted });
    } catch (err) {
        console.error('Ошибка в POST /api/comments:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/comments', async (req, res) => {
    try {
        const { data: media, error: mediaError } = await supabase.from('gallery').select('id');
        if (mediaError) throw mediaError;
        const result = {};
        for (const item of media) {
            const { data: comments, error } = await supabase
                .from('comments')
                .select(`
                    id,
                    text,
                    created_at,
                    users (username)
                `)
                .eq('media_id', item.id)
                .order('created_at', { ascending: true });
            if (error) throw error;
            result[item.id] = comments.map(c => ({
                id: c.id,
                text: c.text,
                created_at: c.created_at,
                user: c.users.username
            }));
        }
        res.json(result);
    } catch (err) {
        console.error('Ошибка в GET /api/comments:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- АВАТАР ---
app.post('/api/avatar', avatarUpload.single('avatar'), async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    try {
        const publicUrl = await uploadFileToStorage('avatars', req.file.buffer, req.file.originalname, req.file.mimetype);
        const { error } = await supabase.from('users').update({ avatar_url: publicUrl }).eq('id', req.session.userId);
        if (error) throw error;
        res.json({ success: true, avatar_url: publicUrl });
    } catch (err) {
        console.error('Ошибка в POST /api/avatar:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- АУТЕНТИФИКАЦИЯ ---
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Заполните поля' });
    try {
        const { data: existing } = await supabase
            .from('users')
            .select('id')
            .eq('username', username)
            .maybeSingle();
        if (existing) return res.status(409).json({ error: 'Пользователь уже существует' });
        const hash = await bcrypt.hash(password, 10);
        const { data: newUser, error } = await supabase
            .from('users')
            .insert({ username, password_hash: hash })
            .select('id, username, avatar_url')
            .single();
        if (error) throw error;
        console.log(`✅ Регистрация: ${username} (${password})`);
        req.session.userId = newUser.id;
        res.json({ success: true, user: newUser });
    } catch (err) {
        console.error('Ошибка в POST /api/register:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Заполните поля' });
    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('username', username)
            .maybeSingle();
        if (!user) return res.status(401).json({ error: 'Неверные данные' });
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(401).json({ error: 'Неверные данные' });
        req.session.userId = user.id;
        res.json({ success: true, user: { id: user.id, username: user.username, avatar_url: user.avatar_url } });
    } catch (err) {
        console.error('Ошибка в POST /api/login:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/me', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('id, username, avatar_url')
            .eq('id', req.session.userId)
            .single();
        if (!user) {
            req.session.destroy();
            return res.status(401).json({ error: 'Сессия недействительна' });
        }
        res.json(user);
    } catch (err) {
        console.error('Ошибка в GET /api/me:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// --- ЧАТ ---
app.delete('/api/chat', async (req, res) => {
    const pin = req.headers['x-pin'];
    if (pin !== '6666') return res.status(403).json({ error: 'Неверный пин' });
    try {
        await supabase.from('messages').delete().neq('id', 0);
        io.emit('chat cleared');
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка в DELETE /api/chat:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- SOCKET.IO (чат + онлайн) ---
let onlineUsers = new Map();

function updateOnlineCount() {
    io.emit('online count', onlineUsers.size);
}

io.on('connection', (socket) => {
    onlineUsers.set(socket.id, null);
    updateOnlineCount();

    socket.on('join', async (userId) => {
        socket.userId = userId;
        onlineUsers.set(socket.id, userId);
        updateOnlineCount();

        const { data: messages, error } = await supabase
            .from('messages')
            .select('*')
            .order('timestamp', { ascending: true })
            .limit(100);
        if (!error && messages) socket.emit('chat history', messages);
    });

    socket.on('chat message', async (msg) => {
        if (!socket.userId) return;
        const { data: user } = await supabase
            .from('users')
            .select('username')
            .eq('id', socket.userId)
            .single();
        if (!user) return;
        const newMsg = {
            id: Date.now(),
            user_id: socket.userId,
            nickname: user.username,
            text: msg.text,
            timestamp: new Date().toISOString()
        };
        const { error } = await supabase.from('messages').insert({
            user_id: socket.userId,
            nickname: user.username,
            text: msg.text,
            timestamp: newMsg.timestamp
        });
        if (!error) io.emit('chat message', newMsg);
    });

    socket.on('disconnect', () => {
        onlineUsers.delete(socket.id);
        updateOnlineCount();
    });
});

server.listen(PORT, () => {
    console.log(`Сервер запущен: http://localhost:${PORT}`);
});
