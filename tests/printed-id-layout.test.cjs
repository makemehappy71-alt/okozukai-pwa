const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const code = '2200083271771';
const formats = {
  suffix: id => `緑茶 明細番号 ${id}\n${code} 1 ¥1,000`,
  prefix: id => `明細番号 ${id} 緑茶\n${code} 1 ¥1,000`,
  pricedSuffix: id => `緑茶 ¥1,000 明細番号 ${id}`,
  pricedPrefix: id => `明細番号 ${id} 緑茶 ¥1,000`,
  codeSuffix: id => `緑茶\n${code} 1 ¥1,000 明細番号 ${id}`,
  post: id => `緑茶\n${code} 1 ¥1,000\n明細番号 ${id}`,
  pricedPost: id => `緑茶 ¥1,000\n明細番号 ${id}`
};
const body = (format, first = 100, second = 200) => `${format(101)}\n${first ? '商品値引 ¥' + first : '補足情報'}\n${format(102)}\n${second ? '商品値引 ¥' + second : '補足情報'}`;
function receipt(items, { net = 1700, count = 2, tax = 0, paid = true } = {}) {
  return `テスト商店\n2026年11月07日\n${items}\n小計 ${count ? count + '点 ' : ''}¥${net}\n${tax ? '消費税 ¥' + tax + '\n' : ''}${paid ? '合計 ¥' + (net + tax) + '\n楽天ペイ ¥' + (net + tax) : ''}`;
}
const parse = (text, r = runtime()) => r.context.receiptFeature.parseReceiptText(text, '2026-11-07');
function assigned(p, discounts = [100, 200], gross = [900, 800]) {
  assert.equal(p.discountAttributionConfirmed, true);
  assert.equal(p.discountReviewRequired, false);
  assert.equal(p.itemSetComplete, true);
  assert.deepEqual(Array.from(p.itemRows, row => [row.name, row.receiptLineId, row.qty, row.total]), [['緑茶', '101', 1, 1000], ['緑茶', '102', 1, 1000]]);
  assert.deepEqual(Array.from(p.splitRows, row => row.discount), discounts);
  assert.deepEqual(Array.from(p.splitRows, row => row.gross), gross);
}
function held(p) {
  assert.equal(p.discountAttributionConfirmed, false);
  assert.equal(p.discountReviewRequired, true);
  assert.equal(p.itemSetComplete, false);
  assert.equal(p.autoConfirmedItemCount, 0);
  assert.equal(p.productCandidateAutoConfirmed, false);
  assert.equal(p.splitRows.length, 0);
}

for (const [name, format] of Object.entries(formats)) test(`${name}: explicit IDs retain real prices and identify deductions`, () => assigned(parse(receipt(body(format)))));

for (const label of ['明細No.', '明細ID', '明細Ｎｏ．']) test(`inline ${label} preserves names and full-width IDs`, () => {
  assigned(parse(receipt(body(formats.suffix).replace(/明細番号/g, label).replace(/101/g, '１０１').replace(/102/g, '１０２'))));
});

for (const name of ['suffix', 'post']) test(`${name}: metadata survives product-source filtering without changing its side`, () => {
  const a = runtime().context.receiptInternals, text = body(formats[name]);
  for (const input of [text, a.productSourceText(text)]) {
    const rows = a.itemRowsFromText(input);
    assert.deepEqual(Array.from(rows, row => [row.name, row.receiptLineId, row.total]), [['緑茶', '101', 1000], ['緑茶', '102', 1000]]);
  }
});

for (const name of ['suffix', 'post']) for (const selected of [0, 1]) test(`${name}: one discount belongs only to occurrence ${selected + 1}`, () => {
  const discounts = selected ? [0, 100] : [100, 0];
  assigned(parse(receipt(body(formats[name], ...discounts), { net: 1900 })), discounts, discounts.map(d => 1000 - d));
});

test('postfix IDs with identical discount amounts retain both deductions', () => assigned(parse(receipt(body(formats.post, 100, 100), { net: 1800 })), [100, 100], [900, 900]));

