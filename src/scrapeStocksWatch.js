const cheerio = require('cheerio');

// Tin Nhanh Chứng Khoán publishes a daily "Cổ phiếu cần quan tâm ngày D/M" roundup
// of brokerage reports. There's no RSS/category listing for it, but its monthly
// Google News sitemap is a plain static XML file we can scan for today's URL —
// the article slug embeds the date as "ngay-{day}{month}" (no zero padding).
function vnDateParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return { year: get('year'), month: get('month'), day: get('day') };
}

async function findTodayArticleUrl() {
  const { year, month, day } = vnDateParts();
  const sitemapUrl = `https://www.tinnhanhchungkhoan.vn/sitemaps/news-${year}-${month}.xml`;
  const res = await fetch(sitemapUrl);
  if (!res.ok) return null;
  const xml = await res.text();

  const slugDate = `${day}${month}`;
  const re = new RegExp(
    `https://www\\.tinnhanhchungkhoan\\.vn/co-phieu-can-quan-tam-ngay-${slugDate}-post\\d+\\.html`
  );
  const match = xml.match(re);
  return match ? match[0] : null;
}

async function scrapeStocksWatch() {
  const url = await findTodayArticleUrl();
  if (!url) return [];

  const res = await fetch(url);
  if (!res.ok) return [];
  const html = await res.text();

  const $ = cheerio.load(html);
  const body = $('div.article__body.cms-body');
  if (!body.length) return [];

  const text = body.text();
  const tickers = [];
  const seen = new Set();
  const re = /dành cho cổ phiếu\s+([A-Z]{2,5})\b/g;
  let m;
  while ((m = re.exec(text))) {
    const ticker = m[1];
    if (!seen.has(ticker)) {
      seen.add(ticker);
      tickers.push(ticker);
    }
  }

  return tickers;
}

module.exports = { scrapeStocksWatch };
