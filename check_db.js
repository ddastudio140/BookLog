import db from './db/database.js';

db.all("SELECT title, isbn, summary FROM books WHERE summary IS NOT NULL AND summary != '' LIMIT 5", [], (err, rows) => {
  if (err) {
    console.error(err);
  } else if (rows.length === 0) {
    console.log('No summaries found in database');
  } else {
    rows.forEach((row, i) => {
      console.log(`\n=================== BOOK ${i + 1} ===================`);
      console.log('Title:', row.title);
      console.log('ISBN:', row.isbn);
      console.log('Summary Length:', row.summary.length);
      console.log('Summary string representation:');
      console.log(JSON.stringify(row.summary.substring(0, 500)));
      console.log('--- Rendered Summary ---');
      console.log(row.summary.substring(0, 500));
    });
  }
  db.close();
});
