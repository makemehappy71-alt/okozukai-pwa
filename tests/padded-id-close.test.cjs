const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const code = '2200083271771';
const part = id => `緑茶 (明細ID ${id})\n${code} 1 ¥1,000`;
const refs = ids => `(明細ID ${ids[0]}) 値引 ¥100\n(明細ID ${ids[1]}) 値引 ¥200`;
const closeRow = '\t ) \t';
const product = (id, close = closeRow) => `緑茶 (明細ID ${id}\n${close}\n${code} 1 ¥1,000`;
const products = (close = closeRow, ids = ['A101', 'B102'], fold = id => id) => `${product(fold(ids[0]), close)}\n${product(fold(ids[1]), close)}\n${refs(ids)}`;
const references = (close = closeRow, ids = ['A101', 'B102'], fold = id => id) => `${part(ids[0])}\n${part(ids[1])}\n値引 ¥100 (明細ID ${fold(ids[0])}\n${close}\n値引 ¥200 (明細ID ${fold(ids[1])}\n${close}`;
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

for (const [name, body] of [['merchandise', products], ['reference', references]]) {
  for (const close of [' )', ') ', '  )  ', '\t)', ')\t', '\t)\t', closeRow, '　）　']) test(`${name}: closing-only padding ${JSON.stringify(close)} requires exact same-source proof`, () => assigned(parse(receipt(body(close)))));
  for (const [open, close] of [['[', ']'], ['【', '】']]) test(`${name}: matching ${open}${close} with mixed space and TAB padding`, () => assigned(parse(receipt(body().replace(/\(明細ID/g, open + '明細ID').replace(/\)/g, close)))));
  test(`${name}: 16 ID fragments plus one padded closing row`, () => {
    const ids = ['A' + '1'.repeat(15), 'B' + '2'.repeat(15)];assigned(parse(receipt(body(closeRow, ids, id => id.split('').join('\n')))), ids);
  });
  test(`${name}: a full 16-character fragment still reaches its padded close`, () => {
    const ids = ['A' + '1'.repeat(15), 'B' + '2'.repeat(15)];assigned(parse(receipt(body(closeRow, ids))), ids);
  });
}
test('value-only brackets distinguish closing padding from ID contents', () => assigned(parse(receipt(`明細ID [A101\n\t ] \t\n緑茶\n${code} 1 ¥1,000\n明細ID [B102\n\t ] \t\n緑茶\n${code} 1 ¥1,000\n${refs(['A101', 'B102'])}`))));
test('postfix merchandise IDs retain their unique priced rows', () => assigned(parse(receipt(`緑茶\n${code} 1 ¥1,000\n(明細ID A101\n${closeRow}\n補足情報\n緑茶\n${code} 1 ¥1,000\n(明細ID B102\n${closeRow}\n${refs(['A101', 'B102'])}`))));
test('literal ID separators are retained through fragment and padding recovery', () => assigned(parse(receipt(products(closeRow, ['A-101', 'B_102'], id => id.slice(0, 2) + '\n' + id.slice(2)))), ['A-101', 'B_102']));
test('numeric ID spelling is corroborated without guessing', () => assigned(parse(receipt(products(closeRow, ['1011', '1022']))), ['1011', '1022']));
for (const newline of ['\n', '\r\n', '\r']) test(`${JSON.stringify(newline)} does not turn closing padding into ID whitespace`, () => assigned(parse(receipt(products()).replace(/\n/g, newline))));
test('one recovered reference takes its full single deduction', () => assigned(parse(receipt(`${part('A101')}\n${part('B102')}\n値引 ¥100 (明細ID A101\n${closeRow}`, { net: 1900 })), undefined, [100, 0], [900, 1000]));
test('tax allocation still follows the exact recovered ID', () => assigned(parse(receipt(references(), { tax: 136 })), undefined, [100, 200], [972, 864]));
test('original whitespace, diagnostics and caller-owned objects are retained', () => {
  const input = { text: receipt(products()), whole: receipt(references()), diagnostics: [{ label: '全体', text: receipt(products()) }] };
  const before = JSON.stringify(input), p = parse(input);assigned(p);assert.equal(JSON.stringify(input), before);assert(p.rawText.includes('A101\n' + closeRow));assert(p.debugText.includes('A101\n' + closeRow));
});

