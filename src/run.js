require('dotenv').config();
const path = require('path');
const { scrape } = require('./scrape');
const { publishMultiPhotoPost } = require('./facebook');
const { withFooter } = require('./footer');

async function main() {
  const key = process.argv[2];
  if (key !== 'vnindex_nonvin') {
    console.error('Dùng: node src/run.js vnindex_nonvin (VNINDEX dùng node src/runVnindexPro.js)');
    process.exit(1);
  }

  const outDir = path.join(__dirname, '..', 'output');
  const results = await scrape([key], outDir);
  const { reportText, greenpink, heikin, heatmap, technical } = results[key];
  const imagePaths = [greenpink, heikin, heatmap, technical];
  const message = withFooter(reportText);

  console.log(`--- Đã lấy dữ liệu cho ${key} ---`);
  console.log('Ảnh:', imagePaths);
  console.log(`Độ dài báo cáo: ${reportText.length} ký tự`);

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
    imagePaths,
    message,
  });
  console.log('Đăng bài thành công:', post);
}

main().catch((err) => {
  console.error('Lỗi:', err);
  process.exit(1);
});
