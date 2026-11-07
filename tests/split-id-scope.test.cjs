const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const code = '2200083271771';
const part = id => `緑茶 (明細ID ${id})\n${code} 1 ¥1,000`;
const ref = (id, n, { note = '単品', folded = true, ownNote = false, label = '値引' } = {}) => `(明細ID ${id}${folded ? '\n' : ''})${ownNote ? '\n' : ' '}${note}\n${label} ¥${n}`;
const body = (options = {}) => {
  const ids = options.ids || ['A101', 'B102'], fold = options.fold || (id => id);
  return `${part(ids[0])}\n${part(ids[1])}\n${ref(fold(ids[0]), 100, options)}\n${ref(fold(ids[1]), 200, options)}`;
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
function held(p) {
  assert.equal(p.discountAttributionConfirmed, false);
  assert.equal(p.discountReviewRequired, true);
  assert.equal(p.itemSetComplete, false);
  assert.equal(p.autoConfirmedItemCount, 0);
  assert.equal(p.productCandidateAutoConfirmed, false);
  assert.equal(p.splitRows.length, 0);
}

for (const folded of [true, false]) for (const ownNote of [true, false]) {
  for (const note of ['単品', '商品', '(単品)', '【商品】', '\t単品\t']) test(`${folded ? 'folded' : 'complete'} ID, ${ownNote ? 'own' : 'closing'} note row: ${JSON.stringify(note)}`, () => assigned(parse(receipt(body({ folded, ownNote, note })))));
}
for (const label of ['割引', '値引額', '割引額', '値下額', '値下げ額']) test(`explicit following ${label} amount remains a deduction`, () => assigned(parse(receipt(body({ label })))));
for (const [open, close] of [['[', ']'], ['【', '】'], ['（', '）']]) test(`matching ID ${open}${close} with separate scope and deduction`, () => assigned(parse(receipt(body().replace(/\(明細ID/g, open + '明細ID').replace(/\)/g, close)))));
for (const length of [4, 16]) for (const ownNote of [true, false]) {
  const ids = ['A' + '1'.repeat(length - 1), 'B' + '2'.repeat(length - 1)];
  test(`${length} ID fragments followed by ${ownNote ? 'separate closing, note, amount' : 'closing-note and amount'} rows`, () => assigned(parse(receipt(body({ ids, ownNote, fold: id => id.split('').join('\n') }))), { ids }));
}
test('a 16-character first fragment still reaches the note and amount', () => {
  const ids = ['A' + '1'.repeat(15), 'B' + '2'.repeat(15)];assigned(parse(receipt(body({ ids }))), { ids });
});
for (const ownNote of [true, false]) test(`last ID characters and closing bracket share a row before ${ownNote ? 'an independent' : 'a same-row'} note`, () => assigned(parse(receipt(body({ ownNote }).replace('A101\n)', 'A\n101)').replace('B102\n)', 'B\n102)')))));
test('value-only ID brackets retain their exact witness', () => assigned(parse(receipt(body().replace(/\(明細ID (A101|B102)\n\)/g, '明細ID [$1\n]')))));
test('literal ID separators are not changed', () => {
  const ids = ['A-101', 'B_102'];assigned(parse(receipt(body({ ids, fold: id => id.slice(0, 2) + '\n' + id.slice(2) }))), { ids });
});
for (const newline of ['\n', '\r\n', '\r']) test(`${JSON.stringify(newline)} keeps the separate note and amount contiguous`, () => assigned(parse(receipt(body()).replace(/\n/g, newline))));
test('a single split-note deduction stays with its one exact product', () => assigned(parse(receipt(`${part('A101')}\n${part('B102')}\n${ref('A101', 100)}`, { net: 1900 })), { discounts: [100, 0], gross: [900, 1000] }));
test('tax allocation follows the identified split-note deduction', () => assigned(parse(receipt(body(), { tax: 136 })), { gross: [972, 864] }));
test('original note, amount, tabs, line breaks and caller objects remain intact', () => {
  const text = receipt(body({ note: '\t(単品)\t' })), input = { text, whole: text, diagnostics: [{ label: '全体', text }] };
  const before = JSON.stringify(input), p = parse(input);assigned(p);assert.equal(JSON.stringify(input), before);assert(p.rawText.includes('A101\n) \t(単品)\t\n値引 ¥100'));assert(p.debugText.includes('A101\n) \t(単品)\t\n値引 ¥100'));
});

for (const note of ['商品対象外', '単品取消', '商品 次回用', '商品2点', '単品 10%', '商品 ¥50', '(注記)', '(対象外)', '(単品]', '((単品))', '商品 単品', '商品 明細ID C103', '会員']) test(`uncertain note does not authorize joining: ${note}`, () => held(parse(receipt(body({ note })))));
for (const gap of ['\n', '\t\n', '注記\n', '歯ブラシ ¥100\n', '(明細ID C103)\n', '消費税 ¥0\n', '¥100\n']) test(`a barrier between scope and amount is not skipped: ${JSON.stringify(gap)}`, () => held(parse(receipt(body().replace('単品\n値引 ¥100', '単品\n' + gap + '値引 ¥100')))));
for (const amount of ['¥100', '値引後価格 ¥100', '値引合計 ¥100', '値引 10%', '値引 ¥0', '値引 ¥1000001', '値引 ¥1,00', '値引 ¥100 注記', '値引 ¥100 ¥200', '値引 ¥100 (明細ID C103)', '値引\n¥100', '商品値引 ¥100']) test(`uncertain following amount remains manual: ${JSON.stringify(amount)}`, () => held(parse(receipt(body().replace('値引 ¥100', amount)))));
for (const fragment of ['A\t101', 'A\n\t101', 'A101 ', 'A\n101 ', 'A-\n_101']) test(`split scope does not repair ID fragments: ${JSON.stringify(fragment)}`, () => held(parse(receipt(body().replace('明細ID A101\n', '明細ID ' + fragment + '\n')))));
test('wrong ID closing bracket remains manual', () => held(parse(receipt(body().replace('A101\n)', 'A101\n]')))));
test('a note and amount without an ID cannot infer the target', () => held(parse(receipt(`${part('A101')}\n${part('B102')}\n単品\n値引 ¥100\n単品\n値引 ¥200`))));
test('an unbounded ID does not gain the split-note exception', () => held(parse(receipt(body({ folded: false }).replace(/\(明細ID (A101|B102)\) 単品/g, '明細ID $1 単品')))));
test('product text before a reference is not reinterpreted as a deduction', () => held(parse(receipt(body({ folded: false }).replace('(明細ID A101) 単品', '緑茶 (明細ID A101) 単品')))));
test('both sides folded cannot corroborate their spelling', () => held(parse(receipt(`${part('A101\n')}\n${part('B102\n')}\n${ref('A101', 100)}\n${ref('B102', 200)}`))));
for (const folded of [true, false]) {
  test(`${folded ? 'folded' : 'complete'} split reference cannot borrow products from another pass`, () => held(parse({ text: receipt(`${part('A101\n')}\n商品値引 ¥100\n${part('B102\n')}\n商品値引 ¥200`), whole: receipt(body({ folded })) })));
  test(`${folded ? 'folded' : 'complete'} merged split reference cannot bypass actual records`, () => held(parse({ text: receipt(body({ folded })), diagnostics: [{ label: '分割 1', text: receipt(`${part('A101')}\n${part('B102')}`) }, { label: '分割 2', text: receipt(`${ref('A101', 100, { folded })}\n${ref('B102', 200, { folded })}`) }] })));
  test(`${folded ? 'folded' : 'complete'} conflicting split allocations remain manual`, () => held(parse({ text: receipt(body({ folded })), whole: receipt(body({ folded }).replace('¥100', '¥50').replace('¥200', '¥250')) })));
}
test('a spaced complete spelling competing with a compact fold is ambiguous', () => held(parse(receipt(`${part('A101')}\n${part('A 101')}\n${ref('A\n101', 100)}\n(明細ID A 101) 値引 ¥200`))));
test('different full ID spelling is not corrected', () => held(parse(receipt(body().replace('緑茶 (明細ID A101)', '緑茶 (明細ID A1O1)')))));
test('duplicate complete priced IDs are not unique', () => held(parse(receipt(`${part('A101')}\n${part('A101')}\n${ref('A101', 300)}`))));
test('duplicate split references cannot infer one shared recovery', () => held(parse(receipt(`${part('A101')}\n${part('B102')}\n${ref('A101', 100)}\n${ref('A101', 50)}\n${ref('B102', 150)}`))));
test('seventeen fragments cannot be truncated before the split note', () => {
  const id = 'A' + '1'.repeat(16);held(parse(receipt(body({ ids: [id, 'B102'], fold: value => value.split('').join('\n') }).replace(`緑茶 (明細ID ${id})`, `緑茶 (明細ID ${id.slice(0, 16)})`))));
});
test('a split reference after checkout is not current-sale evidence', () => held(parse(receipt(`${part('A101')}\n${part('B102')}\n商品値引 ¥100\n商品値引 ¥200`) + '\n' + ref('A101', 100))));
for (const options of [{ count: 0 }, { paid: false }, { net: 1699 }]) test(`split scope cannot replace accounting: ${JSON.stringify(options)}`, () => held(parse(receipt(body(), options))));
test('learning cannot establish a missing full product ID', () => {
  const r = runtime();r.storage.set('okozukaiReceiptProductDictionaryV1', JSON.stringify([{ shopKey: 'テスト商', name: '緑茶', aliases: ['緑茶'], priceHints: [1000], source: 'learned', confirmedCount: 6 }]));
  held(parse(receipt(`${part('A101\n')}\n${part('B102')}\n${ref('A101', 100)}\n${ref('B102', 200)}`), r));assert.equal(r.writes.length, 0);
});
test('split-scope recovery preserves ledger, dictionary and schema', () => {
  const r = runtime();r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'unrelated', name: '学習商品', priceHints: [73], source: 'learned', confirmedCount: 4 }]);r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);
  const before = r.evaluate('JSON.stringify(state)');assigned(parse(receipt(body()), r));held(parse(receipt(body({ note: '商品対象外' })), r));
  assert.equal(r.evaluate('JSON.stringify(state)'), before);assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);assert.equal(r.writes.length, 0);assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});
for (const [name, options, valid] of [['folded note', {}, true], ['complete ID with own note', { folded: false, ownNote: true }, true], ['excluded note', { note: '商品対象外' }, false]]) test(`mock OCR: ${name} and data safety`, async () => {
  const r = runtime(), a = r.context.receiptInternals, text = receipt(body(options));let terminated = 0;
  r.context.Tesseract = { async createWorker() { return { async setParameters() {}, async recognize() { return { data: { text, blocks: [] } }; }, async terminate() { terminated++; } }; } };
  const canvas = { width: 100, height: 300 };
  const ocr = await a.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'middle', canvas }, { role: 'bottom', canvas }], shopSlices: [], itemSlices: Array.from({ length: 7 }, () => ({ canvas })), amountSlices: [], paymentSlices: [] });
  const p = parse(ocr, r);if (valid) assigned(p);else held(p);assert.equal(terminated, 1);assert.equal(r.writes.length, 0);
});
