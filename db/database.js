import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '../books.db');

const sqlite = sqlite3.verbose();
const db = new sqlite.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database at:', dbPath);
    // Enable Foreign Key support
    db.run('PRAGMA foreign_keys = ON;', (pragmaErr) => {
      if (pragmaErr) {
        console.error('Error enabling foreign keys:', pragmaErr.message);
      } else {
        console.log('Foreign key support enabled.');
      }
    });
  }
});

// Initialize database schema
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL,          -- '사서추천' or '대학추천'
      source_subtype TEXT NOT NULL,       -- '유아', '청소년', '서울대학교' 등
      title TEXT NOT NULL,
      author TEXT,
      publisher TEXT,
      pub_year TEXT,                      -- 발행년도 또는 발행일
      isbn TEXT,
      call_number TEXT,                   -- 청구기호 (사서추천용)
      price TEXT,                         -- 가격 (대학추천용)
      recommendation_month TEXT,          -- 추천년월 (사서추천용)
      category TEXT,                      -- 분류명/카테고리
      description TEXT,                   -- 추천사유 / 책소개
      image_url TEXT,                     -- 도서 표지 이미지 URL
      summary TEXT,                       -- 도서 소개 및 줄거리 요약
      ranking INTEGER,                    -- 베스트셀러 순위
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Error creating books table:', err.message);
    } else {
      console.log('Books table verified/created successfully.');
    }
  });

  // Create Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT UNIQUE NOT NULL,      -- Username / Nickname
      password_hash TEXT NOT NULL,        -- Cryptographically hashed password
      salt TEXT NOT NULL,                 -- Unique salt for password hashing
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Error creating users table:', err.message);
  });

  // Create Sessions table for persistent login tokens
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) console.error('Error creating sessions table:', err.message);
  });

  // Create Favorite Categories table (supports folder trees)
  db.run(`
    CREATE TABLE IF NOT EXISTS favorite_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      parent_id INTEGER DEFAULT NULL,      -- Tree structure support
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(parent_id) REFERENCES favorite_categories(id) ON DELETE SET NULL
    )
  `, (err) => {
    if (err) console.error('Error creating favorite_categories table:', err.message);
  });

  // Check and migrate/create favorites table with new UNIQUE constraint
  db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='favorites'", (err, row) => {
    if (err) {
      console.error('Error checking favorites table:', err.message);
      return;
    }
    
    if (!row) {
      // Table doesn't exist, create it with UNIQUE(user_id, book_id, category_id)
      db.run(`
        CREATE TABLE IF NOT EXISTS favorites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          book_id INTEGER NOT NULL,
          category_id INTEGER DEFAULT NULL,    -- NULL means uncategorized (미분류)
          sort_order INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE,
          FOREIGN KEY(category_id) REFERENCES favorite_categories(id) ON DELETE SET NULL,
          UNIQUE(user_id, book_id, category_id)
        )
      `, (createErr) => {
        if (createErr) console.error('Error creating favorites table:', createErr.message);
      });
    } else {
      // Table exists, check if it has old UNIQUE constraint
      const sql = row.sql;
      if (sql.includes('UNIQUE(user_id, book_id)') && !sql.includes('UNIQUE(user_id, book_id, category_id)')) {
        console.log('Migrating favorites table: changing UNIQUE constraint...');
        db.serialize(() => {
          db.run("BEGIN TRANSACTION;");
          db.run("ALTER TABLE favorites RENAME TO favorites_old;");
          db.run(`
            CREATE TABLE favorites (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER NOT NULL,
              book_id INTEGER NOT NULL,
              category_id INTEGER DEFAULT NULL,
              sort_order INTEGER DEFAULT 0,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
              FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE,
              FOREIGN KEY(category_id) REFERENCES favorite_categories(id) ON DELETE SET NULL,
              UNIQUE(user_id, book_id, category_id)
            )
          `);
          db.run(`
            INSERT INTO favorites (id, user_id, book_id, category_id, sort_order, created_at)
            SELECT id, user_id, book_id, category_id, sort_order, created_at FROM favorites_old;
          `);
          db.run("DROP TABLE favorites_old;");
          db.run("COMMIT;", (commitErr) => {
            if (commitErr) {
              console.error('Error committing favorites migration:', commitErr.message);
            } else {
              console.log('Favorites table migrated successfully (UNIQUE constraint relaxed).');
            }
          });
        });
      }
    }
  });

  // Alter table to add image_url column if it doesn't exist (migration for existing db)
  db.run(`ALTER TABLE books ADD COLUMN image_url TEXT`, (alterErr) => {
    if (alterErr) {
      if (!alterErr.message.includes('duplicate column name')) {
        console.log('Altering database (image_url):', alterErr.message);
      }
    } else {
      console.log('Migrated: image_url column added to existing books database.');
    }
  });

  // Alter table to add summary column if it doesn't exist (migration for existing db)
  db.run(`ALTER TABLE books ADD COLUMN summary TEXT`, (alterErr) => {
    if (alterErr) {
      if (!alterErr.message.includes('duplicate column name')) {
        console.log('Altering database (summary):', alterErr.message);
      }
    } else {
      console.log('Migrated: summary column added to existing books database.');
    }
  });

  // Alter table to add ranking column if it doesn't exist (migration for existing db)
  db.run(`ALTER TABLE books ADD COLUMN ranking INTEGER`, (alterErr) => {
    if (alterErr) {
      if (!alterErr.message.includes('duplicate column name')) {
        console.log('Altering database (ranking):', alterErr.message);
      }
    } else {
      console.log('Migrated: ranking column added to existing books database.');
    }
  });

  // Create indexes for fast searching and filtering
  db.run(`CREATE INDEX IF NOT EXISTS idx_books_source ON books(source_type, source_subtype)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_books_title ON books(title)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_books_author ON books(author)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_books_isbn ON books(isbn)`);
});

export default db;
