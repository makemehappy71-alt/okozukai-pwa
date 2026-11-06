const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const code = '2200083271771';
const merchandise = `緑茶\n${code} 1 ¥1,000`;
const formats = {
  round: id => `(明細番号 ${id})\n${merchandise}`,
  square: id => `[明細番号 ${id}]\n${merchandise}`,
  japanese: id => `【明細番号 ${id}】\n${merchandise}`,
  value: id => `明細番号 (${id})\n${merchandise}`,
  inline: id => `緑茶 ¥1,000 (明細番号 ${id})`,
  wrappedPrefix: id => `(明細番号 ${id}) 緑茶\n${code} 1 ¥1,000`,
  post: id => `${merchandise}\n(明細番号 ${id})`,
  alpha: id => `明細ID ${id}\n${merchandise}`,
  alphaRound: id => `(明細ID ${id})\n${merchandise}`,
  alphaValue: id => `明細ID [${id}]\n${merchandise}`,
  alphaInline: id => `緑茶 (明細ID ${id})\n${code} 1 ¥1,000`,
  alphaPrefix: id => `[明細ID ${id}] 緑茶 ¥1,000`,
  alphaCode: id => `緑茶\n${code} 1 ¥1,000 【明細ID ${id}】`,
  alphaPost: id => `${merchandise}\n[明細ID ${id}]`
};
const body = (format, ids = ['101', '102'], discounts = [100, 200]) => ids.map((id, i) => `${format(id)}\n${discounts[i] ? '商品値引 ¥' + discounts[i] : '補足情報'}`).join('\n');
function receipt(items, { net = 1700, count = 2, tax = 0, paid = true } = {}) {
  return `テスト商店\n2026年11月07日\n${items}\n小計 ${count ? count + '点 ' : ''}¥${net}\n${tax ? '消費税 ¥' + tax + '\n' : ''}${paid ? '合計 ¥' + (net + tax) + '\n楽天ペイ ¥' + (net + tax) : ''}`;
}
const parse = (text, r = runtime()) => r.context.receiptFeature.parseReceiptText(text, '2026-11-07');
function assigned(p, ids = ['101', '102'], discounts = [100, 200], gross = [900, 800]) {
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

for (const [name, format] of Object.entries(formats)) test(`${name}: explicit bounded identifiers distinguish identical purchases`, () => {
  const ids = name.startsWith('alpha') ? ['A101', 'A102'] : ['101', '102'];
  assigned(parse(receipt(body(format, ids))), ids);
});

for (const label of ['明細No.', '明細ID']) test(`parenthesized numeric ${label} remains compatible`, () => assigned(parse(receipt(body(formats.round).replace(/明細番号/g, label)))));

test('full-width brackets, labels and tokens normalize without losing the token', () => {
  assigned(parse(receipt(body(id => `緑茶 （明細ＩＤ ${id}）\n${code} 1 ¥1,000`, ['Ａ１０１', 'Ａ１０２']))), ['A101', 'A102']);
});

for (const ids of [['A1O1', 'A101'], ['B1I1', 'B111'], ['C1l1', 'C111'], ['A001', 'A1'], ['A101', 'a101'], ['1E3', 'E1000']]) test(`ID tokens remain distinct: ${ids.join(' / ')}`, () => assigned(parse(receipt(body(formats.alphaInline, ids))), ids));

test('numeric leading zeros retain the existing numeric canonical form', () => assigned(parse(receipt(body(formats.round, ['000101', '000102'])))));

for (const name of ['round', 'alphaInline', 'alphaPost']) test(`${name}: raw and filtered extraction agree on names and IDs`, () => {
  const ids = name === 'round' ? ['101', '102'] : ['A1O1', 'A101'], a = runtime().context.receiptInternals, text = body(formats[name], ids);
  for (const input of [text, a.productSourceText(text)]) assert.deepEqual(Array.from(a.itemRowsFromText(input), r => [r.name, r.receiptLineId, r.total]), ids.map(id => ['緑茶', id, 1000]));
});

test('wrapped references target exact letter tokens before and after the discount', () => {
  const items = `${formats.alphaInline('A1O1')}\n${formats.alphaInline('A101')}\n(明細ID A1O1) 値引 ¥100\n商品値引 ¥200 [明細ID A101]`;
  assigned(parse(receipt(items)), ['A1O1', 'A101']);
});

test('a lone suffix reference uses its discount amount rather than digits from the ID', () => {
  assigned(parse(receipt(`${formats.alphaInline('A1O1')}\n${formats.alphaInline('A101')}\n値引 ¥100 (明細ID A1O1)`, { net: 1900 })), ['A1O1', 'A101'], [100, 0], [900, 1000]);
});

for (const name of ['round', 'alphaPost']) for (const selected of [0, 1]) test(`${name}: a single discount belongs only to occurrence ${selected + 1}`, () => {
  const ids = name === 'round' ? ['101', '102'] : ['A101', 'A102'], discounts = selected ? [0, 100] : [100, 0];
  assigned(parse(receipt(body(formats[name], ids, discounts), { net: 1900 })), ids, discounts, discounts.map(n => 1000 - n));
});

test('same-sized deductions on distinct wrapped IDs are not deduplicated', () => assigned(parse(receipt(body(formats.alphaInline, ['A101', 'A102'], [100, 100]), { net: 1800 })), ['A101', 'A102'], [100, 100], [900, 900]));

test('plain, wrapped and postfix OCR readings match only by the exact identifier', () => {
  const ids = ['A101', 'A102'];
  assigned(parse({ text: receipt(body(formats.alpha, ids)), whole: receipt(body(formats.alphaInline, ids)), itemText: receipt(body(formats.alphaPost, ids)) }), ids);
});

test('reversing OCR order keeps the per-ID deductions', () => {
  const p = parse({ text: receipt(body(formats.alphaInline, ['A101', 'A102'])), whole: receipt(body(formats.alphaPost, ['A102', 'A101'], [200, 100])) });
  assert.equal(p.discountAttributionConfirmed, true);
  assert.deepEqual(Object.fromEntries(Array.from(p.itemRows, (r, i) => [r.receiptLineId, p.splitRows[i].discount])), { A101: 100, A102: 200 });
});

for (const malformed of ['(明細番号 101]', '[明細番号 101)', '【明細番号 101)', '(明細番号 101', '明細番号 (101]', '明細番号 ((101))', '((明細番号 101))']) test(`malformed brackets remain manual: ${malformed}`, () => {
  held(parse(receipt(`${malformed}\n${merchandise}\n商品値引 ¥100\n${formats.round(102)}\n商品値引 ¥200`)));
});

for (const malformed of ['((明細ID A101)', '[(明細ID A101)']) test(`an extra opening bracket before an inline ID is not ignored: ${malformed}`, () => {
  held(parse(receipt(`緑茶 ${malformed}\n${code} 1 ¥1,000\n商品値引 ¥100\n${formats.alphaInline('A102')}\n商品値引 ¥200`)));
});

test('balanced product-name parentheses next to a wrapped ID remain valid', () => {
  const p = parse(receipt(body(formats.alphaInline, ['A101', 'A102']).replace(/緑茶 /g, '緑茶 (濃い味) ')));
  assert.equal(p.discountAttributionConfirmed, true);
  assert.deepEqual(Array.from(p.itemRows, r => r.receiptLineId), ['A101', 'A102']);
  assert.equal(p.itemRows.every(r => r.name.includes('濃い味')), true);
});

for (const id of ['ABC', 'A-101', 'A_101', 'A/101', 'ABCDEFGHIJKLMNOP1', '0', '1000001']) test(`unsupported ID ${id} is not shortened or repaired`, () => held(parse(receipt(body(formats.alphaInline, [id, 'A102'])))));

for (const label of ['明細番号', '明細No.']) test(`${label} does not reinterpret an O-like numeric error as an alphabetic ID`, () => held(parse(receipt(body(id => `緑茶 (${label} ${id})\n${code} 1 ¥1,000`, ['1O1', '102'])))));

test('an unlabelled parenthesized number is not a line identifier', () => held(parse(receipt(body(id => `緑茶 (${id})\n${code} 1 ¥1,000`)))));

for (const label of ['会員ID', '取引ID', 'No.']) test(`${label} is not promoted into a merchandise ID`, () => held(parse(receipt(body(formats.alphaInline, ['A101', 'A102']).replace(/明細ID/g, label)))));

test('repeated alphabetic IDs cannot distinguish purchases', () => held(parse(receipt(body(formats.alphaInline, ['A101', 'A101'])))));

test('case mismatch in a remote reference is not repaired', () => held(parse(receipt(`${formats.alphaInline('A101')}\n${formats.alphaInline('A102')}\n(明細ID a101) 値引 ¥100\n(明細ID A102) 値引 ¥200`))));

test('an O-to-zero mismatch in a reference is not repaired', () => held(parse(receipt(`${formats.alphaInline('A1O1')}\n${formats.alphaInline('A102')}\n(明細ID A101) 値引 ¥100\n(明細ID A102) 値引 ¥200`))));

test('a single malformed wrapped discount reference cannot fall back to general allocation', () => held(parse(receipt(`${formats.alphaInline('A101')}\n${formats.alphaInline('A102')}\n値引 ¥100 (明細ID A101]`, { net: 1900 }))));

test('conflicting assignments across wrapped OCR passes remain manual', () => held(parse({ text: receipt(body(formats.alphaInline, ['A101', 'A102'])), whole: receipt(body(formats.alphaPost, ['A101', 'A102'], [200, 100])) })));

test('a wrapped ID between two products has no inferred direction', () => held(parse(receipt(`${merchandise}\n(明細ID A101)\n${merchandise}\n(明細ID A102)\n(明細ID A101) 値引 ¥100\n(明細ID A102) 値引 ¥200`))));

for (const options of [{ count: 0 }, { count: 3 }, { paid: false }, { net: 1699 }]) test(`wrapped IDs cannot bypass accounting: ${JSON.stringify(options)}`, () => held(parse(receipt(body(formats.alphaInline, ['A101', 'A102']), options))));

test('tax allocation follows exact alphabetic identifiers', () => assigned(parse(receipt(body(formats.alphaInline, ['A101', 'A102']), { tax: 136 })), ['A101', 'A102'], [100, 200], [972, 864]));

test('a name and wrapped number without a price cannot become a synthetic original', () => {
  const p = parse('テスト商店\n緑茶 (明細番号 101)\nクーポン割引 ¥50\n合計 ¥51\n楽天ペイ ¥51');
  assert.equal(p.itemRows.length, 0);
  assert.equal(p.itemSetComplete, false);
});

test('a wrapped identifier is not a coordinate price anchor', () => {
  const blocks = [{ paragraphs: [{ lines: [{ text: '緑茶 (明細番号 101)', bbox: { x0: 80, y0: 620, x1: 900, y1: 660 }, words: [] }] }] }];
  assert.equal(runtime().context.receiptInternals.anchoredProductLineFromBlocks(blocks, 'クーポン割引 ¥50\n合計 ¥51', 1000, 1800), null);
});

test('natural product parentheses are preserved', () => {
  const rows = runtime().context.receiptInternals.itemRowsFromText('緑茶 (濃い味) ¥100');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name.includes('濃い味'), true);
  assert.equal(rows[0].receiptLineId, undefined);
});

