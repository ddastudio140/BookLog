import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import db from './db/database.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to parse and clean ISBN
function getCleanIsbn(isbn) {
  if (!isbn) return null;
  const isbnParts = isbn.split(/[\s,,\/]+/);
  for (const part of isbnParts) {
    const clean = part.replace(/[^0-9X]/gi, '');
    if (clean.length === 10 || clean.length === 13) {
      return clean;
    }
  }
  return null;
}

// Fetch cover image from Aladin on-the-fly
async function fetchCoverImage(isbn) {
  const cleanIsbn = getCleanIsbn(isbn);
  if (!cleanIsbn) return null;

  const url = `https://www.aladin.co.kr/search/wsearchresult.aspx?SearchTarget=Book&SearchWord=${cleanIsbn}`;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(4000)
    });
    if (!response.ok) return null;
    const html = await response.text();
    const matches = html.match(/https:\/\/image\.aladin\.co\.kr\/product\/\d+\/\d+\/cover[^\s"'>]+/gi);
    if (matches && matches.length > 0) {
      let imageUrl = matches[0];
      imageUrl = imageUrl.replace('/cover200/', '/cover500/').replace('/cover150/', '/cover500/');
      return imageUrl;
    }
  } catch (err) {
    console.error(`On-the-fly fetch failed for ISBN ${cleanIsbn}:`, err.message);
  }
  return null;
}

function convertIsbn13To10(isbn13) {
  if (!isbn13 || isbn13.length !== 13) return isbn13;
  const raw = isbn13.substring(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(raw[i]) * (10 - i);
  }
  const rem = sum % 11;
  const check = 11 - rem;
  let checkChar = '';
  if (check === 10) checkChar = 'X';
  else if (check === 11) checkChar = '0';
  else checkChar = check.toString();
  return raw + checkChar;
}

function cleanHtmlToText(html) {
  if (!html) return '';

  // Normalize newlines
  let cleaned = html.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Remove short description containers (which contain truncated text and '더보기' button)
  cleaned = cleaned.replace(/<(?:div|span)[^>]*id=["'](?:div_)?[a-zA-Z0-9_]+_Short["'][^>]*>[\s\S]*?<\/(?:div|span)>/gi, '');

  // Remove Underline (밑줄긋기) containers completely
  cleaned = cleaned.replace(/<(?:div|span|table)[^>]*id=["'](?:div_)?Underline(?:_[a-zA-Z0-9_]+)?["'][^>]*>[\s\S]*?<\/(?:div|span|table)>/gi, '');

  // Remove tab navigation containers that contain heading links
  cleaned = cleaned.replace(/<(?:div|ul|table|tr|p)[^>]*>([\s\S]*?)<\/(?:div|ul|table|tr|p)>/gi, (match, inner) => {
    const cleanInner = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, '');
    const countHeaders = ['책소개', '도서소개', '상품설명', '목차', '추천', '줄거리', '리뷰', '책속에서'].filter(h => cleanInner.includes(h)).length;
    const hasTagsOrDelimiters = inner.includes('<a') || inner.includes('<span') || inner.includes('<li') || inner.includes('|') || inner.includes('/');
    
    if (countHeaders >= 2 && cleanInner.length < 100 && hasTagsOrDelimiters) {
      return '';
    }
    return match;
  });

  cleaned = cleaned
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    // Remove dynamic link indicators
    .replace(/<a[^>]*>더보기<\/a>/gi, '')
    .replace(/<a[^>]*>접기<\/a>/gi, '')
    .replace(/<a[\s\S]*?<\/a>/gi, '')
    // Replace block tags and line breaks with newlines
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, '\n')
    // Remove all other HTML tags
    .replace(/<[^>]+>/g, '')
    // Decode HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Remove zero-width spaces and invisible characters
    .replace(/[\u200B-\u200D\uFEFF]/g, '');

  // Remove "더보기" or "접기" text artifacts before trimming lines
  cleaned = cleaned
    .replace(/\.{2,}[ \t]*더보기/g, '')
    .replace(/[ \t]*더보기[ \t]*/gi, ' ')
    .replace(/[ \t]*접기[ \t]*/gi, ' ');

  // Split and clean each line
  let lines = cleaned.split('\n')
    .map(line => line.trim())
    // Filter out redundant empty lines
    .filter((line, index, arr) => line !== '' || (index > 0 && arr[index - 1] !== ''));

  // Section cleanup: remove empty headings, and remove "밑줄긋기" section completely
  const headings = ['책소개', '도서소개', '상품설명', '목차', '추천글', '추천평', '줄거리', '출판사리뷰', '밑줄긋기', '책속에서'];
  let filteredLines = [];
  
  for (let i = 0; i < lines.length; i++) {
    const currentLine = lines[i];
    const cleanCurrent = currentLine.replace(/[^가-힣]/g, '');
    const isHeading = headings.includes(cleanCurrent);
    
    if (isHeading) {
      // If it is "밑줄긋기", skip it and skip everything under it
      if (cleanCurrent === '밑줄긋기') {
        while (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          const cleanNext = nextLine.replace(/[^가-힣]/g, '');
          if (headings.includes(cleanNext)) {
            break;
          }
          i++;
        }
        continue;
      }
      
      // Check if this heading has non-empty content before the next heading
      let hasContent = false;
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j];
        const cleanNext = nextLine.replace(/[^가-힣]/g, '');
        if (headings.includes(cleanNext)) {
          break;
        }
        if (nextLine.trim() !== '') {
          hasContent = true;
          break;
        }
      }
      
      if (hasContent) {
        filteredLines.push(currentLine);
      }
    } else {
      filteredLines.push(currentLine);
    }
  }

  return filteredLines.join('\n')
    .replace(/[ \t]{2,}/g, ' ') // collapse multiple horizontal spaces
    .trim();
}

