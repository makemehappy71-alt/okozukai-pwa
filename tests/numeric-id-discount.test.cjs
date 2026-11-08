const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const code = '2200083271771';
const part = (id, qty = 1, productCode = code) => `緑茶 (明細ID ${id})\n${productCode} ${qty} ¥1,000`;
function ref(id, amount, { layout = 'close', label = '値引額（円）' } = {}) {
  const printed = layout === 'complete' ? id : layout === 'fragment' ? Array.from(id).join('\n') : id + '\n';
  return `(明細ID ${printed}) ${label}\n${amount}`;
}
function body({ ids = ['100', '200'], values = [100, 200], qty = 1, codes = [code, code], ...options } = {}) {
  return `${part(ids[0], qty, codes[0])}\n${part(ids[1], qty, codes[1])}\n${ref(ids[0], values[0], options)}\n${ref(ids[1], values[1], options)}`;
}
function receipt(items, { count = 2, net = 1700, tax = 0, paid = true } = {}) {
  return `テスト商店\n2026年11月08日\n${items}\n小計 ${count ? count + '点 ' : ''}¥${net}\n${tax ? '消費税 ¥' + tax + '\n' : ''}${paid ? '合計 ¥' + (net + tax) + '\n楽天ペイ ¥' + (net + tax) : ''}`;
}
const parse = (text, r = runtime()) => r.context.receiptFeature.parseReceiptText(text, '2026-11-08');
function assigned(p, { ids = ['100', '200'], values = [100, 200], gross = values.map(n => 1000 - n), qty = 1, codes = [code, code] } = {}) {
  assert.equal(p.discountAttributionConfirmed, true);assert.equal(p.discountReviewRequired, false);assert.equal(p.itemSetComplete, true);
  assert.deepEqual(Array.from(p.itemRows, row => [row.name, row.receiptLineId, row.productCode, row.qty, row.total]), ids.map((id, i) => ['緑茶', id, codes[i], qty, 1000]));
  assert.deepEqual(Array.from(p.splitRows, row => [row.discount, row.gross]), values.map((n, i) => [n, gross[i]]));
  assert(p.wrappedIdRecoveryCount > 0);
}
function held(p) {
  assert.equal(p.discountAttributionConfirmed, false);assert.equal(p.itemSetComplete, false);assert.equal(p.autoConfirmedItemCount, 0);assert.equal(p.productCandidateAutoConfirmed, false);assert.equal(p.splitRows.length, 0);
}
for (const layout of ['complete', 'close', 'fragment']) {
  for (const label of ['値引額（円）', '割引額 (円)', '値下額(円)', '値下げ額（円）', '商品 値引額 ( 円 ):', '(単品) 割引額（円）']) {
    for (const values of [[100, 200], [200, 100]]) test(`${layout} ${label} separates numeric IDs from ${values.join('/')} yen`, () => assigned(parse(receipt(body({ layout, label, values }))), { values }));
  }
  for (const label of ['値引額', '割引額', '商品値引額', '単品 値下げ額']) test(`${layout} ${label} without a local unit cannot resolve an ID/amount collision`, () => held(parse(receipt(body({ layout, label })))));
  test(`${layout} the other reference's yen unit is not enough`, () => held(parse(receipt(body({ layout }).replace('値引額（円）\n100', '値引額\n100')))));
}
for (const [open, close] of [['[', ']'], ['【', '】'], ['（', '）']]) test(`numeric ID and amount keep their roles with ${open}${close}`, () => {
  const input = receipt(body()).replace(/\(明細ID/g, open + '明細ID').replace(/(100|200)\)/g, '$1' + close).replace(/\n\) /g, '\n' + close + ' ');
  assigned(parse(input));
});
test('inner numeric ID brackets provide the same exact reference', () => assigned(parse(receipt(body({ layout: 'complete' })).replace(/\(明細ID (100|200)\)/g, '明細ID [$1]'))));
test('a separate scope and unit-bearing label keep numeric roles', () => assigned(parse(receipt(body({ label: '\n(単品)\n値引額（円）' })))));
for (const newline of ['\n', '\r\n', '\r']) test(`numeric ID/value collision with ${JSON.stringify(newline)}`, () => assigned(parse(receipt(body()).replace(/\n/g, newline))));
test('full-width numeric IDs and amounts normalize without OCR digit repair', () => {
  const text = receipt(body()).replaceAll('明細ID 100', '明細ID １００').replaceAll('明細ID 200', '明細ID ２００').replace('値引額（円）\n100', '値引額（円）\n１００').replace('値引額（円）\n200', '値引額（円）\n２００');assigned(parse(text));
});
test('padded closing brackets do not merge IDs with values', () => assigned(parse(receipt(body()).replace(/\n\) /g, '\n\t )\t '))));
test('a one-digit ID can equal a value and a printed quantity', () => {
  const ids = ['1', '2'], values = [1, 2];assigned(parse(receipt(body({ ids, values }), { net: 1997 })), { ids, values });
});
test('numeric ID prefix matches do not replace exact ID equality', () => {
  const ids = ['100', '1000'];assigned(parse(receipt(body({ ids }))), { ids });
});
test('numeric ID values and unit prices can coincide together', () => assigned(parse(receipt(body({ qty: 10 }), { count: 20 })), { qty: 10 }));
test('numeric ID values and product-code values can coincide together', () => {
  const codes = ['0000000000100', '0000000000200'];assigned(parse(receipt(body({ codes }))), { codes });
});
test('a numeric amount may equal another printed numeric ID while its own target is alphabetic', () => {
  const ids = ['A101', '100'];assigned(parse(receipt(body({ ids }))), { ids });
});
test('the original numeric canonicalization remains available for fully printed products', () => {
  const items = body().replace('緑茶 (明細ID 100)', '緑茶 (明細ID 000100)').replace('緑茶 (明細ID 200)', '緑茶 (明細ID 000200)');assigned(parse(receipt(items)));
});
test('one deduction with a numeric ID equal to its value affects only that ID', () => assigned(parse(receipt(`${part('100')}\n${part('200')}\n${ref('100', 100)}`, { net: 1900 })), { values: [100, 0] }));
test('numeric-ID deductions retain tax allocation', () => assigned(parse(receipt(body(), { tax: 136 })), { gross: [972, 864] }));
test('a currency-marked value already remains supported without a local unit on the label', () => assigned(parse(receipt(body({ label: '値引額' }).replace('値引額\n100', '値引額\n¥100').replace('値引額\n200', '値引額\n200円')))));

