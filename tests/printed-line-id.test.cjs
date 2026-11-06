const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const code = '2200083271771';
const part = (id, discount = 100, label = '明細番号') => `${label} ${id}\n緑茶\n${code} 1 ¥1,000${discount ? `\n商品値引 ¥${discount}` : ''}`;
function receipt(body, { net = 1700, count = 2, tax = 0, paid = true } = {}) {
  return `テスト商店\n2026年11月07日\n${body}\n小計 ${count ? count + '点 ' : ''}¥${net}\n${tax ? `消費税 ¥${tax}\n` : ''}${paid ? `合計 ¥${net + tax}\n楽天ペイ ¥${net + tax}` : ''}`;
}
const parse = (text, r = runtime()) => r.context.receiptFeature.parseReceiptText(text, '2026-11-07');
function assigned(p, expected) {
  assert.equal(p.discountAttributionConfirmed, true);
  assert.equal(p.discountReviewRequired, false);
  assert.equal(p.itemSetComplete, true);
  assert.deepEqual(Array.from(p.itemRows, (row, i) => [row.receiptLineId, row.productCode, row.qty, row.total, p.splitRows[i].discount, p.splitRows[i].gross]), expected.map(([id, discount, gross]) => [id, code, 1, 1000, discount, gross]));
}
function held(p, status = 'total_only') {
  assert.equal(p.discountStatus, status);
  assert.equal(p.discountReviewRequired, true);
  assert.equal(p.discountAttributionConfirmed, false);
  assert.equal(p.itemSetComplete, false);
  assert.equal(p.autoConfirmedItemCount, 0);
  assert.equal(p.productCandidateAutoConfirmed, false);
  assert.notEqual(p.productCandidateStatus, 'confirmed');
  assert.equal(p.splitRows.length, 0);
}

for (const label of ['明細番号', '明細No.', '明細ID']) test(`explicit ${label} distinguishes otherwise identical purchases`, () => {
  const p = parse(receipt(part(101, 100, label) + '\n' + part(102, 200, label)));
  assigned(p, [['101', 100, 900], ['102', 200, 800]]);
});

test('printed line metadata is never a priced product', () => {
  const a = runtime().context.receiptInternals;
  assert.equal(a.itemRowsFromText('明細番号 101\n明細No. 102\n明細ID 103').length, 0);
});

test('explicit IDs survive source filtering and direct extraction', () => {
  const a = runtime().context.receiptInternals, text = part(101, 0) + '\n' + part(102, 0);
  for (const source of [text, a.productSourceText(text)]) {
    const rows = a.itemRowsFromText(source);
    assert.deepEqual(Array.from(rows, x => [x.name, x.receiptLineId, x.total]), [['緑茶', '101', 1000], ['緑茶', '102', 1000]]);
  }
});

test('full-width printed identifiers normalize without changing prices', () => {
  const body = part('１０１', 100, '明細Ｎｏ．') + '\n' + part('１０２', 200, '明細ＩＤ');
  assigned(parse(receipt(body)), [['101', 100, 900], ['102', 200, 800]]);
});

test('explicit identifiers need not be consecutive or ascending', () => {
  assigned(parse(receipt(part(9001, 100) + '\n' + part(13, 200))), [['9001', 100, 900], ['13', 200, 800]]);
});

for (const discounted of [101, 102]) test(`one deduction belongs to printed line ${discounted}`, () => {
  assigned(parse(receipt(part(101, discounted === 101 ? 100 : 0) + '\n' + part(102, discounted === 102 ? 100 : 0), { net: 1900 })), [['101', discounted === 101 ? 100 : 0, discounted === 101 ? 900 : 1000], ['102', discounted === 102 ? 100 : 0, discounted === 102 ? 900 : 1000]]);
});

test('same discount amounts on separate numbered lines are not deduplicated', () => {
  assigned(parse(receipt(part(101) + '\n' + part(102), { net: 1800 })), [['101', 100, 900], ['102', 100, 900]]);
});

test('a printed discount reference can identify a non-adjacent target', () => {
  const body = part(101, 0) + '\n' + part(102, 0) + '\n明細番号 102 商品値引 ¥200\n明細番号 101 値引 ¥100';
  assigned(parse(receipt(body)), [['101', 100, 900], ['102', 200, 800]]);
});

test('an explicit reference takes priority over positional proximity', () => {
  const body = part(101, 0) + '\n明細番号 102 値引 ¥100\n' + part(102, 0);
  assigned(parse(receipt(body, { net: 1900 })), [['101', 0, 1000], ['102', 100, 900]]);
});