async function fetchDescriptionFromYes24(isbn) {
  const searchUrl = `https://www.yes24.com/Product/Search?domain=BOOK&query=${isbn}`;
  try {
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(4000)
    });
    if (!response.ok) return null;
    
    let html = await response.text();
    let isProductPage = response.url.includes('/Product/Goods/');
    
    if (!isProductPage) {
      // Find the first product link
      const goodsIdMatch = html.match(/\/Product\/Goods\/(\d+)/i);
      if (goodsIdMatch) {
        const goodsUrl = `https://www.yes24.com/Product/Goods/${goodsIdMatch[1]}`;
        console.log(`Yes24 Search didn't redirect. Fetching detail page: ${goodsUrl}`);
        const goodsRes = await fetch(goodsUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          signal: AbortSignal.timeout(4000)
        });
        if (goodsRes.ok) {
          html = await goodsRes.text();
          isProductPage = true;
        }
      }
    }
    
    // Write raw HTML for diagnosis
    fs.writeFileSync(path.join(__dirname, 'last_crawled_yes24.html'), html, 'utf-8');

    const textareaRegex = /<textarea[^>]*class=["']dscr["'][^>]*>([\s\S]*?)<\/textarea>/i;
    const textareaMatch = html.match(textareaRegex);
    if (textareaMatch && textareaMatch[1].trim()) {
      return cleanHtmlToText(textareaMatch[1]);
    }
    
    const divRegex = /<div[^>]*class=["']gd_dscr["'][^>]*>([\s\S]*?)<\/div>/i;
    const divMatch = html.match(divRegex);
    if (divMatch && divMatch[1].trim()) {
      return cleanHtmlToText(divMatch[1]);
    }

    const infoWrapRegex = /<div[^>]*class=["']infoWrap_txtInner["'][^>]*>([\s\S]*?)<\/div>/i;
    const infoWrapMatch = html.match(infoWrapRegex);
    if (infoWrapMatch && infoWrapMatch[1].trim()) {
      return cleanHtmlToText(infoWrapMatch[1]);
    }
  } catch (err) {
    console.error(`Yes24 fetch failed for ISBN ${isbn}:`, err.message);
  }
  return null;
}

async function fetchBookDescription(isbn) {
  const cleanIsbn = getCleanIsbn(isbn);
  if (!cleanIsbn) return null;

  const isbn10 = cleanIsbn.length === 13 ? convertIsbn13To10(cleanIsbn) : cleanIsbn;
  const url = `https://www.aladin.co.kr/shop/product/getContents.aspx?ISBN=${isbn10}&name=Introduce&type=0`;
  const url13 = `https://www.aladin.co.kr/shop/product/getContents.aspx?ISBN=${cleanIsbn}&name=Introduce&type=0`;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': `https://www.aladin.co.kr/shop/wproduct.aspx?ISBN=${cleanIsbn}`,
    'X-Requested-With': 'XMLHttpRequest'
  };

  try {
    let response = await fetch(url, { headers, signal: AbortSignal.timeout(4000) });
    let text = '';
    if (response.ok) {
      text = await response.text();
    }

    if (text.trim().length <= 5) {
      response = await fetch(url13, { headers, signal: AbortSignal.timeout(4000) });
      if (response.ok) {
        text = await response.text();
      }
    }

    if (text.trim().length > 5) {
      // Write raw HTML for diagnosis
      fs.writeFileSync(path.join(__dirname, 'last_crawled_aladin.html'), text, 'utf-8');
      return cleanHtmlToText(text);
    }
  } catch (err) {
    console.error(`Aladin description fetch failed for ISBN ${cleanIsbn}:`, err.message);
  }

  // Fallback to Yes24
  console.log(`Trying Yes24 fallback for ISBN ${cleanIsbn}...`);
  return await fetchDescriptionFromYes24(cleanIsbn);
}

// Populate missing covers for the returned books list
async function populateMissingCovers(books) {
  const booksToFetch = books.filter(b => (!b.image_url || b.image_url === 'failed') && b.isbn);
  if (booksToFetch.length === 0) return books;

  // Process up to 15 books (matches default page size) to keep response time low
  const subset = booksToFetch.slice(0, 15);
  const promises = subset.map(async (book) => {
    const imageUrl = await fetchCoverImage(book.isbn);
    if (imageUrl) {
      book.image_url = imageUrl;
      db.run('UPDATE books SET image_url = ? WHERE id = ?', [imageUrl, book.id]);
    } else {
      db.run('UPDATE books SET image_url = ? WHERE id = ?', ['failed', book.id]);
      book.image_url = 'failed';
    }
  });

  await Promise.all(promises);
  return books;
}

// Password hashing helpers
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, storedHash) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return hash === storedHash;
}

