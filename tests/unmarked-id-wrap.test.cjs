const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const code = '2200083271771';
const part = id => `緑茶 (明細ID ${id})\n${code} 1 ¥1,000`;
const refs = '(明細ID A101) 値引 ¥100\n(明細ID B102) 値引 ¥200';
const foldedProducts = `${part('A\n101')}\n${part('B\n102')}\n${refs}`;
const foldedRefs = `${part('A101')}\n${part('B102')}\n(明細ID A\n101) 値引 ¥100\n(明細ID B\n102) 値引 ¥200`;
function receipt(items, { net = 1700, count = 2, paid = true, tax = 0 } = {}) {
  return `テスト商店\n2026年11月07日\n${items}\n小計 ${count ? count + '点 ' : ''}¥${net}\n${tax ? '消費税 ¥' + tax + '\n' : ''}${paid ? '合計 ¥' + (net + tax) + '\n楽天ペイ ¥' + (net + tax) : ''}`;
}
const parse = (text, r = runtime()) => r.context.receiptFeature.parseReceiptText(text, '2026-11-07');
function assigned(p, ids = ['A101', 'B102'], discounts = [100, 200], gross = [900, 800]) {
  assert.equal(p.discountAttributionConfirmed, true);
  assert.equal(p.discountReviewRequired, false);
  assert.equal(p.itemSetComplete, true);
  assert.deepEqual(Array.from(p.itemRows, r => [r.name, r.receiptLineId, r.qty, r.total]), ids.map(id => ['緑茶', id, 1, 1000]));
  assert.deepEqual(Array.from(p.splitRows, r => [r.discount, r.gross]), discounts.map((n, i) => [n, gross[i]]));
  assert(p.wrappedIdRecoveryCount > 0);
}
function held(p) {
  assert.equal(p.discountAttributionConfirmed, false);
  assert.equal(p.discountReviewRequired, true);
  assert.equal(p.itemSetComplete, false);
  assert.equal(p.autoConfirmedItemCount, 0);
  assert.equal(p.productCandidateAutoConfirmed, false);
  assert.equal(p.splitRows.length, 0);
}

test('unmarked folded product IDs require exact complete references', () => assigned(parse(receipt(foldedProducts))));
test('unmarked folded references require exact complete priced product IDs', () => assigned(parse(receipt(foldedRefs))));

for (const [open, close] of [['(', ')'], ['[', ']'], ['【', '】'], ['（', '）']]) test(`${open}${close} bounds an unmarked fold`, () => assigned(parse(receipt(foldedProducts.replace(/\(明細ID/g, open + '明細ID').replace(/\)/g, close)))));

test('value-only brackets identify the complete folded token', () => assigned(parse(receipt(`明細ID [A\n101]\n緑茶\n${code} 1 ¥1,000\n明細ID [B\n102]\n緑茶\n${code} 1 ¥1,000\n${refs}`))));
test('a bracket before the product name provides a unique priced row', () => assigned(parse(receipt(`(明細ID A\n101) 緑茶\n${code} 1 ¥1,000\n(明細ID B\n102) 緑茶\n${code} 1 ¥1,000\n${refs}`))));
test('an unmarked postfix fold can use its complete individual reference', () => assigned(parse(receipt(`緑茶\n${code} 1 ¥1,000\n(明細ID A\n101)\n補足情報\n緑茶\n${code} 1 ¥1,000\n(明細ID B\n102)\n${refs}`))));
test('suffix references can fold without a continuation symbol', () => assigned(parse(receipt(`${part('A101')}\n${part('B102')}\n値引 ¥100 (明細ID A\n101)\n値引 ¥200 (明細ID B\n102)`))));
test('all three fragments can end in alphanumeric characters', () => assigned(parse(receipt(`${part('A\n10\n1')}\n${part('B\n10\n2')}\n${refs}`))));
test('an existing separator inside the token is preserved without inventing one', () => assigned(parse(receipt(`${part('A-1\n01')}\n${part('B_1\n02')}\n(明細ID A-101) 値引 ¥100\n(明細ID B_102) 値引 ¥200`)), ['A-101', 'B_102']));
test('a canonical numeric ID can be matched to its complete printed token', () => assigned(parse(receipt(`${part('10\n1')}\n${part('10\n2')}\n(明細ID 101) 値引 ¥100\n(明細ID 102) 値引 ¥200`)), ['101', '102']));