test('OCR order reversal does not reverse the printed-ID allocation', () => {
  const p = parse({ text: receipt(part(101, 100) + '\n' + part(102, 200)), whole: receipt(part(102, 200) + '\n' + part(101, 100)) });
  assert.equal(p.discountAttributionConfirmed, true);
  assert.deepEqual(Object.fromEntries(Array.from(p.itemRows, (row, i) => [row.receiptLineId, p.splitRows[i].discount])), { 101: 100, 102: 200 });
});

test('the same identifiers across OCR copies are not extra purchases', () => {
  const text = receipt(part(101, 100) + '\n' + part(102, 200));
  const p = parse({ text, whole: text, itemText: text, sections: { middle: text } });
  assigned(p, [['101', 100, 900], ['102', 200, 800]]);
  assert.equal(p.actualItemCount, 2);
});

test('disagreement about a printed-ID target prevents confirmation', () => {
  held(parse({ text: receipt(part(101, 100) + '\n' + part(102, 200)), whole: receipt(part(101, 200) + '\n' + part(102, 100)) }));
});

for (const second of ['101', '000101']) test(`reused identifier ${second} does not identify two purchases`, () => {
  held(parse(receipt(part(101, 100) + '\n' + part(second, 200))), 'unresolved');
});

for (const invalid of ['0', '1000001', '10O', 'ABC', '']) test(`invalid printed ID ${JSON.stringify(invalid)} cannot be repaired`, () => {
  const p = parse(receipt(part(invalid, 100) + '\n' + part(102, 200)));
  held(p, 'unresolved');
});

test('an invalid marker cannot carry the previous ID into another product', () => {
  const a = runtime().context.receiptInternals;
  const rows = a.itemRowsFromText(part(101, 0) + '\n' + part('10O', 0));
  assert.deepEqual(Array.from(rows, x => x.receiptLineId || ''), ['101', '']);
});

test('a missing ID is not inferred from the remaining item', () => {
  const body = part(101, 100).replace('明細番号 101\n', '') + '\n' + part(102, 200);
  held(parse(receipt(body)));
});

test('unrelated intervening text prevents attaching a printed ID', () => {
  const body = part(101, 100).replace('明細番号 101\n', '明細番号 101\n補足情報\n') + '\n' + part(102, 200);
  held(parse(receipt(body)));
});

test('an unknown referenced ID remains unresolved even when the total matches', () => {
  const body = part(101, 0) + '\n' + part(102, 0) + '\n明細番号 999 値引 ¥100\n明細番号 102 値引 ¥200';
  held(parse(receipt(body)));
});

for (const unrelated of ['No.101', '取引番号 101', '会員番号 101']) test(`${unrelated} is not a product-line identifier`, () => {
  const body = `${unrelated}\n緑茶\n${code} 1 ¥1,000\n商品値引 ¥100\n緑茶\n${code} 1 ¥1,000\n商品値引 ¥200`;
  held(parse(receipt(body)));
});

test('a discount reference cannot create a missing product identifier', () => {
  const body = `緑茶\n${code} 1 ¥1,000\n緑茶\n${code} 1 ¥1,000\n明細番号 101 値引 ¥100\n明細番号 102 値引 ¥200`;
  held(parse(receipt(body)));
});

test('an unnumbered OCR pass cannot assign numbered identical products by order', () => {
  const text = receipt(part(101, 100) + '\n' + part(102, 200));
  const unnumbered = text.replace(/明細番号 [0-9]+\n/g, '');
  held(parse({ text, diagnostics: [{ label: '全体', text: unnumbered }] }));
});

test('mixing numbered and unnumbered OCR rows does not silently join them', () => {
  const text = receipt(part(101, 100) + '\n' + part(102, 200));
  held(parse({ text, whole: text.replace('明細番号 102\n', '') }), 'unresolved');
});

for (const options of [{ count: 0 }, { count: 3 }, { paid: false }, { net: 1699 }]) test(`line IDs do not bypass missing accounting evidence: ${JSON.stringify(options)}`, () => {
  held(parse(receipt(part(101, 100) + '\n' + part(102, 200), options)), 'unresolved');
});

test('tax is allocated using the identifier-specific discounts', () => {
  assigned(parse(receipt(part(101, 100) + '\n' + part(102, 200), { tax: 136 })), [['101', 100, 972], ['102', 200, 864]]);
});