// Authentication Middlewares
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  let token = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: '인증이 필요합니다. 로그인해 주세요.' });
  }

  db.get(
    `SELECT s.user_id, u.nickname FROM sessions s 
     JOIN users u ON s.user_id = u.id 
     WHERE s.token = ? AND s.expires_at > datetime('now')`,
    [token],
    (err, session) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!session) {
        return res.status(401).json({ error: '유효하지 않거나 만료된 세션입니다. 다시 로그인해 주세요.' });
      }
      req.user = {
        id: session.user_id,
        nickname: session.nickname,
        token: token
      };
      next();
    }
  );
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  let token = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    req.user = null;
    return next();
  }

  db.get(
    `SELECT s.user_id, u.nickname FROM sessions s 
     JOIN users u ON s.user_id = u.id 
     WHERE s.token = ? AND s.expires_at > datetime('now')`,
    [token],
    (err, session) => {
      if (err || !session) {
        req.user = null;
      } else {
        req.user = {
          id: session.user_id,
          nickname: session.nickname
        };
      }
      next();
    }
  );
}

function ensureUserRoots(userId, callback) {
  // 1. Check if '즐겨찾기' root category exists
  db.get(
    "SELECT id FROM favorite_categories WHERE user_id = ? AND name = '즐겨찾기' AND parent_id IS NULL",
    [userId],
    (err, favRoot) => {
      if (err) return callback(err);
      
      if (!favRoot) {
        // Create '즐겨찾기' root
        db.run(
          "INSERT INTO favorite_categories (user_id, name, parent_id, sort_order) VALUES (?, '즐겨찾기', NULL, 0)",
          [userId],
          function(err2) {
            if (err2) return callback(err2);
            const favRootId = this.lastID;
            
            // Now ensure '독서 완료' root exists
            ensureReadRoot(userId, favRootId, callback);
          }
        );
      } else {
        ensureReadRoot(userId, favRoot.id, callback);
      }
    }
  );

  function ensureReadRoot(userId, favRootId, callback) {
    db.get(
      "SELECT id FROM favorite_categories WHERE user_id = ? AND name = '독서 완료' AND parent_id IS NULL",
      [userId],
      (err, readRoot) => {
        if (err) return callback(err);
        
        if (!readRoot) {
          // Create '독서 완료' root
          db.run(
            "INSERT INTO favorite_categories (user_id, name, parent_id, sort_order) VALUES (?, '독서 완료', NULL, 1)",
            [userId],
            function(err2) {
              if (err2) return callback(err2);
              
              // Now ensure a default '미분류' folder exists under '즐겨찾기' root
              ensureDefaultFolder(userId, favRootId, callback);
            }
          );
        } else {
          ensureDefaultFolder(userId, favRootId, callback);
        }
      }
    );
  }

  function ensureDefaultFolder(userId, favRootId, callback) {
    // Check if there are any categories under '즐겨찾기' root
    db.get(
      "SELECT id FROM favorite_categories WHERE user_id = ? AND parent_id = ?",
      [userId, favRootId],
      (err, anySub) => {
        if (err) return callback(err);
        
        if (!anySub) {
          // Check if there are ANY categories with parent_id IS NULL (except roots).
          // Migrate them to be subfolders of '즐겨찾기'
          db.all(
            "SELECT id, name FROM favorite_categories WHERE user_id = ? AND parent_id IS NULL AND name NOT IN ('즐겨찾기', '독서 완료')",
            [userId],
            (err2, oldRoots) => {
              if (err2) return callback(err2);
              
              if (oldRoots && oldRoots.length > 0) {
                // Migrate old roots to be children of '즐겨찾기'
                db.serialize(() => {
                  oldRoots.forEach(r => {
                    db.run("UPDATE favorite_categories SET parent_id = ? WHERE id = ?", [favRootId, r.id]);
                  });
                  callback(null);
                });
              } else {
                // Create default '미분류' under '즐겨찾기'
                db.run(
                  "INSERT INTO favorite_categories (user_id, name, parent_id, sort_order) VALUES (?, '미분류', ?, 0)",
                  [userId, favRootId],
                  (err3) => {
                    callback(err3);
                  }
                );
              }
            }
          );
        } else {
          // Roots and subs exist, but let's double check if there are any stray folders with parent_id = NULL (except roots)
          db.run(
            "UPDATE favorite_categories SET parent_id = ? WHERE user_id = ? AND parent_id IS NULL AND name NOT IN ('즐겨찾기', '독서 완료')",
            [favRootId, userId],
            (errMigrate) => {
              callback(errMigrate);
            }
          );
        }
      }
    );
  }
}

function getUserRootIds(userId, callback) {
  ensureUserRoots(userId, (err) => {
    if (err) return callback(err);
    
    db.all(
      "SELECT id, name FROM favorite_categories WHERE user_id = ? AND parent_id IS NULL AND name IN ('즐겨찾기', '독서 완료')",
      [userId],
      (err2, rows) => {
        if (err2) return callback(err2);
        
        let favRootId = null;
        let readRootId = null;
        
        rows.forEach(r => {
          if (r.name === '즐겨찾기') favRootId = r.id;
          if (r.name === '독서 완료') readRootId = r.id;
        });
        
        callback(null, { favRootId, readRootId });
      }
    );
  });
}

