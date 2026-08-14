require('dotenv').config();
const path = require('path');
const { scrapeVimo } = require('./scrapeVimo');
const { publishMultiPhotoPost } = require('./facebook');
const { withFooter } = require('./footer');

async function main() {
  const outDir = path.join(__dirname, '..', 'output');
  const outputs = await scrapeVimo(outDir);

  console.log('--- Đã chụp xong 7 ảnh vĩ mô + nội dung báo cáo ---');
  console.log('Ảnh:', {
    overview: outputs.overview,
    monitor: outputs.monitor,
    pe: outputs.pe,
    pb: outputs.pb,
    interbank: outputs.interbank,
    omo: outputs.omo,
    credit: outputs.credit,
  });
  console.log(`Độ dài báo cáo: ${outputs.reportText.length} ký tự`);

  const imagePaths = [
    outputs.overview,
    outputs.monitor,
    outputs.pe,
    outputs.pb,
    outputs.interbank,
    outputs.omo,
    outputs.credit,
  ];

  const message = withFooter(outputs.reportText);

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
