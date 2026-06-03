import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
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
app.get('/api/books', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const offset = (page - 1) * limit;
  
  const search = req.query.search || '';
  const searchType = req.query.searchType || 'all';
  const sourceType = req.query.sourceType || '';
  const subtype = req.query.subtype || '';
  const category = req.query.category || '';

  let sql = 'SELECT * FROM books WHERE 1=1';
  let countSql = 'SELECT COUNT(*) as total FROM books WHERE 1=1';
  const params = [];

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
    sql += ' AND source_type = ?';
    countSql += ' AND source_type = ?';
    params.push(sourceType);
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

  // Order alphabetically by title
  sql += ' ORDER BY title ASC LIMIT ? OFFSET ?';
  const queryParams = [...params, limit, offset];

  db.serialize(() => {
    let totalCount = 0;
    
    // First query count
    db.get(countSql, params, (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      totalCount = row ? row.total : 0;

      // Then query rows
      db.all(sql, queryParams, async (err, rows) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        // On-the-fly fetch missing cover images for the list
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
});

// API Endpoint: Get book details by ID
app.get('/api/books/:id', (req, res) => {
  const id = req.params.id;
  db.get('SELECT * FROM books WHERE id = ?', [id], async (err, row) => {
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
});

// Serve frontend html for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