// API Endpoint: Get filters configuration
app.get('/api/filters', (req, res) => {
  const queries = {
    sourceTypes: 'SELECT DISTINCT source_type FROM books ORDER BY source_type DESC',
    subtypes: 'SELECT DISTINCT source_type, source_subtype FROM books ORDER BY source_type, source_subtype',
    categories: `SELECT DISTINCT category FROM books WHERE category IS NOT NULL AND category != '' ORDER BY category`
  };

  const results = {};

  db.serialize(() => {
    let completed = 0;
    let failed = false;

    const checkComplete = () => {
      completed++;
      if (completed === 3 && !failed) {
        res.json(results);
      }
    };

    db.all(queries.sourceTypes, [], (err, rows) => {
      if (err) {
        failed = true;
        return res.status(500).json({ error: err.message });
      }
      results.sourceTypes = rows.map(r => r.source_type);
      checkComplete();
    });

    db.all(queries.subtypes, [], (err, rows) => {
      if (err) {
        failed = true;
        return res.status(500).json({ error: err.message });
      }
      // Group subtypes by source_type
      const grouped = {};
      rows.forEach(r => {
        if (!grouped[r.source_type]) {
          grouped[r.source_type] = [];
        }
        grouped[r.source_type].push(r.source_subtype);
      });
      results.subtypes = grouped;
      checkComplete();
    });

    db.all(queries.categories, [], (err, rows) => {
      if (err) {
        failed = true;
        return res.status(500).json({ error: err.message });
      }
      results.categories = rows.map(r => r.category);
      checkComplete();
    });
  });
});

// API Endpoint: Paginated and filtered list of books
app.get('/api/books', optionalAuth, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const offset = (page - 1) * limit;
  
  const search = req.query.search || '';
  const searchType = req.query.searchType || 'all';
  const sourceType = req.query.sourceType || '';
  const subtype = req.query.subtype || '';
  const category = req.query.category || '';

  const runQuery = (favRootId, readRootId) => {
    let sql = 'SELECT *, 0 as is_favorite, 0 as is_read FROM books WHERE 1=1';
    let countSql = 'SELECT COUNT(*) as total FROM books WHERE 1=1';
    const params = [];

    if (req.user && favRootId && readRootId) {
      sql = `
        SELECT b.*, 
          (SELECT 1 FROM favorites f 
           LEFT JOIN favorite_categories c ON f.category_id = c.id 
           WHERE f.book_id = b.id AND f.user_id = ? 
             AND (c.id = ? OR c.parent_id = ?)
           LIMIT 1) as is_favorite,
          (SELECT 1 FROM favorites f 
           LEFT JOIN favorite_categories c ON f.category_id = c.id 
           WHERE f.book_id = b.id AND f.user_id = ? 
             AND (c.id = ? OR c.parent_id = ?)
           LIMIT 1) as is_read
        FROM books b 
        WHERE 1=1
      `;
    }

    if (search) {
      const searchPattern = `%${search}%`;
      let searchClause = '';
      
      if (searchType === 'title') {
        searchClause = ' AND title LIKE ?';
        params.push(searchPattern);
      } else if (searchType === 'author') {
        searchClause = ' AND author LIKE ?';
        params.push(searchPattern);
      } else if (searchType === 'publisher') {
        searchClause = ' AND publisher LIKE ?';
        params.push(searchPattern);
      } else if (searchType === 'isbn') {
        searchClause = ' AND isbn LIKE ?';
        params.push(searchPattern);
      } else {
        searchClause = ' AND (title LIKE ? OR author LIKE ? OR publisher LIKE ? OR description LIKE ? OR category LIKE ?)';
        params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
      }
      
      sql += searchClause;
      countSql += searchClause;
    }

    if (sourceType) {
      const sources = sourceType.split(',');
      if (sources.length > 1) {
        const placeholders = sources.map(() => '?').join(',');
        sql += ` AND source_type IN (${placeholders})`;
        countSql += ` AND source_type IN (${placeholders})`;
        params.push(...sources);
      } else {
        sql += ' AND source_type = ?';
        countSql += ' AND source_type = ?';
        params.push(sourceType);
      }
    }

    if (subtype) {
      sql += ' AND source_subtype = ?';
      countSql += ' AND source_subtype = ?';
      params.push(subtype);
    }

    if (category) {
      sql += ' AND category = ?';
      countSql += ' AND category = ?';
      params.push(category);
    }

    // Order strictly by ranking if bestseller, otherwise alphabetically by title
    if (sourceType === '베스트셀러') {
      sql += ' ORDER BY ranking ASC LIMIT ? OFFSET ?';
    } else {
      sql += ' ORDER BY title ASC LIMIT ? OFFSET ?';
    }
    
    // Binding parameters
    const queryParams = (req.user && favRootId && readRootId) 
      ? [req.user.id, favRootId, favRootId, req.user.id, readRootId, readRootId, ...params, limit, offset]
      : [...params, limit, offset];

    db.serialize(() => {
      let totalCount = 0;
      
      db.get(countSql, params, (err, row) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        totalCount = row ? row.total : 0;

        db.all(sql, queryParams, async (err, rows) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          if (rows.length > 0) {
            try {
              await populateMissingCovers(rows);
            } catch (populateErr) {
              console.error('Failed to populate covers on-the-fly:', populateErr.message);
            }
          }

          res.json({
            books: rows,
            page,
            limit,
            total: totalCount,
            totalPages: Math.ceil(totalCount / limit)
          });
        });
      });
    });
  };

  if (req.user) {
    getUserRootIds(req.user.id, (err, roots) => {
      if (err) {
        console.error('Failed to ensure roots in books API:', err.message);
        return runQuery(null, null);
      }
      runQuery(roots.favRootId, roots.readRootId);
    });
  } else {
    runQuery(null, null);
  }
});

