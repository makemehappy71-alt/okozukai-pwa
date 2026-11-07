const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const code = '2200083271771';
const part = id => `緑茶 (明細ID ${id})\n${code} 1 ¥1,000`;
const refs = ids => `(明細ID ${ids[0]}) 値引 ¥100\n(明細ID ${ids[1]}) 値引 ¥200`;
const products = (ids = ['A101', 'B102'], fold = id => id) => `${part(fold(ids[0]) + '\n')}\n${part(fold(ids[1]) + '\n')}\n${refs(ids)}`;
const references = (ids = ['A101', 'B102'], fold = id => id) => `${part(ids[0])}\n${part(ids[1])}\n値引 ¥100 (明細ID ${fold(ids[0])}\n)\n値引 ¥200 (明細ID ${fold(ids[1])}\n)`;
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
  test(`${name} ID with a separate close requires its exact complete counterpart`, () => assigned(parse(receipt(body()))));
  for (const length of [4, 16]) {
    const ids = ['A' + '1'.repeat(length - 1), 'B' + '2'.repeat(length - 1)];
    test(`${name}: ${length} one-character fragments plus one closing-only row`, () => assigned(parse(receipt(body(ids, id => id.split('').join('\n')))), ids));
  }
  test(`${name}: a 16-character first fragment still allows the closing-only row`, () => {
    const ids = ['A' + '1'.repeat(15), 'B' + '2'.repeat(15)];assigned(parse(receipt(body(ids))), ids);
  });
  for (const [open, close] of [['[', ']'], ['【', '】'], ['（', '）']]) test(`${name}: matching ${open}${close} with a separate close`, () => assigned(parse(receipt(body().replace(/\(明細ID/g, open + '明細ID').replace(/\)/g, close)))));
}
test('value-only brackets can close on the following row', () => assigned(parse(receipt(`明細ID [A101\n]\n緑茶\n${code} 1 ¥1,000\n明細ID [B102\n]\n緑茶\n${code} 1 ¥1,000\n${refs(['A101', 'B102'])}`))));
test('postfix merchandise IDs keep their unique physical rows', () => assigned(parse(receipt(`緑茶\n${code} 1 ¥1,000\n(明細ID A101\n)\n補足情報\n緑茶\n${code} 1 ¥1,000\n(明細ID B102\n)\n${refs(['A101', 'B102'])}`))));
test('literal separators survive fragment and closing-only rows', () => assigned(parse(receipt(products(['A-101', 'B_102'], id => id.slice(0, 2) + '\n' + id.slice(2)))), ['A-101', 'B_102']));
test('numeric IDs still require exact canonical spelling', () => assigned(parse(receipt(products(['1011', '1022']))), ['1011', '1022']));
test('full-width IDs and brackets normalize consistently', () => assigned(parse(receipt(products(['Ａ１０１', 'Ｂ１０２']).replace(/\(/g, '（').replace(/\)/g, '）')))));
for (const newline of ['\n', '\r\n', '\r']) test(`${JSON.stringify(newline)} preserves a separate closing row`, () => assigned(parse(receipt(products()).replace(/\n/g, newline))));
test('a single recovered merchandise ID receives its entire deduction', () => assigned(parse(receipt(`${part('A101\n')}\n${part('B102')}\n(明細ID A101) 値引 ¥100`, { net: 1900 })), undefined, [100, 0], [900, 1000]));
test('tax allocation follows the exact recovered reference', () => assigned(parse(receipt(references(), { tax: 136 })), undefined, [100, 200], [972, 864]));
test('original OCR, diagnostics and caller objects retain the closing-only row', () => {
  const input = { text: receipt(products()), whole: receipt(references()), diagnostics: [{ label: '全体', text: receipt(products()) }] };
  const before = JSON.stringify(input), p = parse(input);assigned(p);assert.equal(JSON.stringify(input), before);assert(p.rawText.includes('A101\n)'));assert(p.debugText.includes('A101\n)'));
});

