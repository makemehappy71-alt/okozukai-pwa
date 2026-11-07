const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const code = '2200083271771';
const part = id => `緑茶 (明細ID ${id})\n${code} 1 ¥1,000`;
function ref(id, n, { layout = 'close', scope = '', ownLabel = false, ownScope = false, label = '値引', money = value => '¥' + value } = {}) {
  const printed = layout === 'close' ? id + '\n' : layout === 'fragment' ? id.slice(0, 1) + '\n' + id.slice(1) : id;
  return `(明細ID ${printed})${scope ? (ownScope ? '\n' : ' ') + scope : ''}${ownLabel ? '\n' : ' '}${label}\n${money(n)}`;
}
const body = (options = {}) => {
  const ids = options.ids || ['A101', 'B102'];
  return `${part(ids[0])}\n${part(ids[1])}\n${ref(ids[0], 100, options)}\n${ref(ids[1], 200, options)}`;
};
function receipt(items, { net = 1700, count = 2, paid = true, tax = 0 } = {}) {
  return `テスト商店\n2026年11月08日\n${items}\n小計 ${count ? count + '点 ' : ''}¥${net}\n${tax ? '消費税 ¥' + tax + '\n' : ''}${paid ? '合計 ¥' + (net + tax) + '\n楽天ペイ ¥' + (net + tax) : ''}`;
}
const parse = (text, r = runtime()) => r.context.receiptFeature.parseReceiptText(text, '2026-11-08');
function assigned(p, { ids = ['A101', 'B102'], discounts = [100, 200], gross = [900, 800] } = {}) {
  assert.equal(p.discountAttributionConfirmed, true);
  assert.equal(p.discountReviewRequired, false);
  assert.equal(p.itemSetComplete, true);
  assert.deepEqual(Array.from(p.itemRows, r => [r.name, r.receiptLineId, r.qty, r.total]), ids.map(id => ['緑茶', id, 1, 1000]));
  assert.deepEqual(Array.from(p.splitRows, r => [r.discount, r.gross]), discounts.map((n, i) => [n, gross[i]]));
  assert(p.wrappedIdRecoveryCount > 0);
}
function held(p, priceLabel = false) {
  assert.equal(p.discountAttributionConfirmed, false);
  if (!priceLabel) assert.equal(p.discountReviewRequired, true);
  assert.equal(p.itemSetComplete, false);
  assert.equal(p.autoConfirmedItemCount, 0);
  assert.equal(p.productCandidateAutoConfirmed, false);
  assert.equal(p.splitRows.length, 0);
}

for (const layout of ['complete', 'close', 'fragment']) for (const ownLabel of [true, false]) {
  test(`${layout} ID with ${ownLabel ? 'independent' : 'same-row'} label and following currency`, () => assigned(parse(receipt(body({ layout, ownLabel })))));
  test(`${layout} ID, bare scope, ${ownLabel ? 'independent' : 'same-row'} label and currency`, () => assigned(parse(receipt(body({ layout, ownLabel, scope: '単品' })))));
  test(`${layout} ID, bracketed independent scope, label and currency`, () => assigned(parse(receipt(body({ layout, ownLabel: true, ownScope: true, scope: '(商品)' })))));
}
for (const label of ['割引', '値引額', '割引額', '値下額', '値下げ額', '商品値引', '単品 値引', '(単品) 値引', '値引:']) test(`exact label ${label} authorizes only the immediate money row`, () => assigned(parse(receipt(body({ label })))));
for (const money of [n => n + '円', n => '￥' + String(n).replace(/[0-9]/g, d => String.fromCharCode(d.charCodeAt(0) + 0xfee0)), n => '\t¥' + n + '\t', n => '¥-' + n, n => '-' + n + '円', n => '¥' + n + '円']) test(`explicit money format ${money(100)} preserves deduction semantics`, () => assigned(parse(receipt(body({ money })))));
for (const [open, close] of [['[', ']'], ['【', '】'], ['（', '）']]) test(`matching ID ${open}${close} with split label and amount`, () => assigned(parse(receipt(body().replace(/\(明細ID/g, open + '明細ID').replace(/\)/g, close)))));
for (const length of [4, 16]) {
  const ids = ['A' + '1'.repeat(length - 1), 'B' + '2'.repeat(length - 1)];
  test(`${length} fragments plus closing, scope, label and money rows`, () => {
    const items = `${part(ids[0])}\n${part(ids[1])}\n(明細ID ${ids[0].split('').join('\n')}\n)\n単品\n値引\n¥100\n(明細ID ${ids[1].split('').join('\n')}\n)\n商品\n値引\n¥200`;
    assigned(parse(receipt(items)), { ids });
  });
}
test('a 16-character initial fragment reaches its split amount', () => {
  const ids = ['A' + '1'.repeat(15), 'B' + '2'.repeat(15)];assigned(parse(receipt(body({ ids }))), { ids });
});
test('value-only brackets preserve exact ID correspondence', () => assigned(parse(receipt(body().replace(/\(明細ID (A101|B102)\n\)/g, '明細ID [$1\n]')))));
test('literal ID separators are unchanged', () => {
  const ids = ['A-101', 'B_102'];
  const items = body({ ids }).replace('A-101\n)', 'A-\n101)').replace('B_102\n)', 'B_\n102)');
  assigned(parse(receipt(items)), { ids });
});
test('numeric IDs remain distinct from the following deduction amount', () => {
  const ids = ['1011', '1022'];assigned(parse(receipt(body({ ids }))), { ids });
});
test('deductions printed directly after each merchandise row keep their exact target', () => assigned(parse(receipt(`${part('A101')}\n${ref('A101', 100, { layout: 'complete' })}\n${part('B102')}\n${ref('B102', 200, { layout: 'fragment' })}`))));
for (const newline of ['\n', '\r\n', '\r']) test(`${JSON.stringify(newline)} preserves label and currency boundaries`, () => assigned(parse(receipt(body()).replace(/\n/g, newline))));
test('a single split amount is assigned wholly to the matching product', () => assigned(parse(receipt(`${part('A101')}\n${part('B102')}\n${ref('A101', 100)}`, { net: 1900 })), { discounts: [100, 0], gross: [900, 1000] }));
test('tax allocation follows the exact split deduction', () => assigned(parse(receipt(body(), { tax: 136 })), { gross: [972, 864] }));
test('original label, currency, whitespace and caller objects remain intact', () => {
  const text = receipt(body({ scope: '\t単品\t', ownLabel: true, money: n => '\t¥' + n + '\t' })), input = { text, whole: text, diagnostics: [{ label: '全体', text }] };
  const before = JSON.stringify(input), p = parse(input);assigned(p);assert.equal(JSON.stringify(input), before);assert(p.rawText.includes('単品\t\n値引\n\t¥100\t'));assert(p.debugText.includes('単品\t\n値引\n\t¥100\t'));
});