// API Endpoint: Get book details by ID
app.get('/api/books/:id', optionalAuth, (req, res) => {
  const id = req.params.id;

  const runQuery = (favRootId, readRootId) => {
    let sql = 'SELECT *, 0 as is_favorite, 0 as is_read FROM books WHERE id = ?';
    let queryParams = [id];

    if (req.user && favRootId && readRootId) {
      sql = `
        SELECT b.*, 
          (SELECT 1 FROM favorites f 
           LEFT JOIN favorite_categories c ON f.category_id = c.id 
           WHERE f.book_id = b.id AND f.user_id = ? 
             AND (c.id = ? OR c.parent_id = ?)
           LIMIT 1) as is_favorite,
          (SELECT 1 FROM favorites f 
           LEFT JOIN favorite_categories c ON f.category_id = c.id 
           WHERE f.book_id = b.id AND f.user_id = ? 
             AND (c.id = ? OR c.parent_id = ?)
           LIMIT 1) as is_read
        FROM books b 
        WHERE b.id = ?
      `;
      queryParams = [req.user.id, favRootId, favRootId, req.user.id, readRootId, readRootId, id];
    }

    db.get(sql, queryParams, async (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!row) {
        return res.status(404).json({ error: 'Book not found' });
      }

      // On-the-fly fetch cover image if missing or marked failed
      if ((!row.image_url || row.image_url === 'failed') && row.isbn) {
        try {
          const imageUrl = await fetchCoverImage(row.isbn);
          if (imageUrl) {
            row.image_url = imageUrl;
            db.run('UPDATE books SET image_url = ? WHERE id = ?', [imageUrl, id]);
          } else if (!row.image_url) {
            db.run('UPDATE books SET image_url = ? WHERE id = ?', ['failed', id]);
            row.image_url = 'failed';
          }
        } catch (fetchErr) {
          console.error(`Failed to fetch cover on details view for book ${id}:`, fetchErr.message);
        }
      }

      // On-the-fly fetch book summary if missing
      if ((!row.summary || row.summary.trim() === '' || row.summary.trim() === 'failed') && row.isbn) {
        try {
          const summary = await fetchBookDescription(row.isbn);
          if (summary) {
            row.summary = summary;
            db.run('UPDATE books SET summary = ? WHERE id = ?', [summary, id]);
          }
        } catch (descErr) {
          console.error(`Failed to fetch summary for book ${id}:`, descErr.message);
        }
      } else if (row.summary) {
        // Lazy migration: clean existing summaries in the database on-the-fly
        const cleaned = cleanHtmlToText(row.summary);
        if (cleaned !== row.summary) {
          row.summary = cleaned;
          db.run('UPDATE books SET summary = ? WHERE id = ?', [cleaned, id]);
        }
      }

      res.json(row);
    });
  };

  if (req.user) {
    getUserRootIds(req.user.id, (err, roots) => {
      if (err) {
        console.error('Failed to get roots in detail API:', err.message);
        return runQuery(null, null);
      }
      runQuery(roots.favRootId, roots.readRootId);
    });
  } else {
    runQuery(null, null);
  }
});

// ==========================================
// AUTHENTICATION ENDPOINTS
// ==========================================