test('inline IDs support remote explicit discount references', () => {
  assigned(parse(receipt(`${formats.suffix(101)}\n${formats.suffix(102)}\n明細番号 102 値引 ¥200\n明細番号 101 値引 ¥100`)));
});

test('postfix IDs target remote references without borrowing from the next product', () => {
  assigned(parse(receipt(`${formats.post(101)}\n補足情報\n${formats.post(102)}\n明細番号 102 値引 ¥200\n明細番号 101 値引 ¥100`)));
});

test('different supported layouts across OCR passes keep the same physical IDs', () => {
  assigned(parse({ text: receipt(body(formats.suffix)), whole: receipt(body(formats.post)), itemText: receipt(body(formats.prefix)) }));
});

test('reversed postfix OCR order preserves allocation by ID', () => {
  const p = parse({ text: receipt(body(formats.suffix)), whole: receipt(`${formats.post(102)}\n商品値引 ¥200\n${formats.post(101)}\n商品値引 ¥100`) });
  assert.equal(p.discountAttributionConfirmed, true);
  assert.deepEqual(Object.fromEntries(Array.from(p.itemRows, (r, i) => [r.receiptLineId, p.splitRows[i].discount])), { 101: 100, 102: 200 });
});

test('disagreeing inline and postfix allocations remain manual', () => held(parse({ text: receipt(body(formats.suffix)), whole: receipt(body(formats.post, 200, 100)) })));

for (const name of ['suffix', 'post']) for (const id of ['0', '10O', '1000001', '']) test(`${name}: invalid ID ${JSON.stringify(id)} is not repaired`, () => {
  held(parse(receipt(body(formats[name]).replace('101', id))));
});

for (const name of ['suffix', 'post']) test(`${name}: duplicate IDs cannot distinguish purchases`, () => held(parse(receipt(body(formats[name]).replace('102', '000101')))));

test('conflicting prefix and postfix metadata on one product remains manual', () => {
  held(parse(receipt(`明細番号 999\n${formats.post(101)}\n商品値引 ¥100\n${formats.post(102)}\n商品値引 ¥200`)));
});

test('two inline labels do not produce a chosen identifier', () => held(parse(receipt(body(formats.suffix).replace('緑茶 明細番号 101', '明細番号 999 緑茶 明細番号 101')))));

test('a standalone number between two unlabelled products has no inferred direction', () => {
  held(parse(receipt(`緑茶\n${code} 1 ¥1,000\n明細番号 101\n緑茶\n${code} 1 ¥1,000\n明細番号 102\n明細番号 101 値引 ¥100\n明細番号 102 値引 ¥200`)));
});

test('an inline ID on the next product does not make an ambiguous inter-product marker safe', () => {
  held(parse(receipt(`緑茶\n${code} 1 ¥1,000\n明細番号 101\n${formats.suffix(102)}\n明細番号 101 値引 ¥100\n明細番号 102 値引 ¥200`)));
});

test('a postfix marker separated by unrelated text is not attached', () => held(parse(receipt(body(formats.post).replace('明細番号 101', '補足情報\n明細番号 101')))));

test('a marker between an unread product name and its price does not invent a name', () => {
  held(parse(receipt(`緑茶\n明細番号 101\n${code} 1 ¥1,000\n商品値引 ¥100\n${formats.post(102)}\n商品値引 ¥200`)));
});

test('an unknown reference cannot target an inline ID by position', () => {
  held(parse(receipt(`${formats.suffix(101)}\n${formats.suffix(102)}\n明細番号 999 値引 ¥100\n明細番号 102 値引 ¥200`)));
});

test('generic inline No. text is not promoted into a product-line identifier', () => held(parse(receipt(body(formats.suffix).replace(/明細番号/g, 'No.')))));

for (const options of [{ count: 0 }, { count: 3 }, { paid: false }, { net: 1699 }]) test(`new layouts cannot bypass accounting: ${JSON.stringify(options)}`, () => held(parse(receipt(body(formats.post), options))));

test('postfix discounts preserve tax allocation', () => assigned(parse(receipt(body(formats.post), { tax: 136 })), [100, 200], [972, 864]));

