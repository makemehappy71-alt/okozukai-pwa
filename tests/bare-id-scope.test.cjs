const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const code = '2200083271771';
const part = id => `緑茶 (明細ID ${id})\n${code} 1 ¥1,000`;
const ref = (id, n, note = '単品 ', folded = true, label = '値引') => `(明細ID ${id}${folded ? '\n' : ''}) ${note}${label} ¥${n}`;
const body = ({ ids = ['A101', 'B102'], note = '単品 ', folded = true, fold = id => id, label = '値引' } = {}) => `${part(ids[0])}\n${part(ids[1])}\n${ref(fold(ids[0]), 100, note, folded, label)}\n${ref(fold(ids[1]), 200, note, folded, label)}`;
function receipt(items, { net = 1700, count = 2, paid = true, tax = 0 } = {}) {
  return `テスト商店\n2026年11月08日\n${items}\n小計 ${count ? count + '点 ' : ''}¥${net}\n${tax ? '消費税 ¥' + tax + '\n' : ''}${paid ? '合計 ¥' + (net + tax) + '\n楽天ペイ ¥' + (net + tax) : ''}`;
}
const parse = (text, r = runtime()) => r.context.receiptFeature.parseReceiptText(text, '2026-11-08');
function assigned(p, { ids = ['A101', 'B102'], discounts = [100, 200], gross = [900, 800], folded = true } = {}) {
  assert.equal(p.discountAttributionConfirmed, true);
  assert.equal(p.discountReviewRequired, false);
  assert.equal(p.itemSetComplete, true);
  assert.deepEqual(Array.from(p.itemRows, r => [r.name, r.receiptLineId, r.qty, r.total]), ids.map(id => ['緑茶', id, 1, 1000]));
  assert.deepEqual(Array.from(p.splitRows, r => [r.discount, r.gross]), discounts.map((n, i) => [n, gross[i]]));
  assert.equal((p.wrappedIdRecoveryCount || 0) > 0, folded);
}
function held(p) {
  assert.equal(p.discountAttributionConfirmed, false);
  assert.equal(p.discountReviewRequired, true);
  assert.equal(p.itemSetComplete, false);
  assert.equal(p.autoConfirmedItemCount, 0);
  assert.equal(p.productCandidateAutoConfirmed, false);
  assert.equal(p.splitRows.length, 0);
}

for (const folded of [true, false]) {
  for (const note of ['商品 ', '単品 ', '商品\t', '\t単品\t', '商品　', ' 単品  ']) test(`${folded ? 'wrapped' : 'complete'} reference with bare scope ${JSON.stringify(note)}`, () => assigned(parse(receipt(body({ note, folded }))), { folded }));
  for (const label of ['割引', '値引額', '割引額', '値下額', '値下げ額']) test(`${folded ? 'wrapped' : 'complete'} bare scope before ${label}`, () => assigned(parse(receipt(body({ label, folded }))), { folded }));
  test(`${folded ? 'wrapped' : 'complete'} compact item label retains existing behavior`, () => assigned(parse(receipt(body({ note: '商品', folded }))), { folded }));
  test(`${folded ? 'wrapped' : 'complete'} bracketed note retains existing behavior`, () => assigned(parse(receipt(body({ note: '(単品) ', folded }))), { folded }));
}
for (const [open, close] of [['[', ']'], ['【', '】'], ['（', '）']]) test(`matching ID ${open}${close} preserves the bare note`, () => assigned(parse(receipt(body().replace(/\(明細ID/g, open + '明細ID').replace(/\)/g, close)))));
for (const length of [4, 16]) {
  const ids = ['A' + '1'.repeat(length - 1), 'B' + '2'.repeat(length - 1)];
  test(`${length} fragments plus closing and bare item scope`, () => assigned(parse(receipt(body({ ids, fold: id => id.split('').join('\n') }))), { ids }));
}
test('a 16-character first fragment still reaches its closing row', () => {
  const ids = ['A' + '1'.repeat(15), 'B' + '2'.repeat(15)];assigned(parse(receipt(body({ ids }))), { ids });
});
test('value-only ID brackets can precede bare item scope', () => assigned(parse(receipt(body().replace(/\(明細ID (A101|B102)\n\)/g, '明細ID [$1\n]')))));
test('literal ID separators remain exact', () => {
  const ids = ['A-101', 'B_102'];assigned(parse(receipt(body({ ids, fold: id => id.slice(0, 2) + '\n' + id.slice(2) }))), { ids });
});
for (const newline of ['\n', '\r\n', '\r']) test(`${JSON.stringify(newline)} does not erase bare scope boundaries`, () => assigned(parse(receipt(body()).replace(/\n/g, newline))));
test('single deduction is assigned wholly to its exact item', () => assigned(parse(receipt(`${part('A101')}\n${part('B102')}\n${ref('A101', 100)}`, { net: 1900 })), { discounts: [100, 0], gross: [900, 1000] }));
test('tax allocation follows the identified item scope', () => assigned(parse(receipt(body(), { tax: 136 })), { gross: [972, 864] }));
test('original bare note, tabs, line breaks and caller objects remain intact', () => {
  const text = receipt(body({ note: '\t単品\t' })), input = { text, whole: text, diagnostics: [{ label: '全体', text }] };
  const before = JSON.stringify(input), p = parse(input);assigned(p);assert.equal(JSON.stringify(input), before);assert(p.rawText.includes('A101\n) \t単品\t値引'));assert(p.debugText.includes('A101\n) \t単品\t値引'));
});
test('complete bare references preserve multiple deductions for one unique item', () => assigned(parse(receipt(`${part('A101')}\n${part('B102')}\n${ref('A101', 100, '単品 ', false)}\n${ref('A101', 50, '商品 ', false)}\n${ref('B102', 150, '単品 ', false)}`)), { discounts: [150, 150], gross: [850, 850], folded: false }));
test('complete bare references corroborate independently folded merchandise', () => assigned(parse(receipt(`${part('A101\n')}\n${part('B102\n')}\n${ref('A101', 100, '単品 ', false)}\n${ref('B102', 200, '商品 ', false)}`))));

