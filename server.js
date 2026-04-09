const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const app = express();
const PORT = 3001;
const BASE = '/merma';
const JWT_SECRET = process.env.JWT_SECRET || 'merma-coleccionistas-secret-2026';
const UPLOADS_DIR = '/var/www/mvps/merma/uploads';

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${require('crypto').randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Solo imágenes JPG, PNG, GIF, WEBP'));
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(BASE, express.static(path.join(__dirname, 'public')));
app.use(`${BASE}/uploads`, express.static(UPLOADS_DIR));

// Auth helpers
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'No autenticado' });
  try {
    req.userId = jwt.verify(header.slice(7), JWT_SECRET).userId;
    next();
  } catch { res.status(401).json({ error: 'Token inválido' }); }
}

function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try { req.userId = jwt.verify(header.slice(7), JWT_SECRET).userId; } catch {}
  }
  next();
}

// ==================== AUTH ====================
app.post(`${BASE}/api/auth/register`, async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Nombre, email y contraseña requeridos' });
  if (password.length < 6) return res.status(400).json({ error: 'Mínimo 6 caracteres' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Email ya registrado' });

  const hash = await bcrypt.hash(password, 10);
  const result = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
    .run(name, email, hash);
  const token = jwt.sign({ userId: result.lastInsertRowid }, JWT_SECRET, { expiresIn: '7d' });
  res.status(201).json({ token, user: { id: result.lastInsertRowid, name, email } });
});

app.post(`${BASE}/api/auth/login`, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Credenciales inválidas' });

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

app.get(`${BASE}/api/auth/me`, auth, (req, res) => {
  const user = db.prepare('SELECT id, name, email, avatar, bio, created_at FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'No encontrado' });

  // stats
  const catalogCount = db.prepare('SELECT COUNT(*) as c FROM catalogs WHERE user_id = ?').get(req.userId).c;
  const itemCount = db.prepare('SELECT COUNT(*) as c FROM items i JOIN catalogs c ON i.catalog_id = c.id WHERE c.user_id = ?').get(req.userId).c;
  const followerCount = db.prepare('SELECT COUNT(*) as c FROM follows WHERE followed_id = ?').get(req.userId).c;
  const followingCount = db.prepare('SELECT COUNT(*) as c FROM follows WHERE follower_id = ?').get(req.userId).c;

  res.json({ ...user, catalogCount, itemCount, followerCount, followingCount });
});

app.put(`${BASE}/api/auth/me`, auth, (req, res) => {
  const { name, bio } = req.body;
  db.prepare('UPDATE users SET name = COALESCE(?, name), bio = COALESCE(?, bio) WHERE id = ?')
    .run(name || null, bio || null, req.userId);
  const user = db.prepare('SELECT id, name, email, avatar, bio FROM users WHERE id = ?').get(req.userId);
  res.json(user);
});

// ==================== CATEGORIES ====================
app.get(`${BASE}/api/categories`, (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.json(categories);
});

app.post(`${BASE}/api/categories`, auth, (req, res) => {
  const { name, emoji } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });

  const existing = db.prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?)').get(name);
  if (existing) return res.status(409).json({ error: 'Categoría ya existe', category: existing });

  const result = db.prepare('INSERT INTO categories (name, emoji) VALUES (?, ?)').run(name, emoji || '📦');
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(cat);
});

