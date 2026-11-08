const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const code = '2200083271771';
const notes = ['商品', '単品', '(商品)', '(単品)', '[商品]', '[単品]', '【商品】', '【単品】', '（ 商品 ）', '（ 単品 ）', '\t商品\t', ' \t単品 \t'];
function fixture({ note = '商品', position = 'price', order = 'unit-first', qty = 2, money = 'yen', id = '000200', firstComplete = false, inline = false, count = qty + 1, net = 1700, tax = 0 } = {}) {
  const ref = (value, amount, scoped = false) => `(明細ID ${value})${scoped ? '\n' + note + '\n' : ' '}${money === 'bare' ? '値引額（円）\n' + amount : '値引\n¥' + amount}`;
  const pair = [`単価 ¥${1000 / qty}`, `${code} ¥1,000`];if (order === 'total-first') pair.reverse();
  const block = pair.join(position === 'price' ? '\n' + note + '\n' : '\n');
  const text = `テスト商店\n2026年11月08日\n緑茶 (明細ID ${firstComplete ? '000100' : '00\n0100'})\n${code} 1 ¥1,000\n${ref('000100', 100)}\n緑茶 (明細ID 00\n0200)\n${block}\n${inline ? `(明細ID ${id}) 値引 ¥200` : ref(id, 200, position === 'reference')}\n小計 ${count ? count + '点 ' : ''}¥${net}\n${tax ? '消費税 ¥' + tax + '\n' : ''}合計 ¥${net + tax}\n楽天ペイ ¥${net + tax}`;
  return { text, block };
}
const parse = (input, r = runtime()) => r.context.receiptFeature.parseReceiptText(input, '2026-11-08');
function held(p) {
  assert.equal(p.discountAttributionConfirmed, false);assert.equal(p.itemSetComplete, false);assert.equal(p.autoConfirmedItemCount, 0);assert.equal(p.productCandidateAutoConfirmed, false);assert.equal(p.splitRows.length, 0);
}
function assigned(p, qty = 2) {
  assert.equal(p.discountAttributionConfirmed, true);assert.equal(p.itemSetComplete, true);assert.equal(p.discountReviewRequired, false);
  assert.deepEqual(Array.from(p.itemRows, r => [r.name, r.receiptLineId, r.productCode, r.qty, r.unitPrice, r.total]), [['緑茶', '100', code, 1, 1000, 1000], ['緑茶', '200', code, qty, 1000 / qty, 1000]]);
  assert.deepEqual(Array.from(p.splitRows, r => [r.discount, r.gross]), [[100, 900], [200, 800]]);assert(p.wrappedIdRecoveryCount > 0);
}
for (const order of ['unit-first', 'total-first']) for (const money of ['yen', 'bare']) {
  for (const note of notes) {
    for (const qty of [1, 2]) test(`${order}/${money} ${JSON.stringify(note)} between prices is not certified by the full ID, quantity ${qty}`, () => {
      const { text, block } = fixture({ note, order, money, qty }), p = parse(text);held(p);assert(p.rawText.includes(block));assert(p.rawText.includes('(明細ID 000200)'));assert(p.rawText.includes('00\n0200)'));
    });
    test(`${order}/${money} ${JSON.stringify(note)} on a separate discount label retains its existing role`, () => assigned(parse(fixture({ note, position: 'reference', order, money }).text)));
  }
  test(`${order}/${money} a complete first ID cannot certify the next price note`, () => held(parse(fixture({ note: '単品', order, money, firstComplete: true }).text)));
  test(`${order}/${money} an inline terminal reference cannot certify the next price note`, () => held(parse(fixture({ note: '商品', order, money, inline: true }).text)));
  test(`${order}/${money} consistent tax does not explain the price note`, () => held(parse(fixture({ note: '(単品)', order, money, tax: 136 }).text)));
  for (const note of ['商品 対象外', '単品 税込', '(商品 税抜)', '商品 500円', '単品 2', '(商品]', '単\n品', '商品\n単品', '\n単品', '商品\n']) test(`${order}/${money} added conditions and broken notes remain manual: ${JSON.stringify(note)}`, () => held(parse(fixture({ note, order, money }).text)));
  test(`${order}/${money} a duplicate complete reference is not extra corroboration`, () => held(parse(fixture({ order, money }).text.replace('小計', '(明細ID 000200) 値引 ¥50\n小計'))));
  for (const id of ['200', '00200', '000201', '00\n0200']) test(`${order}/${money} price note cannot repair reference ${JSON.stringify(id)}`, () => held(parse(fixture({ order, money, id }).text)));
  test(`${order}/${money} a second recognition pass without the note cannot erase the original note`, () => {
    const text = fixture({ order, money }).text, clean = fixture({ order, money, position: 'none' }).text;
    held(parse({ text: clean, diagnostics: [{ label: '全体', text }] }));
  });
  test(`${order}/${money} an unrelated complete ID crop cannot certify the price note`, () => {
    const text = fixture({ order, money }).text;held(parse({ text, diagnostics: [{ label: '商品全域', text }, { label: '分割 1', text: '(明細ID 000200)' }] }));
  });
  test(`${order}/${money} a dictionary match does not explain the note`, () => {
    const r = runtime();r.storage.set('okozukaiReceiptProductDictionaryV1', JSON.stringify([{ shopKey: 'テスト商店', name: '緑茶', priceHints: [500, 1000], source: 'learned', confirmedCount: 20 }]));held(parse(fixture({ order, money }).text, r));assert.equal(r.writes.length, 0);
  });
}
test('bare discount reference scope still requires local yen units at an ID/value collision', () => {
  const text = fixture({ position: 'reference', note: '単品', money: 'bare' }).text;held(parse(text.replace('値引額（円）\n200', '値引額\n200')));
});
test('allowed reference notes do not relax exact quantity arithmetic', () => held(parse(fixture({ position: 'reference', note: '商品' }).text.replace('単価 ¥500', '単価 ¥333'))));
test('allowed reference notes do not repair a zero spelling mismatch', () => held(parse(fixture({ position: 'reference', note: '単品', id: '200' }).text)));
test('allowed reference notes do not override an accounting contradiction', () => held(parse(fixture({ position: 'reference', count: 2 }).text)));
test('normalization preserves the original note, folded ID and caller objects', () => {
  const { text, block } = fixture({ note: '(単品)' }), input = { text, whole: text, diagnostics: [{ label: '全体', text }] }, before = JSON.stringify(input), p = parse(input);held(p);assert.equal(JSON.stringify(input), before);assert(p.rawText.includes(block));assert(p.debugText.includes('単価 ¥500\n(単品)\n[番号マスク]'));
});
test('scope investigation preserves existing ledger, dictionary and schema without writes', () => {
  const r = runtime();r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'テスト商店', name: '緑茶', priceHints: [500], source: 'learned', confirmedCount: 4 }]);r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);const before = r.evaluate('JSON.stringify(state)');
  held(parse(fixture().text, r));assigned(parse(fixture({ position: 'reference' }).text, r));assert.equal(r.evaluate('JSON.stringify(state)'), before);assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);assert.equal(r.writes.length, 0);assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});
for (const [position, note, order, valid] of [['price', '商品', 'unit-first', false], ['price', '(単品)', 'total-first', false], ['reference', '単品', 'unit-first', true]]) test(`mock worker keeps ${position}/${note}/${order} scope`, async () => {
  const r = runtime(), { text } = fixture({ position, note, order, money: 'bare' });let terminated = 0;
  r.context.Tesseract = { async createWorker() { return { async setParameters() {}, async recognize() { return { data: { text, blocks: [] } }; }, async terminate() { terminated++; } }; } };
  const canvas = { width: 100, height: 300 }, ocr = await r.context.receiptInternals.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'middle', canvas }, { role: 'bottom', canvas }], shopSlices: [], itemSlices: Array.from({ length: 7 }, () => ({ canvas })), amountSlices: [], paymentSlices: [] });
  const p = parse(ocr, r);if (valid) assigned(p);else held(p);assert.equal(terminated, 1);assert.equal(r.writes.length, 0);
});
