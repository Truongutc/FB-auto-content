const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://aic-proweb.vercel.app/';
// header (79px) + sticky tab-navigation (68px) stay painted over the page,
// so every scroll-into-view must leave this much room below them.
const STICKY_HEADER_OFFSET = 160;

async function scrollClearOfHeader(handle) {
  await handle.evaluate((el, offset) => {
    el.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -offset);
  }, STICKY_HEADER_OFFSET);
}

function findLeafByText(page, text, { exact = false } = {}) {
  return page.evaluateHandle(
    ({ text, exact }) => {
      const matches = Array.from(document.querySelectorAll('*')).filter(
        (el) => el.children.length === 0 && (exact ? el.textContent.trim() === text : el.textContent.includes(text))
      );
      return matches.sort((a, b) => a.textContent.length - b.textContent.length)[0] || null;
    },
    { text, exact }
  );
}

async function expandOverflow(elHandle) {
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

// Copies the full text of the "📝 Báo cáo Phân tích Chi tiết từ AI" card
// verbatim, to use as the Facebook post's caption.
async function extractReportText(page) {
  const headingHandle = await findLeafByText(page, 'Báo cáo Phân tích Chi tiết từ AI');
  const cardHandle = await headingHandle.evaluateHandle((el) => el.closest('.card'));
  if (!(await cardHandle.evaluate((el) => !!el))) {
    throw new Error('Không tìm thấy card "Báo cáo Phân tích Chi tiết từ AI"');
  }
  await expandOverflow(cardHandle);
  await page.waitForTimeout(200);
  const text = await cardHandle.evaluate((el) => el.innerText);
  return text.trim();
}

// "Độ Rộng Thị Trường (MA Lines vs VNINDEX)" has its own standalone `.card`.
async function captureBreadth(page, outPath) {
  const headingHandle = await findLeafByText(page, 'Độ Rộng Thị Trường (MA Lines vs VNINDEX)');
  const cardHandle = await headingHandle.evaluateHandle((el) => el.closest('.card'));
  if (!(await cardHandle.evaluate((el) => !!el))) {
    throw new Error('Không tìm thấy card "Độ Rộng Thị Trường"');
  }
  await expandOverflow(cardHandle);
  await page.waitForTimeout(200);
  await scrollClearOfHeader(cardHandle);
  await page.waitForTimeout(300);
  const box = await cardHandle.asElement().boundingBox();
  await screenshotBox(page, box, outPath);
}

// The 4 sub-charts (GreenPink+Octopus, Heikin-Ashi+2Trend, Bản đồ nhiệt,
// Báo cáo Kỹ thuật) all live inside ONE big shared `.card`. Crop each as its
// own image using the vertical gap between consecutive sub-titles.
async function captureChartBlocks(page, outDir) {
  const mainHeadingHandle = await findLeafByText(page, 'Biểu đồ Phân tích VNINDEX');
  const cardHandle = await mainHeadingHandle.evaluateHandle((el) => el.closest('.card'));
  if (!(await cardHandle.evaluate((el) => !!el))) {
    throw new Error('Không tìm thấy card "Biểu đồ Phân tích VNINDEX"');
  }
  await expandOverflow(cardHandle);
  await page.waitForTimeout(200);

  const subtitles = ['🌿 GreenPink + Octopus', '🕯️ Heikin-Ashi + 2Trend', '🔥 Bản đồ nhiệt', '📊 Báo cáo Kỹ thuật'];
  const outFiles = ['greenpink.png', 'heikin_ashi.png', 'heatmap.png', 'technical.png'];
  const results = {};

  for (let i = 0; i < subtitles.length; i++) {
    const topHandle = await findLeafByText(page, subtitles[i], { exact: true });
    if (!(await topHandle.evaluate((el) => !!el))) {
      throw new Error(`Không tìm thấy tiêu đề "${subtitles[i]}"`);
    }
    // Only the first segment needs the shared section header above it.
    const scrollTarget = i === 0 ? mainHeadingHandle : topHandle;
    await scrollClearOfHeader(scrollTarget);
    await page.waitForTimeout(400);

    const isLast = i === subtitles.length - 1;
    const bottomHandle = isLast ? null : await findLeafByText(page, subtitles[i + 1], { exact: true });

    const topBox = await topHandle.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y };
    });
    const cardBox = await cardHandle.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, width: r.width, bottom: r.y + r.height };
    });
    const startY = i === 0 ? await mainHeadingHandle.evaluate((el) => el.getBoundingClientRect().y) : topBox.y;
    const endY = bottomHandle
      ? await bottomHandle.evaluate((el) => el.getBoundingClientRect().y)
      : cardBox.bottom;

    const outPath = path.join(outDir, outFiles[i]);
    await screenshotBox(
      page,
      { x: cardBox.x, y: startY, width: cardBox.width, height: endY - startY - 8 },
      outPath
    );
    results[outFiles[i].replace('.png', '')] = outPath;
  }

  return results;
}

async function scrapeVnindexPro(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
    await page.goto(SITE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const reportText = await extractReportText(page);

    const breadthPath = path.join(outDir, 'vnindex_breadth.png');
    await captureBreadth(page, breadthPath);

    const chartBlocks = await captureChartBlocks(page, outDir);

    await page.close();
    return {
      reportText,
      breadth: breadthPath,
      ...chartBlocks,
    };
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeVnindexPro };
