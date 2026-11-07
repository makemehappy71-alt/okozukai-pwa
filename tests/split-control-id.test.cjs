const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const code = '2200083271771';
const merchandise = `緑茶\n${code} 1 ¥1,000`;
const part = id => `緑茶 (明細ID ${id})\n${code} 1 ¥1,000`;
function receipt(items, { net = 1700 } = {}) {
  return `テスト商店\n2026年11月07日\n${items}\n小計 2点 ¥${net}\n合計 ¥${net}\n楽天ペイ ¥${net}`;
}
const goodBody = `${part('A101')}\n商品値引 ¥100\n${part('B102')}\n商品値引 ¥200`;
const parse = (text, r = runtime()) => r.context.receiptFeature.parseReceiptText(text, '2026-11-07');
function assigned(p) {
  assert.equal(p.discountAttributionConfirmed, true);
  assert.equal(p.discountReviewRequired, false);
  assert.equal(p.itemSetComplete, true);
  assert.deepEqual(Array.from(p.itemRows, r => [r.name, r.receiptLineId, r.qty, r.total]), [['緑茶', 'A101', 1, 1000], ['緑茶', 'B102', 1, 1000]]);
  assert.deepEqual(Array.from(p.splitRows, r => [r.discount, r.gross]), [[100, 900], [200, 800]]);
}
function held(p) {
  assert.equal(p.discountAttributionConfirmed, false);
  assert.equal(p.discountReviewRequired, true);
  assert.equal(p.itemSetComplete, false);
  assert.equal(p.autoConfirmedItemCount, 0);
  assert.equal(p.productCandidateAutoConfirmed, false);
  assert.equal(p.splitRows.length, 0);
}
const breaks = [['TAB', '\t'], ['LF', '\n'], ['CR', '\r'], ['CRLF', '\r\n'], ['blank line', '\n\n']];
for (const [name, separator] of breaks) {
  const split = `A${separator}101`;
  test(`${name} inside an inline ID is not joined`, () => held(parse(receipt(`${part(split)}\n商品値引 ¥100\n${part('B102')}\n商品値引 ¥200`))));
  test(`${name} inside a value-only bracket is not joined`, () => held(parse(receipt(`明細ID [${split}]\n${merchandise}\n商品値引 ¥100\n${part('B102')}\n商品値引 ¥200`))));
  test(`${name} inside a prefix discount reference is not joined`, () => held(parse(receipt(`${part('A101')}\n${part('B102')}\n(明細ID ${split}) 値引 ¥100\n(明細ID B102) 値引 ¥200`))));
  test(`${name} inside a suffix discount reference is not joined`, () => held(parse(receipt(`${part('A101')}\n${part('B102')}\n値引 ¥100 (明細ID ${split})\n(明細ID B102) 値引 ¥200`))));
  test(`${name} in a lone reference cannot fall back to general allocation`, () => held(parse(receipt(`${part('A101')}\n${part('B102')}\n値引 ¥100 (明細ID ${split})`, { net: 1900 }))));
}

for (const [name, separator] of [['LF', '\n'], ['CR', '\r'], ['CRLF', '\r\n']]) test(`normal receipt rows separated by ${name} keep valid IDs`, () => {
  const p = parse(receipt(goodBody).replace(/\n/g, separator));
  assigned(p);
  assert.equal(p.shop, 'テスト商店');
  assert.equal(p.date, '2026-11-07');
  assert.equal(p.amount, 1700);
});

test('tabs between the label and value remain ordinary layout delimiters', () => assigned(parse(receipt(goodBody.replace(/明細ID /g, '明細ID\t')))));

test('tabs between the product name and marker remain layout delimiters', () => assigned(parse(receipt(goodBody.replace(/緑茶 \(/g, '緑茶\t(')))));

test('tab padding outside the value is not treated as an internal ID character', () => assigned(parse(receipt(goodBody.replace(/明細ID (A101|B102)\)/g, '明細ID\t$1\t)')))));

test('CRLF and LF OCR copies identify the same physical purchases', () => assigned(parse({ text: receipt(goodBody), whole: receipt(goodBody).replace(/\n/g, '\r\n') })));

