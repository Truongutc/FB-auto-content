const Parser = require('rss-parser');
const cheerio = require('cheerio');

const parser = new Parser();

// Vietstock publishes a curated "Đọc gì trước giờ giao dịch chứng khoán?" digest
// every trading day at 06:00 ICT inside its "Cổ phiếu" RSS category, already grouped
// into the sections below. That's our primary source for macro/market headlines;
// RSS feeds only backfill a category when the digest is missing or came up short.
const DIGEST_FEED_URL = 'https://vietstock.vn/830/chung-khoan/co-phieu.rss';
const DIGEST_TITLE_RE = /Đọc gì trước giờ giao dịch chứng khoán/i;

const CATEGORY_LABEL_MAP = {
  'TÀI CHÍNH THẾ GIỚI': 'quocte',
  'THỊ TRƯỜNG CHỨNG KHOÁN': 'ttck',
  'VĨ MÔ ĐẦU TƯ': 'chinhsach',
};

const CATEGORY_ORDER = ['quocte', 'ttck', 'doanhnghiep', 'chinhsach'];
// Company/ticker news is the main draw (per user feedback), macro/policy/world is
// supporting context — weight the quotas accordingly instead of splitting evenly.
const QUOTA = { quocte: 2, ttck: 2, chinhsach: 2 };

const FALLBACK_FEEDS = {
  quocte: ['https://vneconomy.vn/the-gioi.rss'],
  ttck: ['https://vneconomy.vn/chung-khoan.rss', 'https://cafef.vn/thi-truong-chung-khoan.rss'],
  chinhsach: ['https://cafef.vn/vi-mo-dau-tu.rss'],
};

// Per-company news, spread across Vietstock's category feeds instead of one single
// feed, mirroring how the "TICKER: 1-sentence summary" digests circulating in FB
// groups are actually assembled (confirmed by tracing several of their items back
// to these exact Vietstock categories).
const COMPANY_FEEDS = [
  'https://vietstock.vn/830/chung-khoan/co-phieu.rss',
  'https://vietstock.vn/737/doanh-nghiep/hoat-dong-kinh-doanh.rss',
  'https://vietstock.vn/738/doanh-nghiep/co-tuc.rss',
  'https://vietstock.vn/764/doanh-nghiep/tang-von-m-a.rss',
  'https://vietstock.vn/739/chung-khoan/giao-dich-noi-bo.rss',
  'https://vietstock.vn/4222/bat-dong-san/du-an.rss',
  'https://vietstock.vn/757/tai-chinh/ngan-hang.rss',
];
const DOANHNGHIEP_QUOTA = 10;
// Article pages are fetched one by one to read their ticker + lead sentence, so cap
// how many candidates we're willing to check before giving up on filling the quota.
const MAX_COMPANY_CANDIDATES = 28;

const NOISE_KEYWORDS = [
  'ẩm thực', 'du lịch', 'món ăn', 'công thức', 'giải trí', 'showbiz', 'phim', 'ca sĩ',
  'thể thao', 'bóng đá', 'bắt giữ', 'khởi tố', 'tai nạn', 'thời tiết', 'nắng nóng',
  'chiêm tinh', 'tử vi', 'quà đặc biệt', 'thực đơn',
  'top cổ phiếu đáng chú ý', 'mã cổ phiếu tăng và giảm mạnh nhất',
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

function asSentence(text) {
  const trimmed = text.trim();
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

// Readers open this post to get told the news, not to be asked a rhetorical
// question ("Điều gì khiến..?") — those are opinion/analysis clickbait framing,
// not information, so reject anything whose headline/lead is phrased as a question.
function isQuestion(text) {
  return /[?？]\s*["'"'”]?\s*$/.test(text.trim());
}

// Every Vietstock article page carries a "MÃ CHỨNG KHOÁN LIÊN QUAN" sidebar widget
// listing the ticker(s) that story is tagged with, plus a one-sentence lead (pHead)
// above the full body. Reading those two gives a short "TICKER: summary" (or plain
// summary, when no single ticker applies) instead of just a bare headline.
async function fetchLeadAndTicker(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const html = await res.text();
  const $ = cheerio.load(html);
  const body = $('#vst_detail');
  if (!body.length) return null;

  const head = body.find('p.pHead').first().text().trim().normalize('NFC');
  const title = body.find('p.pTitle').first().text().trim().normalize('NFC');
  const sentence = (head || title).replace(/\s+/g, ' ').trim();
  if (!sentence) return null;

  let ticker = null;
  const widgetTitle = $('h2.widget-title')
    .filter((_, el) => $(el).text().includes('MÃ CHỨNG KHOÁN LIÊN QUAN'))
    .first();
  if (widgetTitle.length) {
    const tickerLinks = widgetTitle.closest('.rightdetail').next('.social_shares').find('.name-index a');
    // The sidebar tags every ticker the page happens to mention, including a
    // one-off example buried in a broader market report — require exactly one
    // tagged ticker, since that's a real signal the whole story is about that
    // one company (multiple tags means it's incidental, not the subject).
    if (tickerLinks.length === 1) {
      ticker = tickerLinks.first().text().trim().normalize('NFC');
    }
  }

  return { sentence, ticker };
}

// Resolve a {title, link} pair into the final display line: fetch the Vietstock
// article for its lead sentence + tagged ticker when possible, otherwise fall back
// to the bare (non-Vietstock) RSS title so a fetch failure never drops the item.
// Returns null (reject, try the next candidate) for question-phrased headlines.
async function resolveEntry({ title, link }) {
  if (isQuestion(title)) return null;

  if (link && /vietstock\.vn/i.test(link)) {
    try {
      const parsed = await fetchLeadAndTicker(link);
      if (parsed) {
        if (isQuestion(parsed.sentence)) return null;
        return parsed.ticker ? `${parsed.ticker}: ${asSentence(parsed.sentence)}` : asSentence(parsed.sentence);
      }
    } catch (err) {
      console.error(`[scrapeNews] Lỗi khi lấy nội dung ${link}:`, err.message);
    }
  }
  return asSentence(title);
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
      const a = $el.find('a').first();
      const title = a.length ? a.text().trim().normalize('NFC') : '';
      const link = a.attr('href');
      if (title) result[currentCategory].push({ title, link });
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
        items.push({ title, link: item.link, pubTime });
      }
    } catch (err) {
      console.error(`[scrapeNews] Lỗi khi lấy RSS ${url}:`, err.message);
    }
  }

  items.sort((a, b) => b.pubTime - a.pubTime);
  return items;
}

async function fetchCompanyItems(seenNormalized) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const candidates = [];

  for (const url of COMPANY_FEEDS) {
    try {
      const feed = await parser.parseURL(url);
      for (const item of feed.items || []) {
        const title = (item.title || '').trim();
        if (!title || isNoisy(title) || DIGEST_TITLE_RE.test(title)) continue;
        const norm = normalize(title);
        if (seenNormalized.has(norm)) continue;
        const pubTime = item.pubDate ? new Date(item.pubDate).getTime() : NaN;
        if (Number.isNaN(pubTime) || pubTime < cutoff || !item.link) continue;
        candidates.push({ title, link: item.link, pubTime, norm });
      }
    } catch (err) {
      console.error(`[scrapeNews] Lỗi khi lấy RSS ${url}:`, err.message);
    }
  }

  // The same story often shows up in more than one category feed; keep one copy.
  const byNorm = new Map();
  for (const c of candidates) {
    const existing = byNorm.get(c.norm);
    if (!existing || c.pubTime > existing.pubTime) byNorm.set(c.norm, c);
  }
  const deduped = [...byNorm.values()].sort((a, b) => b.pubTime - a.pubTime);

  const picked = [];
  for (const candidate of deduped.slice(0, MAX_COMPANY_CANDIDATES)) {
    if (picked.length >= DOANHNGHIEP_QUOTA) break;
    seenNormalized.add(candidate.norm);
    const resolved = await resolveEntry(candidate);
    if (resolved) picked.push(resolved);
  }

  return picked;
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

  for (const category of ['quocte', 'ttck', 'chinhsach']) {
    const quota = QUOTA[category];
    const picked = [];

    const tryEntries = async (entries) => {
      for (const entry of entries) {
        if (picked.length >= quota) return;
        const norm = normalize(entry.title);
        if (seenNormalized.has(norm)) continue;
        seenNormalized.add(norm);
        const resolved = await resolveEntry(entry);
        if (resolved) picked.push(resolved);
      }
    };

    await tryEntries((digest && digest[category]) || []);
    // Question-phrased items get rejected inside resolveEntry, so the digest alone
    // may not fill the quota even when it had enough raw candidates — top up from
    // RSS in that case too, not just when the digest was short to begin with.
    if (picked.length < quota) {
      await tryEntries(await fetchFallbackItems(category, seenNormalized));
    }

    byCategory[category] = picked;
  }

  try {
    byCategory.doanhnghiep = await fetchCompanyItems(seenNormalized);
  } catch (err) {
    console.error('[scrapeNews] Không lấy được tin doanh nghiệp:', err.message);
    byCategory.doanhnghiep = [];
  }

  return CATEGORY_ORDER.flatMap((category) => byCategory[category] || []);
}

module.exports = { scrapeNews };