for (const folded of [true, false]) for (const note of ['商品対象外 ', '単品取消 ', '商品 次回用 ', '単品 注記 ', '商品2点 ', '商品 ¥50 ', '単品 10% ', '商品 明細ID C103 ', '商品 単品 ', '商品 (単品) ', '会員 ', '注記 ']) test(`${folded ? 'wrapped' : 'complete'} uncertain bare scope stays manual: ${note}`, () => held(parse(receipt(body({ note, folded })))));
for (const row of [') 商品 ¥100', ') 単品 値引後価格 ¥100', ') 商品 値引合計 ¥100', ') 商品 値引 10%', ') 単品 値引 ¥0', ') 単品 値引 ¥1000001', ') 商品 値引 ¥1,00', ') 商品 値引 ¥100 注記', ') 商品 値引 ¥100 ¥200', ') 商品 値引 ¥100 (明細ID C103)', ') 単\n品 値引 ¥100', '\n) 単品 値引 ¥100', '\t\n) 単品 値引 ¥100', '] 単品 値引 ¥100', ') 単品\v値引 ¥100', ') 単品\u200b値引 ¥100']) test(`bare scope cannot repair an uncertain row: ${JSON.stringify(row)}`, () => held(parse(receipt(body().replace(') 単品 値引 ¥100', row)))));
for (const fragment of ['A\t101', 'A\n\t101', 'A101 ', 'A\n101 ', 'A-\n_101']) test(`bare scope cannot repair ID fragments: ${JSON.stringify(fragment)}`, () => held(parse(receipt(body().replace('明細ID A101\n', '明細ID ' + fragment + '\n')))));
test('unbounded ID labels do not gain the new spaced-scope exception', () => held(parse(receipt(body({ folded: false }).replace(/\(明細ID (A101|B102)\) 単品 値引/g, '明細ID $1 単品 値引')))));
test('folded references cannot bootstrap folded merchandise', () => held(parse(receipt(`${part('A101\n')}\n${part('B102\n')}\n${ref('A101', 100)}\n${ref('B102', 200)}`))));
for (const folded of [true, false]) {
  test(`${folded ? 'wrapped' : 'complete'} bare reference cannot borrow products from another pass`, () => held(parse({ text: receipt(`${part('A101\n')}\n商品値引 ¥100\n${part('B102\n')}\n商品値引 ¥200`), whole: receipt(body({ folded })) })));
  test(`${folded ? 'wrapped' : 'complete'} bare merged reference cannot bypass actual records`, () => held(parse({ text: receipt(body({ folded })), diagnostics: [{ label: '分割 1', text: receipt(`${part('A101')}\n${part('B102')}`) }, { label: '分割 2', text: receipt(`${ref('A101', 100, '単品 ', folded)}\n${ref('B102', 200, '商品 ', folded)}`) }] })));
  test(`${folded ? 'wrapped' : 'complete'} conflicting allocations remain manual`, () => held(parse({ text: receipt(body({ folded })), whole: receipt(body({ folded }).replace('¥100', '¥50').replace('¥200', '¥250')) })));
}
test('a spaced complete spelling competing with the compact fold remains ambiguous', () => held(parse(receipt(`${part('A101')}\n${part('A 101')}\n${ref('A\n101', 100)}\n(明細ID A 101) 値引 ¥200`))));
test('different complete ID spelling is not repaired', () => held(parse(receipt(body().replace('緑茶 (明細ID A101)', '緑茶 (明細ID A1O1)')))));
test('duplicate complete priced IDs are not unique', () => held(parse(receipt(`${part('A101')}\n${part('A101')}\n${ref('A101', 300)}`))));
test('duplicate folded references cannot infer one shared restoration', () => held(parse(receipt(`${part('A101')}\n${part('B102')}\n${ref('A101', 100)}\n${ref('A101', 50)}\n${ref('B102', 150)}`))));
test('product text before an ID is not a bare deduction reference', () => held(parse(receipt(body().replace('(明細ID A101\n', '緑茶 (明細ID A101\n')))));
test('seventeen fragments cannot be truncated before bare scope', () => {
  const id = 'A' + '1'.repeat(16);held(parse(receipt(body({ ids: [id, 'B102'], fold: value => value.split('').join('\n') }).replace(`緑茶 (明細ID ${id})`, `緑茶 (明細ID ${id.slice(0, 16)})`))));
});
test('a bare reference after checkout cannot identify current-sale deductions', () => held(parse(receipt(`${part('A101')}\n${part('B102')}\n商品値引 ¥100\n商品値引 ¥200`) + '\n' + ref('A101', 100))));
for (const options of [{ count: 0 }, { paid: false }, { net: 1699 }]) test(`bare scope cannot replace accounting: ${JSON.stringify(options)}`, () => held(parse(receipt(body(), options))));
test('learning cannot establish a missing complete priced ID', () => {
  const r = runtime();r.storage.set('okozukaiReceiptProductDictionaryV1', JSON.stringify([{ shopKey: 'テスト商', name: '緑茶', aliases: ['緑茶'], priceHints: [1000], source: 'learned', confirmedCount: 6 }]));
  held(parse(receipt(`${part('A101\n')}\n${part('B102')}\n${ref('A101', 100)}\n${ref('B102', 200)}`), r));assert.equal(r.writes.length, 0);
});
test('bare-scope analysis preserves ledger, dictionary and schema', () => {
  const r = runtime();r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'unrelated', name: '学習商品', priceHints: [73], source: 'learned', confirmedCount: 4 }]);r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);
  const before = r.evaluate('JSON.stringify(state)');assigned(parse(receipt(body()), r));held(parse(receipt(body({ note: '商品対象外 ' })), r));
  assert.equal(r.evaluate('JSON.stringify(state)'), before);assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);assert.equal(r.writes.length, 0);assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});
for (const [name, items, valid, folded] of [['wrapped bare scope', body(), true, true], ['complete bare scope', body({ folded: false }), true, false], ['excluded scope', body({ note: '商品対象外 ' }), false, true]]) test(`mock OCR: ${name} and storage safety`, async () => {
  const r = runtime(), a = r.context.receiptInternals, text = receipt(items);let terminated = 0;
  r.context.Tesseract = { async createWorker() { return { async setParameters() {}, async recognize() { return { data: { text, blocks: [] } }; }, async terminate() { terminated++; } }; } };
  const canvas = { width: 100, height: 300 };
  const ocr = await a.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'middle', canvas }, { role: 'bottom', canvas }], shopSlices: [], itemSlices: Array.from({ length: 7 }, () => ({ canvas })), amountSlices: [], paymentSlices: [] });
  const p = parse(ocr, r);if (valid) assigned(p, { folded });else held(p);assert.equal(terminated, 1);assert.equal(r.writes.length, 0);
});

test('a bare scope followed by an explicit deduction uses the full ID witness', () => assigned(parse(receipt(body().replace(') 単品 値引 ¥100', ') 単品\n値引 ¥100')))));
