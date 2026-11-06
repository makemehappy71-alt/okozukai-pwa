const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { test } = require('node:test');

const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.test-artifacts');
fs.mkdirSync(output, { recursive: true });

for (const [width, mixedTax, codePrice, adjustment] of [[360, false, false], [412, false, false], [412, true, false], [412, false, true], [412, false, false, 'markdown'], [412, false, false, 'discount']]) {
  const caseName = `${width}${adjustment ? '-' + adjustment : mixedTax ? '-mixed-tax' : codePrice ? '-product-code' : ''}`;
  test(`mobile Chromium ${caseName}px: image crop, OCR review, apply, data safety`, { timeout: 60000 }, async () => {
    const allowed = new Set(['index.html', 'app.js', 'receipt.js', 'styles.css', 'sw.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png']);
    const server = http.createServer((request, response) => {
      const name = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html';
      if (!allowed.has(name)) { response.writeHead(404).end(); return; }
      const mime = { '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
      response.setHeader('Content-Type', mime[path.extname(name)]);
      response.end(fs.readFileSync(path.join(root, name)));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
      browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
      const context = await browser.newContext({ viewport: { width, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      // The camera image and OCR worker are synthetic; no claim of real OCR speed.
      await page.addInitScript(({ text }) => {
        window.testOCRCalls = 0; window.testOCRTerminated = 0;
        window.Tesseract = { async createWorker() { return {
          async setParameters() {},
          async recognize() { window.testOCRCalls++; return { data: { blocks: [], text } }; },
          async terminate() { window.testOCRTerminated++; }
        }; } };
      }, { text: adjustment === 'markdown' ? 'ヤオコー東大和店\n2026年10月10日\nテスト"緑茶\n値下(元 ¥2,500) ¥1,280\n小計 1点 ¥1,280\n合計 ¥1,280\n楽天ペイ ¥1,280' : adjustment === 'discount' ? 'ヤオコー東大和店\n2026年10月10日\nテスト"緑茶 ¥2,500\n値引 ¥1,280\n歯ブラシ ¥100\n小計 2点 ¥1,320\n合計 ¥1,320\n楽天ペイ ¥1,320' : codePrice ? 'ヤオコー東大和店\n2026年10月10日\nテスト"緑茶\n2200083271771 2 ¥98\n小計 2点 ¥98\n合計 ¥98\n楽天ペイ ¥98' : mixedTax ? 'ヤオコー東大和店\n2026年10月10日\nテスト"緑茶 ¥100\n歯ブラシ ¥200\n8%税抜対象額 ¥100\n8%税額 ¥8\n10%税抜対象額 ¥200\n10%税額 ¥20\n合計 ¥328\n楽天ペイ ¥328' : width === 412 ? 'ヤオコー東大和店\n2026年10月10日\nテスト"緑茶 10 ¥15,625\n小計 10点 ¥15,625\n消費税額\n8% 10点 ¥1,250\n合計 ¥16,875\n楽天ペイ ¥16,875' : 'ヤオコー東大和店\n2026年10月10日\nテスト"緑茶 ¥100\n小計 1点 ¥100\n消費税 ¥8\n合計 ¥108\n楽天ペイ ¥108' });
      const expectedAmount = adjustment === 'markdown' ? '1280' : adjustment === 'discount' ? '1320' : codePrice ? '98' : mixedTax ? '328' : width === 412 ? '16875' : '108';
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      // A fresh PWA install claims the page and intentionally reloads it once.
      await page.waitForFunction(() => navigator.serviceWorker.controller && performance.getEntriesByType('navigation')[0].type === 'reload');
      await page.waitForFunction(() => typeof state !== 'undefined' && !!state && !!window.receiptFeature && document.getElementById('storageMode').textContent !== '-');
      assert.equal(await page.locator('#fatal').evaluate(el => el.classList.contains('show')), false);
      const builtIn = await page.evaluate(() => {
        runTests();
        return { appFailures: (document.getElementById('testResult').innerHTML.match(/❌/g) || []).length,
          receiptFailures: window.receiptFeature.tests().filter(x => !x[1]).map(x => x[0]) };
      });
      assert.equal(builtIn.appFailures, 0);
      assert.deepEqual(builtIn.receiptFailures, []);
      await page.evaluate(async () => {
        const group = state.categories[0];
        state.transactions.push({ id: 'existing-ledger', type: 'expense', date: '2026-09-01', amount: 73, from: 'wallet', categoryId: group.id, subcategoryId: group.subs[0].id });
        await persist(false);
        localStorage.setItem('okozukaiReceiptProductDictionaryV1', JSON.stringify([{ shopKey: 'unrelated', name: '既存の学習商品', priceHints: [73], source: 'learned', confirmedCount: 4 }]));
      });
      const snapshot = await page.evaluate(async () => ({ transactions: JSON.stringify(state.transactions), dictionary: localStorage.getItem('okozukaiReceiptProductDictionaryV1'), mirror: localStorage.getItem('okozukai_v321_mirror'), indexedDB: JSON.stringify(await idbReadCurrent()) }));
      await page.locator('#homeExpense').click();
      await page.locator('#receiptGalleryInput').waitFor({ state: 'attached' });
      assert.equal(await page.locator('#receiptCameraInput').getAttribute('capture'), 'environment');
      const image = await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = 150; canvas.height = 400;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 150, 400);
        ctx.fillStyle = 'black'; ctx.font = '12px sans-serif';
        ['TEST RECEIPT', '2026/10/10', 'TEA 100', 'TAX 8', 'TOTAL 108'].forEach((line, i) => ctx.fillText(line, 12, 30 + i * 48));
        return canvas.toDataURL().split(',')[1];
      });
      await page.locator('#receiptGalleryInput').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
      await page.locator('#receiptCropReadBtn').waitFor();
      assert(await page.locator('#receiptCropPreview').isVisible());
      await page.locator('#receiptCropReadBtn').click();
      await page.locator('#receiptApplyBtn').waitFor();
      assert.equal(await page.locator('#receiptAmount').inputValue(), expectedAmount);
      assert.equal(await page.locator('#receiptShop').inputValue(), 'ヤオコー東大和店');
      assert.equal(await page.locator('#receiptDate').inputValue(), '2026-10-10');
      if (adjustment === 'markdown') {
        const rows = await page.locator('#receiptOCRPanel').evaluate(el => JSON.parse(el.dataset.itemRows));
        assert.equal(rows.length, 1);
        assert.equal(rows[0].total, 1280);
        assert.equal(rows[0].markdownOriginalTotal, 2500);
        assert.equal(rows[0].markdownDiscount, 1220);
      } else if (adjustment === 'discount') {
        const rows = await page.locator('#receiptOCRPanel').evaluate(el => JSON.parse(el.dataset.itemRows));
        assert.deepEqual(rows.map(row => row.total), [2500, 100]);
      } else if (mixedTax) {
        const rows = await page.locator('#receiptOCRPanel').evaluate(el => JSON.parse(el.dataset.splitRows));
        assert.deepEqual(rows.map(row => [row.net, row.extra, row.gross, row.taxRate]), [[100, 8, 108, 8], [200, 20, 220, 10]]);
      } else if (width === 412) {
        const rows = await page.locator('#receiptOCRPanel').evaluate(el => JSON.parse(el.dataset.itemRows));
        assert.equal(rows.length, 1);
        assert.equal(rows[0].qty, codePrice ? 2 : 10);
        assert.equal(rows[0].total, codePrice ? 98 : 15625);
        assert.equal(rows[0].unitPrice, codePrice ? 49 : 0);
        if (codePrice) assert.equal(rows[0].productCode, '2200083271771');
      }
      assert.equal(await page.locator('#receiptCameraBtn').isEnabled(), true);
      assert.equal(await page.evaluate(() => window.testOCRTerminated), 1);
      assert.equal(await page.evaluate(() => JSON.stringify(state.transactions)), snapshot.transactions);
      assert.equal(await page.evaluate(() => localStorage.getItem('okozukaiReceiptProductDictionaryV1')), snapshot.dictionary);
      assert.equal(await page.evaluate(() => localStorage.getItem('okozukai_v321_mirror')), snapshot.mirror);
      assert.equal(await page.evaluate(async () => JSON.stringify(await idbReadCurrent())), snapshot.indexedDB);
      assert(await page.locator('.receipt-product-review-confirm').count() > 0);
      const dismissed = page.waitForEvent('dialog').then(dialog => dialog.dismiss());
      await page.locator('#receiptApplyBtn').click();
      await dismissed;
      assert.equal(await page.locator('#txAmount').inputValue(), '');
      await page.locator('.receipt-product-review-name[data-index="0"]').fill('テスト緑茶');
      if (mixedTax || adjustment === 'discount') await page.locator('.receipt-product-review-name[data-index="1"]').fill('歯ブラシ');
      for (const checkbox of await page.locator('.receipt-product-review-confirm').all()) await checkbox.check();
      const geometry = await page.locator('#receiptApplyBtn').boundingBox();
      assert(geometry.width >= 44 && geometry.height >= 44);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.locator('#receiptApplyBtn').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `mobile-${caseName}.png`) });
      await page.locator('#receiptApplyBtn').click();
      assert.equal(await page.locator('#txAmount').inputValue(), expectedAmount);
      assert.equal(await page.locator('#txShop').inputValue(), 'ヤオコー東大和店');
      if (mixedTax) {
        const plan = JSON.parse(await page.locator('#receiptSplitPlan').inputValue());
        assert.equal(plan.total, 328);
        assert.deepEqual(plan.rows.map(row => [row.name, row.net, row.extra, row.gross, row.taxRate]), [['テスト緑茶', 100, 8, 108, 8], ['歯ブラシ', 200, 20, 220, 10]]);
      }
      if (adjustment === 'discount') {
        const plan = JSON.parse(await page.locator('#receiptSplitPlan').inputValue());
        assert.equal(plan.total, 1320);
        assert.equal(plan.rows.reduce((sum, row) => sum + row.originalNet, 0), 2600);
        assert.equal(plan.rows.reduce((sum, row) => sum + row.discount, 0), 1280);
        assert.equal(plan.rows.reduce((sum, row) => sum + row.gross, 0), 1320);
      }
      assert.equal(await page.evaluate(() => JSON.stringify(state.transactions)), snapshot.transactions);
      assert.equal(await page.evaluate(() => localStorage.getItem('okozukai_v321_mirror')), snapshot.mirror);
      assert.equal(await page.evaluate(async () => JSON.stringify(await idbReadCurrent())), snapshot.indexedDB);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('okozukaiReceiptProductDictionaryV1')).some(row => row.name === '既存の学習商品' && row.confirmedCount === 4)), true);
      assert.deepEqual(errors, []);
      const metrics = await page.evaluate(() => ({ calls: window.testOCRCalls, terminated: window.testOCRTerminated }));
      fs.writeFileSync(path.join(output, `mobile-${caseName}.json`), JSON.stringify({ width, mixedTax, codePrice, adjustment, ...metrics, errors, realAndroidDevice: false, mockedOCR: true }, null, 2));
    } finally {
      if (browser) await browser.close();
      await new Promise(resolve => server.close(resolve));
    }
  });
}

