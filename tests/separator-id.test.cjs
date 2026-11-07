const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const code = '2200083271771';
const merchandise = `緑茶\n${code} 1 ¥1,000`;
const formats = {
  plain: id => `明細ID ${id}\n${merchandise}`,
  wrapped: id => `(明細ID ${id})\n${merchandise}`,
  value: id => `明細ID [${id}]\n${merchandise}`,
  inline: id => `緑茶 (明細ID ${id})\n${code} 1 ¥1,000`,
  priced: id => `緑茶 ¥1,000 [明細ID ${id}]`,
  prefix: id => `[明細ID ${id}] 緑茶\n${code} 1 ¥1,000`,
  plainPrefix: id => `明細ID ${id} 緑茶\n${code} 1 ¥1,000`,
  code: id => `緑茶\n${code} 1 ¥1,000 【明細ID ${id}】`,
  post: id => `${merchandise}\n[明細ID ${id}]`
};
const body = (format = formats.inline, ids = ['A-101', 'A_101'], discounts = [100, 200]) => ids.map((id, i) => `${format(id)}\n${discounts[i] ? '商品値引 ¥' + discounts[i] : '補足情報'}`).join('\n');
function receipt(items, { net = 1700, count = 2, paid = true, tax = 0 } = {}) {
  return `テスト商店\n2026年11月07日\n${items}\n小計 ${count ? count + '点 ' : ''}¥${net}\n${tax ? '消費税 ¥' + tax + '\n' : ''}${paid ? '合計 ¥' + (net + tax) + '\n楽天ペイ ¥' + (net + tax) : ''}`;
}
const parse = (text, r = runtime()) => r.context.receiptFeature.parseReceiptText(text, '2026-11-07');
function assigned(p, ids = ['A-101', 'A_101'], discounts = [100, 200], gross = [900, 800]) {
  assert.equal(p.discountAttributionConfirmed, true);
  assert.equal(p.discountReviewRequired, false);
  assert.equal(p.itemSetComplete, true);
  assert.deepEqual(Array.from(p.itemRows, r => [r.name, r.receiptLineId, r.qty, r.total]), ids.map(id => ['緑茶', id, 1, 1000]));
  assert.deepEqual(Array.from(p.splitRows, r => r.discount), discounts);
  assert.deepEqual(Array.from(p.splitRows, r => r.gross), gross);
}
function held(p) {
  assert.equal(p.discountAttributionConfirmed, false);
  assert.equal(p.discountReviewRequired, true);
  assert.equal(p.itemSetComplete, false);
  assert.equal(p.autoConfirmedItemCount, 0);
  assert.equal(p.productCandidateAutoConfirmed, false);
  assert.equal(p.splitRows.length, 0);
}

for (const [name, format] of Object.entries(formats)) test(`${name}: hyphen and underscore distinguish otherwise identical lines`, () => assigned(parse(receipt(body(format)))));

for (const ids of [['101-1', '101_1'], ['001-01', '1-1'], ['A-1_B2', 'A_1-B2'], ['A-101', 'a-101'], ['A-1O1', 'A-101'], ['B_1I1', 'B_111'], ['A1234567890123-4', 'B_102']]) test(`opaque separated tokens remain distinct: ${ids.join(' / ')}`, () => assigned(parse(receipt(body(formats.inline, ids))), ids));

test('NFKC-compatible full-width separators normalize without removing them', () => assigned(parse(receipt(body(formats.inline, ['Ａ－１０１', 'Ａ＿１０１'])))));

for (const name of ['plain', 'inline', 'post']) test(`${name}: source filtering retains full separator IDs`, () => {
  const a = runtime().context.receiptInternals, text = body(formats[name]);
  for (const input of [text, a.productSourceText(text)]) assert.deepEqual(Array.from(a.itemRowsFromText(input), r => [r.name, r.receiptLineId, r.total]), [['緑茶', 'A-101', 1000], ['緑茶', 'A_101', 1000]]);
});

test('remote prefix and suffix references match exact separators', () => assigned(parse(receipt(`${formats.inline('A-101')}\n${formats.inline('A_101')}\n(明細ID A-101) 値引 ¥100\n商品値引 ¥200 [明細ID A_101]`))));

for (const selected of [0, 1]) test(`one remote deduction belongs only to separator occurrence ${selected + 1}`, () => {
  const ids = ['A-101', 'A_101'], discounts = selected ? [0, 100] : [100, 0];
  assigned(parse(receipt(`${formats.inline(ids[0])}\n${formats.inline(ids[1])}\n値引 ¥100 (明細ID ${ids[selected]})`, { net: 1900 })), ids, discounts, discounts.map(n => 1000 - n));
});

test('equal deductions on distinct separator IDs are separate occurrences', () => assigned(parse(receipt(body(formats.inline, undefined, [100, 100]), { net: 1800 })), undefined, [100, 100], [900, 900]));

test('OCR passes can differ in layout without changing separator identity', () => assigned(parse({ text: receipt(body(formats.inline)), whole: receipt(body(formats.post)), itemText: receipt(body(formats.plain)) })));

test('reversed OCR order does not swap per-ID deductions', () => {
  const p = parse({ text: receipt(body()), whole: receipt(body(formats.post, ['A_101', 'A-101'], [200, 100])) });
  assert.equal(p.discountAttributionConfirmed, true);
  assert.deepEqual(Object.fromEntries(Array.from(p.itemRows, (r, i) => [r.receiptLineId, p.splitRows[i].discount])), { 'A-101': 100, A_101: 200 });
});

for (const unknown of ['A101', 'A_101', 'a-101', 'A−101']) test(`a mismatched reference ${unknown} is not repaired`, () => {
  const ids = ['A-101', 'B_102'];
  held(parse(receipt(`${formats.inline(ids[0])}\n${formats.inline(ids[1])}\n(明細ID ${unknown}) 値引 ¥100\n(明細ID B_102) 値引 ¥200`)));
});

test('an ID that loses a separator in another OCR pass remains manual', () => held(parse({ text: receipt(body()), whole: receipt(body(formats.inline, ['A101', 'A_101'])) })));

test('contradictory separator assignments across OCR passes remain manual', () => held(parse({ text: receipt(body()), whole: receipt(body(formats.post, undefined, [200, 100])) })));

test('duplicate separated IDs cannot identify two purchases', () => held(parse(receipt(body(formats.inline, ['A-101', 'A-101'])))));

for (const id of ['-A101', '_A101', 'A101-', 'A101_', 'A--101', 'A__101', 'A-_101', 'A_-101', 'A/101', 'A−101', 'A‐101', 'A–101', 'Aー101', 'A12345678901234-5', 'AB-CD']) test(`unsupported separator token ${id} is not repaired or truncated`, () => held(parse(receipt(body(formats.inline, [id, 'B_102'])))));

for (const id of ['A1 -01', 'A1 _01', 'A- 101', 'A_ 101', 'A - 101']) test(`internal whitespace is not joined: ${id}`, () => held(parse(receipt(body(formats.plain, [id, 'B_102'])))));

for (const label of ['明細番号', '明細No.', '会員ID', '取引ID', 'No.']) test(`${label} cannot promote separated tokens into a merchandise ID`, () => held(parse(receipt(body().replace(/明細ID/g, label)))));

test('a single malformed reference cannot fall back to proportional allocation', () => held(parse(receipt(`${formats.inline('A-101')}\n${formats.inline('A_101')}\n値引 ¥100 (明細ID A--101)`, { net: 1900 }))));

test('a separator ID between two products has no inferred direction', () => held(parse(receipt(`${merchandise}\n(明細ID A-101)\n${merchandise}\n(明細ID A_101)\n(明細ID A-101) 値引 ¥100\n(明細ID A_101) 値引 ¥200`))));

for (const options of [{ count: 0 }, { paid: false }, { net: 1699 }]) test(`separator IDs cannot replace missing accounting: ${JSON.stringify(options)}`, () => held(parse(receipt(body(), options))));

test('tax follows the exact separator-specific deductions', () => assigned(parse(receipt(body(), { tax: 136 })), undefined, [100, 200], [972, 864]));

test('a price-free separator ID cannot create a synthetic original price', () => {
  const p = parse('テスト商店\n緑茶 (明細ID A-101)\nクーポン割引 ¥50\n合計 ¥51\n楽天ペイ ¥51');
  assert.equal(p.itemRows.length, 0);
  assert.equal(p.itemSetComplete, false);
});

test('learning cannot bypass a malformed separator ID', () => {
  const r = runtime();
  r.storage.set('okozukaiReceiptProductDictionaryV1', JSON.stringify([{ shopKey: 'テスト商', name: '緑茶', aliases: ['緑茶'], priceHints: [1000], source: 'learned', confirmedCount: 6 }]));
  held(parse(receipt(body(formats.inline, ['A--101', 'A_101'])), r));
  assert.equal(r.writes.length, 0);
});

test('separator IDs preserve ledger, dictionary and schema', () => {
  const r = runtime();
  r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'unrelated', name: '学習商品', priceHints: [73], source: 'learned', confirmedCount: 4 }]);
  r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);
  const before = r.evaluate('JSON.stringify(state)');
  assigned(parse(receipt(body()), r));
  held(parse(receipt(body(formats.inline, ['A--101', 'A_101'])), r));
  assert.equal(r.evaluate('JSON.stringify(state)'), before);
  assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);
  assert.equal(r.writes.length, 0);
  assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});

for (const ids of [['A-101', 'A_101'], ['A-1O1', 'A-101']]) test(`mock OCR retains separator identity: ${ids.join(' / ')}`, async () => {
  const r = runtime(), a = r.context.receiptInternals, text = receipt(body(formats.inline, ids));
  let terminated = 0;
  r.context.Tesseract = { async createWorker() { return { async setParameters() {}, async recognize() { return { data: { text, blocks: [] } }; }, async terminate() { terminated++; } }; } };
  const canvas = { width: 100, height: 300 };
  const ocr = await a.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'middle', canvas }, { role: 'bottom', canvas }], shopSlices: [], itemSlices: Array.from({ length: 7 }, () => ({ canvas })), amountSlices: [], paymentSlices: [] });
  assigned(parse(ocr, r), ids);
  assert.equal(terminated, 1);
  assert.equal(r.writes.length, 0);
});
