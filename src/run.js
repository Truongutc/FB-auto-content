require('dotenv').config();
const path = require('path');
const { scrape } = require('./scrape');
const { publishPhotoPost } = require('./facebook');

async function main() {
  const key = process.argv[2];
  if (!key || !['vnindex', 'vnindex_nonvin'].includes(key)) {
    console.error('Dùng: node src/run.js <vnindex|vnindex_nonvin>');
    process.exit(1);
  }

  const outDir = path.join(__dirname, '..', 'output');
  const results = await scrape([key], outDir);
  const { reportText, chartPath } = results[key];

  console.log(`--- Đã lấy dữ liệu cho ${key} ---`);
  console.log(`Ảnh biểu đồ: ${chartPath}`);
  console.log(`Độ dài báo cáo: ${reportText.length} ký tự`);

  const dryRun = process.env.DRY_RUN === '1' || !process.env.FB_PAGE_ID || !process.env.FB_PAGE_ACCESS_TOKEN;
  if (dryRun) {
    console.log('\n[DRY RUN] Chưa đăng lên Facebook (thiếu FB_PAGE_ID / FB_PAGE_ACCESS_TOKEN, hoặc DRY_RUN=1).');
    console.log('Nội dung caption sẽ đăng:\n');
    console.log(reportText);
    return;
  }

  const post = await publishPhotoPost({
    pageId: process.env.FB_PAGE_ID,
    accessToken: process.env.FB_PAGE_ACCESS_TOKEN,
    imagePath: chartPath,
    message: reportText,
  });
  console.log('Đăng bài thành công:', post);
}

main().catch((err) => {
  console.error('Lỗi:', err);
  process.exit(1);
});
