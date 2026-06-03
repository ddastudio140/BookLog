import db from './database.js';

// Parse command line arguments
const args = process.argv.slice(2);
const limitArg = args.find(arg => arg.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 50; // Default to 50 books per run
const runAll = args.includes('--all');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchCoverImage(isbn, title) {
  // Handle multiple ISBNs in a single string (split by space, comma, or slash)
  const isbnParts = isbn.split(/[\s,,\/]+/);
  let cleanIsbn = '';
  
  for (const part of isbnParts) {
    const clean = part.replace(/[^0-9X]/gi, '');
    if (clean.length === 10 || clean.length === 13) {
      cleanIsbn = clean;
      break;
    }
  }

  if (!cleanIsbn) {
    return { success: false, error: 'No valid 10 or 13-digit ISBN found in field' };
  }

  const url = `https://www.aladin.co.kr/search/wsearchresult.aspx?SearchTarget=Book&SearchWord=${cleanIsbn}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(5000) // 5s timeout
    });

    if (!response.ok) {
      return { success: false, error: `HTTP error ${response.status}` };
    }

    const html = await response.text();
    
    // Regex for Aladin cover images: e.g. https://image.aladin.co.kr/product/37594/16/cover200/8911732885_1.jpg
    const matches = html.match(/https:\/\/image\.aladin\.co\.kr\/product\/\d+\/\d+\/cover[^\s"'>]+/gi);
    
    if (matches && matches.length > 0) {
      // Get the first match
      let imageUrl = matches[0];
      // Try to upgrade to cover500 for higher quality
      imageUrl = imageUrl.replace('/cover200/', '/cover500/').replace('/cover150/', '/cover500/');
      return { success: true, imageUrl };
    }
    
    return { success: false, error: 'No cover image found in HTML' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function main() {
  console.log('=== Book Metadata Cover Scraper Started ===');
  
  let selectSql = `
    SELECT id, title, isbn 
    FROM books 
    WHERE isbn IS NOT NULL 
      AND isbn != '' 
      AND (image_url IS NULL OR image_url = '')
  `;
  
  if (!runAll) {
    selectSql += ` LIMIT ${limit}`;
    console.log(`Mode: Batch Run (Limit: ${limit} books)`);
  } else {
    console.log(`Mode: Full Run (All remaining books)`);
  }

  // Get books to process
  const books = await new Promise((resolve, reject) => {
    db.all(selectSql, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  if (books.length === 0) {
    console.log('No books found that require image cover fetching.');
    db.close();
    return;
  }

  console.log(`Found ${books.length} books to process. Starting scraping...`);
  console.log('----------------------------------------------------');

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    const progress = `[${i + 1}/${books.length}]`;
    
    console.log(`${progress} Fetching for "${book.title}" (ISBN: ${book.isbn})...`);
    
    const result = await fetchCoverImage(book.isbn, book.title);
    
    if (result.success) {
      successCount++;
      console.log(`  -> SUCCESS: Found cover image: ${result.imageUrl}`);
      
      // Update database
      await new Promise((resolve, reject) => {
        db.run('UPDATE books SET image_url = ? WHERE id = ?', [result.imageUrl, book.id], (err) => {
          if (err) {
            console.error(`  -> Database update error:`, err.message);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    } else {
      failCount++;
      console.log(`  -> FAILED: ${result.error}`);
      
      // Set to 'failed' to prevent infinite retries in subsequent runs
      await new Promise((resolve) => {
        db.run('UPDATE books SET image_url = ? WHERE id = ?', ['failed', book.id], () => resolve());
      });
    }

    // Delay between requests to prevent getting blocked by Yes24 (500ms)
    if (i < books.length - 1) {
      await sleep(600);
    }
  }

  console.log('----------------------------------------------------');
  console.log(`Scraping run completed.`);
  console.log(`- Total Processed: ${books.length}`);
  console.log(`- Success (Cover Updated): ${successCount}`);
  console.log(`- Failed (No cover or error): ${failCount}`);
  console.log('====================================================');
  
  db.close();
}

main();