// Register User
app.post('/api/auth/register', (req, res) => {
  const { nickname, password } = req.body;
  if (!nickname || !password) {
    return res.status(400).json({ error: '별명과 비밀번호를 입력해 주세요.' });
  }
  
  const cleanNickname = nickname.trim();
  if (cleanNickname.length < 2 || cleanNickname.length > 15) {
    return res.status(400).json({ error: '별명은 2자 이상 15자 이하여야 합니다.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: '비밀번호는 최소 6자 이상이어야 합니다.' });
  }

  // Check if nickname already exists
  db.get('SELECT id FROM users WHERE nickname = ?', [cleanNickname], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (row) {
      return res.status(400).json({ error: '이미 사용 중인 별명입니다.' });
    }

    // Hash password
    const { salt, hash } = hashPassword(password);

    // Insert user
    db.run(
      'INSERT INTO users (nickname, password_hash, salt) VALUES (?, ?, ?)',
      [cleanNickname, hash, salt],
      function (insertErr) {
        if (insertErr) {
          return res.status(500).json({ error: insertErr.message });
        }
        const userId = this.lastID;
        
        // Auto-login: Create session token (expires in 30 days)
        const token = crypto.randomBytes(32).toString('hex');
        db.run(
          `INSERT INTO sessions (token, user_id, expires_at) 
           VALUES (?, ?, datetime('now', '+30 days'))`,
          [token, userId],
          (sessionErr) => {
            if (sessionErr) {
              return res.status(500).json({ error: sessionErr.message });
            }
            
            // Ensure default roots and categories are created for the user
            ensureUserRoots(userId, (catErr) => {
              if (catErr) console.error('Failed to initialize user category roots:', catErr.message);
              res.status(201).json({
                message: '회원가입이 완료되었습니다.',
                token,
                user: { id: userId, nickname: cleanNickname }
              });
            });
          }
        );
      }
    );
  });
});

// Login User
app.post('/api/auth/login', (req, res) => {
  const { nickname, password } = req.body;
  if (!nickname || !password) {
    return res.status(400).json({ error: '별명과 비밀번호를 입력해 주세요.' });
  }

  db.get('SELECT * FROM users WHERE nickname = ?', [nickname.trim()], (err, user) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!user) {
      return res.status(400).json({ error: '별명 또는 비밀번호가 올바르지 않습니다.' });
    }

    // Verify Password
    const isValid = verifyPassword(password, user.salt, user.password_hash);
    if (!isValid) {
      return res.status(400).json({ error: '별명 또는 비밀번호가 올바르지 않습니다.' });
    }

    // Create session token
    const token = crypto.randomBytes(32).toString('hex');
    db.run(
      `INSERT INTO sessions (token, user_id, expires_at) 
       VALUES (?, ?, datetime('now', '+30 days'))`,
      [token, user.id],
      (sessionErr) => {
        if (sessionErr) {
          return res.status(500).json({ error: sessionErr.message });
        }
        ensureUserRoots(user.id, (catErr) => {
          if (catErr) console.error('Failed to initialize/migrate user category roots on login:', catErr.message);
          res.json({
            message: '로그인에 성공했습니다.',
            token,
            user: { id: user.id, nickname: user.nickname }
          });
        });
      }
    );
  });
});

// Logout User
app.post('/api/auth/logout', requireAuth, (req, res) => {
  db.run('DELETE FROM sessions WHERE token = ?', [req.user.token], (err) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ message: '로그아웃 되었습니다.' });
  });
});

// Get Current User
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ==========================================
// FAVORITES FOLDERS ENDPOINTS
// ==========================================

// Get Favorite Categories (Folders)
app.get('/api/favorites/folders', requireAuth, (req, res) => {
  ensureUserRoots(req.user.id, (err) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    db.all(
      'SELECT * FROM favorite_categories WHERE user_id = ? ORDER BY sort_order ASC, name ASC',
      [req.user.id],
      (err2, rows) => {
        if (err2) {
          return res.status(500).json({ error: err2.message });
        }
        res.json(rows);
      }
    );
  });
});

// Create Favorite Category (Folder)
app.post('/api/favorites/folders', requireAuth, (req, res) => {
  const { name, parent_id } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '폴더 이름을 입력해 주세요.' });
  }

  const insertFolder = (actualParentId) => {
    db.run(
      'INSERT INTO favorite_categories (user_id, name, parent_id) VALUES (?, ?, ?)',
      [req.user.id, name.trim(), actualParentId],
      function (err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        res.status(201).json({
          id: this.lastID,
          user_id: req.user.id,
          name: name.trim(),
          parent_id: actualParentId,
          sort_order: 0
        });
      }
    );
  };

  if (parent_id) {
    insertFolder(parent_id);
  } else {
    // If no parent_id specified, place under '즐겨찾기' root folder
    db.get(
      "SELECT id FROM favorite_categories WHERE user_id = ? AND name = '즐겨찾기' AND parent_id IS NULL",
      [req.user.id],
      (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        const favRootId = row ? row.id : null;
        insertFolder(favRootId);
      }
    );
  }
});

// Rename/Update Favorite Category
app.put('/api/favorites/folders/:id', requireAuth, (req, res) => {
  const folderId = req.params.id;
  const { name, parent_id, sort_order } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: '폴더 이름을 입력해 주세요.' });
  }

  // Verify the folder belongs to user
  db.get(
    'SELECT id, name, parent_id FROM favorite_categories WHERE id = ? AND user_id = ?',
    [folderId, req.user.id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: '폴더를 찾을 수 없거나 권한이 없습니다.' });

      // Guard: Prevent modifications to root folders ('즐겨찾기', '독서 완료')
      if (row.parent_id === null && (row.name === '즐겨찾기' || row.name === '독서 완료')) {
        return res.status(400).json({ error: '기본 루트 카테고리는 수정할 수 없습니다.' });
      }

      db.run(
        `UPDATE favorite_categories 
         SET name = ?, parent_id = ?, sort_order = ? 
         WHERE id = ? AND user_id = ?`,
        [name.trim(), parent_id || null, sort_order || 0, folderId, req.user.id],
        (updateErr) => {
          if (updateErr) return res.status(500).json({ error: updateErr.message });
          res.json({ message: '폴더가 수정되었습니다.' });
        }
      );
    }
  );
});

