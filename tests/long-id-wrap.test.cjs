const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const code = '2200083271771';
const fold = id => id.split('').join('\n');
const part = id => `緑茶 (明細ID ${id})\n${code} 1 ¥1,000`;
const references = ids => `(明細ID ${ids[0]}) 値引 ¥100\n(明細ID ${ids[1]}) 値引 ¥200`;
const productBody = (ids = ['A101', 'B102']) => `${part(fold(ids[0]))}\n${part(fold(ids[1]))}\n${references(ids)}`;
const referenceBody = (ids = ['A101', 'B102']) => `${part(ids[0])}\n${part(ids[1])}\n(明細ID ${fold(ids[0])}) 値引 ¥100\n(明細ID ${fold(ids[1])}) 値引 ¥200`;
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

for (const length of [4, 5, 8, 16]) {
  const ids = ['A' + '1'.repeat(length - 1), 'B' + '2'.repeat(length - 1)];
  test(`${length} merchandise fragments use their exact complete references`, () => assigned(parse(receipt(productBody(ids))), ids));
  test(`${length} reference fragments use their exact complete priced IDs`, () => assigned(parse(receipt(referenceBody(ids))), ids));
}

for (const [open, close] of [['[', ']'], ['【', '】'], ['（', '）']]) test(`${open}${close} bounds four merchandise fragments`, () => assigned(parse(receipt(productBody().replace(/\(明細ID/g, open + '明細ID').replace(/\)/g, close)))));
test('value-only brackets can bound four ID fragments', () => assigned(parse(receipt(`明細ID [A\n1\n0\n1]\n緑茶\n${code} 1 ¥1,000\n明細ID [B\n1\n0\n2]\n緑茶\n${code} 1 ¥1,000\n${references(['A101', 'B102'])}`))));
test('postfix IDs can use four complete fragments', () => assigned(parse(receipt(`緑茶\n${code} 1 ¥1,000\n(明細ID A\n1\n0\n1)\n補足情報\n緑茶\n${code} 1 ¥1,000\n(明細ID B\n1\n0\n2)\n${references(['A101', 'B102'])}`))));
test('suffix references can wrap over four lines', () => assigned(parse(receipt(`${part('A101')}\n${part('B102')}\n値引 ¥100 (明細ID A\n1\n0\n1)\n値引 ¥200 (明細ID B\n1\n0\n2)`))));
test('printed separators remain literal across four fragments', () => assigned(parse(receipt(`${part('A-\n1_\n0_\n1')}\n${part('B_\n2-\n0-\n2')}\n${references(['A-1_0_1', 'B_2-0-2'])}`)), ['A-1_0_1', 'B_2-0-2']));
test('four numeric fragments retain their canonical complete IDs', () => assigned(parse(receipt(`${part('1\n0\n1\n1')}\n${part('1\n0\n2\n2')}\n${references(['1011', '1022'])}`)), ['1011', '1022']));
test('full-width fragments normalize like their full printed counterparts', () => assigned(parse(receipt(productBody(['Ａ１０１', 'Ｂ１０２'])))));
for (const newline of ['\n', '\r\n', '\r']) test(`${JSON.stringify(newline)} preserves four-line fold boundaries`, () => assigned(parse(receipt(productBody()).replace(/\n/g, newline))));
test('one folded reference gets its complete single deduction', () => assigned(parse(receipt(`${part('A101')}\n${part('B102')}\n(明細ID A\n1\n0\n1) 値引 ¥100`, { net: 1900 })), undefined, [100, 0], [900, 1000]));
test('one folded product needs its independent complete deduction reference', () => assigned(parse(receipt(`${part(fold('A101'))}\n${part('B102')}\n(明細ID A101) 値引 ¥100`, { net: 1900 })), undefined, [100, 0], [900, 1000]));
test('tax allocation follows the corroborated four-line IDs', () => assigned(parse(receipt(productBody(), { tax: 136 })), undefined, [100, 200], [972, 864]));
test('original OCR and caller objects retain all fold boundaries', () => {
  const input = { text: receipt(productBody()), whole: receipt(referenceBody()), diagnostics: [{ label: '全体', text: receipt(productBody()) }] };
  const before = JSON.stringify(input), p = parse(input);assigned(p);assert.equal(JSON.stringify(input), before);assert(p.rawText.includes(fold('A101')));assert(p.debugText.includes(fold('A101')));
});

test('four lines without a complete independent counterpart remain manual', () => held(parse(receipt(`${part(fold('A101'))}\n商品値引 ¥100\n${part(fold('B102'))}\n商品値引 ¥200`))));
test('both sides being long folds cannot corroborate themselves', () => held(parse(receipt(`${part(fold('A101'))}\n${part(fold('B102'))}\n(明細ID ${fold('A101')}) 値引 ¥100\n(明細ID ${fold('B102')}) 値引 ¥200`))));
test('a spaced complete spelling competing with the compact token remains manual', () => held(parse(receipt(`${part('A101')}\n${part('A 101')}\n(明細ID ${fold('A101')}) 値引 ¥100\n(明細ID A 101) 値引 ¥200`))));
test('a full counterpart found only in another OCR pass is insufficient', () => {
  const incomplete = receipt(`${part(fold('A101'))}\n商品値引 ¥100\n${part(fold('B102'))}\n商品値引 ¥200`);
  const complete = receipt(`${part('A101')}\n商品値引 ¥100\n${part('B102')}\n商品値引 ¥200`);held(parse({ text: incomplete, whole: complete }));
});
test('merged text cannot supply proof absent from actual recognition records', () => {
  const products = receipt(`${part(fold('A101'))}\n商品値引 ¥100\n${part(fold('B102'))}\n商品値引 ¥200`);
  const p = parse({ text: receipt(productBody()), diagnostics: [{ label: '分割 1', text: products }, { label: '分割 2', text: receipt(references(['A101', 'B102'])) }] });held(p);assert.equal(p.wrappedIdRecoveryCount || 0, 0);
});

