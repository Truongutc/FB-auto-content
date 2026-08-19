require('dotenv').config();
const path = require('path');
const { scrapeNews } = require('./scrapeNews');
const { scrapeStocksWatch } = require('./scrapeStocksWatch');
const { publishPhotoPost } = require('./facebook');
const { withFooter } = require('./footer');

const COVER_IMAGE = path.join(__dirname, '..', 'assets', 'news-cover.jpg');

function todayVN() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
  }).formatToParts(new Date());
  const dd = parts.find((p) => p.type === 'day').value;
  const mm = parts.find((p) => p.type === 'month').value;
  return `${dd}/${mm}`;
}

async function main() {
  const headlines = await scrapeNews();
  if (!headlines.length) {
    console.log('Không tìm được tin tức nào phù hợp hôm nay, bỏ qua đăng bài.');
    return;
  }

  const body = headlines.map((title, i) => `${i + 1}. ${title}`).join('\n\n');
  let postText = `CẬP NHẬT TIN TỨC NGÀY ${todayVN()}:\n\n${body}`;

  let tickers = [];
  try {
    tickers = await scrapeStocksWatch();
  } catch (err) {
    console.error('[runNews] Không lấy được danh sách cổ phiếu đáng chú ý:', err.message);
  }
  if (tickers.length) {
    postText += `\n\n📌 Cổ phiếu đáng chú ý hôm nay (tổng hợp từ báo cáo các CTCK, không phải khuyến nghị mua/bán): ${tickers.join(', ')}`;
  }

  const message = withFooter(postText);

  console.log('Ảnh:', COVER_IMAGE);

  const dryRun = process.env.DRY_RUN === '1' || !process.env.FB_PAGE_ID || !process.env.FB_PAGE_ACCESS_TOKEN;
  if (dryRun) {
    console.log('\n[DRY RUN] Chưa đăng lên Facebook (thiếu FB_PAGE_ID / FB_PAGE_ACCESS_TOKEN, hoặc DRY_RUN=1).');
    console.log('Nội dung caption sẽ đăng:\n');
    console.log(message);
    return;
  }

  const post = await publishPhotoPost({
    pageId: process.env.FB_PAGE_ID,
    accessToken: process.env.FB_PAGE_ACCESS_TOKEN,
    imagePath: COVER_IMAGE,
    message,
  });
  console.log('Đăng bài thành công:', post);
}

main().catch((err) => {
  console.error('Lỗi:', err);
  process.exit(1);
});