// Delete Favorite Category
app.delete('/api/favorites/folders/:id', requireAuth, (req, res) => {
  const folderId = req.params.id;

  // Verify the folder belongs to user
  db.get(
    'SELECT id, name, parent_id FROM favorite_categories WHERE id = ? AND user_id = ?',
    [folderId, req.user.id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: '폴더를 찾을 수 없거나 권한이 없습니다.' });

      // Guard: Prevent deleting root folders
      if (row.parent_id === null && (row.name === '즐겨찾기' || row.name === '독서 완료')) {
        return res.status(400).json({ error: '기본 루트 카테고리는 삭제할 수 없습니다.' });
      }

      // Determine default folder (oldest subfolder under '즐겨찾기' root)
      db.get(
        `SELECT id FROM favorite_categories 
         WHERE user_id = ? AND parent_id = (SELECT id FROM favorite_categories WHERE user_id = ? AND name = '즐겨찾기' AND parent_id IS NULL)
         ORDER BY id ASC LIMIT 1`,
        [req.user.id, req.user.id],
        (defaultFolderErr, defaultFolder) => {
          if (defaultFolderErr) return res.status(500).json({ error: defaultFolderErr.message });
          
          if (defaultFolder && defaultFolder.id === parseInt(folderId)) {
            return res.status(400).json({ error: '기본 폴더는 삭제할 수 없습니다.' });
          }
          
          const targetCategoryId = defaultFolder ? defaultFolder.id : null;

          db.serialize(() => {
            // 1. Update books in this folder to be in target folder
            db.run(
              'UPDATE favorites SET category_id = ? WHERE user_id = ? AND category_id = ?',
              [targetCategoryId, req.user.id, folderId]
            );
            
            // 2. Update any subfolders to be root folders
            db.run(
              'UPDATE favorite_categories SET parent_id = NULL WHERE user_id = ? AND parent_id = ?',
              [req.user.id, folderId]
            );

            // 3. Delete the category itself
            db.run(
              'DELETE FROM favorite_categories WHERE id = ? AND user_id = ?',
              [folderId, req.user.id],
              (deleteErr) => {
                if (deleteErr) return res.status(500).json({ error: deleteErr.message });
                res.json({ message: '폴더가 삭제되었으며, 포함된 책들은 미분류로 이동되었습니다.' });
              }
            );
          });
        }
      );
    }
  );
});

// ==========================================
// FAVORITE BOOKS ENDPOINTS
// ==========================================

// Get Favorite Books
app.get('/api/favorites', requireAuth, (req, res) => {
  db.all(
    `SELECT f.id as favorite_id, f.book_id, f.category_id, f.sort_order,
            b.title, b.author, b.publisher, b.image_url, b.source_type, b.source_subtype
     FROM favorites f
     JOIN books b ON f.book_id = b.id
     WHERE f.user_id = ?
     ORDER BY f.category_id ASC, f.sort_order ASC, f.created_at DESC`,
    [req.user.id],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(rows);
    }
  );
});

// Add Book to Favorites
app.post('/api/favorites', requireAuth, (req, res) => {
  const { book_id, category_id } = req.body;
  if (!book_id) {
    return res.status(400).json({ error: '도서 ID가 누락되었습니다.' });
  }

  const getCategoryAndInsert = () => {
    if (category_id) {
      db.get(
        'SELECT id FROM favorite_categories WHERE id = ? AND user_id = ?',
        [category_id, req.user.id],
        (err, row) => {
          if (err) return res.status(500).json({ error: err.message });
          if (!row) return res.status(400).json({ error: '유효하지 않은 폴더입니다.' });
          
          insertFavorite(category_id);
        }
      );
    } else {
      // Find default folder (oldest subfolder under '즐겨찾기' root)
      db.get(
        `SELECT id FROM favorite_categories 
         WHERE user_id = ? AND parent_id = (SELECT id FROM favorite_categories WHERE user_id = ? AND name = '즐겨찾기' AND parent_id IS NULL)
         ORDER BY id ASC LIMIT 1`,
        [req.user.id, req.user.id],
        (err, row) => {
          if (err) return res.status(500).json({ error: err.message });
          const defaultId = row ? row.id : null;
          insertFavorite(defaultId);
        }
      );
    }
  };

  const insertFavorite = (catId) => {
    db.run(
      `INSERT INTO favorites (user_id, book_id, category_id) 
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, book_id, category_id) DO NOTHING`,
      [req.user.id, book_id, catId],
      function (err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        res.status(201).json({
          message: '즐겨찾기에 추가되었습니다.',
          id: this.lastID || null,
          book_id,
          category_id: catId
        });
      }
    );
  };

  getCategoryAndInsert();
});

// Delete Book from Favorites (By Book ID and optionally Category ID)
app.delete('/api/favorites/:bookId', requireAuth, (req, res) => {
  const bookId = req.params.bookId;
  const categoryId = req.query.category_id;

  let sql = 'DELETE FROM favorites WHERE user_id = ? AND book_id = ?';
  let params = [req.user.id, bookId];

  if (categoryId) {
    sql += ' AND category_id = ?';
    params.push(categoryId);
  }

  db.run(sql, params, function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
    }
    
    // Cleanup: if target category was inside "독서 완료" root and is now empty, delete it
    if (categoryId) {
      db.run(
        `DELETE FROM favorite_categories 
         WHERE user_id = ? AND parent_id = (SELECT id FROM favorite_categories WHERE user_id = ? AND name = '독서 완료' AND parent_id IS NULL)
           AND id NOT IN (SELECT DISTINCT category_id FROM favorites WHERE user_id = ? AND category_id IS NOT NULL)`,
        [req.user.id, req.user.id, req.user.id],
        (cleanErr) => {
          if (cleanErr) console.error('Failed to clean empty date folders:', cleanErr.message);
          res.json({ message: '삭제되었습니다.' });
        }
      );
    } else {
      res.json({ message: '삭제되었습니다.' });
    }
  });
});

