const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const code = '2200083271771';
const part = id => `緑茶 (明細ID ${id})\n${code} 1 ¥1,000`;
const ref = (id, n, label = '値引') => `(明細ID ${id}\n) ${label} ¥${n}`;
const body = (ids = ['A101', 'B102'], fold = id => id, label = '値引') => `${part(ids[0])}\n${part(ids[1])}\n${ref(fold(ids[0]), 100, label)}\n${ref(fold(ids[1]), 200, label)}`;
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

test('a closing bracket and explicit deduction share a row with exact complete product IDs', () => assigned(parse(receipt(body()))));
for (const label of ['商品値引', '単品値引', '割引', '値引額', '割引額', '値下額', '値下げ額']) test(`explicit ${label} is a deduction amount`, () => assigned(parse(receipt(body(undefined, undefined, label)))));
for (const [open, close] of [['[', ']'], ['【', '】'], ['（', '）']]) test(`matching ${open}${close} bounds the reference`, () => assigned(parse(receipt(body().replace(/\(明細ID/g, open + '明細ID').replace(/\)/g, close)))));
for (const row of [')値引¥100', ' ) 値引 ¥100 ', '\t)\t値引\t¥100\t', '　）　値引　￥１００　', ') 値引: 100円', ') 値引 ¥-100']) test(`unambiguous closing and amount row: ${JSON.stringify(row)}`, () => assigned(parse(receipt(body().replace(') 値引 ¥100', row)))));
for (const length of [4, 16]) {
  const ids = ['A' + '1'.repeat(length - 1), 'B' + '2'.repeat(length - 1)];
  test(`${length} fragments plus one closing and amount row`, () => assigned(parse(receipt(body(ids, id => id.split('').join('\n')))), ids));
}
test('a full 16-character fragment still reaches its closing and amount row', () => {
  const ids = ['A' + '1'.repeat(15), 'B' + '2'.repeat(15)];assigned(parse(receipt(body(ids))), ids);
});
test('value-only brackets retain their reference role', () => assigned(parse(receipt(body().replace(/\(明細ID/g, '明細ID [').replace(/\)/g, ']')))));
test('literal separators remain part of the exact reference ID', () => assigned(parse(receipt(body(['A-101', 'B_102'], id => id.slice(0, 2) + '\n' + id.slice(2)))), ['A-101', 'B_102']));
test('numeric IDs require exact canonical spelling', () => assigned(parse(receipt(body(['1011', '1022']))), ['1011', '1022']));
for (const newline of ['\n', '\r\n', '\r']) test(`${JSON.stringify(newline)} keeps amount and ID boundaries`, () => assigned(parse(receipt(body()).replace(/\n/g, newline))));
test('one closing-row deduction is assigned wholly to its unique complete product', () => assigned(parse(receipt(`${part('A101')}\n${part('B102')}\n${ref('A101', 100)}`, { net: 1900 })), undefined, [100, 0], [900, 1000]));
test('tax allocation follows the identified deductions', () => assigned(parse(receipt(body(), { tax: 136 })), undefined, [100, 200], [972, 864]));
test('original raw OCR, diagnostics and caller objects remain intact', () => {
  const text = receipt(body().replace(') 値引 ¥100', '\t)\t値引\t¥100\t')), input = { text, whole: text, diagnostics: [{ label: '全体', text }] };
  const before = JSON.stringify(input), p = parse(input);assigned(p);assert.equal(JSON.stringify(input), before);assert(p.rawText.includes('A101\n\t)\t値引\t¥100\t'));assert(p.debugText.includes('A101\n\t)\t値引\t¥100\t'));
});