for (const newline of ['\n', '\r\n', '\r']) test(`unmarked folds preserve ${JSON.stringify(newline)} boundaries`, () => assigned(parse(receipt(foldedProducts).replace(/\n/g, newline))));
test('full-width fragments and witnesses share the existing NFKC normalization', () => assigned(parse(receipt(foldedProducts.replace(/A/g, 'Ａ').replace(/B/g, 'Ｂ').replace(/101/g, '１０１').replace(/102/g, '１０２')))));

test('a single folded reference targets only its exact product', () => assigned(parse(receipt(`${part('A101')}\n${part('B102')}\n(明細ID A\n101) 値引 ¥100`, { net: 1900 })), undefined, [100, 0], [900, 1000]));
test('a single folded product needs its complete deduction reference', () => assigned(parse(receipt(`${part('A\n101')}\n${part('B102')}\n(明細ID A101) 値引 ¥100`, { net: 1900 })), undefined, [100, 0], [900, 1000]));
test('tax allocation follows the independently corroborated IDs', () => assigned(parse(receipt(foldedProducts, { tax: 136 })), undefined, [100, 200], [972, 864]));

test('normal and folded OCR layouts agree without changing caller text', () => {
  const input = { text: receipt(foldedProducts), whole: receipt(foldedRefs), diagnostics: [{ label: '全体', text: receipt(foldedProducts) }] };
  const before = JSON.stringify(input), p = parse(input);assigned(p);
  assert.equal(JSON.stringify(input), before);
  assert(p.rawText.includes('A\n101'));
  assert(p.debugText.includes('A\n101'));
});

test('brackets without a complete independent spelling are insufficient', () => held(parse(receipt(`${part('A\n101')}\n商品値引 ¥100\n${part('B\n102')}\n商品値引 ¥200`))));
test('two folded sides cannot corroborate themselves', () => held(parse(receipt(`${part('A\n101')}\n${part('B\n102')}\n(明細ID A\n101) 値引 ¥100\n(明細ID B\n102) 値引 ¥200`))));
test('a compact ID competing with its spaced form remains manual', () => held(parse(receipt(`${part('A101')}\n${part('A 101')}\n(明細ID A\n101) 値引 ¥100\n(明細ID A 101) 値引 ¥200`))));
test('a spaced spelling alone does not justify inserting an ID character', () => held(parse(receipt(`${part('A\n101')}\n${part('B102')}\n(明細ID A 101) 値引 ¥100\n(明細ID B102) 値引 ¥200`))));

test('different OCR passes alone cannot supply the missing counterpart', () => {
  const incomplete = `${part('A\n101')}\n商品値引 ¥100\n${part('B\n102')}\n商品値引 ¥200`;
  const complete = `${part('A101')}\n商品値引 ¥100\n${part('B102')}\n商品値引 ¥200`;
  held(parse({ text: receipt(incomplete), whole: receipt(complete) }));
});
test('merged text cannot fabricate proof missing from actual recognition records', () => {
  const products = `${part('A\n101')}\n商品値引 ¥100\n${part('B\n102')}\n商品値引 ¥200`;
  const p = parse({ text: receipt(foldedProducts), diagnostics: [{ label: '分割 1', text: receipt(products) }, { label: '分割 2', text: receipt(refs) }] });
  held(p);assert.equal(p.wrappedIdRecoveryCount || 0, 0);
});