// Update Book's Category/Sort Order in Favorites
app.put('/api/favorites/:bookId', requireAuth, (req, res) => {
  const bookId = req.params.bookId;
  const { category_id, source_category_id, sort_order } = req.body;

  const updateFavorite = (catId) => {
    let sql = `UPDATE favorites SET category_id = ?, sort_order = ? WHERE user_id = ? AND book_id = ?`;
    let params = [catId, sort_order || 0, req.user.id, bookId];

    if (source_category_id) {
      sql += ' AND category_id = ?';
      params.push(source_category_id);
    }

    db.run(sql, params, function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ message: '즐겨찾기 정보가 수정되었습니다.' });
    });
  };

  if (category_id) {
    db.get(
      'SELECT id FROM favorite_categories WHERE id = ? AND user_id = ?',
      [category_id, req.user.id],
      (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(400).json({ error: '유효하지 않은 폴더입니다.' });
        updateFavorite(category_id);
      }
    );
  } else {
    // Determine default folder (oldest subfolder under '즐겨찾기' root)
    db.get(
      `SELECT id FROM favorite_categories 
       WHERE user_id = ? AND parent_id = (SELECT id FROM favorite_categories WHERE user_id = ? AND name = '즐겨찾기' AND parent_id IS NULL)
       ORDER BY id ASC LIMIT 1`,
      [req.user.id, req.user.id],
      (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        const defaultId = row ? row.id : null;
        updateFavorite(defaultId);
      }
    );
  }
});

// Add Book to Read Completion List (Creates date folder YYYY.MM.DD under '독서 완료' root)
app.post('/api/favorites/read', requireAuth, (req, res) => {
  const { book_id, is_read } = req.body;
  if (!book_id) {
    return res.status(400).json({ error: '도서 ID가 누락되었습니다.' });
  }

  if (is_read) {
    // 1. Get '독서 완료' root ID
    db.get(
      "SELECT id FROM favorite_categories WHERE user_id = ? AND name = '독서 완료' AND parent_id IS NULL",
      [req.user.id],
      (err, readRoot) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!readRoot) return res.status(500).json({ error: '독서 완료 카테고리를 찾을 수 없습니다.' });

        const readRootId = readRoot.id;

        // 2. Generate YYYY.MM.DD date folder name
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const date = String(now.getDate()).padStart(2, '0');
        const folderName = `${year}.${month}.${date}`;

        // 3. Find or Create date folder under '독서 완료' root
        db.get(
          "SELECT id FROM favorite_categories WHERE user_id = ? AND name = ? AND parent_id = ?",
          [req.user.id, folderName, readRootId],
          (err2, folder) => {
            if (err2) return res.status(500).json({ error: err2.message });

            if (folder) {
              insertReadBook(folder.id);
            } else {
              db.run(
                "INSERT INTO favorite_categories (user_id, name, parent_id) VALUES (?, ?, ?)",
                [req.user.id, folderName, readRootId],
                function (err3) {
                  if (err3) return res.status(500).json({ error: err3.message });
                  insertReadBook(this.lastID);
                }
              );
            }
          }
        );
      }
    );

    const insertReadBook = (catId) => {
      db.run(
        `INSERT INTO favorites (user_id, book_id, category_id) 
         VALUES (?, ?, ?)
         ON CONFLICT(user_id, book_id, category_id) DO NOTHING`,
        [req.user.id, book_id, catId],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({
            message: '읽음 완료 처리되었습니다.',
            book_id,
            category_id: catId
          });
        }
      );
    };
  } else {
    // is_read = false (Cancel read status)
    // Find all '독서 완료' subfolders for this user and remove this book from them
    db.all(
      `SELECT id FROM favorite_categories 
       WHERE user_id = ? AND parent_id = (SELECT id FROM favorite_categories WHERE user_id = ? AND name = '독서 완료' AND parent_id IS NULL)`,
      [req.user.id, req.user.id],
      (err, folders) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!folders || folders.length === 0) {
          return res.json({ message: '읽음 완료가 취소되었습니다.' });
        }

        const folderIds = folders.map(f => f.id);
        const placeholders = folderIds.map(() => '?').join(',');
        
        db.run(
          `DELETE FROM favorites WHERE user_id = ? AND book_id = ? AND category_id IN (${placeholders})`,
          [req.user.id, book_id, ...folderIds],
          function (err2) {
            if (err2) return res.status(500).json({ error: err2.message });
            
            // Clean up empty date folders under '독서 완료'
            db.run(
              `DELETE FROM favorite_categories 
               WHERE user_id = ? AND parent_id = (SELECT id FROM favorite_categories WHERE user_id = ? AND name = '독서 완료' AND parent_id IS NULL)
                 AND id NOT IN (SELECT DISTINCT category_id FROM favorites WHERE user_id = ? AND category_id IS NOT NULL)`,
              [req.user.id, req.user.id, req.user.id],
              (cleanErr) => {
                if (cleanErr) console.error('Failed to clean empty date folders:', cleanErr.message);
                res.json({ message: '읽음 완료가 취소되었습니다.' });
              }
            );
          }
        );
      }
    );
  }
});

// Serve frontend html for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
