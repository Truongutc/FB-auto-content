const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://aic-chart-nganh.vercel.app/';

// value on the site's home select: "VNINDEX_NONVIN" or the full-market VNINDEX card
const TARGETS = {
  vnindex: { label: 'VNINDEX (Toàn thị trường)', name: 'VNINDEX' },
  vnindex_nonvin: { label: 'VNINDEX (không VIN)', name: 'VNINDEX (không VIN)' },
};

async function openCard(page, label) {
  await page.goto(SITE_URL, { waitUntil: 'networkidle' });
  await page.click('text=Trang chủ');
  await page.waitForTimeout(800);
  const clicked = await page.evaluate((label) => {
    const all = Array.from(document.querySelectorAll('body *'));
    const candidates = all.filter(el =>
      el.tagName !== 'OPTION' && el.tagName !== 'SELECT' &&
      el.children.length <= 3 &&
      el.textContent.trim().startsWith(label)
    );
    if (candidates.length === 0) return false;
    let el = candidates.sort((a, b) => a.textContent.length - b.textContent.length)[0];
    let target = el;
    for (let i = 0; i < 6 && target; i++) {
      const cs = getComputedStyle(target);
      if (cs.cursor === 'pointer' || target.onclick || target.tagName === 'BUTTON' || target.tagName === 'A') break;
      target = target.parentElement;
    }
    (target || el).click();
    return true;
  }, label);
  if (!clicked) throw new Error(`Không tìm thấy thẻ "${label}" trên trang chủ`);
  await page.waitForTimeout(2500);
}

async function expandReportBox(page) {
  return page.evaluate(() => {
    const heading = Array.from(document.querySelectorAll('*')).find(el =>
      el.children.length === 0 && el.textContent.includes('Báo cáo Phân tích Chi tiết từ AI'));
    if (!heading) return null;
    let root = heading;
    for (let i = 0; i < 5; i++) root = root.parentElement;
    const all = root.querySelectorAll('*');
    let scrollable = null;
    for (const el of all) {
      if (el.scrollHeight > el.clientHeight + 20 && el.clientHeight > 50) {
        scrollable = el;
        break;
      }
    }
    if (!scrollable) return null;
    const text = scrollable.innerText;
    scrollable.style.maxHeight = 'none';
    scrollable.style.height = 'auto';
    scrollable.style.overflow = 'visible';
    return text;
  });
}

async function screenshotChartsSection(page, outPath) {
  // Bound the crop between the "Biểu đồ Phân tích" heading and the bottom of the page.
  const headingBox = await page.locator('text=/Biểu đồ Phân tích/').first().boundingBox();
  if (!headingBox) throw new Error('Không tìm thấy khối biểu đồ (Biểu đồ Phân tích)');

  await page.waitForTimeout(1500); // let chart canvases finish drawing

  const fullHeight = await page.evaluate(() => document.body.scrollHeight);
  const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);

  await page.setViewportSize({ width: viewportWidth, height: fullHeight });
  await page.waitForTimeout(500);

  const rawPath = outPath.replace(/\.png$/, '.full.png');
  await page.screenshot({ path: rawPath, fullPage: true });

  const sharp = require('sharp');
  const meta = await sharp(rawPath).metadata();
  const top = Math.max(0, Math.round(headingBox.y) - 8);
  await sharp(rawPath)
    .extract({ left: 0, top, width: meta.width, height: meta.height - top })
    .toFile(outPath);
  fs.unlinkSync(rawPath);
}

async function scrapeOne(browser, key, outDir) {
  const target = TARGETS[key];
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await openCard(page, target.label);

  const reportText = await expandReportBox(page);
  if (!reportText) throw new Error(`Không lấy được nội dung báo cáo AI cho ${key}`);

  const chartPath = path.join(outDir, `${key}_chart.png`);
  await screenshotChartsSection(page, chartPath);

  await page.close();
  return { key, reportText: reportText.trim(), chartPath };
}

async function scrape(keys, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    const results = {};
    for (const key of keys) {
      results[key] = await scrapeOne(browser, key, outDir);
    }
    return results;
  } finally {
    await browser.close();
  }
}

module.exports = { scrape, TARGETS };
