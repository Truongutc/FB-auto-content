const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://aic-chart-nganh.vercel.app/';
// header (79px) + sticky tab-navigation (52px) stay painted over the page,
// so every scroll-into-view must leave this much room below them.
const STICKY_HEADER_OFFSET = 140;

// value on the site's home select: "VNINDEX_NONVIN" or the full-market VNINDEX card
const TARGETS = {
  vnindex: { label: 'VNINDEX (Toàn thị trường)', name: 'VNINDEX' },
  vnindex_nonvin: { label: 'VNINDEX (không VIN)', name: 'VNINDEX (không VIN)' },
};

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

async function scrollClearOfHeader(handle) {
  await handle.evaluate((el, offset) => {
    el.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -offset);
  }, STICKY_HEADER_OFFSET);
}

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

async function screenshotBox(page, box, outPath, padding = 12) {
  const clip = {
    x: Math.max(0, box.x - padding),
    y: Math.max(0, box.y - padding),
    width: box.width + padding * 2,
    height: box.height + padding * 2,
  };
  await page.screenshot({ path: outPath, clip });
}

// The 4 sub-charts (GP + Octopus, Heikin + 2Trend, Heatmap, Kỹ thuật) all live
// inside ONE big shared `.card`. Crop each as its own image using the
// vertical gap between consecutive sub-titles.
async function screenshotChartBlocks(page, outDir, key) {
  await page.waitForTimeout(1500); // let chart canvases finish drawing

  const mainHeadingHandle = await findLeafByText(page, 'Biểu đồ Phân tích');
  if (!(await mainHeadingHandle.evaluate((el) => !!el))) {
    throw new Error('Không tìm thấy khối biểu đồ (Biểu đồ Phân tích)');
  }
  const cardHandle = await mainHeadingHandle.evaluateHandle((el) => el.closest('.card'));

  // The shared card continues past "Kỹ thuật" with unrelated P/E and P/B
  // industry charts, so the last block needs an explicit end marker instead
  // of falling back to the card's own bottom.
  const subtitles = ['🌿 GP + Octopus', '🕯️ Heikin + 2Trend', '🔥 Heatmap', '📊 Kỹ thuật'];
  const boundaries = ['🕯️ Heikin + 2Trend', '🔥 Heatmap', '📊 Kỹ thuật', '💹 P/E ngành + Tăng trưởng LNST'];
  const names = ['greenpink', 'heikin', 'heatmap', 'technical'];
  const results = {};

  for (let i = 0; i < subtitles.length; i++) {
    const topHandle = await findLeafByText(page, subtitles[i], { exact: true });
    if (!(await topHandle.evaluate((el) => !!el))) {
      throw new Error(`Không tìm thấy tiêu đề "${subtitles[i]}"`);
    }
    const scrollTarget = i === 0 ? mainHeadingHandle : topHandle;
    await scrollClearOfHeader(scrollTarget);
    await page.waitForTimeout(400);

    const bottomHandle = await findLeafByText(page, boundaries[i], { exact: true });
    if (!(await bottomHandle.evaluate((el) => !!el))) {
      throw new Error(`Không tìm thấy mốc kết thúc "${boundaries[i]}"`);
    }

    const cardBox = await cardHandle.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, width: r.width, bottom: r.y + r.height };
    });
    const startY =
      i === 0
        ? await mainHeadingHandle.evaluate((el) => el.getBoundingClientRect().y)
        : await topHandle.evaluate((el) => el.getBoundingClientRect().y);
    const endY = await bottomHandle.evaluate((el) => el.getBoundingClientRect().y);

    const outPath = path.join(outDir, `${key}_${names[i]}.png`);
    await screenshotBox(
      page,
      { x: cardBox.x, y: startY, width: cardBox.width, height: endY - startY - 8 },
      outPath
    );
    results[names[i]] = outPath;
  }

  return results;
}

async function scrapeOne(browser, key, outDir) {
  const target = TARGETS[key];
  const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
  await openCard(page, target.label);

  const reportText = await expandReportBox(page);
  if (!reportText) throw new Error(`Không lấy được nội dung báo cáo AI cho ${key}`);

  const chartBlocks = await screenshotChartBlocks(page, outDir, key);

  await page.close();
  return { key, reportText: reportText.trim(), ...chartBlocks };
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
