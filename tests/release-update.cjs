const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const baseline = 'e641912b6648757e39893659766b1de83dff8765';
const changedAssets = ['index.html', 'app.js', 'receipt.js', 'sw.js'];
const old = Object.fromEntries(changedAssets.map(name => [name, execFileSync('git', ['show', `${baseline}:${name}`], { cwd: root, maxBuffer: 2 * 1024 * 1024 })]));
const sample = 'テスト商店\n2026年11月09日\n緑茶 (明細ID 00\n0100)\n2200083271771 1 ¥1,000\n(明細ID 000100) 値引\n¥100\n緑茶 (明細ID 00\n0200)\n単価 ¥500\n2200083271771 ¥1,000\n(明細ID 000200)\n\n値引\n\n¥200\n小計 3点 ¥1700\n合計 ¥1700\n楽天ペイ ¥1700';

test('published PWA upgrade preserves saved data, refreshes OCR assets and works offline', { timeout: 180000 }, async () => {
  let phase = 'old';
  const allowed = new Set(['', 'index.html', 'app.js', 'receipt.js', 'sw.js', 'styles.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png']);
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!allowed.has(name)) { res.writeHead(404).end();return; }
    res.setHeader('Cache-Control', 'no-store');
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
    res.setHeader('Content-Type', mime[path.extname(name)] || 'application/octet-stream');
    res.end(phase === 'old' && old[name] ? old[name] : fs.readFileSync(path.join(root, name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
    const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => navigator.serviceWorker.controller && performance.getEntriesByType('navigation')[0].type === 'reload' && typeof state !== 'undefined' && !!state && !!window.receiptFeature);
    assert.equal(await page.locator('.version').textContent(), 'v3.71.19');
    assert.notEqual(await page.evaluate(text => receiptFeature.parseReceiptText(text, '2026-11-09').discountAttributionConfirmed, sample), true);
    await page.evaluate(async () => {
      const g = state.categories[0];
      state.transactions.push({ id: 'release-existing-ledger', relationGroupId: 'rel_release-existing-ledger', type: 'expense', date: '2026-11-01', amount: 73, from: 'wallet', categoryId: g.id, subcategoryId: g.subs[0].id });
      state.settings.cashBudget = 28000;
      await persist(false);
      localStorage.setItem('okozukaiReceiptProductDictionaryV1', JSON.stringify([{ shopKey: 'unrelated', name: '既存の学習商品', priceHints: [73], source: 'learned', confirmedCount: 4 }]));
      localStorage.setItem('release-unrelated-key', 'preserve');
      const cache = await caches.open('unrelated-pwa-cache');await cache.put('./unrelated-sentinel', new Response('preserve'));
    });
    const snapshot = await page.evaluate(async () => ({ state: structuredClone(state), idb: await idbReadCurrent(), mirror: JSON.parse(localStorage.getItem('okozukai_v321_mirror')), dictionary: localStorage.getItem('okozukaiReceiptProductDictionaryV1') }));
    assert((await page.evaluate(() => caches.keys())).includes('okozukai-v3.71.19-prod-1'));
    phase = 'new';
    await page.evaluate(async () => (await navigator.serviceWorker.ready).update()).catch(error => { if (!/Execution context was destroyed|Cannot find context/.test(error.message)) throw error; });
    await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith('sw.js?v=3287120') && typeof VERSION !== 'undefined' && VERSION === 'v3.71.20' && typeof state !== 'undefined' && !!state && !!window.receiptFeature && document.querySelector('.version')?.textContent === 'v3.71.20');
    // Changing the worker URL and its body can produce two controller reloads.
    // Read saved data only after the final registration and navigation settle.
    await page.waitForFunction(async () => { const reg = await navigator.serviceWorker.getRegistration();return reg?.active?.scriptURL.endsWith('sw.js?v=3287120') && reg.active.state === 'activated' && !reg.installing && !reg.waiting; });
    await page.waitForLoadState('networkidle');
    const normalized = data => ({ ...data, version: 'VERSION' });
    async function verifyData() {
      const current = await page.evaluate(async () => ({ state: structuredClone(state), idb: await idbReadCurrent(), mirror: JSON.parse(localStorage.getItem('okozukai_v321_mirror')), dictionary: localStorage.getItem('okozukaiReceiptProductDictionaryV1'), unrelated: localStorage.getItem('release-unrelated-key'), legacy: localStorage.getItem('okozukai_v321_legacy_backup'), schema: SCHEMA_VERSION }));
      assert.deepEqual(normalized(current.state), normalized(snapshot.state));
      assert.deepEqual(normalized(current.idb), normalized(snapshot.idb));
      assert.deepEqual(normalized(current.mirror), normalized(snapshot.mirror));
      assert.equal(current.state.version, 'v3.71.20');assert.equal(current.schema, 12);
      assert.equal(current.dictionary, snapshot.dictionary);assert.equal(current.unrelated, 'preserve');assert.equal(current.legacy, null);
      assert.equal(await page.locator('#fatal').evaluate(el => el.classList.contains('show')), false);
    }
    await verifyData();
    const parsed = await page.evaluate(text => receiptFeature.parseReceiptText(text, '2026-11-09'), sample);
    assert.equal(parsed.discountAttributionConfirmed, true);assert.equal(parsed.itemSetComplete, true);
    assert.deepEqual(parsed.splitRows.map(row => [row.discount, row.gross]), [[100, 900], [200, 800]]);
    const cacheState = await page.evaluate(async () => {
      const keys = await caches.keys(), cache = await caches.open('okozukai-v3.71.20-prod-1');
      const receipt = await cache.match('./receipt.js?v=3287120'), other = await (await caches.open('unrelated-pwa-cache')).match('./unrelated-sentinel');
      return { keys, receipt: receipt && await receipt.text(), other: other && await other.text() };
    });
    assert(!cacheState.keys.includes('okozukai-v3.71.19-prod-1'));assert(cacheState.keys.includes('okozukai-v3.71.20-prod-1'));assert.equal(cacheState.other, 'preserve');
    assert.equal(createHash('sha256').update(cacheState.receipt).digest('hex'), createHash('sha256').update(fs.readFileSync(path.join(root, 'receipt.js'))).digest('hex'));
    await context.setOffline(true);await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' && !!state && typeof VERSION !== 'undefined' && VERSION === 'v3.71.20' && !!window.receiptFeature);
    await verifyData();assert.equal(await page.locator('.version').textContent(), 'v3.71.20');
    assert.deepEqual(errors, []);
    const out = path.join(root, '.test-artifacts');fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'release-pwa-update.json'), JSON.stringify({ from: 'v3.71.19', to: 'v3.71.20', schema: 12, dataPreserved: true, dictionaryPreserved: true, unrelatedCachePreserved: true, ocrAssetsMatch: true, offline: true }, null, 2));
  } finally { if (browser) await browser.close();await new Promise(resolve => server.close(resolve)); }
});