test('references without independent complete product IDs cannot corroborate themselves', () => held(parse(receipt(`${part('A101\n')}\n${part('B102\n')}\n${ref('A101', 100)}\n${ref('B102', 200)}`))));
test('a complete arbitrary label without a named priced row is insufficient', () => held(parse(receipt(`補足情報\n(明細ID A101)\n補足情報\n${part('B102')}\n${ref('A101', 100)}\n${ref('B102', 200)}`))));
test('a full counterpart available only in a different OCR pass is insufficient', () => {
  const incomplete = receipt(`${part('A101\n')}\n商品値引 ¥100\n${part('B102\n')}\n商品値引 ¥200`);held(parse({ text: incomplete, whole: receipt(body()) }));
});
test('merged sources cannot invent same-source proof', () => {
  const p = parse({ text: receipt(body()), diagnostics: [{ label: '分割 1', text: receipt(`${part('A101')}\n${part('B102')}`) }, { label: '分割 2', text: receipt(`${ref('A101', 100)}\n${ref('B102', 200)}`) }] });held(p);assert.equal(p.wrappedIdRecoveryCount || 0, 0);
});
test('a spaced complete spelling competing with the compact token remains ambiguous', () => held(parse(receipt(`${part('A101')}\n${part('A 101')}\n${ref('A\n101', 100)}\n(明細ID A 101) 値引 ¥200`))));
for (const id of ['a101', 'A1O1', 'A_101', 'A 101']) test(`the different complete spelling ${id} is not repaired`, () => held(parse(receipt(body().replace('緑茶 (明細ID A101)', `緑茶 (明細ID ${id})`)))));
for (const row of ['] 値引 ¥100', ')) 値引 ¥100', ') ¥100', ') 値引後価格 ¥100', ') 値引前 ¥100', ') 値下 ¥100', ') 値引合計 ¥100', ') クーポンをGET ¥100', ') 値引 10%', ') 値引 ¥0', ') 値引 ¥1000001', ') 値引 ¥100 注記', ') 値引 ¥100 ¥200', ') 値引 ¥1,00', ') 値引 ¥100 (明細ID C103)', ') 注記 値引 ¥100', ') 値引\n¥100', ')\n値引 ¥100', '\n) 値引 ¥100', '\t\n) 値引 ¥100', '消費税 ¥0\n) 値引 ¥100', '¥100\n) 値引 ¥100', '\v) 値引 ¥100']) test(`uncertain or malformed closing row remains manual: ${JSON.stringify(row)}`, () => held(parse(receipt(body().replace(') 値引 ¥100', row)))));
for (const fragment of ['A\t101', 'A\n\t101', 'A101 ', 'A\n101 ', 'A-\n_101', 'A101\n0']) test(`the amount row does not repair ID fragments: ${JSON.stringify(fragment)}`, () => held(parse(receipt(body().replace('明細ID A101\n', '明細ID ' + fragment + '\n')))));
test('product text before a folded marker cannot be reinterpreted as a deduction reference', () => held(parse(receipt(body().replace('(明細ID A101\n', '緑茶 (明細ID A101\n')))));
test('two printed amount claims on opposite sides of one marker remain manual', () => held(parse(receipt(body().replace('(明細ID A101\n', '値引 ¥50 (明細ID A101\n')))));
test('seventeen characters cannot be truncated before an amount row', () => {
  const id = 'A' + '1'.repeat(16);held(parse(receipt(body([id, 'B102']).replace(`緑茶 (明細ID ${id})`, `緑茶 (明細ID ${id.slice(0, 16)})`))));
});
test('seventeen fragments cannot be truncated before an amount row', () => {
  const id = 'A' + '1'.repeat(16);held(parse(receipt(body([id, 'B102'], value => value.split('').join('\n')).replace(`緑茶 (明細ID ${id})`, `緑茶 (明細ID ${id.slice(0, 16)})`))));
});
test('duplicate complete priced IDs cannot establish a unique target', () => held(parse(receipt(`${part('A101')}\n${part('A101')}\n${ref('A101', 300)}`))));
test('a reference after checkout cannot establish a current-sale association', () => held(parse(receipt(`${part('A101')}\n${part('B102')}\n商品値引 ¥100\n商品値引 ¥200`) + '\n' + ref('A101', 100))));
for (const options of [{ count: 0 }, { paid: false }, { net: 1699 }]) test(`amount-row recovery cannot replace accounting: ${JSON.stringify(options)}`, () => held(parse(receipt(body(), options))));
test('contradictory assignments across OCR passes remain manual', () => held(parse({ text: receipt(body()), whole: receipt(body().replace('¥100', '¥50').replace('¥200', '¥250')) })));
test('learning cannot replace the missing complete priced ID', () => {
  const r = runtime();r.storage.set('okozukaiReceiptProductDictionaryV1', JSON.stringify([{ shopKey: 'テスト商', name: '緑茶', aliases: ['緑茶'], priceHints: [1000], source: 'learned', confirmedCount: 6 }]));
  held(parse(receipt(`${part('A101\n')}\n${part('B102')}\n${ref('A101', 100)}\n${ref('B102', 200)}`), r));assert.equal(r.writes.length, 0);
});
test('amount-row recovery preserves ledger, dictionary and schema', () => {
  const r = runtime();r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'unrelated', name: '学習商品', priceHints: [73], source: 'learned', confirmedCount: 4 }]);r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);
  const before = r.evaluate('JSON.stringify(state)');assigned(parse(receipt(body()), r));held(parse(receipt(body().replace('明細ID A101\n', '明細ID A\t101\n')), r));
  assert.equal(r.evaluate('JSON.stringify(state)'), before);assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);assert.equal(r.writes.length, 0);assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});
for (const [name, items, valid] of [['explicit deduction', body(), true], ['padded deduction', body().replace(') 値引 ¥100', '\t)\t値引\t¥100\t'), true], ['TAB in ID', body().replace('明細ID A101\n', '明細ID A\t101\n'), false]]) test(`mock OCR: ${name} and storage safety`, async () => {
  const r = runtime(), a = r.context.receiptInternals, text = receipt(items);let terminated = 0;
  r.context.Tesseract = { async createWorker() { return { async setParameters() {}, async recognize() { return { data: { text, blocks: [] } }; }, async terminate() { terminated++; } }; } };
  const canvas = { width: 100, height: 300 };
  const ocr = await a.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'middle', canvas }, { role: 'bottom', canvas }], shopSlices: [], itemSlices: Array.from({ length: 7 }, () => ({ canvas })), amountSlices: [], paymentSlices: [] });
  const p = parse(ocr, r);if (valid) assigned(p);else held(p);assert.equal(terminated, 1);assert.equal(r.writes.length, 0);
});