test('a name and identifier without a printed price never creates a 101-yen original', () => {
  const p = parse('テスト商店\n緑茶 明細番号 101\nクーポン割引 ¥50\n合計 ¥51\n楽天ペイ ¥51');
  assert.equal(p.itemRows.length, 0);
  assert.equal(p.itemSetComplete, false);
});

test('inline identifier coordinates cannot become an original-price anchor', () => {
  const blocks = [{ paragraphs: [{ lines: [{ text: '緑茶 明細番号 101', bbox: { x0: 80, y0: 620, x1: 900, y1: 660 }, words: [] }] }] }];
  assert.equal(runtime().context.receiptInternals.anchoredProductLineFromBlocks(blocks, 'クーポン割引 ¥50\n合計 ¥51', 1000, 1800), null);
});

test('an actual inline original price remains available for the coordinate anchor', () => {
  const blocks = [{ paragraphs: [{ lines: [{ text: '緑茶 ¥101 明細番号 999', bbox: { x0: 80, y0: 620, x1: 900, y1: 660 }, words: [] }] }] }];
  const anchor = runtime().context.receiptInternals.anchoredProductLineFromBlocks(blocks, 'クーポン割引 ¥50\n合計 ¥51', 1000, 1800);
  assert(anchor);
  assert.equal(anchor.value, 101);
});

test('new layouts preserve existing transactions, dictionary and schema', () => {
  const r = runtime();
  r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'unrelated', name: '学習商品', priceHints: [73], source: 'learned', confirmedCount: 4 }]);
  r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);
  const before = r.evaluate('JSON.stringify(state)');
  assigned(parse(receipt(body(formats.suffix)), r));
  assigned(parse(receipt(body(formats.post)), r));
  held(parse(receipt(body(formats.post).replace('102', '101')), r));
  assert.equal(r.evaluate('JSON.stringify(state)'), before);
  assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);
  assert.equal(r.writes.length, 0);
  assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});

for (const [layout, items] of [
  ['postfix', body(formats.post)],
  ['inline', body(formats.suffix)],
  ['inline remote references', `${formats.suffix(101)}\n${formats.suffix(102)}\n明細番号 102 値引 ¥200\n明細番号 101 値引 ¥100`]
]) test(`mock OCR preserves ${layout} identity through the complete parser`, async () => {
  const r = runtime(), a = r.context.receiptInternals;
  const text = receipt(items);
  let terminated = 0;
  r.context.Tesseract = { async createWorker() { return {
    async setParameters() {}, async recognize() { return { data: { text, blocks: [] } }; }, async terminate() { terminated++; }
  }; } };
  const canvas = { width: 100, height: 300 };
  const ocr = await a.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'middle', canvas }, { role: 'bottom', canvas }], shopSlices: [], itemSlices: Array.from({ length: 7 }, () => ({ canvas })), amountSlices: [], paymentSlices: [] });
  assigned(parse(ocr, r));
  assert.equal(terminated, 1);
  assert.equal(r.writes.length, 0);
});

test('postfix IDs attach after a standalone price without becoming its name', () => {
  assigned(parse(receipt(body(id => `緑茶\n¥1,000\n明細番号 ${id}`))));
});

test('postfix IDs attach after a complete quantity-price descriptor', () => {
  const p = parse(receipt(body(id => `緑茶\n@500 2 1000\n明細番号 ${id}`), { count: 4 }));
  assert.equal(p.discountAttributionConfirmed, true);
  assert.deepEqual(Array.from(p.itemRows, r => [r.receiptLineId, r.qty, r.unitPrice, r.total]), [['101', 2, 500, 1000], ['102', 2, 500, 1000]]);
  assert.deepEqual(Array.from(p.splitRows, r => [r.discount, r.gross]), [[100, 900], [200, 800]]);
});

test('ambiguous diagnostic evidence cannot be bypassed by a readable inline OCR pass', () => {
  const ambiguous = `緑茶\n${code} 1 ¥1,000\n明細番号 101\n緑茶\n${code} 1 ¥1,000\n明細番号 102\n明細番号 101 値引 ¥100\n明細番号 102 値引 ¥200`;
  held(parse({ text: receipt(body(formats.suffix)), diagnostics: [{ label: '全体', text: receipt(ambiguous) }] }));
});
