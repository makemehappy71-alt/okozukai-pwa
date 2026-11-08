const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const code = '2200083271771';
function fixture({ order = 'unit-first', gap = '', qty = 2, unit = 1000 / qty, money = 'yen', id = '000200', firstComplete = false, inline = false, count = qty + 1, net = 1700, tax = 0 } = {}) {
  const ref = (value, amount) => `(明細ID ${value}) ${money === 'bare' ? '値引額（円）\n' + amount : '値引\n¥' + amount}`;
  const pair = order === 'unit-first' ? [`単価 ¥${unit}`, `${code} ¥1,000`] : [`${code} ¥1,000`, `単価 ¥${unit}`];
  const items = `緑茶 (明細ID ${firstComplete ? '000100' : '00\n0100'})\n${code} 1 ¥1,000\n${ref('000100', 100)}\n緑茶 (明細ID 00\n0200)\n${pair.join('\n' + gap + '\n')}\n${inline ? `(明細ID ${id}) 値引 ¥200` : ref(id, 200)}`;
  return `テスト商店\n2026年11月08日\n${items}\n小計 ${count ? count + '点 ' : ''}¥${net}\n${tax ? '消費税 ¥' + tax + '\n' : ''}合計 ¥${net + tax}\n楽天ペイ ¥${net + tax}`;
}
const parse = (input, r = runtime()) => r.context.receiptFeature.parseReceiptText(input, '2026-11-08');
function assigned(p, qty = 2, gross = [900, 800]) {
  assert.equal(p.discountAttributionConfirmed, true);assert.equal(p.discountReviewRequired, false);assert.equal(p.itemSetComplete, true);
  assert.deepEqual(Array.from(p.itemRows, r => [r.name, r.receiptLineId, r.productCode, r.qty, r.unitPrice, r.total]), [['緑茶', '100', code, 1, 1000, 1000], ['緑茶', '200', code, qty, 1000 / qty, 1000]]);
  assert.deepEqual(Array.from(p.splitRows, r => [r.discount, r.gross]), [[100, gross[0]], [200, gross[1]]]);
  assert(p.wrappedIdRecoveryCount > 0);assert(p.itemRows.every(r => !Object.hasOwn(r, 'quantityEvidence')));
}
function held(p) {
  assert.equal(p.discountAttributionConfirmed, false);assert.equal(p.itemSetComplete, false);assert.equal(p.autoConfirmedItemCount, 0);assert.equal(p.productCandidateAutoConfirmed, false);assert.equal(p.splitRows.length, 0);
}
for (const order of ['unit-first', 'total-first']) for (const money of ['yen', 'bare']) {
  for (const gap of ['', ' ', '\t', ' \t ', '　']) for (const qty of [1, 2, 4]) test(`${order}/${money} blank ${JSON.stringify(gap)} preserves exact quantity ${qty}`, () => assigned(parse(fixture({ order, money, gap, qty })), qty));
  for (const gap of ['注記', '単品', '(単品)', '(商品)', '税込', '税抜', '対象外', '数量 2', '単価 ¥1000', '@1000', '500', '¥500', '(明細ID 000200)', '(明細ID 000300)', '別商品', '※', '\u200b', '\f']) test(`${order}/${money} nonblank ${JSON.stringify(gap)} cannot be erased`, () => held(parse(fixture({ order, money, gap }))));
  for (const id of ['200', '00200', '000201', '00\n0200']) test(`${order}/${money} blank cannot repair full reference ${JSON.stringify(id)}`, () => held(parse(fixture({ order, money, id }))));
  for (const unit of [0, 333, 1001, 10]) test(`${order}/${money} blank does not relax quantity math ${unit}`, () => held(parse(fixture({ order, money, unit }))));
  for (const count of [0, 2, 4]) test(`${order}/${money} blank does not replace accounting ${count}`, () => held(parse(fixture({ order, money, count }))));
  test(`${order}/${money} original complete first ID remains usable`, () => assigned(parse(fixture({ order, money, firstComplete: true }))));
  test(`${order}/${money} inline original reference bounds the price block`, () => assigned(parse(fixture({ order, money, inline: true }))));
  test(`${order}/${money} external tax remains accounted`, () => assigned(parse(fixture({ order, money, tax: 136 })), 2, [972, 864]));
  for (const position of ['before', 'after']) test(`${order}/${money} formatting beside the price pair keeps the reference boundary: ${position}`, () => {
    const text = fixture({ order, money });
    const p = parse(position === 'before' ? text.replace('00\n0200)\n', '00\n0200)\n\n') : text.replace(`\n(明細ID 000200)`, '\n\n(明細ID 000200)'));assigned(p);
  });
  test(`${order}/${money} extra nonblank rows after an empty row are not scanned past`, () => held(parse(fixture({ order, money, gap: '\n注記' }))));
  test(`${order}/${money} repeated whitespace rows exceed the bounded gap`, () => held(parse(fixture({ order, money, gap: ' \n\t' }))));
  test(`${order}/${money} unknown unit notation is not repaired`, () => held(parse(fixture({ order, money }).replace('単価 ¥500', '単価 500'))));
  test(`${order}/${money} an explicit quantity is not overwritten`, () => held(parse(fixture({ order, money }).replace(code + ' ¥1,000', code + ' 1 ¥1,000'))));
  test(`${order}/${money} literal code cannot be repaired or borrowed`, () => held(parse(fixture({ order, money }).replace(code + ' ¥1,000', '22O0083271771 ¥1,000'))));
  test(`${order}/${money} duplicate references remain ambiguous`, () => held(parse(fixture({ order, money }).replace('小計', '(明細ID 000200) 値引 ¥50\n小計'))));
  test(`${order}/${money} evidence withdrawn at final amount also withdraws earlier boundary`, () => held(parse(fixture({ order, money, net: 900 }).replace(money === 'bare' ? '値引額（円）\n200' : '値引\n¥200', money === 'bare' ? '値引額（円）\n1000' : '値引\n¥1000'))));
  test(`${order}/${money} another recognition source cannot supply the missing unit`, () => {
    const text = fixture({ order, money });held(parse({ text, diagnostics: [{ label: '全体', text: text.replace('単価 ¥500', '') }] }));
  });
  test(`${order}/${money} a conflicting balanced quantity remains manual`, () => held(parse({ text: fixture({ order, money }), whole: fixture({ order, money, qty: 4 }) })));
  test(`${order}/${money} a conflicting balanced attribution remains manual`, () => {
    const text = fixture({ order, money }), other = text.replace(money === 'bare' ? '値引額（円）\n100' : '値引\n¥100', 'TEMP').replace(money === 'bare' ? '値引額（円）\n200' : '値引\n¥200', money === 'bare' ? '値引額（円）\n100' : '値引\n¥100').replace('TEMP', money === 'bare' ? '値引額（円）\n200' : '値引\n¥200');held(parse({ text, whole: other }));
  });
}
for (const newline of ['\n', '\r\n', '\r']) test(`blank layout and raw input survive ${JSON.stringify(newline)}`, () => {
  const text = fixture().replace(/\n/g, newline), input = { text, whole: text, diagnostics: [{ label: '全体', text }] }, before = JSON.stringify(input), p = parse(input);assigned(p);
  assert.equal(JSON.stringify(input), before);assert(p.rawText.includes('単価 ¥500\n\n' + code + ' ¥1,000'));assert(!p.rawText.includes(code + ' 2 ¥1,000'));
});
test('a bare discount still needs its own currency-role evidence', () => held(parse(fixture({ money: 'bare' }).replace('(明細ID 000200) 値引額（円）', '(明細ID 000200) 値引額'))));
test('blank handling does not alter existing ledger, dictionary, schema or write storage', () => {
  const r = runtime();r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'テスト商店', name: '緑茶', priceHints: [500], source: 'learned', confirmedCount: 4 }]);r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);const before = r.evaluate('JSON.stringify(state)');
  assigned(parse(fixture(), r));held(parse(fixture({ gap: '注記' }), r));assert.equal(r.evaluate('JSON.stringify(state)'), before);assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);assert.equal(r.writes.length, 0);assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});
for (const [order, gap, valid] of [['unit-first', '', true], ['total-first', '\t', true], ['unit-first', '(単品)', false]]) test(`mock worker retains ${order} gap ${JSON.stringify(gap)}`, async () => {
  const r = runtime(), text = fixture({ order, gap, money: 'bare' });let terminated = 0;
  r.context.Tesseract = { async createWorker() { return { async setParameters() {}, async recognize() { return { data: { text, blocks: [] } }; }, async terminate() { terminated++; } }; } };
  const canvas = { width: 100, height: 300 }, ocr = await r.context.receiptInternals.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'middle', canvas }, { role: 'bottom', canvas }], shopSlices: [], itemSlices: Array.from({ length: 7 }, () => ({ canvas })), amountSlices: [], paymentSlices: [] });
  const p = parse(ocr, r);if (valid) assigned(p);else held(p);assert.equal(terminated, 1);assert.equal(r.writes.length, 0);
});