test('a marker without an actual product never creates a name or price', () => {
  const p = parse(receipt('明細番号 101\n商品値引 ¥100\n明細番号 102\n商品値引 ¥200'));
  held(p, 'unresolved');
  assert.equal(p.itemRows.length, 0);
});

test('a readable identifier does not invent the missing product name', () => {
  const body = `明細番号 101\n${code} 1 ¥1,000\n商品値引 ¥100\n明細番号 102\n${code} 1 ¥1,000\n商品値引 ¥200`;
  const p = parse(receipt(body));
  held(p);
  assert.equal(p.itemRows.every(row => row.name === '商品名要確認'), true);
  assert.equal(p.itemRows.every(row => !/^明細/.test(row.rawName)), true);
});

test('learned names cannot bypass duplicate printed IDs', () => {
  const r = runtime();
  r.storage.set('okozukaiReceiptProductDictionaryV1', JSON.stringify([{ shopKey: 'テスト商', name: '緑茶', aliases: ['緑茶'], priceHints: [1000], source: 'learned', confirmedCount: 6 }]));
  held(parse(receipt(part(101, 100) + '\n' + part(101, 200)), r), 'unresolved');
  assert.equal(r.writes.length, 0);
});

test('identifier parsing never alters existing user data or schema', () => {
  const r = runtime();
  r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'unrelated', name: '学習商品', priceHints: [73], source: 'learned', confirmedCount: 4 }]);
  r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);
  const before = r.evaluate('JSON.stringify(state)');
  parse(receipt(part(101, 100) + '\n' + part(102, 200)), r);
  parse(receipt(part(101, 100) + '\n' + part(101, 200)), r);
  assert.equal(r.evaluate('JSON.stringify(state)'), before);
  assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);
  assert.equal(r.writes.length, 0);
  assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});

test('mock OCR pipeline preserves printed IDs when identical product text is merged', async () => {
  const r = runtime(), a = r.context.receiptInternals;
  const text = receipt(part(101, 100) + '\n' + part(102, 200));
  let terminated = 0;
  r.context.Tesseract = { async createWorker() { return {
    async setParameters() {}, async recognize() { return { data: { text, blocks: [] } }; }, async terminate() { terminated++; }
  }; } };
  const canvas = { width: 100, height: 300 };
  const ocr = await a.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'middle', canvas }, { role: 'bottom', canvas }], shopSlices: [], itemSlices: Array.from({ length: 7 }, () => ({ canvas })), amountSlices: [], paymentSlices: [] });
  assigned(parse(ocr, r), [['101', 100, 900], ['102', 200, 800]]);
  assert.equal(terminated, 1);
  assert.equal(r.writes.length, 0);
});

test('a printed identifier is never a synthetic original price', () => {
  const p = parse('テスト商店\n明細番号 101\nクーポン割引 ¥50\n合計 ¥51\n楽天ペイ ¥51');
  assert.equal(p.amount, 51);
  assert.equal(p.itemRows.length, 0);
  assert.equal(p.itemSetComplete, false);
});

test('printed identifier coordinates are not a product-price anchor', () => {
  const blocks = [{ paragraphs: [{ lines: [{ text: '明細番号 101', bbox: { x0: 80, y0: 620, x1: 900, y1: 660 }, words: [] }] }] }];
  const anchor = runtime().context.receiptInternals.anchoredProductLineFromBlocks(blocks, 'クーポン割引 ¥50\n合計 ¥51', 1000, 1800);
  assert.equal(anchor, null);
});

test('an actual printed original price remains eligible for an anchor', () => {
  const blocks = [{ paragraphs: [{ lines: [{ text: '緑茶 ¥101', bbox: { x0: 80, y0: 620, x1: 900, y1: 660 }, words: [] }] }] }];
  const anchor = runtime().context.receiptInternals.anchoredProductLineFromBlocks(blocks, 'クーポン割引 ¥50\n合計 ¥51', 1000, 1800);
  assert(anchor);
  assert.equal(anchor.value, 101);
});

test('an unrelated numbered product does not require inventing an ID for a uniquely named product', () => {
  const p = parse(receipt('明細番号 101\n牛乳 ¥1,000\n商品値引 ¥100\n緑茶 ¥1,000\n商品値引 ¥200'));
  assert.equal(p.discountAttributionConfirmed, true);
  assert.deepEqual(Array.from(p.itemRows, row => [row.name, row.receiptLineId || '']), [['牛乳', '101'], ['緑茶', '']]);
  assert.deepEqual(Array.from(p.splitRows, row => row.discount), [100, 200]);
});
