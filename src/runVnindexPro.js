require('dotenv').config();
const path = require('path');
const { scrapeVnindexPro } = require('./scrapeVnindexPro');
const { publishMultiPhotoPost } = require('./facebook');
const { withFooter } = require('./footer');

async function main() {
  const outDir = path.join(__dirname, '..', 'output');
  const result = await scrapeVnindexPro(outDir);

  const imagePaths = [result.breadth, result.greenpink, result.heikin_ashi, result.heatmap, result.technical];
  const message = withFooter(result.reportText);

  console.log('--- Đã lấy dữ liệu VNINDEX (aic-proweb) ---');
  console.log('Ảnh:', imagePaths);
  console.log(`Độ dài báo cáo: ${result.reportText.length} ký tự`);

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
