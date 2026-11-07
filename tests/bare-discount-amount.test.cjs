const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const code = '2200083271771';
const part = (id, qty = 1, total = 1000, productCode = code) => `緑茶 (明細ID ${id})\n${productCode} ${qty} ¥${total.toLocaleString('en-US')}`;
function ref(id, amount, { layout = 'close', label = '値引額', scope = '', ownLabel = false, ownScope = false } = {}) {
  const printed = layout === 'close' ? id + '\n' : layout === 'fragment' ? id.slice(0, 1) + '\n' + id.slice(1) : id;
  return `(明細ID ${printed})${scope ? (ownScope ? '\n' : ' ') + scope : ''}${ownLabel ? '\n' : ' '}${label}\n${amount}`;
}
const body = (options = {}) => {
  const ids = options.ids || ['A101', 'B102'];
  return `${part(ids[0], options.qty, options.total, options.productCode)}\n${part(ids[1], options.qty, options.total, options.productCode)}\n${ref(ids[0], 100, options)}\n${ref(ids[1], 200, options)}`;
};
function receipt(items, { net = 1700, count = 2, paid = true, tax = 0 } = {}) {
  return `テスト商店\n2026年11月08日\n${items}\n小計 ${count ? count + '点 ' : ''}¥${net}\n${tax ? '消費税 ¥' + tax + '\n' : ''}${paid ? '合計 ¥' + (net + tax) + '\n楽天ペイ ¥' + (net + tax) : ''}`;
}
const parse = (text, r = runtime()) => r.context.receiptFeature.parseReceiptText(text, '2026-11-08');
function assigned(p, { ids = ['A101', 'B102'], discounts = [100, 200], gross = [900, 800], qty = 1, total = 1000 } = {}) {
  assert.equal(p.discountAttributionConfirmed, true);
  assert.equal(p.discountReviewRequired, false);
  assert.equal(p.itemSetComplete, true);
  assert.deepEqual(Array.from(p.itemRows, r => [r.name, r.receiptLineId, r.qty, r.total]), ids.map(id => ['緑茶', id, qty, total]));
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

for (const layout of ['complete', 'close', 'fragment']) {
  for (const label of ['値引額', '割引額', '値下額', '値下げ額', '商品値引額', '単品 割引額', '(単品) 値引額']) test(`${layout} ID and explicit ${label} corroborate a non-conflicting bare amount`, () => assigned(parse(receipt(body({ layout, label })))));
  test(`${layout} ID with separate scope, label and numeric amount`, () => assigned(parse(receipt(body({ layout, scope: '(単品)', ownScope: true, ownLabel: true })))));
}
for (const [open, close] of [['[', ']'], ['【', '】'], ['（', '）']]) test(`matching ${open}${close} keeps bare amount separate from ID`, () => assigned(parse(receipt(body().replace(/\(明細ID/g, open + '明細ID').replace(/\)/g, close)))));
test('literal ID separators remain unchanged', () => {
  const ids = ['A-101', 'B_102'];
  assigned(parse(receipt(body({ ids }).replace('A-101\n)', 'A-\n101)').replace('B_102\n)', 'B_\n102)'))), { ids });
});
test('non-conflicting numeric IDs remain distinct from amount fields', () => {
  const ids = ['1011', '1022'];assigned(parse(receipt(body({ ids }))), { ids });
});
for (const newline of ['\n', '\r\n', '\r']) test(`${JSON.stringify(newline)} preserves explicit amount-label boundaries`, () => assigned(parse(receipt(body()).replace(/\n/g, newline))));
test('full-width numeric values normalize without digit repair', () => {
  const items = body().replace('\n100\n(明細ID', '\n１００\n(明細ID').replace(/\n200$/, '\n２００');
  assigned(parse(receipt(items)));
});
test('one bare amount is assigned wholly to the matching priced ID', () => assigned(parse(receipt(`${part('A101')}\n${part('B102')}\n${ref('A101', 100)}`, { net: 1900 })), { discounts: [100, 0], gross: [900, 1000] }));
test('a known following merchandise row gives an explicit field boundary', () => assigned(parse(receipt(`${part('A101')}\n${ref('A101', 100)}\n${part('B102')}\n${ref('B102', 200)}`))));
test('tax allocation follows the corroborated bare amount', () => assigned(parse(receipt(body(), { tax: 136 })), { gross: [972, 864] }));
test('printed quantities greater than one are supported when distinct from the deduction', () => assigned(parse(receipt(body({ qty: 2 }), { count: 4 })), { qty: 2 }));
test('original numeric values, whitespace and caller objects remain intact', () => {
  const text = receipt(body().replace('\n100\n(明細ID', '\n\t100\t\n(明細ID')), input = { text, whole: text, diagnostics: [{ label: '全体', text }] };
  const before = JSON.stringify(input), p = parse(input);assigned(p);assert.equal(JSON.stringify(input), before);assert(p.rawText.includes('値引額\n\t100\t'));assert(p.debugText.includes('値引額\n\t100\t'));
});

for (const label of ['値引', '割引', '商品値引', '単品値引', '値引数量', '単価', '数量', '商品コード', '値引額合計', '値引後価格']) test(`an insufficient or non-amount label is not guessed: ${label}`, () => {
  const p = parse(receipt(body({ label })));
  assert.equal(p.discountAttributionConfirmed, false);assert.equal(p.itemSetComplete, false);assert.equal(p.autoConfirmedItemCount, 0);assert.equal(p.productCandidateAutoConfirmed, false);assert.equal(p.splitRows.length, 0);
});
for (const value of ['0', '00100', '-100', '1,00', '1,000', '1000001', '2200083271771', '1O0', '100 1', '100 注記', '100 (明細ID C103)', '10%']) test(`ambiguous numeric row is not repaired: ${value}`, () => {
  const items = body().replace('\n100\n(明細ID', '\n' + value + '\n(明細ID');held(parse(receipt(items)));
});
test('a bare quantity equal to printed item quantity stays manual despite a matching balance', () => {
  const items = `${part('A101', 2)}\n${part('B102', 2)}\n${ref('A101', 2)}\n${ref('B102', 2)}`;
  held(parse(receipt(items, { count: 4, net: 1996 })));
});
test('a bare quantity equal to the printed basket count stays manual', () => {
  held(parse(receipt(`${part('A101')}\n${part('B102')}\n${ref('A101', 2)}\n${ref('B102', 2)}`, { net: 1996 })));
});
test('a crop without its own subtotal cannot hide that the bare value equals known total quantity', () => {
  const items = `${part('A101')}\n${part('B102')}\n${ref('A101', 2)}\n${ref('B102', 2)}`;
  const summary = '小計 2点 ¥1996\n合計 ¥1996\n楽天ペイ ¥1996';
  held(parse({ text: receipt(items, { net: 1996 }), diagnostics: [{ label: '商品全域', text: items + '\n(明細ID Z999)' }, { label: '全体', text: summary }] }));
});
test('a bare amount equal to known unit price stays manual despite a matching balance', () => {
  const items = `${part('A101', 10)}\n${part('B102', 10)}\n${ref('A101', 100)}\n${ref('B102', 200)}`;
  held(parse(receipt(items, { count: 20 })));
});
test('a bare amount equal to a complete numeric ID is not guessed', () => {
  held(parse(receipt(body({ ids: ['100', '200'] }))));
});
test('numeric product codes with leading zeros cannot become discount amounts', () => {
  const items = `${part('A101', 1, 1000, '0000000000100')}\n${part('B102', 1, 1000, '0000000000200')}\n${ref('A101', 100)}\n${ref('B102', 200)}`;held(parse(receipt(items)));
});
for (const field of ['商品コード 100', 'PLU 100', '品番 100', '数量 100', '単価 ¥100']) test(`another explicit field ${field} makes the numeric role uncertain`, () => held(parse(receipt(field + '\n' + body()))));
test('a product without explicit code, quantity and price does not supply numeric-role proof', () => {
  const items = `緑茶 (明細ID A101) ¥1,000\n緑茶 (明細ID B102) ¥1,000\n${ref('A101', 100)}\n${ref('B102', 200)}`;held(parse(receipt(items)));
});
test('a separately printed product ID does not satisfy the inline numeric-role proof', () => {
  const items = body().replaceAll('緑茶 (明細ID ', '(明細ID ').replaceAll(')\n' + code, ')\n緑茶\n' + code);
  held(parse(receipt(items)));
});
test('an omitted quantity is not treated as printed quantity one', () => {
  held(parse(receipt(body().replaceAll(`${code} 1 ¥1,000`, `${code} ¥1,000`))));
});
test('a fractional derived unit price is insufficient', () => {
  held(parse(receipt(body({ qty: 3 }), { count: 6 })));
});
for (const barrier of ['\n', '\t\n', '注記\n', '歯ブラシ ¥100\n', '(明細ID C103)\n', '消費税 ¥0\n']) test(`a barrier before the bare number is not skipped: ${JSON.stringify(barrier)}`, () => held(parse(receipt(body().replace('値引額\n100', '値引額\n' + barrier + '100')))));
for (const extra of ['200', '¥200', '0']) test(`adjacent numeric candidate ${extra} remains ambiguous`, () => {
  const items = body().replace('\n100\n(明細ID', '\n100\n' + extra + '\n(明細ID');held(parse(receipt(items)));
});
for (const suffix of ['個', '%', '対象外']) test(`a separate suffix ${suffix} cannot be silently detached from a bare number`, () => {
  const items = body().replace('\n100\n(明細ID', '\n100\n' + suffix + '\n(明細ID');held(parse(receipt(items)));
});
for (const scope of ['商品対象外', '(対象外)', '単品取消', '商品 次回用', '商品2点']) test(`scope restriction ${scope} is retained`, () => held(parse(receipt(body({ scope, ownLabel: true })))));
test('wrong closing bracket remains manual', () => held(parse(receipt(body().replace('A101\n)', 'A101\n]')))));
test('a numeric field without an ID cannot infer its product', () => held(parse(receipt(`${part('A101')}\n${part('B102')}\n値引額\n100\n値引額\n200`))));
test('unbounded IDs do not gain the numeric exception', () => held(parse(receipt(body({ layout: 'complete' }).replace(/\(明細ID (A101|B102)\) 値引額/g, '明細ID $1 値引額')))));
test('a bare value cut off at a recognition-source edge does not have a confirmed field boundary', () => {
  const items = body(), summary = '小計 2点 ¥1700\n合計 ¥1700\n楽天ペイ ¥1700';
  held(parse({ text: receipt(items), diagnostics: [{ label: '商品全域', text: items }, { label: '全体', text: summary }] }));
});
test('folded merchandise cannot corroborate its own folded reference', () => held(parse(receipt(`${part('A101\n')}\n${part('B102\n')}\n${ref('A101', 100)}\n${ref('B102', 200)}`))));
for (const layout of ['close', 'complete']) {
  test(`${layout} references cannot borrow numeric-role proof from another pass`, () => held(parse({ text: receipt(`${part('A101\n')}\n商品値引 ¥100\n${part('B102\n')}\n商品値引 ¥200`), whole: receipt(body({ layout })) })));
  test(`${layout} merged text cannot replace original same-source evidence`, () => held(parse({ text: receipt(body({ layout })), diagnostics: [{ label: '分割 1', text: receipt(`${part('A101')}\n${part('B102')}`) }, { label: '分割 2', text: receipt(`${ref('A101', 100, { layout })}\n${ref('B102', 200, { layout })}`) }] })));
  test(`${layout} conflicting allocations remain manual`, () => held(parse({ text: receipt(body({ layout })), whole: receipt(body({ layout }).replace('\n100\n', '\n50\n').replace(/\n200$/, '\n250')) })));
}
test('competing spaced and compact ID spellings remain ambiguous', () => held(parse(receipt(`${part('A101')}\n${part('A 101')}\n${ref('A\n101', 100)}\n(明細ID A 101) 値引額 ¥200`))));
test('different complete ID spelling is not repaired', () => held(parse(receipt(body().replace('緑茶 (明細ID A101)', '緑茶 (明細ID A1O1)')))));
test('duplicate complete priced IDs are not unique', () => held(parse(receipt(`${part('A101')}\n${part('A101')}\n${ref('A101', 300)}`))));
test('duplicate split references do not share a guessed restoration', () => held(parse(receipt(`${part('A101')}\n${part('B102')}\n${ref('A101', 100)}\n${ref('A101', 50)}\n${ref('B102', 150)}`))));
test('a bare numeric reference after checkout is not current-sale evidence', () => held(parse(receipt(`${part('A101')}\n${part('B102')}\n商品値引 ¥100\n商品値引 ¥200`) + '\n' + ref('A101', 100))));
for (const options of [{ count: 0 }, { paid: false }, { net: 1699 }]) test(`numeric-role proof cannot replace accounting: ${JSON.stringify(options)}`, () => held(parse(receipt(body(), options))));
test('learning cannot supply missing printed numeric-role evidence', () => {
  const r = runtime();r.storage.set('okozukaiReceiptProductDictionaryV1', JSON.stringify([{ shopKey: 'テスト商', name: '緑茶', aliases: ['緑茶'], priceHints: [1000], source: 'learned', confirmedCount: 6 }]));
  held(parse(receipt(body().replaceAll(`${code} 1 ¥1,000`, '¥1,000')), r));assert.equal(r.writes.length, 0);
});
test('bare numeric analysis preserves ledger, dictionary and schema', () => {
  const r = runtime();r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'unrelated', name: '学習商品', priceHints: [73], source: 'learned', confirmedCount: 4 }]);r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);
  const before = r.evaluate('JSON.stringify(state)');assigned(parse(receipt(body()), r));held(parse(receipt(body({ label: '値引' })), r));
  assert.equal(r.evaluate('JSON.stringify(state)'), before);assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);assert.equal(r.writes.length, 0);assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});
for (const [name, options, valid] of [['complete ID', { layout: 'complete' }, true], ['folded ID', {}, true], ['insufficient label', { label: '値引' }, false]]) test(`mock OCR: ${name} and storage safety`, async () => {
  const r = runtime(), a = r.context.receiptInternals, text = receipt(body(options));let terminated = 0;
  r.context.Tesseract = { async createWorker() { return { async setParameters() {}, async recognize() { return { data: { text, blocks: [] } }; }, async terminate() { terminated++; } }; } };
  const canvas = { width: 100, height: 300 };
  const ocr = await a.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'middle', canvas }, { role: 'bottom', canvas }], shopSlices: [], itemSlices: Array.from({ length: 7 }, () => ({ canvas })), amountSlices: [], paymentSlices: [] });
  const p = parse(ocr, r);if (valid) assigned(p);else held(p);assert.equal(terminated, 1);assert.equal(r.writes.length, 0);
});
