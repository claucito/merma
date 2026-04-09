const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'merma.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    avatar TEXT,
    bio TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    emoji TEXT DEFAULT '📦',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS catalogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    name TEXT NOT NULL,
    description TEXT,
    category_id INTEGER REFERENCES categories(id),
    is_public INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    catalog_id INTEGER REFERENCES catalogs(id),
    name TEXT NOT NULL,
    description TEXT,
    country TEXT,
    acquired_date TEXT,
    photo_filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    ordinal_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER REFERENCES items(id),
    user_id INTEGER REFERENCES users(id),
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS follows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    follower_id INTEGER REFERENCES users(id),
    followed_id INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(follower_id, followed_id)
  );
`);

// Seed categories
const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get();
if (catCount.c === 0) {
  const insert = db.prepare('INSERT INTO categories (name, emoji) VALUES (?, ?)');
  [
    ['Tapitas de cerveza', '🍺'],
    ['Monedas', '🪙'],
    ['Figuritas', '⚽'],
    ['Sellos', '📮'],
    ['Tazos', '🎮'],
    ['Llaveros', '🔑'],
    ['CDs', '💿'],
    ['Vinilos', '📀'],
    ['Cartas', '🃏'],
    ['Posters', '🖼️'],
    ['Fotos Antiguas', '📷'],
    [' Otro', '📦'],
  ].forEach(([name, emoji]) => insert.run(name, emoji));
  console.log('[DB] Categories seeded');
}

module.exports = db;