// ==================== CATALOGS ====================
app.get(`${BASE}/api/catalogs`, optionalAuth, (req, res) => {
  const { category, search, user: userId } = req.query;
  let query = `
    SELECT c.*, u.name as owner_name, cat.name as category_name, cat.emoji as category_emoji,
           (SELECT COUNT(*) FROM items WHERE catalog_id = c.id) as item_count
    FROM catalogs c
    JOIN users u ON c.user_id = u.id
    LEFT JOIN categories cat ON c.category_id = cat.id
    WHERE c.is_public = 1
  `;
  const params = [];

  if (userId) { query += ' AND c.user_id = ?'; params.push(userId); }
  if (category) { query += ' AND c.category_id = ?'; params.push(category); }
  if (search) { query += ' AND (c.name LIKE ? OR c.description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  query += ' ORDER BY c.updated_at DESC';

  const catalogs = db.prepare(query).all(...params);
  res.json(catalogs);
});

app.get(`${BASE}/api/catalogs/:id`, optionalAuth, (req, res) => {
  const catalog = db.prepare(`
    SELECT c.*, u.name as owner_name, cat.name as category_name, cat.emoji as category_emoji,
           (SELECT COUNT(*) FROM items WHERE catalog_id = c.id) as item_count
    FROM catalogs c
    JOIN users u ON c.user_id = u.id
    LEFT JOIN categories cat ON c.category_id = cat.id
    WHERE c.id = ?
  `).get(req.params.id);

  if (!catalog) return res.status(404).json({ error: 'Catálogo no encontrado' });
  if (!catalog.is_public && catalog.user_id !== req.userId) return res.status(403).json({ error: 'No tenés acceso' });

  // check if current user follows owner
  let isFollowing = false;
  if (req.userId && req.userId !== catalog.user_id) {
    const f = db.prepare('SELECT id FROM follows WHERE follower_id = ? AND followed_id = ?').get(req.userId, catalog.user_id);
    isFollowing = !!f;
  }

  res.json({ ...catalog, is_following: isFollowing });
});

app.post(`${BASE}/api/catalogs`, auth, (req, res) => {
  const { name, description, category_id, is_public } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });

  const result = db.prepare('INSERT INTO catalogs (user_id, name, description, category_id, is_public) VALUES (?, ?, ?, ?, ?)')
    .run(req.userId, name, description || '', category_id || null, is_public !== false ? 1 : 0);

  const catalog = db.prepare(`
    SELECT c.*, u.name as owner_name, cat.name as category_name, cat.emoji as category_emoji
    FROM catalogs c JOIN users u ON c.user_id = u.id LEFT JOIN categories cat ON c.category_id = cat.id
    WHERE c.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json(catalog);
});

app.put(`${BASE}/api/catalogs/:id`, auth, (req, res) => {
  const catalog = db.prepare('SELECT * FROM catalogs WHERE id = ?').get(req.params.id);
  if (!catalog) return res.status(404).json({ error: 'Catálogo no encontrado' });
  if (catalog.user_id !== req.userId) return res.status(403).json({ error: 'No sos el dueño' });

  const { name, description, category_id, is_public } = req.body;
  db.prepare(`
    UPDATE catalogs SET name=COALESCE(?,name), description=COALESCE(?,description),
    category_id=COALESCE(?,category_id), is_public=COALESCE(?,is_public), updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(name||null, description||null, category_id||null, is_public !== undefined ? (is_public?1:0) : null, req.params.id);

  const updated = db.prepare(`
    SELECT c.*, u.name as owner_name, cat.name as category_name, cat.emoji as category_emoji
    FROM catalogs c JOIN users u ON c.user_id = u.id LEFT JOIN categories cat ON c.category_id = cat.id
    WHERE c.id = ?
  `).get(req.params.id);

  res.json(updated);
});

