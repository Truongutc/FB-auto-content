const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SOURCES = {
  stock: {
    siteUrl: 'https://aic-proweb.vercel.app/',
    tabText: 'TOPRS',
    headingMatch: 'Top 30 theo RS14',
    boundaryMatch: 'RS52',
  },
  sector: {
    siteUrl: 'https://aic-chart-nganh.vercel.app/',
    tabText: 'TopRS',
    headingMatch: 'RS14 — 30 phiên',
    boundaryMatch: 'RS52',
  },
};

// Finds the RS14 card, expands every scroll-clipped ancestor/descendant (both axes)
// so the full table + full color formatting renders outside the viewport, then
// screenshots just that card.
async function captureRS14Card(page, { headingMatch, boundaryMatch }, outPath) {
  const found = await page.evaluate(({ headingMatch, boundaryMatch }) => {
    window.scrollTo(0, 0);
    const heading = Array.from(document.querySelectorAll('*')).find(
      (el) => el.children.length === 0 && el.textContent.includes(headingMatch)
    );
    if (!heading) return false;

    let card = heading;
    while (card.parentElement && !card.parentElement.textContent.includes(boundaryMatch)) {
      card = card.parentElement;
    }

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
    card.setAttribute('data-rs14-capture-target', '1');
    return true;
  }, { headingMatch, boundaryMatch });

  if (!found) throw new Error(`Không tìm thấy bảng khớp "${headingMatch}"`);
  await page.waitForTimeout(400);

  const cardHandle = await page.$('[data-rs14-capture-target="1"]');
  await cardHandle.screenshot({ path: outPath });
}

async function scrapeOne(browser, key, outDir) {
  const cfg = SOURCES[key];
  // Viewport is generously large (wider/taller than any measured table) so the
  // element screenshot never needs to scroll-and-stitch, which would otherwise
  // bake the page's sticky top nav into the captured image.
  const page = await browser.newPage({ viewport: { width: 2400, height: 2400 } });
  await page.goto(cfg.siteUrl, { waitUntil: 'networkidle' });
  await page.click(`text=${cfg.tabText}`);
  await page.waitForTimeout(1500);

  const outPath = path.join(outDir, `toprs_${key}.png`);
  await captureRS14Card(page, cfg, outPath);

  await page.close();
  return outPath;
}

async function scrapeTopRS(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    const stockPath = await scrapeOne(browser, 'stock', outDir);
    const sectorPath = await scrapeOne(browser, 'sector', outDir);
    return { stockPath, sectorPath };
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeTopRS };
