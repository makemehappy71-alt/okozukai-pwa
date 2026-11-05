const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const root = process.env.RECEIPT_TEST_ROOT;
const shop = 'オーケー立川若葉町店';
const rawName = 'F NEIE® -F74-1000m|';
const line = rawName + ' ¥101';
function setup(options) { return createRuntime(root, options); }
function fixture() {
  const r = setup({ captureFixtures: true });
  r.context.receiptFeature.tests();
  return { r, api: r.context.receiptInternals, data: r.context.receiptFixtures };
}

test('101-yen OCR survives product classification and source filtering', () => {
  const a = setup().context.receiptInternals;
  assert.equal(a.classifyReceiptLine(line), 'product');
  assert.equal(a.productSourceText(line), line);
  assert.equal(a.isReceiptHeaderLine(line), false);
  assert.equal(a.isGarbageProductName(a.normalizeProductName(rawName)), true);
  assert.equal(a.productMeaningfulScore(rawName), -43);
});
test('ordinary extraction retains price and original OCR as a review-only row', () => {
  const r = setup(), before = r.evaluate('JSON.stringify(state)');
  const rows = r.context.receiptInternals.itemRowsFromText(line, 3, shop);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, '商品名要確認');
  assert.equal(rows[0].rawName, rawName);
  assert.equal(rows[0].total, 101);
  assert.equal(rows[0].unitPrice, 101);
  assert.equal(rows[0].qty, 1);
  assert.equal(rows[0].lowConfidence, true);
  assert.equal(rows[0].candidateOnly, true);
  assert(!rows[0].autoConfirmed);
  assert.equal(r.evaluate('JSON.stringify(state)'), before);
  assert.equal(r.writes.length, 0);
});
test('real middle OCR now yields all four independently printed prices', () => {
  const { api, data } = fixture();
  const rows = api.itemRowsFromText(api.productSourceText(data.okObj.sections.middle), 3, shop);
  assert.deepEqual(Array.from(rows, row => row.total).sort((a, b) => a - b), [101, 108, 284, 325]);
  assert.equal(rows.reduce((sum, row) => sum + row.qty, 0), 7);
});
test('101-yen row can be retained when its explicit price is on the next line', () => {
  const rows = setup().context.receiptInternals.itemRowsFromText(rawName + '\n¥101', 3, shop);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rawName, rawName);
  assert.equal(rows[0].total, 101);
  assert.equal(rows[0].lowConfidence, true);
});
for (const merchant of ['', '西友', 'ヤオコー東大和店', 'MEGAドン・キホーテ立川店']) {
  test(`same weak OCR is not admitted at unrelated/unknown store: ${merchant || 'none'}`, () => {
    assert.equal(setup().context.receiptInternals.itemRowsFromText(line, 3, merchant).length, 0);
  });
}
for (const text of [rawName + ' ¥102', rawName + ' ¥100', 'F NEIX® -F74-1000m| ¥101', 'F XXXX® -Z99-1000m| ¥101', rawName]) {
  test(`price or fuzzy resemblance alone is insufficient: ${text}`, () => {
    assert.equal(setup().context.receiptInternals.itemRowsFromText(text, 3, shop).length, 0);
  });
}
test('dictionary alias ambiguity cannot preserve a garbage row', () => {
  const entry = { name: 'テスト商品', aliases: [rawName], priceHints: [101], source: 'verified_sample' };
  const r = setup({ merchantDictionary: [entry, { ...entry, name: '別のテスト商品' }] });
  assert.equal(r.context.receiptInternals.itemRowsFromText(line, 3, shop).length, 0);
});
test('an exact user-confirmed alias can retain price without confirming the name', () => {
  const r = setup({ merchantDictionary: [{ name: 'テスト商品', aliases: [rawName], priceHints: [101], source: 'learned' }] });
  const rows = r.context.receiptInternals.itemRowsFromText(line, 3, shop);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, '商品名要確認');
  assert.equal(rows[0].lowConfidence, true);
  assert(!rows[0].autoConfirmed);
});
test('a saved learned entry overriding the same built-in name cannot lose the price row', () => {
  const r = setup(), key = 'okozukaiReceiptProductDictionaryV1';
  const dictionary = JSON.stringify([{ shopKey: 'ok', name: 'ピーチティー1000ml', aliases: [rawName], priceHints: [101], source: 'learned', confirmedCount: 2 }]);
  r.storage.set(key, dictionary);
  const rows = r.context.receiptInternals.itemRowsFromText(line, 3, shop);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rawName, rawName);
  assert.equal(rows[0].total, 101);
  assert.equal(r.storage.get(key), dictionary);
  assert.equal(r.writes.length, 0);
});
for (const alias of ['TEL F NEIE® -F74-1000m|', '合計 F NEIE® -F74-1000m|', 'ポイント F NEIE® -F74-1000m|']) {
  test(`even an exact dictionary alias cannot bypass metadata guards: ${alias}`, () => {
    const r = setup({ merchantDictionary: [{ name: 'テスト商品', aliases: [alias], priceHints: [101], source: 'verified_sample' }] });
    assert.equal(r.context.receiptInternals.itemRowsFromText(alias + ' ¥101', 3, shop).length, 0);
  });
}
test('complete receipt enables structural fast path without confirming the raw name', () => {
  const { data } = fixture(), fast = data.okFastPath;
  assert.equal(fast.ready, true);
  assert.equal(fast.sum, 818);
  assert.equal(fast.actualItemCount, 7);
  assert.equal(fast.expectedItemCount, 7);
  assert.equal(fast.rows.find(row => row.total === 101).name, '商品名要確認');
});
for (const variant of ['missing', 'wrongPrice', 'wrongCount']) {
  test(`incomplete/inconsistent receipt never enters fast path: ${variant}`, () => {
    const { api, data } = fixture();
    let full = data.okText, middle = data.okObj.sections.middle, bottom = data.okObj.sections.bottom;
    if (variant === 'missing') { full = full.replace(line + '\n', ''); middle = middle.replace(line + '\n', ''); }
    if (variant === 'wrongPrice') { full = full.replace(line, rawName + ' ¥102'); middle = middle.replace(line, rawName + ' ¥102'); }
    if (variant === 'wrongCount') { full = full.replace('7点', '8点'); bottom = bottom.replace('7点', '8点'); }
    const fast = api.receiptStructuralFastPath(full, middle, bottom, shop);
    assert.equal(fast.ready, false);
    if (variant !== 'wrongCount') assert.equal(fast.sum, 717);
  });
}
test('full parser no longer uses a computed 101-yen gap to reconstruct the item', () => {
  const { data } = fixture(), result = data.pOk, row = result.itemRows.find(item => item.total === 101);
  assert(row);
  assert.equal(row.name, 'ピーチティー1000ml');
  assert.equal(row.rawName, rawName);
  assert.equal(row.unitPrice, 101);
  assert.equal(row.qty, 1);
  assert(!row.recoveredMissing);
  assert.equal(result.gapRecovered, false);
  assert.equal(result.amount, 859);
  assert.equal(result.subtotal, 796);
  assert.equal(result.tax, 63);
  assert.equal(result.actualItemCount, 7);
  assert.equal(result.splitRows.reduce((sum, item) => sum + item.gross, 0), 859);
  assert.equal(result.splitRows.reduce((sum, item) => sum + item.discount, 0), 22);
});
test('extracting the known weak name leaves an existing ledger and dictionary unchanged', () => {
  const r = setup();
  r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:101,date:"2026-09-01",from:"wallet"})');
  const key = 'okozukaiReceiptProductDictionaryV1', dictionary = JSON.stringify([{ shopKey: 'unrelated', name: '既存商品', priceHints: [101], source: 'learned' }]);
  r.storage.set(key, dictionary);
  const before = r.evaluate('JSON.stringify(state)');
  assert.equal(r.context.receiptInternals.itemRowsFromText(line, 3, shop).length, 1);
  assert.equal(r.evaluate('JSON.stringify(state)'), before);
  assert.equal(r.storage.get(key), dictionary);
  assert.equal(r.writes.length, 0);
  assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});
test('OCR orchestration can skip product re-scans only after four prices reconcile', async () => {
  const { r, api, data } = fixture();
  let calls = 0, terminated = 0;
  r.context.Tesseract = { async createWorker() { return {
    async setParameters() {}, async terminate() { terminated++; },
    async recognize() { calls++; return { data: { text: data.okText, blocks: [] } }; }
  }; } };
  const canvas = { width: 100, height: 300 };
  const ocr = await api.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'bottom', canvas }], itemSlices: Array.from({ length: 7 }, () => ({ canvas })) });
  assert.equal(ocr.meta.fastPath, true);
  assert.equal(ocr.meta.fastPathRows, 4);
  assert.equal(calls, 3);
  assert.equal(terminated, 1);
  const result = r.context.receiptFeature.parseReceiptText(ocr, '2026-09-27');
  assert.equal(result.amount, 859);
  assert.equal(result.actualItemCount, 7);
  const row = result.itemRows.find(item => item.total === 101);
  assert.equal(row.rawName, rawName);
  assert(!row.recoveredMissing);
  assert.equal(r.writes.length, 0);
});