for (const fragment of ['A \n101', 'A　\n101', 'A\n10 \n1', 'A\t\n101', 'A\n\t101', 'A\n\n101', 'A\n1\n0\n1', 'A 1\n01', 'A\nNOTE\n101']) test(`ambiguous continuation is not repaired: ${JSON.stringify(fragment)}`, () => held(parse(receipt(`${part(fragment)}\n${part('B102')}\n${refs}`))));
test('numeric leading zeros are not guessed away during restoration', () => held(parse(receipt(`${part('00\n0101')}\n${part('B102')}\n(明細ID 101) 値引 ¥100\n(明細ID B102) 値引 ¥200`))));
test('a broken bracket cannot delimit a folded ID', () => held(parse(receipt(foldedProducts.replace('101)', '101]')))));
test('an unbounded token cannot be joined from neighbouring lines', () => held(parse(receipt(`明細ID A\n101\n緑茶\n${code} 1 ¥1,000\n${part('B102')}\n${refs}`))));

for (const different of ['a101', 'A1O1', 'A-101']) test(`complete spelling ${different} does not repair A101`, () => held(parse(receipt(foldedProducts.replace('(明細ID A101) 値引', `(明細ID ${different}) 値引`)))));
test('duplicated complete product IDs are not unique counterparts', () => held(parse(receipt(`${part('A101')}\n${part('A101')}\n(明細ID A\n101) 値引 ¥300`))));
test('an arbitrary complete label cannot replace a priced product witness', () => held(parse(receipt(`補足情報\n明細ID A101\n補足情報\n${part('B102')}\n(明細ID A\n101) 値引 ¥100\n(明細ID B102) 値引 ¥200`))));
test('a reference after checkout cannot corroborate a merchandise fold', () => {
  const p = parse(receipt(`${part('A\n101')}\n商品値引 ¥100\n${part('B102')}\n商品値引 ¥200`) + '\n(明細ID A101) 値引 ¥100');
  held(p);assert.equal(p.wrappedIdRecoveryCount || 0, 0);
});
for (const options of [{ count: 0 }, { paid: false }, { net: 1699 }]) test(`a restored spelling cannot replace accounting: ${JSON.stringify(options)}`, () => held(parse(receipt(foldedProducts, options))));

test('learning cannot supply a missing complete ID', () => {
  const r = runtime();r.storage.set('okozukaiReceiptProductDictionaryV1', JSON.stringify([{ shopKey: 'テスト商', name: '緑茶', aliases: ['緑茶'], priceHints: [1000], source: 'learned', confirmedCount: 6 }]));
  held(parse(receipt(`${part('A\n101')}\n商品値引 ¥100\n${part('B102')}\n商品値引 ¥200`), r));assert.equal(r.writes.length, 0);
});
test('unmarked recovery preserves transactions, dictionary and schema', () => {
  const r = runtime();r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'unrelated', name: '学習商品', priceHints: [73], source: 'learned', confirmedCount: 4 }]);r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);
  const before = r.evaluate('JSON.stringify(state)');assigned(parse(receipt(foldedProducts), r));held(parse(receipt(foldedProducts.replace('A\n101', 'A\n\t101')), r));
  assert.equal(r.evaluate('JSON.stringify(state)'), before);assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);assert.equal(r.writes.length, 0);assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});

for (const [name, items, valid] of [['merchandise', foldedProducts, true], ['references', foldedRefs, true], ['TAB continuation', foldedProducts.replace('A\n101', 'A\n\t101'), false]]) test(`mock OCR checks unmarked ${name} without guessing`, async () => {
  const r = runtime(), a = r.context.receiptInternals, text = receipt(items);let terminated = 0;
  r.context.Tesseract = { async createWorker() { return { async setParameters() {}, async recognize() { return { data: { text, blocks: [] } }; }, async terminate() { terminated++; } }; } };
  const canvas = { width: 100, height: 300 };
  const ocr = await a.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'middle', canvas }, { role: 'bottom', canvas }], shopSlices: [], itemSlices: Array.from({ length: 7 }, () => ({ canvas })), amountSlices: [], paymentSlices: [] });
  const p = parse(ocr, r);if (valid) assigned(p);else held(p);assert.equal(terminated, 1);assert.equal(r.writes.length, 0);
});