app.delete(`${BASE}/api/catalogs/:id`, auth, (req, res) => {
  const catalog = db.prepare('SELECT * FROM catalogs WHERE id = ?').get(req.params.id);
  if (!catalog) return res.status(404).json({ error: 'Catálogo no encontrado' });
  if (catalog.user_id !== req.userId) return res.status(403).json({ error: 'No sos el dueño' });

  // delete items and their photos
  const items = db.prepare('SELECT photo_filename FROM items WHERE catalog_id = ?').all(req.params.id);
  items.forEach(item => {
    const fp = path.join(UPLOADS_DIR, item.photo_filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  });
  db.prepare('DELETE FROM comments WHERE item_id IN (SELECT id FROM items WHERE catalog_id = ?)').run(req.params.id);
  db.prepare('DELETE FROM items WHERE catalog_id = ?').run(req.params.id);
  db.prepare('DELETE FROM catalogs WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==================== ITEMS ====================
app.get(`${BASE}/api/catalogs/:id/items`, optionalAuth, (req, res) => {
  const catalog = db.prepare('SELECT * FROM catalogs WHERE id = ?').get(req.params.id);
  if (!catalog) return res.status(404).json({ error: 'Catálogo no encontrado' });
  if (!catalog.is_public && catalog.user_id !== req.userId) return res.status(403).json({ error: 'No tenés acceso' });

  const { country, search } = req.query;
  let query = 'SELECT * FROM items WHERE catalog_id = ?';
  const params = [req.params.id];

  if (country) { query += ' AND country = ?'; params.push(country); }
  if (search) { query += ' AND (name LIKE ? OR description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  query += ' ORDER BY created_at DESC';
  const items = db.prepare(query).all(...params);

  // add comment count
  const enriched = items.map(item => {
    const commentCount = db.prepare('SELECT COUNT(*) as c FROM comments WHERE item_id = ?').get(item.id).c;
    return { ...item, comment_count: commentCount };
  });

  res.json(enriched);
});

app.post(`${BASE}/api/catalogs/:id/items`, auth, upload.single('photo'), (req, res) => {
  const catalog = db.prepare('SELECT * FROM catalogs WHERE id = ?').get(req.params.id);
  if (!catalog) return res.status(404).json({ error: 'Catálogo no encontrado' });
  if (catalog.user_id !== req.userId) return res.status(403).json({ error: 'No podés agregar items a este catálogo' });
  if (!req.file) return res.status(400).json({ error: 'Foto requerida' });

  const { name, description, country, acquired_date, ordinal_data } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });

  const result = db.prepare(`
    INSERT INTO items (catalog_id, name, description, country, acquired_date, photo_filename, original_name, ordinal_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, name, description || '', country || '', acquired_date || '',
    req.file.filename, req.file.originalname, ordinal_data || '');

  // update catalog timestamp
  db.prepare('UPDATE catalogs SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(item);
});

app.get(`${BASE}/api/items/:id`, optionalAuth, (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item no encontrado' });

  const catalog = db.prepare('SELECT * FROM catalogs WHERE id = ?').get(item.catalog_id);
  if (!catalog.is_public && catalog.user_id !== req.userId) return res.status(403).json({ error: 'No tenés acceso' });

  const comments = db.prepare(`
    SELECT cm.*, u.name as user_name FROM comments cm JOIN users u ON cm.user_id = u.id WHERE cm.item_id = ? ORDER BY cm.created_at ASC
  `).all(req.params.id);

  res.json({ ...item, comments });
});

app.put(`${BASE}/api/items/:id`, auth, (req, res) => {
  const item = db.prepare('SELECT i.*, c.user_id as owner_id FROM items i JOIN catalogs c ON i.catalog_id = c.id WHERE i.id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item no encontrado' });
  if (item.owner_id !== req.userId) return res.status(403).json({ error: 'No sos el dueño' });

  const { name, description, country, acquired_date, ordinal_data } = req.body;
  db.prepare(`
    UPDATE items SET name=COALESCE(?,name), description=COALESCE(?,description),
    country=COALESCE(?,country), acquired_date=COALESCE(?,acquired_date), ordinal_data=COALESCE(?,ordinal_data)
    WHERE id=?
  `).run(name||null, description||null, country||null, acquired_date||null, ordinal_data||null, req.params.id);

  res.json(db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id));
});

app.delete(`${BASE}/api/items/:id`, auth, (req, res) => {
  const item = db.prepare('SELECT i.*, c.user_id as owner_id FROM items i JOIN catalogs c ON i.catalog_id = c.id WHERE i.id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item no encontrado' });
  if (item.owner_id !== req.userId) return res.status(403).json({ error: 'No sos el dueño' });

  const fp = path.join(UPLOADS_DIR, item.photo_filename);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);

  db.prepare('DELETE FROM comments WHERE item_id = ?').run(req.params.id);
  db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==================== COMMENTS ====================
app.post(`${BASE}/api/items/:id/comments`, auth, (req, res) => {
  const item = db.prepare('SELECT i.*, c.user_id as owner_id, c.is_public FROM items i JOIN catalogs c ON i.catalog_id = c.id WHERE i.id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item no encontrado' });
  if (!item.is_public && item.owner_id !== req.userId) return res.status(403).json({ error: 'No tenés acceso' });

  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Contenido requerido' });

  const result = db.prepare('INSERT INTO comments (item_id, user_id, content) VALUES (?, ?, ?)')
    .run(req.params.id, req.userId, content.trim());

  const comment = db.prepare(`
    SELECT cm.*, u.name as user_name FROM comments cm JOIN users u ON cm.user_id = u.id WHERE cm.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json(comment);
});

app.delete(`${BASE}/api/comments/:id`, auth, (req, res) => {
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!comment) return res.status(404).json({ error: 'Comentario no encontrado' });
  if (comment.user_id !== req.userId) return res.status(403).json({ error: 'No podés eliminar este comentario' });

  db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==================== USERS / PROFILES ====================
app.get(`${BASE}/api/users/:id`, (req, res) => {
  const user = db.prepare('SELECT id, name, avatar, bio, created_at FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const catalogCount = db.prepare('SELECT COUNT(*) as c FROM catalogs WHERE user_id = ? AND is_public = 1').get(req.params.id).c;
  const itemCount = db.prepare(`
    SELECT COUNT(*) as c FROM items i JOIN catalogs c ON i.catalog_id = c.id
    WHERE c.user_id = ? AND c.is_public = 1
  `).get(req.params.id).c;
  const followerCount = db.prepare('SELECT COUNT(*) as c FROM follows WHERE followed_id = ?').get(req.params.id).c;
  const followingCount = db.prepare('SELECT COUNT(*) as c FROM follows WHERE follower_id = ?').get(req.params.id).c;

  // check if current user follows this
  const isFollowing = false; // populated if auth

  res.json({ ...user, catalogCount, itemCount, followerCount, followingCount });
});

app.get(`${BASE}/api/users/:id/catalogs`, (req, res) => {
  const catalogs = db.prepare(`
    SELECT c.*, cat.name as category_name, cat.emoji as category_emoji,
           (SELECT COUNT(*) FROM items WHERE catalog_id = c.id) as item_count
    FROM catalogs c
    LEFT JOIN categories cat ON c.category_id = cat.id
    WHERE c.user_id = ? AND c.is_public = 1
    ORDER BY c.updated_at DESC
  `).all(req.params.id);
  res.json(catalogs);
});

app.post(`${BASE}/api/users/:id/follow`, auth, (req, res) => {
  if (parseInt(req.params.id) === req.userId) return res.status(400).json({ error: 'No podés seguirte a vos mismo' });
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const existing = db.prepare('SELECT id FROM follows WHERE follower_id = ? AND followed_id = ?').get(req.userId, req.params.id);
  if (existing) return res.status(409).json({ error: 'Ya seguís a este usuario' });

  db.prepare('INSERT INTO follows (follower_id, followed_id) VALUES (?, ?)').run(req.userId, req.params.id);
  res.json({ success: true });
});

app.delete(`${BASE}/api/users/:id/follow`, auth, (req, res) => {
  db.prepare('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?').run(req.userId, req.params.id);
  res.json({ success: true });
});

// ==================== HEALTH ====================
app.get(`${BASE}/api/health`, (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Merma] Coleccionistas running on http://0.0.0.0:${PORT}${BASE}`);
});
