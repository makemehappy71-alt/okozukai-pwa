const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const { baselineRuntime, selectionRows, canvasRuntime } = require('./helpers/performance.cjs');
const baseline = baselineRuntime();
const current = createRuntime();
const plain = value => JSON.parse(JSON.stringify(value));
function compareSelection(rows, subtotal, total = 10000, discount = 0, shop = '') {
  const args = [rows, subtotal, total, discount, shop];
  const before = JSON.stringify(rows);
  const expected = baseline.context.receiptInternals.chooseItemsForSubtotal(...args);
  const actual = current.context.receiptInternals.chooseItemsForSubtotal(...args);
  assert.deepEqual(plain(actual), plain(expected));
  assert.equal(JSON.stringify(rows), before);
  return actual;
}

test('selection preserves baseline results across 90 seeded baskets', () => {
  for (let seed = 1; seed <= 90; seed++) {
    const rows = selectionRows(2 + seed % 10, seed);
    const subtotal = seed % 3 ? rows.filter((_, i) => (i + seed) % 3 === 0).reduce((s, r) => s + r.total, 0) : 1;
    compareSelection(rows, subtotal, 10000, seed % 4 === 0 ? 17 : 0);
  }
});
test('18 candidate matching basket preserves all selected rows and quantities', () => {
  const rows = selectionRows(18, 64);
  compareSelection(rows, rows.filter((_, i) => i % 3 === 0).reduce((s, r) => s + r.total, 0));
});
test('18 candidate unmatched basket stays unconfirmed', () => {
  const result = compareSelection(selectionRows(18, 93), 1);
  assert.equal(result.matched, false);
});
test('equal-score ties preserve the original earliest mask', () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ name: 'テスト商品', qty: 1, total: 100, sourceIndex: i, sourcePriority: 3 }));
  const result = compareSelection(rows, 200);
  assert.deepEqual(Array.from(result.rows, r => r.sourceIndex), [0, 1]);
});
test('discount fallback, full-basket shortcut and candidate limit stay unchanged', () => {
  const rows = selectionRows(8, 77);
  const subtotal = rows[0].total + rows[1].total;
  compareSelection(rows, subtotal, 10000, 100000);
  compareSelection(rows, rows.reduce((s, r) => s + r.total, 0));
  compareSelection(selectionRows(19, 77), 900);
});
test('fractional amounts retain original arithmetic behaviour', () => {
  const rows = selectionRows(6, 9).map((row, i) => ({ ...row, total: i % 2 ? 0.2 : 0.1 }));
  for (const subtotal of [0.3, 0.30000000000000004, 0.4]) compareSelection(rows, subtotal);
});
test('verified merchant evidence retains selection priority', () => {
  const rows = ['別の商品', 'アクリルウォールラック20cm', '別の品物'].map((name, i) => ({ name, qty: 1, total: 100, sourceIndex: i, sourcePriority: 3 }));
  const result = compareSelection(rows, 100, 110, 0, 'Seria');
  assert.equal(result.rows[0].name, 'アクリルウォールラック20cm');
});

test('optional OCR canvases are deferred and retain identical crop geometry', () => {
  const old = canvasRuntime(baselineRuntime(), 300, 900), next = canvasRuntime(createRuntime(), 300, 900);
  const expected = old.context.receiptInternals.buildOCRBundle(), actual = next.context.receiptInternals.buildOCRBundle();
  assert(next.stats().pixels < old.stats().pixels / 2);
  const prepared = next.stats().count;
  for (const role of ['shopSlices', 'itemSlices', 'amountSlices', 'paymentSlices']) {
    assert.equal(actual[role].length, expected[role].length);
    actual[role].forEach((part, i) => {
      const cached = part.canvas;
      assert.equal(part.canvas, cached, 'repeated access reuses the same canvas');
      assert.deepEqual(next.signature(cached), old.signature(expected[role][i].canvas));
      for (const key of ['mode', 'label', 'whitelist']) assert.equal(part[key], expected[role][i][key]);
    });
  }
  assert(next.stats().count > prepared);
  assert.deepEqual(next.stats(), old.stats());
});
test('known-store fast OCR never creates unused optional canvases', async () => {
  const r = canvasRuntime(createRuntime(), 300, 900);
  const bundle = r.context.receiptInternals.buildOCRBundle(), prepared = r.stats();
  r.context.Tesseract = { async createWorker() { return { async setParameters() {}, async terminate() {}, async recognize() { return { data: { blocks: [], text: '西友\nテスト飲料 ¥100\n小計 1点 ¥100\n消費税 ¥8\n合計 ¥108\n楽天ペイ ¥108' } }; } }; } };
  const result = await r.context.receiptInternals.runOCR(bundle);
  assert.equal(result.meta.fastPath, true);
  assert.deepEqual(r.stats(), prepared);
  assert.equal(r.writes.length, 0);
});
