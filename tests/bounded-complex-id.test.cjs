const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const code = '2200083271771';
const merchandise = `緑茶\n${code} 1 ¥1,000`;
const formats = {
  whole: id => `(明細ID ${id})\n${merchandise}`,
  value: id => `明細ID [${id}]\n${merchandise}`,
  inline: id => `緑茶 (明細ID ${id})\n${code} 1 ¥1,000`,
  prefix: id => `[明細ID ${id}] 緑茶\n${code} 1 ¥1,000`,
  priced: id => `緑茶 ¥1,000 【明細ID ${id}】`,
  post: id => `${merchandise}\n[明細ID ${id}]`
};
const body = (format = formats.inline, ids = ['A 101', 'A  101'], discounts = [100, 200]) => ids.map((id, i) => `${format(id)}\n${discounts[i] ? '商品値引 ¥' + discounts[i] : '補足情報'}`).join('\n');
function receipt(items, { net = 1700, count = 2, paid = true, tax = 0 } = {}) {
  return `テスト商店\n2026年11月07日\n${items}\n小計 ${count ? count + '点 ' : ''}¥${net}\n${tax ? '消費税 ¥' + tax + '\n' : ''}${paid ? '合計 ¥' + (net + tax) + '\n楽天ペイ ¥' + (net + tax) : ''}`;
}
const parse = (text, r = runtime()) => r.context.receiptFeature.parseReceiptText(text, '2026-11-07');
function assigned(p, ids = ['A 101', 'A  101'], discounts = [100, 200], gross = [900, 800]) {
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

for (const [name, format] of Object.entries(formats)) test(`${name}: bounded one-space and two-space IDs stay distinct`, () => assigned(parse(receipt(body(format)))));

for (const ids of [['A--101', 'A__101'], ['A-_101', 'A_-101'], ['A - 101', 'A- 101'], ['101 01', '101  01'], ['A 101', 'A101'], ['A--101', 'A-101'], ['A 1O1', 'A 101']]) test(`literal bounded tokens are not repaired: ${ids.join(' / ')}`, () => assigned(parse(receipt(body(formats.inline, ids))), ids));

for (const name of ['whole', 'value', 'inline', 'post']) test(`${name}: direct and filtered extraction preserve internal spacing`, () => {
  const a = runtime().context.receiptInternals, text = body(formats[name]);
  for (const input of [text, a.productSourceText(text)]) assert.deepEqual(Array.from(a.itemRowsFromText(input), r => [r.name, r.receiptLineId]), [['緑茶', 'A 101'], ['緑茶', 'A  101']]);
});

test('NFKC-compatible full-width tokens preserve the number of spaces', () => {
  assigned(parse(receipt(body(formats.inline, ['Ａ　１０１', 'Ａ　　１０１']))));
});

test('prefix and suffix discount references preserve exact internal spaces', () => assigned(parse(receipt(`${formats.inline('A 101')}\n${formats.inline('A  101')}\n(明細ID A 101) 値引 ¥100\n商品値引 ¥200 [明細ID A  101]`))));

for (const selected of [0, 1]) test(`one deduction targets only the exact space count of occurrence ${selected + 1}`, () => {
  const ids = ['A 101', 'A  101'], discounts = selected ? [0, 100] : [100, 0];
  assigned(parse(receipt(`${formats.inline(ids[0])}\n${formats.inline(ids[1])}\n値引 ¥100 (明細ID ${ids[selected]})`, { net: 1900 })), ids, discounts, discounts.map(n => 1000 - n));
});

test('consecutive-separator references target their exact full token', () => {
  const ids = ['A--101', 'A__101'];
  assigned(parse(receipt(`${formats.inline(ids[0])}\n${formats.inline(ids[1])}\n(明細ID A--101) 値引 ¥100\n商品値引 ¥200 [明細ID A__101]`)), ids);
});

test('OCR layout differences do not change literal whitespace identity', () => assigned(parse({ text: receipt(body()), whole: receipt(body(formats.value)), itemText: receipt(body(formats.post)) })));

test('reversed OCR order preserves the exact whitespace allocation', () => {
  const p = parse({ text: receipt(body()), whole: receipt(body(formats.post, ['A  101', 'A 101'], [200, 100])) });
  assert.equal(p.discountAttributionConfirmed, true);
  assert.deepEqual(Object.fromEntries(Array.from(p.itemRows, (r, i) => [r.receiptLineId, p.splitRows[i].discount])), { 'A 101': 100, 'A  101': 200 });
});

for (const text of ['明細ID A1 01 緑茶', '明細ID A1 B2 緑茶', '明細番号 101 01 緑茶', '明細ID A1 Coca Cola']) test(`ambiguous unbounded suffix is not truncated: ${text}`, () => {
  held(parse(receipt(`${text}\n${code} 1 ¥1,000\n商品値引 ¥100\n${formats.inline('B2')}\n商品値引 ¥200`)));
});

for (const id of ['A 101', 'A--101', 'A__101', 'A - 101']) test(`an unbounded complex token ${id} is not inferred`, () => held(parse(receipt(`明細ID ${id}\n${merchandise}\n商品値引 ¥100\n${formats.inline('B2')}\n商品値引 ¥200`))));

for (const unknown of ['A101', 'A 101', 'A   101', 'a  101']) test(`reference ${JSON.stringify(unknown)} does not repair a two-space ID`, () => held(parse(receipt(`${formats.inline('A  101')}\n${formats.inline('B2')}\n(明細ID ${unknown}) 値引 ¥100\n(明細ID B2) 値引 ¥200`))));

test('a missing repeated separator is not inferred in a reference', () => held(parse(receipt(`${formats.inline('A--101')}\n${formats.inline('B2')}\n(明細ID A-101) 値引 ¥100\n(明細ID B2) 値引 ¥200`))));

test('unbounded references cannot select a bounded complex ID by partial prefix', () => held(parse(receipt(`${formats.inline('A1 01')}\n${formats.inline('B2')}\n明細ID A1 01 値引 ¥100\n(明細ID B2) 値引 ¥200`))));

test('a single ambiguous reference cannot fall back to general allocation', () => held(parse(receipt(`${formats.inline('A1')}\n${formats.inline('B2')}\n明細ID A1 01 値引 ¥100`, { net: 1900 }))));

test('a changed space count in another OCR pass remains manual', () => held(parse({ text: receipt(body()), whole: receipt(body(formats.inline, ['A 101', 'A   101'])) })));

test('a readable OCR pass cannot bypass a diagnostic that truncates an unbounded ID', () => {
  const ambiguous = `明細ID A1 01 緑茶\n${code} 1 ¥1,000\n商品値引 ¥100\n明細ID B2 02 緑茶\n${code} 1 ¥1,000\n商品値引 ¥200`;
  held(parse({ text: receipt(body(formats.inline, ['A1', 'B2'])), diagnostics: [{ label: '全体', text: receipt(ambiguous) }] }));
});

test('contradictory per-ID deductions across OCR passes remain manual', () => held(parse({ text: receipt(body()), whole: receipt(body(formats.value, undefined, [200, 100])) })));

test('duplicate bounded IDs cannot distinguish purchases', () => held(parse(receipt(body(formats.inline, ['A 101', 'A 101'])))));

for (const id of ['A\t101', 'A/ 101', '-A 101', 'A 101-', 'A 123456789012345', 'AB  CD']) test(`unsupported bounded token ${JSON.stringify(id)} is not repaired`, () => held(parse(receipt(body(formats.inline, [id, 'B2'])))));

for (const label of ['明細番号', '明細No.', '会員ID', '取引ID']) test(`${label} cannot become a complex merchandise identifier`, () => held(parse(receipt(body().replace(/明細ID/g, label)))));

test('mismatched brackets do not provide an ID boundary', () => held(parse(receipt(body().replace('(明細ID A 101)', '(明細ID A 101]')))));

test('unmatched direction between products remains manual', () => held(parse(receipt(`${merchandise}\n(明細ID A 101)\n${merchandise}\n(明細ID A  101)\n(明細ID A 101) 値引 ¥100\n(明細ID A  101) 値引 ¥200`))));

for (const options of [{ count: 0 }, { paid: false }, { net: 1699 }]) test(`bounded complex IDs do not bypass accounting: ${JSON.stringify(options)}`, () => held(parse(receipt(body(), options))));

test('tax follows the literal internal-space identifiers', () => assigned(parse(receipt(body(), { tax: 136 })), undefined, [100, 200], [972, 864]));

test('a price-free complex ID cannot become an original price', () => {
  const p = parse('テスト商店\n緑茶 (明細ID A 101)\nクーポン割引 ¥50\n合計 ¥51\n楽天ペイ ¥51');
  assert.equal(p.itemRows.length, 0);
  assert.equal(p.itemSetComplete, false);
});

test('learning cannot bypass ambiguous unbounded identifiers', () => {
  const r = runtime();
  r.storage.set('okozukaiReceiptProductDictionaryV1', JSON.stringify([{ shopKey: 'テスト商', name: '緑茶', aliases: ['緑茶'], priceHints: [1000], source: 'learned', confirmedCount: 6 }]));
  held(parse(receipt(`明細ID A1 01 緑茶\n${code} 1 ¥1,000\n商品値引 ¥100\n${formats.inline('B2')}\n商品値引 ¥200`), r));
  assert.equal(r.writes.length, 0);
});

test('complex-ID parsing preserves ledger, learning dictionary and schema', () => {
  const r = runtime();
  r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'unrelated', name: '学習商品', priceHints: [73], source: 'learned', confirmedCount: 4 }]);
  r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);
  const before = r.evaluate('JSON.stringify(state)');
  assigned(parse(receipt(body()), r));
  held(parse(receipt(body(formats.inline, ['A\t101', 'B2'])), r));
  assert.equal(r.evaluate('JSON.stringify(state)'), before);
  assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);
  assert.equal(r.writes.length, 0);
  assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});

for (const ids of [['A 101', 'A  101'], ['A 101', 'A101'], ['A--101', 'A__101']]) test(`mock OCR keeps complete identities: ${ids.join(' / ')}`, async () => {
  const r = runtime(), a = r.context.receiptInternals, text = receipt(body(formats.inline, ids));
  let terminated = 0;
  r.context.Tesseract = { async createWorker() { return { async setParameters() {}, async recognize() { return { data: { text, blocks: [] } }; }, async terminate() { terminated++; } }; } };
  const canvas = { width: 100, height: 300 };
  const ocr = await a.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'middle', canvas }, { role: 'bottom', canvas }], shopSlices: [], itemSlices: Array.from({ length: 7 }, () => ({ canvas })), amountSlices: [], paymentSlices: [] });
  assert(ocr.text.includes(`明細ID ${ids[0]}`));
  assert(ocr.text.includes(`明細ID ${ids[1]}`));
  assigned(parse(ocr, r), ids);
  assert.equal(terminated, 1);
  assert.equal(r.writes.length, 0);
});