test('learning cannot bypass a malformed wrapper', () => {
  const r = runtime();
  r.storage.set('okozukaiReceiptProductDictionaryV1', JSON.stringify([{ shopKey: 'テスト商', name: '緑茶', aliases: ['緑茶'], priceHints: [1000], source: 'learned', confirmedCount: 6 }]));
  held(parse(receipt(body(formats.alphaInline, ['A101', 'A102']).replace('(明細ID A101)', '(明細ID A101]')), r));
  assert.equal(r.writes.length, 0);
});

test('wrapped ID parsing preserves ledger, dictionary and schema', () => {
  const r = runtime();
  r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'unrelated', name: '学習商品', priceHints: [73], source: 'learned', confirmedCount: 4 }]);
  r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);
  const before = r.evaluate('JSON.stringify(state)');
  assigned(parse(receipt(body(formats.alphaInline, ['A101', 'A102'])), r), ['A101', 'A102']);
  held(parse(receipt(body(formats.alphaInline, ['A101', 'A101'])), r));
  assert.equal(r.evaluate('JSON.stringify(state)'), before);
  assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);
  assert.equal(r.writes.length, 0);
  assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});

for (const ids of [['A101', 'A102'], ['A1O1', 'A101'], ['A101', 'a101']]) test(`mock OCR retains exact wrapped IDs: ${ids.join(' / ')}`, async () => {
  const r = runtime(), a = r.context.receiptInternals, text = receipt(body(formats.alphaInline, ids));
  let terminated = 0;
  r.context.Tesseract = { async createWorker() { return { async setParameters() {}, async recognize() { return { data: { text, blocks: [] } }; }, async terminate() { terminated++; } }; } };
  const canvas = { width: 100, height: 300 };
  const ocr = await a.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'middle', canvas }, { role: 'bottom', canvas }], shopSlices: [], itemSlices: Array.from({ length: 7 }, () => ({ canvas })), amountSlices: [], paymentSlices: [] });
  assigned(parse(ocr, r), ids);
  assert.equal(terminated, 1);
  assert.equal(r.writes.length, 0);
});
