const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://aic-pro-fa.vercel.app/chiemtinh.html';
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

async function screenshotBox(page, box, outPath, padding = 12) {
  const clip = {
    x: Math.max(0, box.x - padding),
    y: Math.max(0, box.y - padding),
    width: box.width + padding * 2,
    height: box.height + padding * 2,
  };
  await page.screenshot({ path: outPath, clip });
}

// The "🧭 Kết luận Tổng thể" text and the "📈 Chỉ số Áp lực/Thuận lợi Thị
// trường" chart share one `.card`. Copy just the conclusion portion (before
// the chart's own title) verbatim, to use as the Facebook post caption.
async function extractConclusionText(page) {
  const headingHandle = await findLeafByText(page, 'Kết luận Tổng thể');
  const cardHandle = await headingHandle.evaluateHandle((el) => el.closest('.card'));
  if (!(await cardHandle.evaluate((el) => !!el))) {
    throw new Error('Không tìm thấy card "Kết luận Tổng thể"');
  }
  const fullText = await cardHandle.evaluate((el) => el.innerText);
  const marker = 'Chỉ số Áp lực/Thuận lợi Thị trường';
  const idx = fullText.indexOf(marker);
  const text = idx === -1 ? fullText : fullText.slice(0, fullText.lastIndexOf('\n', idx));
  return text.trim();
}

// Crops just the pressure/favorability chart out of the shared card (skips
// the conclusion text above it).
async function capturePressureChart(page, outPath) {
  const chartTitleHandle = await findLeafByText(page, 'Chỉ số Áp lực/Thuận lợi Thị trường');
  const cardHandle = await chartTitleHandle.evaluateHandle((el) => el.closest('.card'));
  await scrollClearOfHeader(chartTitleHandle);
  await page.waitForTimeout(500);

  const topY = await chartTitleHandle.evaluate((el) => el.getBoundingClientRect().y);
  const cardBox = await cardHandle.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, width: r.width, bottom: r.y + r.height };
  });
  await screenshotBox(
    page,
    { x: cardBox.x, y: topY, width: cardBox.width, height: cardBox.bottom - topY },
    outPath
  );
}

// "🌌 Biểu đồ Vị trí Hành tinh (Sơ đồ vòng hoàng đạo & Nhà)" is its own
// standalone `.card`.
async function capturePlanetChart(page, outPath) {
  const headingHandle = await findLeafByText(page, 'Biểu đồ Vị trí Hành tinh');
  const cardHandle = await headingHandle.evaluateHandle((el) => el.closest('.card'));
  if (!(await cardHandle.evaluate((el) => !!el))) {
    throw new Error('Không tìm thấy card "Biểu đồ Vị trí Hành tinh"');
  }
  await scrollClearOfHeader(cardHandle);
  await page.waitForTimeout(500);
  const box = await cardHandle.asElement().boundingBox();
  await screenshotBox(page, box, outPath);
}

async function scrapeChiemTinh(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
    await page.goto(SITE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const conclusionText = await extractConclusionText(page);

    const pressurePath = path.join(outDir, 'chiemtinh_pressure.png');
    await capturePressureChart(page, pressurePath);

    const planetPath = path.join(outDir, 'chiemtinh_planets.png');
    await capturePlanetChart(page, planetPath);

    await page.close();
    return { conclusionText, pressure: pressurePath, planets: planetPath };
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeChiemTinh };
