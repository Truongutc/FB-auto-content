const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://aic-pro-fa.vercel.app/vimo.html';
// The site's top nav bar is position:sticky and paints over whatever is
// scrolled beneath it, so every scroll-into-view must leave this much room.
const STICKY_HEADER_OFFSET = 100;

async function scrollClearOfHeader(handle) {
  await handle.evaluate((el, offset) => {
    el.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -offset);
  }, STICKY_HEADER_OFFSET);
}

function findLeafByText(page, text) {
  return page.evaluateHandle((text) => {
    return Array.from(document.querySelectorAll('*')).find(
      (el) => el.children.length === 0 && el.textContent.includes(text)
    );
  }, text);
}

// Expands every overflow-clipped descendant of `el` (both axes) so the full
// content renders outside the viewport instead of being scroll-clipped.
async function expandOverflow(page, elHandle) {
  await elHandle.evaluate((card) => {
    for (const el of card.querySelectorAll('*')) {
      if (el.scrollWidth > el.clientWidth + 10) {
        el.style.width = el.scrollWidth + 'px';
        el.style.maxWidth = 'none';
        el.style.overflowX = 'visible';
      }
      if (el.scrollHeight > el.clientHeight + 10) {
        el.style.height = el.scrollHeight + 'px';
        el.style.maxHeight = 'none';
        el.style.overflowY = 'visible';
      }
    }
    let node = card;
    while (node) {
      node.style.maxWidth = 'none';
      node.style.maxHeight = 'none';
      node.style.overflowX = 'visible';
      node.style.overflowY = 'visible';
      if (node.scrollWidth > node.clientWidth) node.style.width = node.scrollWidth + 'px';
      if (node.scrollHeight > node.clientHeight) node.style.height = node.scrollHeight + 'px';
      node = node.parentElement;
    }
  });
}

async function screenshotBox(page, box, outPath, padding = 12) {
  const clip = {
    x: Math.max(0, box.x - padding),
    y: Math.max(0, box.y - padding),
    width: box.width + padding * 2,
    height: box.height + padding * 2,
  };
  await page.screenshot({ path: outPath, clip });
}

// Finds `headingText`'s enclosing `cardSelector` ancestor, expands its overflow,
// scrolls it into view, and screenshots just that card.
async function captureCard(page, { headingText, cardSelector }, outPath) {
  const headingHandle = await findLeafByText(page, headingText);
  if (!(await headingHandle.evaluate((el) => !!el))) {
    throw new Error(`Không tìm thấy heading "${headingText}"`);
  }
  await scrollClearOfHeader(headingHandle);
  await page.waitForTimeout(800);

  const cardHandle = await headingHandle.evaluateHandle(
    (el, sel) => el.closest(sel),
    cardSelector
  );
  if (!(await cardHandle.evaluate((el) => !!el))) {
    throw new Error(`Không tìm thấy card "${cardSelector}" cho "${headingText}"`);
  }
  await expandOverflow(page, cardHandle);
  await page.waitForTimeout(300);

  await scrollClearOfHeader(cardHandle);
  await page.waitForTimeout(300);
  const box = await cardHandle.asElement().boundingBox();
  await screenshotBox(page, box, outPath);
}

// Special case: the P/E and P/B charts share one big `.card`. Crop the P/E
// pair (with the shared section header) and the P/B pair as two sub-regions.
async function capturePeAndPb(page, outDir) {
  const h3Handle = await findLeafByText(page, 'Định giá VN-Index theo thời gian');
  await scrollClearOfHeader(h3Handle);
  await page.waitForTimeout(800);

  const cardHandle = await h3Handle.evaluateHandle((el) => el.closest('.card'));
  await expandOverflow(page, cardHandle);
  await page.waitForTimeout(300);
  await scrollClearOfHeader(cardHandle);
  await page.waitForTimeout(300);

  const coords = await page.evaluate(() => {
    const h3 = Array.from(document.querySelectorAll('*')).find(
      (el) => el.children.length === 0 && el.textContent.includes('Định giá VN-Index theo thời gian')
    );
    const titles = Array.from(document.querySelectorAll('.vimo-chart-title')).filter((t) =>
      t.textContent.includes('P/E VN-Index') || t.textContent.includes('P/B VN-Index')
    );
    const card = h3.closest('.card');
    const rect = (el) => el.getBoundingClientRect();
    const cardBox = rect(card);
    return {
      h3Top: rect(h3).y,
      titleTops: titles.map((t) => ({ text: t.textContent.trim(), y: rect(t).y })),
      cardBottom: cardBox.y + cardBox.height,
      cardX: cardBox.x,
      cardWidth: cardBox.width,
    };
  });

  const peTop = coords.h3Top;
  const pbTitleMatch = coords.titleTops.find((t) => t.text.startsWith('P/B VN-Index (headline'));
  if (!pbTitleMatch) {
    throw new Error(`Không tìm thấy title P/B headline. Titles hiện có: ${JSON.stringify(coords.titleTops)}`);
  }
  const pbTitleTop = pbTitleMatch.y;
  const peBottom = pbTitleTop - 16;
  const pbTop = pbTitleTop;
  const pbBottom = coords.cardBottom;

  await screenshotBox(
    page,
    { x: coords.cardX, y: peTop, width: coords.cardWidth, height: peBottom - peTop },
    path.join(outDir, 'vimo_pe.png')
  );
  await screenshotBox(
    page,
    { x: coords.cardX, y: pbTop, width: coords.cardWidth, height: pbBottom - pbTop },
    path.join(outDir, 'vimo_pb.png')
  );
}

// Copies the text of the "🧭 Tổng hợp Phân tích Đa Chỉ số — Bức tranh Tổng
// thể" card, skipping the opening summary + the giant "Các điểm sáng cụ
// thể... Ngược lại, một số điểm nghẽn..." indicator dump (too long/noisy for
// a post) and starting at "Về định giá, VN-Index đang giao dịch..." instead.
async function extractReportText(page) {
  const headingHandle = await findLeafByText(page, 'Tổng hợp Phân tích Đa Chỉ số');
  if (!(await headingHandle.evaluate((el) => !!el))) {
    throw new Error('Không tìm thấy mục "Tổng hợp Phân tích Đa Chỉ số"');
  }
  const cardHandle = await headingHandle.evaluateHandle((el) => el.closest('.card'));
  if (!(await cardHandle.evaluate((el) => !!el))) {
    throw new Error('Không tìm thấy card của mục "Tổng hợp Phân tích Đa Chỉ số"');
  }
  const fullText = (await cardHandle.evaluate((el) => el.innerText)).trim();

  const marker = 'Về định giá, VN-Index đang giao dịch';
  const idx = fullText.indexOf(marker);
  if (idx === -1) {
    throw new Error(`Không tìm thấy mốc "${marker}" trong nội dung báo cáo`);
  }
  const body = fullText.slice(idx).trim();
  return `🧭 Định giá Vnindex NO VIN (loại bỏ nhóm Vingroup)\n\n${body}`;
}

async function scrapeVimo(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 2000 } });
    await page.goto(SITE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const outputs = {};

    await captureCard(
      page,
      { headingText: 'Diễn biến Vĩ mô Tổng quan', cardSelector: '.card' },
      (outputs.overview = path.join(outDir, 'vimo_overview.png'))
    );

    await captureCard(
      page,
      { headingText: 'Bảng giám sát các chỉ số vĩ mô hàng tháng', cardSelector: '.card' },
      (outputs.monitor = path.join(outDir, 'vimo_monitor.png'))
    );

    await capturePeAndPb(page, outDir);
    outputs.pe = path.join(outDir, 'vimo_pe.png');
    outputs.pb = path.join(outDir, 'vimo_pb.png');

    await captureCard(
      page,
      {
        headingText: 'Lãi suất liên ngân hàng O/N, 1 tuần, 2 tuần, 1 tháng, 6 tháng theo thời gian',
        cardSelector: '.vimo-indicator-card',
      },
      (outputs.interbank = path.join(outDir, 'vimo_interbank.png'))
    );

    await captureCard(
      page,
      {
        headingText: 'Số dư OMO đang lưu hành (kênh cầm cố) & Bơm/hút ròng OMO theo thời gian',
        cardSelector: '.vimo-indicator-card',
      },
      (outputs.omo = path.join(outDir, 'vimo_omo.png'))
    );

    await captureCard(
      page,
      {
        headingText: 'Tăng trưởng tín dụng, cung tiền M2 & huy động theo tháng (so cùng kỳ năm trước)',
        cardSelector: '.vimo-indicator-card',
      },
      (outputs.credit = path.join(outDir, 'vimo_credit.png'))
    );

    outputs.reportText = await extractReportText(page);

    await page.close();
    return outputs;
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeVimo };
