const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const code = '2200083271771';
const part = (id, qty = 1, productCode = code) => `緑茶 (明細ID ${id})\n${productCode} ${qty} ¥1,000`;
function ref(id, value, label = '値引額（円）', layout = 'close') {
  const printed = layout === 'complete' ? id : layout === 'fragment' ? id[0] + '\n' + id.slice(1) : id + '\n';
  return `(明細ID ${printed}) ${label}\n${value}`;
}
function body({ qty = 1, codes = [code, code], ids = ['A101', 'B102'], values = [100, 200], label, layout } = {}) {
  return `${part(ids[0], qty, codes[0])}\n${part(ids[1], qty, codes[1])}\n${ref(ids[0], values[0], label, layout)}\n${ref(ids[1], values[1], label, layout)}`;
}
function receipt(items, { count = 2, net = 1700, tax = 0, paid = true } = {}) {
  return `テスト商店\n2026年11月08日\n${items}\n小計 ${count ? count + '点 ' : ''}¥${net}\n${tax ? '消費税 ¥' + tax + '\n' : ''}${paid ? '合計 ¥' + (net + tax) + '\n楽天ペイ ¥' + (net + tax) : ''}`;
}
const parse = (input, r = runtime()) => r.context.receiptFeature.parseReceiptText(input, '2026-11-08');
function assigned(p, { qty = 1, codes = [code, code], values = [100, 200], gross = [900, 800] } = {}) {
  assert.equal(p.discountAttributionConfirmed, true);
  assert.equal(p.discountReviewRequired, false);
  assert.equal(p.itemSetComplete, true);
  assert.deepEqual(Array.from(p.itemRows, r => [r.receiptLineId, r.qty, r.productCode, r.total]), ['A101', 'B102'].map((id, i) => [id, qty, codes[i], 1000]));
  assert.deepEqual(Array.from(p.splitRows, r => [r.discount, r.gross]), values.map((n, i) => [n, gross[i]]));
  assert(p.wrappedIdRecoveryCount > 0);
}
function held(p) {
  assert.equal(p.discountAttributionConfirmed, false);
  assert.equal(p.itemSetComplete, false);
  assert.equal(p.autoConfirmedItemCount, 0);
  assert.equal(p.productCandidateAutoConfirmed, false);
  assert.equal(p.splitRows.length, 0);
}
const collisions = [
  ['item quantity', { qty: 2, values: [2, 2] }, { count: 4, net: 1996 }, { qty: 2, values: [2, 2], gross: [998, 998] }],
  ['basket count', { values: [2, 2] }, { net: 1996 }, { values: [2, 2], gross: [998, 998] }],
  ['unit price', { qty: 10 }, { count: 20 }, { qty: 10 }],
  ['product code', { codes: ['0000000000100', '0000000000200'] }, {}, { codes: ['0000000000100', '0000000000200'] }]
];
for (const [role, options, accounting, expected] of collisions) {
  for (const layout of ['complete', 'close', 'fragment']) {
    for (const label of ['値引額（円）', '割引額 (円)', '値下額(円)', '値下げ額（円）', '商品 値引額 ( 円 ):', '(単品) 割引額（円）']) {
      test(`${layout} ID and ${label} distinguish the amount from ${role}`, () => assigned(parse(receipt(body({ ...options, layout, label }), accounting)), expected));
    }
    test(`${layout} ID without a printed yen unit cannot resolve ${role}`, () => held(parse(receipt(body({ ...options, layout, label: '値引額' }), accounting))));
  }
}
for (const field of ['商品コード 100', 'JANコード 100', 'PLU 100', '品番 100', '数量 100', '個数 100', '点数 100', '単価 ¥100']) {
  test(`a local unit preserves other receipt checks for the isolated field ${field}`, () => {
    const p = parse(receipt(field + '\n' + body()));
    if (field === 'PLU 100') assigned(p);else held(p);
  });
  test(`the unrelated field ${field} cannot supply a missing local unit`, () => held(parse(receipt(field + '\n' + body({ label: '値引額' })))));
}
for (const label of ['値引額(個)', '値引額(%)', '値引額(円/個)', '値引額[円]', '値引額(円]', '値引額(円) 対象外', '値引額(円) 数量', '単価(円)', '商品コード(円)', '数量(円)', '値引(円)', '値引額合計(円)', '値引後価格(円)']) {
  test(`an unknown, conflicting or insufficient label is not guessed: ${label}`, () => held(parse(receipt(body({ qty: 10, label }), { count: 20 }))));
}
test('a separate unit line cannot be attached by skipping rows', () => held(parse(receipt(body({ qty: 10, label: '値引額\n(円)' }), { count: 20 }))));
for (const newline of ['\n', '\r\n', '\r']) test(`local units and bare values support ${JSON.stringify(newline)}`, () => assigned(parse(receipt(body({ qty: 10 }), { count: 20 }).replace(/\n/g, newline)), { qty: 10 }));
test('scope, unit-bearing label and amount can occupy consecutive rows', () => assigned(parse(receipt(body({ qty: 10, label: '\n(単品)\n値引額（円）' }), { count: 20 })), { qty: 10 }));
test('full-width digits are normalized without changing the original', () => {
  const input = receipt(body({ qty: 10 }), { count: 20 }).replace('\n100\n', '\n１００\n').replace('\n200\n', '\n２００\n');
  const p = parse(input);assigned(p, { qty: 10 });assert(p.rawText.includes('１００'));assert(p.rawText.includes('（円）'));
});
test('the printed unit does not replace tax allocation', () => assigned(parse(receipt(body({ qty: 10 }), { count: 20, tax: 136 })), { qty: 10, gross: [972, 864] }));
for (const value of ['0', '00100', '-100', '1,00', '1,000', '100001', '2200083271771', '1O0', '100 注記', '10%']) {
  test(`a local unit does not repair an ambiguous value: ${value}`, () => held(parse(receipt(body({ qty: 10 }).replace('\n100\n', '\n' + value + '\n'), { count: 20 }))));
}
for (const suffix of ['個', '%', '対象外', '200', '¥200', '0']) test(`a local unit does not discard following information ${suffix}`, () => held(parse(receipt(body({ qty: 10 }).replace('\n100\n', '\n100\n' + suffix + '\n'), { count: 20 }))));
for (const barrier of ['\n', '\t\n', '注記\n', '数量\n', '(明細ID C103)\n']) test(`a barrier before the numeric value is not skipped: ${JSON.stringify(barrier)}`, () => held(parse(receipt(body({ qty: 10 }).replace('\n100\n', '\n' + barrier + '100\n'), { count: 20 }))));
for (const transform of [
  s => s.replaceAll(`${code} 10 ¥1,000`, `${code} ¥1,000`),
  s => s.replaceAll(`${code} 10 ¥1,000`, '¥1,000'),
  s => s.replaceAll('緑茶 (明細ID ', '(明細ID ').replaceAll(')\n' + code, ')\n緑茶\n' + code),
  s => s.replace('緑茶 (明細ID A101)', '緑茶 (明細ID A1O1)'),
  s => s.replace('緑茶 (明細ID B102)', '緑茶 (明細ID A101)'),
  s => s.replaceAll('緑茶 (明細ID A101)', '緑茶 (明細ID A\n101)'),
  s => s.replace('A101\n)', 'A101\n]')
]) test(`the local unit cannot replace original unique product proof #${[...transform.toString()].length}`, () => held(parse(receipt(transform(body({ qty: 10 })), { count: 20 }))));
test('a fractional derived unit price still lacks literal role evidence', () => held(parse(receipt(body({ qty: 3 }), { count: 6 }))));
test('an amount equal to the entire product price stays manual', () => held(parse(receipt(body({ values: [1000, 200] }), { net: 800 }))));
test('numeric IDs matching bare amounts stay conservative', () => held(parse(receipt(body({ ids: ['100', '200'] })))));
test('duplicate folded references cannot use the unit to select or sum', () => held(parse(receipt(body({ qty: 10 }) + '\n' + ref('A101', 50), { count: 20, net: 1650 }))));
for (const accounting of [{ count: 0 }, { net: 1699, count: 20 }, { count: 20, paid: false }, { count: 19 }]) test(`the unit does not replace accounting ${JSON.stringify(accounting)}`, () => held(parse(receipt(body({ qty: 10 }), accounting))));
test('a crop edge does not give an amount boundary even with local units', () => {
  const items = body({ qty: 10 }), summary = '小計 20点 ¥1700\n合計 ¥1700\n楽天ペイ ¥1700';
  held(parse({ text: receipt(items, { count: 20 }), diagnostics: [{ label: '商品全域', text: items }, { label: '全体', text: summary }] }));
});
test('merged text cannot borrow a unit from another recognition source', () => {
  const withUnit = receipt(body({ qty: 10 }), { count: 20 }), withoutUnit = receipt(body({ qty: 10, label: '値引額' }), { count: 20 });
  held(parse({ text: withUnit, diagnostics: [{ label: '全体', text: withoutUnit }] }));
});
test('a unit on the other reference does not resolve the conflicting first amount', () => held(parse(receipt(body({ qty: 10 }).replace('値引額（円）\n100', '値引額\n100'), { count: 20 }))));
test('a global money heading cannot replace a local unit', () => held(parse(receipt('金額単位（円）\n' + body({ qty: 10, label: '値引額' }), { count: 20 }))));
test('a source with a unit but without original product IDs cannot borrow them', () => {
  const items = body({ qty: 10 });
  held(parse({ text: receipt(items, { count: 20 }), diagnostics: [{ label: '分割 1', text: receipt(`${part('A101', 10)}\n${part('B102', 10)}`, { count: 20 }) }, { label: '分割 2', text: receipt(`${ref('A101', 100)}\n${ref('B102', 200)}`, { count: 20 }) }] }));
});
test('contradictory balanced allocations across recognition passes remain manual', () => held(parse({ text: receipt(body({ qty: 10 }), { count: 20 }), whole: receipt(body({ qty: 10, values: [200, 100] }), { count: 20 }) })));
test('unit-bearing bare analysis preserves inputs, ledger, dictionary and schema', () => {
  const r = runtime();r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'unrelated', name: '学習商品', priceHints: [73], source: 'learned', confirmedCount: 4 }]);r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);
  const before = r.evaluate('JSON.stringify(state)'), text = receipt(body({ qty: 10 }), { count: 20 });
  const input = { text, diagnostics: [{ label: '全体', text }] }, original = JSON.stringify(input), p = parse(input, r);assigned(p, { qty: 10 });
  assert.equal(JSON.stringify(input), original);assert(p.rawText.includes('値引額（円）\n100'));assert(p.debugText.includes('値引額（円）\n100'));
  held(parse(receipt(body({ qty: 10, label: '値引額' }), { count: 20 }), r));
  assert.equal(r.evaluate('JSON.stringify(state)'), before);assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);assert.equal(r.writes.length, 0);assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});
for (const valid of [true, false]) test(`mock OCR keeps numeric-role collision ${valid ? 'resolved with unit' : 'manual without unit'}`, async () => {
  const r = runtime(), text = receipt(body({ qty: 10, label: valid ? '値引額（円）' : '値引額' }), { count: 20 });let terminated = 0;
  r.context.Tesseract = { async createWorker() { return { async setParameters() {}, async recognize() { return { data: { text, blocks: [] } }; }, async terminate() { terminated++; } }; } };
  const canvas = { width: 100, height: 300 };
  const ocr = await r.context.receiptInternals.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'middle', canvas }, { role: 'bottom', canvas }], shopSlices: [], itemSlices: Array.from({ length: 7 }, () => ({ canvas })), amountSlices: [], paymentSlices: [] });
  const p = parse(ocr, r);if (valid) assigned(p, { qty: 10 });else held(p);assert.equal(terminated, 1);assert.equal(r.writes.length, 0);
});
