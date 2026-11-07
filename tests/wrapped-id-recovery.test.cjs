const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const code = '2200083271771';
const part = id => `緑茶 (明細ID ${id})\n${code} 1 ¥1,000`;
const refs = '(明細ID A-101) 値引 ¥100\n(明細ID B_102) 値引 ¥200';
const foldedProducts = `${part('A-\n101')}\n${part('B_\n102')}\n${refs}`;
const foldedRefs = `${part('A-101')}\n${part('B_102')}\n(明細ID A-\n101) 値引 ¥100\n(明細ID B_\n102) 値引 ¥200`;
function receipt(items, { net = 1700, count = 2, paid = true, tax = 0 } = {}) {
  return `テスト商店\n2026年11月07日\n${items}\n小計 ${count ? count + '点 ' : ''}¥${net}\n${tax ? '消費税 ¥' + tax + '\n' : ''}${paid ? '合計 ¥' + (net + tax) + '\n楽天ペイ ¥' + (net + tax) : ''}`;
}
const parse = (text, r = runtime()) => r.context.receiptFeature.parseReceiptText(text, '2026-11-07');
function assigned(p, ids = ['A-101', 'B_102'], discounts = [100, 200], gross = [900, 800]) {
  assert.equal(p.discountAttributionConfirmed, true);
  assert.equal(p.discountReviewRequired, false);
  assert.equal(p.itemSetComplete, true);
  assert.deepEqual(Array.from(p.itemRows, r => [r.name, r.receiptLineId, r.qty, r.total]), ids.map(id => ['緑茶', id, 1, 1000]));
  assert.deepEqual(Array.from(p.splitRows, r => r.discount), discounts);
  assert.deepEqual(Array.from(p.splitRows, r => r.gross), gross);
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

test('folded merchandise IDs require exact complete printed discount references', () => assigned(parse(receipt(foldedProducts))));
test('folded references require exact complete IDs on priced products', () => assigned(parse(receipt(foldedRefs))));

for (const [open, close] of [['(', ')'], ['[', ']'], ['【', '】'], ['（', '）']]) test(`${open}${close} supplies matching fold boundaries`, () => {
  assigned(parse(receipt(foldedProducts.replace(/\(明細ID/g, open + '明細ID').replace(/\)/g, close))));
});

test('a value-only bracket can bound a folded product ID', () => {
  const body = `明細ID [A-\n101]\n緑茶\n${code} 1 ¥1,000\n明細ID [B_\n102]\n緑茶\n${code} 1 ¥1,000\n${refs}`;
  assigned(parse(receipt(body)));
});

test('a matching bracket before the product name provides a unique row', () => assigned(parse(receipt(`(明細ID A-\n101) 緑茶\n${code} 1 ¥1,000\n(明細ID B_\n102) 緑茶\n${code} 1 ¥1,000\n${refs}`))));

test('postfix folded IDs can be corroborated by complete references', () => assigned(parse(receipt(`緑茶\n${code} 1 ¥1,000\n(明細ID A-\n101)\n補足情報\n緑茶\n${code} 1 ¥1,000\n(明細ID B_\n102)\n${refs}`))));

test('suffix references can wrap when the product ID is complete', () => assigned(parse(receipt(`${part('A-101')}\n${part('B_102')}\n値引 ¥100 (明細ID A-\n101)\n値引 ¥200 (明細ID B_\n102)`))));

test('three-line fragments preserve their printed separators', () => {
  const body = `${part('A-\n10_\n1')}\n${part('B_\n102')}\n(明細ID A-10_1) 値引 ¥100\n(明細ID B_102) 値引 ¥200`;
  assigned(parse(receipt(body)), ['A-10_1', 'B_102']);
});

test('numeric structured IDs remain opaque tokens', () => {
  const body = `${part('001-\n01')}\n${part('002_\n02')}\n(明細ID 001-01) 値引 ¥100\n(明細ID 002_02) 値引 ¥200`;
  assigned(parse(receipt(body)), ['001-01', '002_02']);
});

test('full-width fragments and their complete printed witnesses normalize consistently', () => {
  const body = foldedProducts.replace(/A-/g, 'Ａ－').replace(/B_/g, 'Ｂ＿').replace(/101/g, '１０１').replace(/102/g, '１０２');
  assigned(parse(receipt(body)));
});

for (const newline of ['\n', '\r\n', '\r']) test(`fold boundaries preserve ${JSON.stringify(newline)} line-ending semantics`, () => assigned(parse(receipt(foldedProducts).replace(/\n/g, newline))));

test('one corroborated folded product gets the entire single deduction', () => assigned(parse(receipt(`${part('A-\n101')}\n${part('B_102')}\n(明細ID A-101) 値引 ¥100`, { net: 1900 })), undefined, [100, 0], [900, 1000]));

test('one corroborated folded reference does not proportionally allocate its deduction', () => assigned(parse(receipt(`${part('A-101')}\n${part('B_102')}\n(明細ID A-\n101) 値引 ¥100`, { net: 1900 })), undefined, [100, 0], [900, 1000]));

test('tax allocation still follows the corroborated per-ID discounts', () => assigned(parse(receipt(foldedProducts, { tax: 136 })), undefined, [100, 200], [972, 864]));

test('original OCR and caller-owned source objects retain the line breaks', () => {
  const input = { text: receipt(foldedProducts), whole: receipt(foldedRefs), diagnostics: [{ label: '全体', text: receipt(foldedProducts) }] };
  const before = JSON.stringify(input), p = parse(input);
  assigned(p);
  assert.equal(JSON.stringify(input), before);
  assert(p.rawText.includes('A-\n101'));
  assert(p.debugText.includes('A-\n101'));
});

test('independent valid OCR layouts agree on restored identity', () => assigned(parse({ text: receipt(foldedProducts), whole: receipt(foldedRefs) })));

test('raw folded products without a complete reference remain manual', () => held(parse(receipt(`${part('A-\n101')}\n商品値引 ¥100\n${part('B_\n102')}\n商品値引 ¥200`))));

test('both sides being folded cannot bootstrap their own spelling', () => held(parse(receipt(`${part('A-\n101')}\n${part('B_\n102')}\n(明細ID A-\n101) 値引 ¥100\n(明細ID B_\n102) 値引 ¥200`))));

test('a witness found only in another OCR pass is insufficient', () => {
  const incomplete = `${part('A-\n101')}\n商品値引 ¥100\n${part('B_\n102')}\n商品値引 ¥200`;
  const complete = `${part('A-101')}\n商品値引 ¥100\n${part('B_102')}\n商品値引 ¥200`;
  held(parse({ text: receipt(incomplete), whole: receipt(complete) }));
});

test('merged text cannot invent same-source proof absent from actual OCR records', () => {
  const products = `${part('A-\n101')}\n商品値引 ¥100\n${part('B_\n102')}\n商品値引 ¥200`;
  const p = parse({ text: receipt(foldedProducts), diagnostics: [{ label: '分割 1', text: receipt(products) }, { label: '分割 2', text: receipt(refs) }] });
  held(p);
  assert.equal(p.wrappedIdRecoveryCount || 0, 0);
});

test('a spaced complete ID makes an otherwise matching compact spelling ambiguous', () => held(parse(receipt(`${part('A-101')}\n${part('A- 101')}\n(明細ID A-\n101) 値引 ¥100\n(明細ID A- 101) 値引 ¥200`))));

test('a witness with an internal space cannot justify deleting the fold', () => held(parse(receipt(`${part('A-\n101')}\n${part('B_102')}\n(明細ID A- 101) 値引 ¥100\n(明細ID B_102) 値引 ¥200`))));

for (const split of ['A-1\n01', 'A-\n10\n1']) test(`unmarked continuation with an exact complete witness is recovered: ${JSON.stringify(split)}`, () => assigned(parse(receipt(`${part(split)}\n${part('B_102')}\n${refs}`))));

for (const split of ['A\n101', 'A \n101', 'A\t101', 'A-\t\n101', 'A-\n\t101', 'A-\n\n101', 'A-\n1_\n0_\n1']) test(`insufficient continuation evidence stays manual: ${JSON.stringify(split)}`, () => {
  held(parse(receipt(`${part(split)}\n${part('B_102')}\n${refs}`)));
});

test('a mismatched closing bracket cannot be repaired', () => held(parse(receipt(foldedProducts.replace('101)', '101]')))));
test('unbounded folded tokens are not joined', () => held(parse(receipt(`明細ID A-\n101\n緑茶\n${code} 1 ¥1,000\n${part('B_102')}\n${refs}`))));
test('a second label inside the fold is not consumed', () => held(parse(receipt(foldedProducts.replace('A-\n101', 'A-\n明細ID 101')))));
test('a tax or price row cannot be an ID continuation', () => held(parse(receipt(foldedProducts.replace('A-\n101', 'A-\n消費税 ¥101')))));
test('ASCII comment text without a trailing separator is not consumed', () => held(parse(receipt(foldedProducts.replace('A-\n101', 'A-\nNOTE\n101')))));

test('a complete arbitrary ID label is not a priced merchandise witness', () => {
  held(parse(receipt(`補足情報\n明細ID A-101\n補足情報\n${part('B_102')}\n(明細ID A-\n101) 値引 ¥100\n(明細ID B_102) 値引 ¥200`)));
});

test('a discount summary is not an individual reference witness', () => held(parse(receipt(`${part('A-\n101')}\n${part('B_102')}\n(明細ID A-101) 値引合計 ¥100\n(明細ID B_102) 値引 ¥200`))));

test('a footer reference after checkout cannot corroborate a merchandise fold', () => {
  const text = receipt(`${part('A-\n101')}\n商品値引 ¥100\n${part('B_102')}\n商品値引 ¥200`) + '\n(明細ID A-101) 値引 ¥100';
  const p = parse(text);held(p);assert.equal(p.wrappedIdRecoveryCount || 0, 0);
});

test('a code without a readable product name is not a priced witness', () => held(parse(receipt(`(明細ID A-101)\n${code} 1 ¥1,000\n${part('B_102')}\n(明細ID A-\n101) 値引 ¥100\n(明細ID B_102) 値引 ¥200`))));

test('two priced occurrences with the same complete ID are not unique', () => held(parse(receipt(`${part('A-101')}\n${part('A-101')}\n(明細ID A-\n101) 値引 ¥300`))));

test('two folded products cannot share the same single complete reference', () => held(parse(receipt(`${part('A-\n101')}\n${part('A-\n101')}\n(明細ID A-101) 値引 ¥300`))));

for (const witness of ['a-101', 'A-1O1', 'A_101', 'A−101']) test(`a different complete spelling ${witness} is not corrected`, () => held(parse(receipt(foldedProducts.replace('(明細ID A-101) 値引', `(明細ID ${witness}) 値引`)))));

for (const options of [{ count: 0 }, { count: 3 }, { paid: false }, { net: 1699 }]) test(`recovery does not replace accounting evidence: ${JSON.stringify(options)}`, () => held(parse(receipt(foldedProducts, options))));

test('a corroborated spelling cannot repair contradictory OCR discount assignments', () => held(parse({ text: receipt(foldedProducts), whole: receipt(foldedRefs.replace('¥100', '¥200').replace(/¥200$/, '¥100')) })));

test('learning cannot replace the missing complete counterpart', () => {
  const r = runtime();
  r.storage.set('okozukaiReceiptProductDictionaryV1', JSON.stringify([{ shopKey: 'テスト商', name: '緑茶', aliases: ['緑茶'], priceHints: [1000], source: 'learned', confirmedCount: 6 }]));
  held(parse(receipt(`${part('A-\n101')}\n商品値引 ¥100\n${part('B_102')}\n商品値引 ¥200`), r));
  assert.equal(r.writes.length, 0);
});

test('recovery preserves ledger, dictionary, schema and caller text', () => {
  const r = runtime();
  r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'unrelated', name: '学習商品', priceHints: [73], source: 'learned', confirmedCount: 4 }]);
  r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);
  const before = r.evaluate('JSON.stringify(state)');
  assigned(parse(receipt(foldedProducts), r));
  held(parse(receipt(`${part('A\n101')}\n${part('B_102')}\n${refs}`), r));
  assert.equal(r.evaluate('JSON.stringify(state)'), before);
  assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);
  assert.equal(r.writes.length, 0);
  assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});

for (const [name, body, valid] of [['folded merchandise', foldedProducts, true], ['folded references', foldedRefs, true], ['an ineligible TAB continuation', foldedProducts.replace('A-\n101', 'A-\n\t101'), false]]) test(`mock OCR checks ${name} against its own printed counterpart`, async () => {
  const r = runtime(), a = r.context.receiptInternals, text = receipt(body);
  let terminated = 0;
  r.context.Tesseract = { async createWorker() { return { async setParameters() {}, async recognize() { return { data: { text, blocks: [] } }; }, async terminate() { terminated++; } }; } };
  const canvas = { width: 100, height: 300 };
  const ocr = await a.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'middle', canvas }, { role: 'bottom', canvas }], shopSlices: [], itemSlices: Array.from({ length: 7 }, () => ({ canvas })), amountSlices: [], paymentSlices: [] });
  const p = parse(ocr, r);if(valid)assigned(p);else held(p);
  assert.equal(terminated, 1);
  assert.equal(r.writes.length, 0);
});
