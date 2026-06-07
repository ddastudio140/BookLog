import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';
import { fileURLToPath } from 'url';
import db from './database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const univDir = path.resolve(rootDir, '대학교');
const eduDir = path.resolve(rootDir, '교육청');

function findColumnIndices(headers) {
  const map = {};
  headers.forEach((h, index) => {
    if (h === undefined || h === null) return;
    const str = h.toString().trim().replace(/\s+/g, '');
    
    if (str === '순번' || str === 'No' || str === '순위' || str === '랭킹' || str === '번호' || str === '순위번호') {
      map.ranking = index;
      if (str === '번호' || str === '순번' || str === 'No') {
        map.id = index;
      }
    } else if (str.includes('도서명') || str.includes('서명') || str.includes('책명') || str.includes('책제목') || str.includes('상품명')) {
      map.title = index;
    } else if (str.includes('저자') || str.includes('글저자') || str.includes('작가') || str.includes('지은이')) {
      map.author = index;
    } else if (str.includes('출판사') || str.includes('발행사')) {
      map.publisher = index;
    } else if (str.includes('년도') || str.includes('발행일') || str.includes('출판일') || str.includes('발간일') || str.includes('출간일')) {
      map.pub_year = index;
    } else if (str.toUpperCase().includes('ISBN')) {
      map.isbn = index;
    } else if (str.includes('청구기호')) {
      map.call_number = index;
    } else if (str.includes('가격') || str.includes('정가') || str.includes('판매가')) {
      map.price = index;
    } else if (str.includes('추천년월') || str.includes('추천연월') || str.includes('추천일') || str.includes('추천일자')) {
      map.recommendation_month = index;
    } else if (str.includes('주제구분') || str.includes('구분') || str.includes('분류') || str.includes('카테고리') || str.includes('대상') || str.includes('분야')) {
      map.category = index;
    } else if (str.includes('추천사유') || str.includes('소개') || str.includes('추천평') || str.includes('도서소개') || str.includes('테마') || str.includes('설명')) {
      map.description = index;
    }
  });
  return map;
}

const coverCache = new Map();
const summaryCache = new Map();
const insertedIsbns = new Set();