test('a separate close without complete references is insufficient', () => held(parse(receipt(`${part('A101\n')}\n商品値引 ¥100\n${part('B102\n')}\n商品値引 ¥200`))));
test('two closing-only layouts cannot corroborate each other', () => held(parse(receipt(`${part('A101\n')}\n${part('B102\n')}\n値引 ¥100 (明細ID A101\n)\n値引 ¥200 (明細ID B102\n)`))));
test('a complete spelling available only in another OCR pass is insufficient', () => {
  const incomplete = receipt(`${part('A101\n')}\n商品値引 ¥100\n${part('B102\n')}\n商品値引 ¥200`);
  held(parse({ text: incomplete, whole: receipt(`${part('A101')}\n商品値引 ¥100\n${part('B102')}\n商品値引 ¥200`) }));
});
test('merged sources cannot invent the independent full counterpart', () => {
  const p = parse({ text: receipt(products()), diagnostics: [{ label: '分割 1', text: receipt(`${part('A101\n')}\n商品値引 ¥100\n${part('B102\n')}\n商品値引 ¥200`) }, { label: '分割 2', text: receipt(refs(['A101', 'B102'])) }] });held(p);assert.equal(p.wrappedIdRecoveryCount || 0, 0);
});
test('a spaced ID competing with a folded spelling remains ambiguous', () => held(parse(receipt(`${part('A101')}\n${part('A 101')}\n値引 ¥100 (明細ID A\n101\n)\n(明細ID A 101) 値引 ¥200`))));
for (const id of ['a101', 'A1O1', 'A_101', 'A 101']) test(`the different complete spelling ${id} is not corrected`, () => held(parse(receipt(products().replace('(明細ID A101) 値引', `(明細ID ${id}) 値引`)))));
for (const ending of ['\n\t)', '\n )', '\n) ']) test(`closing-only padding uses the same independent complete-ID evidence: ${JSON.stringify(ending)}`, () => assigned(parse(receipt(products().replace('A101\n)', 'A101' + ending)))));
for (const ending of ['\n]', '\n))', '\n) 注記', '\n\n)', '\n\t\n)', '\n消費税 ¥0\n)', '\nNOTE\n)', '\n明細ID C103\n)', '\n¥100\n)']) test(`unsupported closing sequence remains manual: ${JSON.stringify(ending)}`, () => held(parse(receipt(products().replace('A101\n)', 'A101' + ending)))));
for (const fragment of ['A101 ', 'A\t101', 'A\n101 ', 'A-\n_101', 'A101\n0']) test(`invalid or mismatching fragments are not repaired: ${JSON.stringify(fragment)}`, () => held(parse(receipt(products().replace('A101\n)', fragment + '\n)')))));
test('a closing bracket on a discount row is outside the closing-only grammar', () => held(parse(receipt(`${part('A101')}\n${part('B102')}\n(明細ID A101\n) 値引 ¥100\n(明細ID B102\n) 値引 ¥200`))));
test('a seventeenth character is not discarded before a closing-only row', () => held(parse(receipt(products(['A' + '1'.repeat(16), 'B102']).replace('(明細ID A' + '1'.repeat(16) + ') 値引', '(明細ID A' + '1'.repeat(15) + ') 値引')))));
test('a seventeenth fragment is not discarded before the closing-only row', () => {
  const id = 'A' + '1'.repeat(16), body = products([id, 'B102'], value => value.split('').join('\n')).replace(`(明細ID ${id}) 値引`, `(明細ID ${id.slice(0, 16)}) 値引`);held(parse(receipt(body)));
});
test('a duplicate full priced ID is not a unique reference target', () => held(parse(receipt(`${part('A101')}\n${part('A101')}\n値引 ¥300 (明細ID A101\n)`))));
test('duplicate folded merchandise IDs cannot share one full deduction', () => held(parse(receipt(`${part('A101\n')}\n${part('A101\n')}\n(明細ID A101) 値引 ¥300`))));
test('a complete footer after checkout is not corroboration', () => {
  const p = parse(receipt(`${part('A101\n')}\n商品値引 ¥100\n${part('B102')}\n商品値引 ¥200`) + '\n(明細ID A101) 値引 ¥100');held(p);assert.equal(p.wrappedIdRecoveryCount || 0, 0);
});
test('a deduction summary cannot corroborate a folded product', () => held(parse(receipt(products().replace('(明細ID A101) 値引', '(明細ID A101) 値引合計')))));
for (const options of [{ count: 0 }, { paid: false }, { net: 1699 }]) test(`closing-only recovery cannot replace accounting evidence: ${JSON.stringify(options)}`, () => held(parse(receipt(products(), options))));
test('conflicting OCR assignments remain manual after closing-only recovery', () => held(parse({ text: receipt(products()), whole: receipt(references().replace('¥100', '¥200').replace('¥200 (明細ID B102', '¥100 (明細ID B102')) })));
test('learning cannot replace a missing independent full ID', () => {
  const r = runtime();r.storage.set('okozukaiReceiptProductDictionaryV1', JSON.stringify([{ shopKey: 'テスト商', name: '緑茶', aliases: ['緑茶'], priceHints: [1000], source: 'learned', confirmedCount: 6 }]));
  held(parse(receipt(`${part('A101\n')}\n商品値引 ¥100\n${part('B102')}\n商品値引 ¥200`), r));assert.equal(r.writes.length, 0);
});
test('closing-only recovery preserves ledger, dictionary and schema', () => {
  const r = runtime();r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'unrelated', name: '学習商品', priceHints: [73], source: 'learned', confirmedCount: 4 }]);r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);
  const before = r.evaluate('JSON.stringify(state)');assigned(parse(receipt(products()), r));assigned(parse(receipt(products().replace('A101\n)', 'A101\n\t)')), r));
  assert.equal(r.evaluate('JSON.stringify(state)'), before);assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);assert.equal(r.writes.length, 0);assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});
for (const [name, body, valid] of [['merchandise', products(), true], ['reference', references(), true], ['TAB close', products().replace('A101\n)', 'A101\n\t)'), true]]) test(`mock OCR: ${name} closing-only source and storage safety`, async () => {
  const r = runtime(), a = r.context.receiptInternals, text = receipt(body);let terminated = 0;
  r.context.Tesseract = { async createWorker() { return { async setParameters() {}, async recognize() { return { data: { text, blocks: [] } }; }, async terminate() { terminated++; } }; } };
  const canvas = { width: 100, height: 300 };
  const ocr = await a.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'middle', canvas }, { role: 'bottom', canvas }], shopSlices: [], itemSlices: Array.from({ length: 7 }, () => ({ canvas })), amountSlices: [], paymentSlices: [] });
  const p = parse(ocr, r);if (valid) assigned(p);else held(p);assert.equal(terminated, 1);assert.equal(r.writes.length, 0);
});
