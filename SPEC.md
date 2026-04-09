# SPEC.md — Merma: Catálogos para Coleccionistas

## 1. Concept & Vision

Una app para que coleccionistas gestionen y compartan sus colecciones. Cada usuario tiene uno o varios catálogos por categoría, puede agregar items con fotos y datos, y explorar los catálogos de otros usuarios. Inspiración: Pinterest meets collector's journal.

**Nombre:** Merma (rebranded de recursos educativos a coleccionistas)

## 2. Design Language

- **Estética:** Clean, visual-first, con toques de color según categoría
- **Colores:**
  - Primary: `#8b5cf6` (violeta — creatividad, colección)
  - Secondary: `#f8fafc` (fondo claro)
  - Accent: `#f59e0b` (amber — interacciones)
  - Background: `#f1f5f9`
  - Card: `#ffffff`
  - Text: `#1e293b` / `#64748b`
- **Tipografía:** System fonts
- **Iconos:** Emojis unicode

## 3. Layout & Structure

**Pages:**
- `/` — Feed de catálogos públicos + búsqueda
- `/catalog/:id` — Ver catálogo específico (items en grid circular)
- `/catalog/:id/item/:itemId` — Detalle de item
- `/profile` — Mi perfil +mis catálogos
- `/profile/edit` — Editar perfil
- `/catalog/new` — Crear catálogo
- `/item/new` — Agregar item
- `/login` / `/register`

## 4. Features & Interactions

### 4.1 Auth
- Registro: nombre, email, contraseña
- Login: email + contraseña
- JWT en localStorage, 7 días

### 4.2 Categorías (globales)
- Lista pre-definida de categorías + posibilidad de crear nueva
- Al crear catálogo: seleccionar categoría existente o crear nueva
- Categorías: Tapitas de cerveza, Monedas, Figuritas, Sellos, Tazos, Llaveros, CDs, Vinilos, Cartas, Posters, Fotos Antiguas, Otro

### 4.3 Catálogos
- Nombre del catálogo + descripción
- Pertenece a una categoría
- Puede ser público o privado
- Dueño puede editar/eliminar
- Estadísticas: X items, Y comentarios totales

### 4.4 Items (piezas de colección)
- Foto (requerida)
- Nombre del item
- Descripción (opcional)
- País de origen (opcional)
- Fecha de adquisición (opcional)
- Datos ordinal custom (key-value pairs)

### 4.5 Explorar
- Ver catálogos públicos de todos
- Buscar por nombre de item
- Filtrar por país
- Filtrar por categoría
- Ver кто (cuya colección) — navegar al catálogo del usuario

### 4.6 Comentarios
- Comentar en items de catálogos públicos
- Requiere estar logueado
- Solo eliminar propio comentario

## 5. Data Model

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar TEXT,
  bio TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  emoji TEXT DEFAULT '📦',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE catalogs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  category_id INTEGER REFERENCES categories(id),
  is_public INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  catalog_id INTEGER REFERENCES catalogs(id),
  name TEXT NOT NULL,
  description TEXT,
  country TEXT,
  acquired_date TEXT,
  photo_filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  ordinal_data TEXT, -- JSON string for custom fields
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER REFERENCES items(id),
  user_id INTEGER REFERENCES users(id),
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE follows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  follower_id INTEGER REFERENCES users(id),
  followed_id INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(follower_id, followed_id)
);
```

## 6. API Endpoints

```
POST   /api/auth/register
POST   /api/auth/login
GET    /api/auth/me

GET    /api/categories
POST   /api/categories          (auth)

GET    /api/catalogs?category=&search=&user=
GET    /api/catalogs/:id
POST   /api/catalogs             (auth)
PUT    /api/catalogs/:id         (owner)
DELETE /api/catalogs/:id          (owner)

GET    /api/catalogs/:id/items
POST   /api/catalogs/:id/items   (auth)
GET    /api/items/:id
PUT    /api/items/:id             (owner)
DELETE /api/items/:id              (owner)

GET    /api/items/:id/comments
POST   /api/items/:id/comments    (auth)
DELETE /api/comments/:id          (owner)

GET    /api/users/:id            -- public profile
GET    /api/users/:id/catalogs    -- public catalogs
POST   /api/users/:id/follow      (auth)
DELETE /api/users/:id/follow      (auth)

GET    /uploads/:filename        -- serve files
```

## 7. Technical Approach

- Backend: Express + better-sqlite3 + bcryptjs + jsonwebtoken + multer
- Frontend: Vanilla JS SPA
- Auth: JWT
- File storage: local (`/var/www/mvps/merma/uploads`)
- nginx: proxy `/merma` → `:3001`
- Puerto interno: 3001
- URL: `http://207.180.197.82/merma`
