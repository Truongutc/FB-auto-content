require('dotenv').config();
const path = require('path');
const { scrapeTopRS } = require('./scrapeTopRS');
const { publishMultiPhotoPost } = require('./facebook');
const { withFooter } = require('./footer');

function todayVN() {
  return new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

async function main() {
  const outDir = path.join(__dirname, '..', 'output');
  const { stockPath, sectorPath } = await scrapeTopRS(outDir);

  console.log('--- Đã chụp xong 2 bảng TopRS (RS14) ---');
  console.log(`Cổ phiếu: ${stockPath}`);
  console.log(`Ngành: ${sectorPath}`);

  const message = withFooter(
    `🏆 TOP RS14 — Cập nhật ${todayVN()}\n\nẢnh 1: Top 30 cổ phiếu theo RS14 (AvgVol20 > 800k)\nẢnh 2: Top ngành theo RS14 (30 phiên gần nhất)`
  );

  const dryRun = process.env.DRY_RUN === '1' || !process.env.FB_PAGE_ID || !process.env.FB_PAGE_ACCESS_TOKEN;
  if (dryRun) {
    console.log('\n[DRY RUN] Chưa đăng lên Facebook (thiếu FB_PAGE_ID / FB_PAGE_ACCESS_TOKEN, hoặc DRY_RUN=1).');
    console.log('Nội dung caption sẽ đăng:\n');
    console.log(message);
    return;
  }

  const post = await publishMultiPhotoPost({
    pageId: process.env.FB_PAGE_ID,
    accessToken: process.env.FB_PAGE_ACCESS_TOKEN,
    imagePaths: [stockPath, sectorPath],
    message,
  });
  console.log('Đăng bài lên Fanpage thành công:', post);

  if (process.env.FB_GROUP_ID) {
    try {
      const groupPost = await publishMultiPhotoPost({
        pageId: process.env.FB_GROUP_ID,
        accessToken: process.env.FB_GROUP_ACCESS_TOKEN,
        imagePaths: [stockPath, sectorPath],
        message,
      });
      console.log('Đăng bài lên Group thành công:', groupPost);
    } catch (err) {
      console.error('Đăng bài lên Group thất bại (bỏ qua, bài Fanpage vẫn đã đăng):', err.message);
    }
  }
}

main().catch((err) => {
  console.error('Lỗi:', err);
  process.exit(1);
});