test('closing padding cannot replace the missing full counterpart', () => held(parse(receipt(`${product('A101')}\n商品値引 ¥100\n${product('B102')}\n商品値引 ¥200`))));
test('both sides with padded closes cannot corroborate themselves', () => held(parse(receipt(`${product('A101')}\n${product('B102')}\n値引 ¥100 (明細ID A101\n${closeRow}\n値引 ¥200 (明細ID B102\n${closeRow}`))));
test('a complete spelling found only in a different OCR pass is insufficient', () => {
  const incomplete = receipt(`${product('A101')}\n商品値引 ¥100\n${product('B102')}\n商品値引 ¥200`);
  held(parse({ text: incomplete, whole: receipt(`${part('A101')}\n商品値引 ¥100\n${part('B102')}\n商品値引 ¥200`) }));
});
test('merged OCR text cannot manufacture same-source corroboration', () => {
  const p = parse({ text: receipt(products()), diagnostics: [{ label: '分割 1', text: receipt(`${product('A101')}\n商品値引 ¥100\n${product('B102')}\n商品値引 ¥200`) }, { label: '分割 2', text: receipt(refs(['A101', 'B102'])) }] });held(p);assert.equal(p.wrappedIdRecoveryCount || 0, 0);
});
test('a spaced complete ID competing with a compact fold remains ambiguous', () => held(parse(receipt(`${part('A101')}\n${part('A 101')}\n値引 ¥100 (明細ID A\n101\n${closeRow}\n(明細ID A 101) 値引 ¥200`))));
for (const id of ['a101', 'A1O1', 'A_101', 'A 101']) test(`different complete spelling ${id} is not corrected`, () => held(parse(receipt(products().replace('(明細ID A101) 値引', `(明細ID ${id}) 値引`)))));
for (const close of ['\t ] \t', '\t )) \t', '\t ) 注記\t', '\t )\t値引 ¥100', '\t \n\t)', '\n\t)', '\t\v)\t', '\t)\f', '\t\u200b)\t', '\t)\u2028', '消費税 ¥0\n\t)', '¥100\n\t)', 'NOTE\n\t)']) test(`unsupported closing content is not erased: ${JSON.stringify(close)}`, () => held(parse(receipt(products().replace(closeRow, close)))));
for (const fragment of ['A\t101', 'A\n\t101', 'A\n101\t', 'A101 ', 'A\n101 ', 'A-\n_101', 'A101\n0']) test(`closing padding cannot relax ID fragments: ${JSON.stringify(fragment)}`, () => held(parse(receipt(products().replace('A101\n' + closeRow, fragment + '\n' + closeRow)))));
test('an unclosed ID cannot borrow a padded closing bracket from after checkout', () => held(parse(receipt(products().replace(closeRow, '')) + '\n' + closeRow)));
test('seventeen characters cannot be truncated before a padded close', () => {
  const id = 'A' + '1'.repeat(16);held(parse(receipt(products(closeRow, [id, 'B102']).replace(`(明細ID ${id}) 値引`, `(明細ID ${id.slice(0, 16)}) 値引`))));
});
test('seventeen fragments cannot be truncated before a padded close', () => {
  const id = 'A' + '1'.repeat(16);held(parse(receipt(products(closeRow, [id, 'B102'], value => value.split('').join('\n')).replace(`(明細ID ${id}) 値引`, `(明細ID ${id.slice(0, 16)}) 値引`))));
});
test('duplicate complete priced IDs are not a unique reference target', () => held(parse(receipt(`${part('A101')}\n${part('A101')}\n値引 ¥300 (明細ID A101\n${closeRow}`))));
test('duplicate folded merchandise IDs cannot share one complete deduction', () => held(parse(receipt(`${product('A101')}\n${product('A101')}\n(明細ID A101) 値引 ¥300`))));
test('a footer reference is not an independent witness', () => {
  const p = parse(receipt(`${product('A101')}\n商品値引 ¥100\n${part('B102')}\n商品値引 ¥200`) + '\n(明細ID A101) 値引 ¥100');held(p);assert.equal(p.wrappedIdRecoveryCount || 0, 0);
});
test('a deduction summary is not a complete individual reference', () => held(parse(receipt(products().replace('(明細ID A101) 値引', '(明細ID A101) 値引合計')))));
for (const options of [{ count: 0 }, { paid: false }, { net: 1699 }]) test(`padded closing recovery cannot replace accounting: ${JSON.stringify(options)}`, () => held(parse(receipt(products(), options))));
test('conflicting OCR deductions remain manual', () => held(parse({ text: receipt(products()), whole: receipt(references().replace('¥100', '¥200').replace('¥200 (明細ID B102', '¥100 (明細ID B102')) })));
test('learning cannot replace the missing independent full ID', () => {
  const r = runtime();r.storage.set('okozukaiReceiptProductDictionaryV1', JSON.stringify([{ shopKey: 'テスト商', name: '緑茶', aliases: ['緑茶'], priceHints: [1000], source: 'learned', confirmedCount: 6 }]));
  held(parse(receipt(`${product('A101')}\n商品値引 ¥100\n${part('B102')}\n商品値引 ¥200`), r));assert.equal(r.writes.length, 0);
});
test('padded closing recovery preserves ledger, dictionary and schema', () => {
  const r = runtime();r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'unrelated', name: '学習商品', priceHints: [73], source: 'learned', confirmedCount: 4 }]);r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);
  const before = r.evaluate('JSON.stringify(state)');assigned(parse(receipt(products()), r));held(parse(receipt(products().replace('A101\n', 'A\t101\n')), r));
  assert.equal(r.evaluate('JSON.stringify(state)'), before);assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);assert.equal(r.writes.length, 0);assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});
for (const [name, body, valid] of [['merchandise', products(), true], ['reference', references(), true], ['TAB in ID', products().replace('A101\n', 'A\t101\n'), false]]) test(`mock OCR: ${name} with padded closes and no storage writes`, async () => {
  const r = runtime(), a = r.context.receiptInternals, text = receipt(body);let terminated = 0;
  r.context.Tesseract = { async createWorker() { return { async setParameters() {}, async recognize() { return { data: { text, blocks: [] } }; }, async terminate() { terminated++; } }; } };
  const canvas = { width: 100, height: 300 };
  const ocr = await a.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'middle', canvas }, { role: 'bottom', canvas }], shopSlices: [], itemSlices: Array.from({ length: 7 }, () => ({ canvas })), amountSlices: [], paymentSlices: [] });
  const p = parse(ocr, r);if (valid) assigned(p);else held(p);assert.equal(terminated, 1);assert.equal(r.writes.length, 0);
});
