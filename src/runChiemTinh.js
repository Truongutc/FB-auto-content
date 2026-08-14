require('dotenv').config();
const path = require('path');
const { scrapeChiemTinh } = require('./scrapeChiemTinh');
const { publishMultiPhotoPost } = require('./facebook');
const { withFooter } = require('./footer');

async function main() {
  const outDir = path.join(__dirname, '..', 'output');
  const result = await scrapeChiemTinh(outDir);
  const message = withFooter(result.conclusionText);

  console.log('--- Đã lấy dữ liệu Chiêm Tinh Tài Chính ---');
  console.log('Ảnh:', [result.pressure, result.planets]);
  console.log(`Độ dài nội dung: ${result.conclusionText.length} ký tự`);

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
    imagePaths: [result.pressure, result.planets],
    message,
  });
  console.log('Đăng bài thành công:', post);
}

main().catch((err) => {
  console.error('Lỗi:', err);
  process.exit(1);
});