for (const label of ['値引額(個)', '値引額(%)', '値引額(円/個)', '値引額[円]', '値引額(円]', '値引額（円） 対象外', '値引(円)', '明細ID', '数量(円)', '単価(円)', '値引後価格(円)', '値引額合計(円)']) test(`a numeric collision cannot use the ambiguous label ${label}`, () => held(parse(receipt(body({ label })))));
for (const value of ['0', '00100', '-100', '1,00', '1,000', '100001', '2200083271771', '1O0', '100 注記', '100 (明細ID 200)', '10%']) test(`a local unit cannot repair the ambiguous numeric value ${value}`, () => held(parse(receipt(body().replace('値引額（円）\n100', '値引額（円）\n' + value)))));
for (const suffix of ['個', '%', '対象外', '200', '¥200', '0']) test(`numeric ID coincidence does not discard following ${suffix}`, () => held(parse(receipt(body().replace('値引額（円）\n100', '値引額（円）\n100\n' + suffix)))));
for (const barrier of ['\n', '\t\n', '注記\n', '数量\n', '(明細ID 300)\n', '消費税 ¥0\n']) test(`numeric ID coincidence does not skip ${JSON.stringify(barrier)}`, () => held(parse(receipt(body().replace('値引額（円）\n100', '値引額（円）\n' + barrier + '100')))));
test('a global yen heading cannot type an otherwise bare colliding amount', () => held(parse(receipt('金額単位（円）\n' + body({ label: '値引額' })))));
test('a separate yen-unit line cannot be borrowed', () => held(parse(receipt(body({ label: '値引額\n(円)' })))));
test('no reference ID means no attribution from equal numeric values', () => held(parse(receipt(`${part('100')}\n${part('200')}\n値引額（円）\n100\n値引額（円）\n200`))));
test('unknown numeric reference IDs are not recovered from the amount', () => held(parse(receipt(body().replace('(明細ID 100\n)', '(明細ID 300\n)')))));
test('a matching prefix cannot identify a different numeric ID', () => held(parse(receipt(body().replace('(明細ID 100\n)', '(明細ID 10\n)')))));
test('OCR O/zero aliases remain different printed IDs', () => held(parse(receipt(body().replace('緑茶 (明細ID 100)', '緑茶 (明細ID 1O0)')))));
test('spaced and compact numeric-ID spellings remain ambiguous', () => held(parse(receipt(`${part('100')}\n${part('1 00')}\n${ref('100', 100)}\n(明細ID 1 00) 値引額 ¥200`))));
test('duplicated canonical numeric IDs cannot be distinguished by their values', () => held(parse(receipt(`${part('100')}\n${part('000100')}\n${ref('100', 300)}`))));
test('duplicated complete IDs cannot be distinguished by a unit-bearing label', () => held(parse(receipt(`${part('100')}\n${part('100')}\n${ref('100', 300)}`))));
test('duplicated folded references are not selected or summed', () => held(parse(receipt(`${part('100')}\n${part('200')}\n${ref('100', 100)}\n${ref('100', 50)}\n${ref('200', 150)}`))));
test('both folded product and reference cannot supply each other with original complete ID proof', () => held(parse(receipt(body().replace('緑茶 (明細ID 100)', '緑茶 (明細ID 1\n00)').replace('緑茶 (明細ID 200)', '緑茶 (明細ID 2\n00)')))));
test('a wrong ID closing bracket is not repaired by equal numeric values', () => held(parse(receipt(body().replace('100\n)', '100\n]')))));
test('tabs within a numeric ID cannot be turned into digits', () => held(parse(receipt(body().replace('100\n)', '1\t\n00)')))));
test('an ID with an omitted closing bracket does not become an amount reference', () => held(parse(receipt(body().replace('100\n)', '100')))));
test('default quantity one is not literal merchandise evidence', () => held(parse(receipt(body().replaceAll(`${code} 1 ¥1,000`, `${code} ¥1,000`)))));
test('missing product code is not literal merchandise evidence', () => held(parse(receipt(body().replaceAll(`${code} 1 ¥1,000`, '¥1,000')))));
test('a separately printed merchandise ID cannot replace inline ID evidence', () => held(parse(receipt(body().replaceAll('緑茶 (明細ID ', '(明細ID ').replaceAll(')\n' + code, ')\n緑茶\n' + code)))));
test('a fractional unit price remains insufficient', () => held(parse(receipt(body({ qty: 3 }), { count: 6 }))));
test('a deduction equal to the entire product price remains manual', () => held(parse(receipt(body({ ids: ['1000', '200'], values: [1000, 200] }), { net: 800 }))));
for (const options of [{ count: 0 }, { count: 3 }, { net: 1699 }, { paid: false }]) test(`numeric ID role proof does not replace accounting ${JSON.stringify(options)}`, () => held(parse(receipt(body(), options))));
test('a numeric value at a recognition-source edge has no confirmed field boundary', () => {
  const items = body(), summary = '小計 2点 ¥1700\n合計 ¥1700\n楽天ペイ ¥1700';held(parse({ text: receipt(items), diagnostics: [{ label: '商品全域', text: items }, { label: '全体', text: summary }] }));
});
test('a footer reference is not evidence for the current sale', () => held(parse(receipt(`${part('100')}\n${part('200')}\n商品値引 ¥100\n商品値引 ¥200`) + '\n' + ref('100', 100))));
for (const layout of ['complete', 'close', 'fragment']) {
  test(`${layout} merged text cannot borrow unit evidence from a different recognition result`, () => held(parse({ text: receipt(body({ layout })), diagnostics: [{ label: '全体', text: receipt(body({ layout, label: '値引額' })) }] })));
  test(`${layout} merged text cannot borrow original full product IDs across source boundaries`, () => held(parse({ text: receipt(body({ layout })), diagnostics: [{ label: '分割 1', text: receipt(`${part('100')}\n${part('200')}`) }, { label: '分割 2', text: receipt(`${ref('100', 100, { layout })}\n${ref('200', 200, { layout })}`) }] })));
  test(`${layout} contradictory balanced allocations across OCR passes remain manual`, () => held(parse({ text: receipt(body({ layout })), whole: receipt(body({ layout, values: [200, 100] })) })));
}
test('original numeric IDs, amounts, tabs and caller objects remain intact', () => {
  const text = receipt(body().replace('値引額（円）\n100', '値引額（円）\n\t100\t')), input = { text, whole: text, diagnostics: [{ label: '全体', text }] }, before = JSON.stringify(input);
  const p = parse(input);assigned(p);assert.equal(JSON.stringify(input), before);assert(p.rawText.includes('100\n) 値引額（円）\n\t100\t'));assert(p.debugText.includes('値引額（円）\n\t100\t'));
});
test('numeric-ID role analysis preserves ledger, dictionary and schema', () => {
  const r = runtime();r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'テスト商店', name: '緑茶', priceHints: [1000], source: 'learned', confirmedCount: 4 }]);r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);const before = r.evaluate('JSON.stringify(state)');
  assigned(parse(receipt(body()), r));held(parse(receipt(body({ label: '値引額' })), r));
  assert.equal(r.evaluate('JSON.stringify(state)'), before);assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);assert.equal(r.writes.length, 0);assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});
for (const [layout, valid] of [['complete', true], ['fragment', true], ['close', false]]) test(`mock OCR ${layout} numeric ID/value collision ${valid ? 'with local unit' : 'without local unit'}`, async () => {
  const r = runtime(), text = receipt(body({ layout, label: valid ? '値引額（円）' : '値引額' }));let terminated = 0;
  r.context.Tesseract = { async createWorker() { return { async setParameters() {}, async recognize() { return { data: { text, blocks: [] } }; }, async terminate() { terminated++; } }; } };
  const canvas = { width: 100, height: 300 }, ocr = await r.context.receiptInternals.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'middle', canvas }, { role: 'bottom', canvas }], shopSlices: [], itemSlices: Array.from({ length: 7 }, () => ({ canvas })), amountSlices: [], paymentSlices: [] });
  const p = parse(ocr, r);if (valid) assigned(p);else held(p);assert.equal(terminated, 1);assert.equal(r.writes.length, 0);
});