test('a CR-split diagnostic cannot be bypassed by a readable OCR pass', () => {
  held(parse({ text: receipt(goodBody), diagnostics: [{ label: '全体', text: receipt(goodBody.replace('A101', 'A\r101')) }] }));
});

test('a bare CR inside a numeric ID is not deleted', () => {
  held(parse(receipt(`${part('1\r01')}\n商品値引 ¥100\n${part('102')}\n商品値引 ¥200`)));
});

test('a CR inside an opaque separator ID is not deleted', () => held(parse(receipt(`${part('A-1\r01')}\n商品値引 ¥100\n${part('B_102')}\n商品値引 ¥200`))));

test('a CR inside a bounded space ID is not changed into a space or deleted', () => held(parse(receipt(`${part('A \r101')}\n商品値引 ¥100\n${part('B 102')}\n商品値引 ¥200`))));

test('an ID label split by CR is not silently reassembled', () => held(parse(receipt(goodBody.replace('明細ID A101', '明細I\rD A101')))));

test('a line break after an open ID bracket does not supply a numeric product price', () => {
  const p = parse('テスト商店\n緑茶 (明細ID A\r101)\nクーポン割引 ¥50\n合計 ¥51\n楽天ペイ ¥51');
  assert.equal(p.amount, 51);
  assert.equal(p.itemSetComplete, false);
  assert.equal(p.productCandidateAutoConfirmed, false);
  assert.equal(p.itemRows.some(r => r.total === 101), false);
});

test('source filtering never changes a split identifier into A101', () => {
  const a = runtime().context.receiptInternals;
  const rows = a.itemRowsFromText(a.productSourceText(`${part('A\r101')}\n商品値引 ¥100\n${part('B102')}\n商品値引 ¥200`));
  assert.equal(rows.some(r => r.receiptLineId === 'A101'), false);
});

test('learning cannot bypass a CR-split reference', () => {
  const r = runtime();
  r.storage.set('okozukaiReceiptProductDictionaryV1', JSON.stringify([{ shopKey: 'テスト商', name: '緑茶', aliases: ['緑茶'], priceHints: [1000], source: 'learned', confirmedCount: 6 }]));
  held(parse(receipt(`${part('A101')}\n${part('B102')}\n(明細ID A\r101) 値引 ¥100\n(明細ID B102) 値引 ¥200`), r));
  assert.equal(r.writes.length, 0);
});

test('control-character handling preserves ledger, learning dictionary and schema', () => {
  const r = runtime();
  r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'unrelated', name: '学習商品', priceHints: [73], source: 'learned', confirmedCount: 4 }]);
  r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);
  const before = r.evaluate('JSON.stringify(state)');
  assigned(parse(receipt(goodBody).replace(/\n/g, '\r'), r));
  held(parse(receipt(goodBody.replace('A101', 'A\r101')), r));
  assert.equal(r.evaluate('JSON.stringify(state)'), before);
  assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);
  assert.equal(r.writes.length, 0);
  assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});

for (const [name, items, valid] of [
  ['layout tabs', goodBody.replace(/明細ID /g, '明細ID\t'), true],
  ['internal TAB', goodBody.replace('A101', 'A\t101'), false],
  ['internal CR', goodBody.replace('A101', 'A\r101'), false],
  ['internal LF', goodBody.replace('A101', 'A\n101'), false]
]) test(`mock OCR handles ${name} without guessing the ID`, async () => {
  const r = runtime(), a = r.context.receiptInternals, text = receipt(items);
  let terminated = 0;
  r.context.Tesseract = { async createWorker() { return { async setParameters() {}, async recognize() { return { data: { text, blocks: [] } }; }, async terminate() { terminated++; } }; } };
  const canvas = { width: 100, height: 300 };
  const ocr = await a.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'middle', canvas }, { role: 'bottom', canvas }], shopSlices: [], itemSlices: Array.from({ length: 7 }, () => ({ canvas })), amountSlices: [], paymentSlices: [] });
  const p = parse(ocr, r);
  if (valid) assigned(p); else held(p);
  assert.equal(terminated, 1);
  assert.equal(r.writes.length, 0);
});
