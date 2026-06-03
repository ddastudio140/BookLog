import fetch from 'node-fetch'; // Wait, does the project use native fetch or node-fetch?
// Node 18+ has native fetch, so we can use global fetch.

async function testFetch() {
  const isbn = '9788949191324'; // 용감무쌍 염소 삼 형제 or another book
  const isbn10 = '8949191326';
  
  // Test Aladin
  const aladinUrl = `https://www.aladin.co.kr/shop/product/getContents.aspx?ISBN=${isbn10}&name=Introduce&type=0`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': `https://www.aladin.co.kr/shop/wproduct.aspx?ISBN=${isbn}`,
    'X-Requested-With': 'XMLHttpRequest'
  };

  try {
    console.log('Fetching from Aladin:', aladinUrl);
    const res = await fetch(aladinUrl, { headers });
    const text = await res.text();
    console.log('--- ALADIN RAW RESPONSE ---');
    console.log(text.substring(0, 2000));
    console.log('---------------------------');
  } catch (err) {
    console.error('Aladin error:', err.message);
  }

  // Test Yes24
  const yes24Url = `https://www.yes24.com/Product/Search?domain=BOOK&query=${isbn}`;
  try {
    console.log('Fetching from Yes24 Search:', yes24Url);
    const res = await fetch(yes24Url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const text = await res.text();
    console.log('--- YES24 RAW RESPONSE ---');
    
    const textareaRegex = /<textarea[^>]*class=["']dscr["'][^>]*>([\s\S]*?)<\/textarea>/i;
    const textareaMatch = text.match(textareaRegex);
    if (textareaMatch) {
      console.log('Textarea match:', textareaMatch[0]);
    } else {
      console.log('No textarea match');
    }

    const divRegex = /<div[^>]*class=["']gd_dscr["'][^>]*>([\s\S]*?)<\/div>/i;
    const divMatch = text.match(divRegex);
    if (divMatch) {
      console.log('Div match:', divMatch[0]);
    } else {
      console.log('No div match');
    }
    console.log('--------------------------');
  } catch (err) {
    console.error('Yes24 error:', err.message);
  }
}

testFetch();
