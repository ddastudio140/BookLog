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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Error creating table:', err.message);
    } else {
      console.log('Books table verified/created successfully.');
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

  // Create indexes for fast searching and filtering
  db.run(`CREATE INDEX IF NOT EXISTS idx_books_source ON books(source_type, source_subtype)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_books_title ON books(title)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_books_author ON books(author)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_books_isbn ON books(isbn)`);
});

export default db;