function importExcelFile(filePath, sourceType, sourceSubtype) {
  return new Promise((resolve, reject) => {
    console.log(`\nImporting: ${path.basename(filePath)} (${sourceType} - ${sourceSubtype})`);
    
    if (!fs.existsSync(filePath)) {
      console.warn(`File not found: ${filePath}`);
      return resolve();
    }

    try {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

      if (rows.length === 0) {
        console.warn(`Empty sheet in ${filePath}`);
        return resolve();
      }

      const headers = rows[0];
      const colMap = findColumnIndices(headers);

      // Print detected columns for debugging
      console.log('Detected headers mapping:');
      Object.keys(colMap).forEach(key => {
        console.log(`  - ${key}: Index ${colMap[key]} ("${headers[colMap[key]]}")`);
      });

      // We must check if title is found
      if (colMap.title === undefined) {
        console.error(`Error: Could not find title column in ${filePath}. Headers: ${headers}`);
        return resolve();
      }

      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        const stmt = db.prepare(`
          INSERT INTO books (
            source_type, source_subtype, title, author, publisher, pub_year, 
            isbn, call_number, price, recommendation_month, category, description, image_url, summary, ranking
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        let insertedCount = 0;
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;

          // Get values safely
          const getValue = (idx) => {
            if (idx === undefined || row[idx] === undefined || row[idx] === null) return '';
            return row[idx].toString().trim();
          };

          const title = getValue(colMap.title);
          if (!title) continue; // Skip rows without title

          const isbn = getValue(colMap.isbn);
          if (isbn) {
            const key = `${sourceType}|${sourceSubtype}|${isbn}`;
            if (insertedIsbns.has(key)) {
              continue; // Skip duplicate ISBN in the same category
            }
            insertedIsbns.add(key);
          }

          const author = getValue(colMap.author);
          const publisher = getValue(colMap.publisher);
          const pub_year = getValue(colMap.pub_year);
          const call_number = getValue(colMap.call_number);
          const price = getValue(colMap.price);
          const recommendation_month = getValue(colMap.recommendation_month);
          const category = getValue(colMap.category);
          const description = getValue(colMap.description);
          const imageUrl = coverCache.get(isbn) || null;
          const summary = summaryCache.get(isbn) || null;
          
          const rankingVal = getValue(colMap.ranking);
          const ranking = rankingVal ? parseInt(rankingVal.replace(/[^0-9]/g, '')) : null;

          stmt.run([
            sourceType,
            sourceSubtype,
            title,
            author,
            publisher,
            pub_year,
            isbn,
            call_number,
            price,
            recommendation_month,
            category,
            description,
            imageUrl,
            summary,
            ranking
          ]);
          insertedCount++;
        }

        stmt.finalize((err) => {
          if (err) {
            db.run('ROLLBACK');
            console.error(`Error finalizing statement for ${filePath}:`, err.message);
            reject(err);
          } else {
            db.run('COMMIT', (commitErr) => {
              if (commitErr) {
                console.error(`Error committing transaction for ${filePath}:`, commitErr.message);
                reject(commitErr);
              } else {
                console.log(`Successfully imported ${insertedCount} books.`);
                resolve();
              }
            });
          }
        });
      });
    } catch (error) {
      console.error(`Error processing file ${filePath}:`, error);
      reject(error);
    }
  });
}

async function main() {
  try {
    // 0. Backup cover image & summary cache mapping (isbn -> image_url, summary)
    await new Promise((resolve) => {
      db.all("SELECT isbn, image_url, summary FROM books WHERE isbn IS NOT NULL AND isbn != ''", [], (err, rows) => {
        if (!err && rows) {
          rows.forEach(r => {
            if (r.image_url && r.image_url !== 'failed') {
              coverCache.set(r.isbn, r.image_url);
            }
            if (r.summary && r.summary.trim() !== '') {
              summaryCache.set(r.isbn, r.summary);
            }
          });
        }
        console.log(`Backed up ${coverCache.size} cover images and ${summaryCache.size} summaries from cache.`);
        resolve();
      });
    });

    // 1. Clear existing data
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM books', (err) => {
        if (err) reject(err);
        else {
          console.log('Cleared existing books table.');
          resolve();
        }
      });
    });

    // 2. Scan and import Librarian Recommended Books
    const files = fs.readdirSync(rootDir);
    const libFiles = files.filter(f => (f.startsWith('사서추천도서_') || f.startsWith('서울시교육청도서관_추천도서_')) && f.endsWith('.xlsx'));
    
    for (const file of libFiles) {
      const filePath = path.join(rootDir, file);
      let subtype = '일반';
      
      if (file.startsWith('사서추천도서_')) {
        const parts = file.split('_');
        if (parts.length >= 3) {
          subtype = parts[2].replace('.xlsx', '');
        }
      } else if (file.startsWith('서울시교육청도서관_추천도서_')) {
        subtype = '서울시교육청도서관';
      }
      
      await importExcelFile(filePath, '사서추천', subtype);
    }

    // 2b. Scan and import Office of Education Recommended Books from '교육청' folder
    if (fs.existsSync(eduDir)) {
      const eduFiles = fs.readdirSync(eduDir).filter(f => f.endsWith('.xlsx'));
      for (const file of eduFiles) {
        const filePath = path.join(eduDir, file);
        const parts = file.split('_');
        const subtype = parts[0] || '교육청';
        await importExcelFile(filePath, '사서추천', subtype);
      }
    } else {
      console.log('No 교육청 directory found.');
    }

    // 3. Scan and import University Recommended Books
    if (fs.existsSync(univDir)) {
      const univFiles = fs.readdirSync(univDir).filter(f => f.endsWith('.xlsx'));
      for (const file of univFiles) {
        const filePath = path.join(univDir, file);
        // Extract university name: e.g. 고려대학교_추천도서_20260603.xlsx -> 고려대학교
        const parts = file.split('_');
        const subtype = parts[0] || '대학교';
        await importExcelFile(filePath, '대학추천', subtype);
      }
    } else {
      console.log('No university directory found.');
    }

    // 4. Scan and import Bestseller Books
    const bestsellerDir = path.resolve(rootDir, '베스트셀러');
    if (fs.existsSync(bestsellerDir)) {
      // 4a. Age-based bestsellers
      const ageDir = path.join(bestsellerDir, '연령');
      if (fs.existsSync(ageDir)) {
        const ageFiles = fs.readdirSync(ageDir).filter(f => f.endsWith('.xlsx'));
        for (const file of ageFiles) {
          const filePath = path.join(ageDir, file);
          const subtype = path.basename(file, '.xlsx'); // "유아", "어린이", "청소년"
          await importExcelFile(filePath, '베스트셀러', subtype);
        }
      }
      
      // 4b. Comprehensive bestsellers
      const generalDir = path.join(bestsellerDir, '종합');
      if (fs.existsSync(generalDir)) {
        const generalFiles = fs.readdirSync(generalDir).filter(f => f.endsWith('.xlsx'));
        for (const file of generalFiles) {
          const filePath = path.join(generalDir, file);
          await importExcelFile(filePath, '베스트셀러', '종합');
        }
      }
    } else {
      console.log('No 베스트셀러 directory found.');
    }

    console.log('\n=======================================');
    console.log('Database seeding process completed!');
    console.log('=======================================');
    
    // Check total count
    db.all('SELECT COUNT(*) as count FROM books', (err, rows) => {
      if (err) {
        console.error('Error counting books:', err.message);
      } else {
        console.log(`Total books in database: ${rows[0].count}`);
      }
      db.close();
    });

  } catch (error) {
    console.error('Import failed:', error);
    db.close();
  }
}

main();
