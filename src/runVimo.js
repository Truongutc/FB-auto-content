require('dotenv').config();
const path = require('path');
const { scrapeVimo } = require('./scrapeVimo');
const { publishMultiPhotoPost } = require('./facebook');

function todayVN() {
  return new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

async function main() {
  const outDir = path.join(__dirname, '..', 'output');
  const outputs = await scrapeVimo(outDir);

  console.log('--- Đã chụp xong 7 ảnh vĩ mô ---');
  console.log(outputs);

  const imagePaths = [
    outputs.overview,
    outputs.monitor,
    outputs.pe,
    outputs.pb,
    outputs.interbank,
    outputs.omo,
    outputs.credit,
  ];

  const message = `🧭 CẬP NHẬT VĨ MÔ VIỆT NAM — ${todayVN()}

1. Diễn biến Vĩ mô Tổng quan (2026 & 2025)
2. Bảng giám sát các chỉ số vĩ mô hàng tháng
3. Định giá VN-Index theo P/E (headline & ex-VIN)
4. Định giá VN-Index theo P/B (headline & ex-VIN)
5. Lãi suất liên ngân hàng O/N, 1 tuần, 2 tuần, 1 tháng, 6 tháng
6. Số dư OMO & Bơm/hút ròng OMO
7. Tăng trưởng tín dụng, cung tiền M2 & huy động (YoY)`;

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