for (const label of ['値引後価格', '値引前', '値下', '値引合計', 'クーポン', '会員値引', '値引10%', '注記 値引', '値引 値引', '値引 (明細ID C103)', '値引取消']) test(`uncertain label remains manual: ${label}`, () => held(parse(receipt(body({ label }))), ['値引後価格', '値引前', '値下'].includes(label)));
for (const money of ['100', '1', '0', '¥0', '¥1000001', '¥1,00', '¥100 ¥200', '¥100 注記', '¥100 (明細ID C103)', '消費税 ¥100', '単価 ¥100', '@100', '¥100 1点', '2200083271771', '$100', '¥10%', '¥100\n¥200']) test(`uncertain standalone amount is not guessed: ${JSON.stringify(money)}`, () => {
  const items = body().replace('¥100\n(明細ID', money + '\n(明細ID');
  held(parse(receipt(items)));
});
for (const extra of ['¥0', '100']) test(`an additional adjacent monetary candidate is ambiguous: ${extra}`, () => {
  const items = body().replace('¥100\n(明細ID', '¥100\n' + extra + '\n(明細ID');
  held(parse(receipt(items)));
});
for (const barrier of ['\n', '\t\n', '注記\n', '歯ブラシ ¥100\n', '(明細ID C103)\n', '消費税 ¥0\n', '¥200\n']) test(`a barrier after the label is not skipped: ${JSON.stringify(barrier)}`, () => held(parse(receipt(body().replace('値引\n¥100', '値引\n' + barrier + '¥100')))));
for (const scope of ['商品対象外', '(対象外)', '単品取消', '商品 次回用', '商品2点', '単品 10%', '商品 ¥50', '商品 単品', '(単品]', '((単品))']) test(`scope restrictions survive the split label: ${scope}`, () => held(parse(receipt(body({ scope, ownLabel: true })))));
for (const fragment of ['A\t101', 'A\n\t101', 'A101 ', 'A\n101 ', 'A-\n_101']) test(`money rows cannot repair ID fragments: ${JSON.stringify(fragment)}`, () => held(parse(receipt(body().replace('明細ID A101\n', '明細ID ' + fragment + '\n')))));
test('a wrong ID bracket remains manual', () => held(parse(receipt(body().replace('A101\n)', 'A101\n]')))));
test('no ID means a matching amount is insufficient', () => held(parse(receipt(`${part('A101')}\n${part('B102')}\n値引\n¥100\n値引\n¥200`))));
test('unbounded IDs do not gain the split-amount exception', () => held(parse(receipt(body({ layout: 'complete' }).replace(/\(明細ID (A101|B102)\) 値引/g, '明細ID $1 値引')))));
test('product text before the reference cannot become a deduction', () => held(parse(receipt(body({ layout: 'complete' }).replace('(明細ID A101) 値引', '緑茶 (明細ID A101) 値引')))));
test('folded merchandise cannot corroborate folded references', () => held(parse(receipt(`${part('A101\n')}\n${part('B102\n')}\n${ref('A101', 100)}\n${ref('B102', 200)}`))));
for (const layout of ['close', 'complete']) {
  test(`${layout} reference cannot borrow full product IDs from another pass`, () => held(parse({ text: receipt(`${part('A101\n')}\n商品値引 ¥100\n${part('B102\n')}\n商品値引 ¥200`), whole: receipt(body({ layout })) })));
  test(`${layout} merged reference cannot replace actual same-source proof`, () => held(parse({ text: receipt(body({ layout })), diagnostics: [{ label: '分割 1', text: receipt(`${part('A101')}\n${part('B102')}`) }, { label: '分割 2', text: receipt(`${ref('A101', 100, { layout })}\n${ref('B102', 200, { layout })}`) }] })));
  test(`${layout} conflicting allocation remains manual`, () => held(parse({ text: receipt(body({ layout })), whole: receipt(body({ layout }).replace('¥100', '¥50').replace('¥200', '¥250')) })));
}
test('a spaced complete spelling competing with a compact fold is ambiguous', () => held(parse(receipt(`${part('A101')}\n${part('A 101')}\n${ref('A\n101', 100)}\n(明細ID A 101) 値引 ¥200`))));
test('a different complete spelling is not corrected', () => held(parse(receipt(body().replace('緑茶 (明細ID A101)', '緑茶 (明細ID A1O1)')))));
test('duplicate complete priced IDs cannot identify a unique target', () => held(parse(receipt(`${part('A101')}\n${part('A101')}\n${ref('A101', 300)}`))));
test('duplicate split references cannot infer one shared recovery', () => held(parse(receipt(`${part('A101')}\n${part('B102')}\n${ref('A101', 100)}\n${ref('A101', 50)}\n${ref('B102', 150)}`))));
test('a seventeenth fragment cannot be truncated', () => {
  const id = 'A' + '1'.repeat(16);held(parse(receipt(body({ ids: [id, 'B102'] }).replace(`(明細ID ${id}\n)`, `(明細ID ${id.split('').join('\n')}\n)`).replace(`緑茶 (明細ID ${id})`, `緑茶 (明細ID ${id.slice(0, 16)})`))));
});
test('a label and amount after checkout are not current-sale proof', () => held(parse(receipt(`${part('A101')}\n${part('B102')}\n商品値引 ¥100\n商品値引 ¥200`) + '\n' + ref('A101', 100))));
for (const options of [{ count: 0 }, { paid: false }, { net: 1699 }]) test(`split labels cannot replace accounting: ${JSON.stringify(options)}`, () => held(parse(receipt(body(), options))));
test('learning cannot replace a missing complete product ID', () => {
  const r = runtime();r.storage.set('okozukaiReceiptProductDictionaryV1', JSON.stringify([{ shopKey: 'テスト商', name: '緑茶', aliases: ['緑茶'], priceHints: [1000], source: 'learned', confirmedCount: 6 }]));
  held(parse(receipt(`${part('A101\n')}\n${part('B102')}\n${ref('A101', 100)}\n${ref('B102', 200)}`), r));assert.equal(r.writes.length, 0);
});
test('split-label recovery preserves ledger, dictionary and schema', () => {
  const r = runtime();r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'unrelated', name: '学習商品', priceHints: [73], source: 'learned', confirmedCount: 4 }]);r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);
  const before = r.evaluate('JSON.stringify(state)');assigned(parse(receipt(body()), r));held(parse(receipt(body({ label: '値引後価格' })), r), true);
  assert.equal(r.evaluate('JSON.stringify(state)'), before);assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);assert.equal(r.writes.length, 0);assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});
for (const [name, options, valid] of [['folded ID', {}, true], ['complete ID and separate scope', { layout: 'complete', scope: '(単品)', ownLabel: true, ownScope: true }, true], ['after-discount price', { label: '値引後価格' }, false]]) test(`mock OCR: ${name} and data safety`, async () => {
  const r = runtime(), a = r.context.receiptInternals, text = receipt(body(options));let terminated = 0;
  r.context.Tesseract = { async createWorker() { return { async setParameters() {}, async recognize() { return { data: { text, blocks: [] } }; }, async terminate() { terminated++; } }; } };
  const canvas = { width: 100, height: 300 };
  const ocr = await a.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'middle', canvas }, { role: 'bottom', canvas }], shopSlices: [], itemSlices: Array.from({ length: 7 }, () => ({ canvas })), amountSlices: [], paymentSlices: [] });
  const p = parse(ocr, r);if (valid) assigned(p);else held(p, true);assert.equal(terminated, 1);assert.equal(r.writes.length, 0);
});
