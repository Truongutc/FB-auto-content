const Parser = require('rss-parser');
const cheerio = require('cheerio');

const parser = new Parser();

// Vietstock publishes a curated "Đọc gì trước giờ giao dịch chứng khoán?" digest
// every trading day at 06:00 ICT inside its "Cổ phiếu" RSS category, already grouped
// into the 4 sections below. That's our primary source; RSS feeds only backfill a
// category when the digest is missing or came up short.
const DIGEST_FEED_URL = 'https://vietstock.vn/830/chung-khoan/co-phieu.rss';
const DIGEST_TITLE_RE = /Đọc gì trước giờ giao dịch chứng khoán/i;

const CATEGORY_LABEL_MAP = {
  'TÀI CHÍNH THẾ GIỚI': 'quocte',
  'THỊ TRƯỜNG CHỨNG KHOÁN': 'ttck',
  'TÀI CHÍNH NGÂN HÀNG': 'doanhnghiep',
  'VĨ MÔ ĐẦU TƯ': 'chinhsach',
};

const CATEGORY_ORDER = ['quocte', 'ttck', 'doanhnghiep', 'chinhsach'];
const QUOTA = { quocte: 2, ttck: 3, doanhnghiep: 2, chinhsach: 2 };

const FALLBACK_FEEDS = {
  quocte: ['https://vneconomy.vn/the-gioi.rss'],
  ttck: ['https://vneconomy.vn/chung-khoan.rss', 'https://cafef.vn/thi-truong-chung-khoan.rss'],
  doanhnghiep: ['https://cafef.vn/doanh-nghiep.rss'],
  chinhsach: ['https://cafef.vn/vi-mo-dau-tu.rss'],
};

const NOISE_KEYWORDS = [
  'ẩm thực', 'du lịch', 'món ăn', 'công thức', 'giải trí', 'showbiz', 'phim', 'ca sĩ',
  'thể thao', 'bóng đá', 'bắt giữ', 'khởi tố', 'tai nạn', 'thời tiết', 'nắng nóng',
  'chiêm tinh', 'tử vi', 'quà đặc biệt', 'thực đơn',
];

function isNoisy(title) {
  const lower = title.toLowerCase();
  return NOISE_KEYWORDS.some((kw) => lower.includes(kw));
}

function normalize(title) {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function fetchDigestByCategory() {
  const feed = await parser.parseURL(DIGEST_FEED_URL);
  const digestItem = (feed.items || []).find((item) => DIGEST_TITLE_RE.test(item.title || ''));
  if (!digestItem) return null;

  const res = await fetch(digestItem.link);
  if (!res.ok) return null;
  const html = await res.text();

  const $ = cheerio.load(html);
  const body = $('#vst_detail');
  if (!body.length) return null;

  const result = {};
  let currentCategory = null;
  body.children('p').each((_, el) => {
    const $el = $(el);
    if ($el.hasClass('pSubTitle')) {
      // Vietstock serves this text in NFD (decomposed diacritics); normalize to NFC
      // so it matches the map keys below, otherwise the lookup silently misses.
      const label = $el.text().trim().normalize('NFC');
      currentCategory = CATEGORY_LABEL_MAP[label] || null;
      if (currentCategory && !result[currentCategory]) result[currentCategory] = [];
    } else if ($el.hasClass('pBody') && currentCategory) {
      // The categorized digest list links the headline directly (no <strong>),
      // unlike the earlier uncategorized summary further up the same article.
      const link = $el.find('a').first();
      const headline = link.length ? link.text().trim().normalize('NFC') : '';
      if (headline) result[currentCategory].push(headline);
    }
  });

  return Object.keys(result).length ? result : null;
}

async function fetchFallbackItems(category, seenNormalized) {
  const feeds = FALLBACK_FEEDS[category] || [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const items = [];

  for (const url of feeds) {
    try {
      const feed = await parser.parseURL(url);
      for (const item of feed.items || []) {
        const title = (item.title || '').trim();
        if (!title || isNoisy(title)) continue;
        const norm = normalize(title);
        if (seenNormalized.has(norm)) continue;
        const pubTime = item.pubDate ? new Date(item.pubDate).getTime() : NaN;
        if (Number.isNaN(pubTime) || pubTime < cutoff) continue;
        items.push({ title, pubTime });
      }
    } catch (err) {
      console.error(`[scrapeNews] Lỗi khi lấy RSS ${url}:`, err.message);
    }
  }

  items.sort((a, b) => b.pubTime - a.pubTime);
  return items.map((i) => i.title);
}

async function scrapeNews() {
  const seenNormalized = new Set();
  const byCategory = {};

  let digest = null;
  try {
    digest = await fetchDigestByCategory();
  } catch (err) {
    console.error('[scrapeNews] Không lấy được bản tin Vietstock, sẽ dùng RSS dự phòng:', err.message);
  }

  for (const category of CATEGORY_ORDER) {
    const quota = QUOTA[category];
    const picked = [];

    for (const title of (digest && digest[category]) || []) {
      if (picked.length >= quota) break;
      const norm = normalize(title);
      if (seenNormalized.has(norm)) continue;
      seenNormalized.add(norm);
      picked.push(title);
    }

    if (picked.length < quota) {
      const fallback = await fetchFallbackItems(category, seenNormalized);
      for (const title of fallback) {
        if (picked.length >= quota) break;
        const norm = normalize(title);
        if (seenNormalized.has(norm)) continue;
        seenNormalized.add(norm);
        picked.push(title);
      }
    }

    byCategory[category] = picked;
  }

  return CATEGORY_ORDER.flatMap((category) => byCategory[category]);
}

module.exports = { scrapeNews };