for (const fragment of ['A\n1\n\t0\n1', 'A\n1\n\n0\n1', 'A \n1\n0\n1', 'A\n1\n0 \n1', 'A\n1\n消費税 ¥0\n1', 'A\n1\nNOTE\n0\n1', 'A\n1\n0\n1\n)']) test(`unsupported continuation is not repaired: ${JSON.stringify(fragment)}`, () => held(parse(receipt(`${part(fragment)}\n${part('B102')}\n${references(['A101', 'B102'])}`))));
test('the seventeenth character is not silently discarded', () => {
  const id = 'A' + '1'.repeat(16), p = parse(receipt(`${part(fold(id))}\n${part('B102')}\n${references(['A' + '1'.repeat(15), 'B102'])}`));held(p);assert.equal(p.wrappedIdRecoveryCount || 0, 0);
});
test('an oversized closing fragment is not truncated to the maximum ID length', () => held(parse(receipt(`${part('ABCD\n1234\n5678\n90123')}\n${part('B102')}\n${references(['ABCD123456789012', 'B102'])}`))));
test('a separate closing bracket is not used to extend the fragment grammar', () => held(parse(receipt(`${part('A\n1\n0\n1\n')}\n${part('B102')}\n${references(['A101', 'B102'])}`))));
test('a missing bracket cannot be reconstructed', () => held(parse(receipt(productBody().replace('0\n1)', '0\n1]')))));
test('an unbounded four-line token cannot be joined', () => held(parse(receipt(`明細ID A\n1\n0\n1\n緑茶\n${code} 1 ¥1,000\n${part('B102')}\n${references(['A101', 'B102'])}`))));
test('a complete footer token after checkout is not a witness', () => {
  const p = parse(receipt(`${part(fold('A101'))}\n商品値引 ¥100\n${part('B102')}\n商品値引 ¥200`) + '\n(明細ID A101) 値引 ¥100');held(p);assert.equal(p.wrappedIdRecoveryCount || 0, 0);
});
test('duplicate priced counterparts are not unique', () => held(parse(receipt(`${part('A101')}\n${part('A101')}\n(明細ID ${fold('A101')}) 値引 ¥300`))));
test('duplicate long folded merchandise IDs cannot share one complete reference', () => held(parse(receipt(`${part(fold('A101'))}\n${part(fold('A101'))}\n(明細ID A101) 値引 ¥300`))));
for (const options of [{ count: 0 }, { paid: false }, { net: 1699 }]) test(`long folds cannot bypass accounting: ${JSON.stringify(options)}`, () => held(parse(receipt(productBody(), options))));
test('contradictory deductions across OCR passes remain manual', () => held(parse({ text: receipt(productBody()), whole: receipt(referenceBody().replace('¥100', '¥200').replace(/¥200$/, '¥100')) })));

test('learning cannot replace a missing complete counterpart for four fragments', () => {
  const r = runtime();r.storage.set('okozukaiReceiptProductDictionaryV1', JSON.stringify([{ shopKey: 'テスト商', name: '緑茶', aliases: ['緑茶'], priceHints: [1000], source: 'learned', confirmedCount: 6 }]));
  held(parse(receipt(`${part(fold('A101'))}\n商品値引 ¥100\n${part('B102')}\n商品値引 ¥200`), r));assert.equal(r.writes.length, 0);
});
test('long-fold recovery preserves transactions, dictionary and schema', () => {
  const r = runtime();r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'unrelated', name: '学習商品', priceHints: [73], source: 'learned', confirmedCount: 4 }]);r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);
  const before = r.evaluate('JSON.stringify(state)');assigned(parse(receipt(productBody()), r));held(parse(receipt(productBody().replace('A\n1\n0\n1', 'A\n1\n\t0\n1')), r));
  assert.equal(r.evaluate('JSON.stringify(state)'), before);assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);assert.equal(r.writes.length, 0);assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});
for (const [name, items, valid] of [['merchandise', productBody(), true], ['references', referenceBody(), true], ['TAB continuation', productBody().replace('A\n1\n0\n1', 'A\n1\n\t0\n1'), false]]) test(`mock OCR checks long ${name} without guessing`, async () => {
  const r = runtime(), a = r.context.receiptInternals, text = receipt(items);let terminated = 0;
  r.context.Tesseract = { async createWorker() { return { async setParameters() {}, async recognize() { return { data: { text, blocks: [] } }; }, async terminate() { terminated++; } }; } };
  const canvas = { width: 100, height: 300 };
  const ocr = await a.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'middle', canvas }, { role: 'bottom', canvas }], shopSlices: [], itemSlices: Array.from({ length: 7 }, () => ({ canvas })), amountSlices: [], paymentSlices: [] });
  const p = parse(ocr, r);if (valid) assigned(p);else held(p);assert.equal(terminated, 1);assert.equal(r.writes.length, 0);
});