test('deferred OCR crops preserve baseline bitmap pixels in Chromium', { timeout: 60000 }, async () => {
  const before = execFileSync('git', ['show', 'fd3d18a4138be0d3a1f13800047e0091914c064e:receipt.js'], { cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  const after = fs.readFileSync(path.join(root, 'receipt.js'), 'utf8');
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
  try {
    const page = await browser.newPage();
    async function bitmaps(source) {
      await page.addScriptTag({ content: source.replace('window.receiptFeature={', 'window.receiptImageTest={buildOCRBundle,setSource:function(source){pendingReceipt={source:source}}};window.receiptFeature={') });
      const result = await page.evaluate(() => {
        const source = document.createElement('canvas'); source.width = 60; source.height = 180;
        const context = source.getContext('2d'), pixels = context.createImageData(60, 180);
        for (let i = 0; i < pixels.data.length; i += 4) {
          pixels.data[i] = i % 251; pixels.data[i + 1] = (i * 7) % 253; pixels.data[i + 2] = (i * 13) % 255; pixels.data[i + 3] = 255;
        }
        context.putImageData(pixels, 0, 0);
        window.receiptImageTest.setSource(source);
        const bundle = window.receiptImageTest.buildOCRBundle();
        return ['slices', 'shopSlices', 'itemSlices', 'amountSlices', 'paymentSlices'].flatMap(role => bundle[role].map(part => ({ role, label: part.label || part.role, width: part.canvas.width, height: part.canvas.height, png: part.canvas.toDataURL() })));
      });
      return result.map(({ png, ...metadata }) => ({ ...metadata, sha256: createHash('sha256').update(png).digest('hex') }));
    }
    assert.deepEqual(await bitmaps(after), await bitmaps(before));
  } finally { await browser.close(); }
});
