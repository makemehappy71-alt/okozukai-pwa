const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const code = '2200083271771';
const forms = ['商品 明細ID 000200', '単品 明細ID 000200', '明細ID 000200 商品', '明細ID 000200 単品', '(商品) 明細ID:000200', '【単品】 明細ID000200', '明細ID:000200 (商品)', '明細ID000200 [単品]'];
function fixture({ note = forms[0], order = 'unit-first', qty = 2, unit = 1000 / qty, money = 'yen', refId = '000200', count = qty + 1, net = 1700, tax = 0, inline = false, firstComplete = false } = {}) {
  const ref = (id, amount) => `(明細ID ${id}) ${money === 'bare' ? '値引額（円）\n' + amount : money === 'suffix' ? '値引\n' + amount + '円' : '値引\n¥' + amount}`;
  const pair = [`単価 ¥${unit}`, `${code} ¥1,000`];if (order === 'total-first') pair.reverse();const block = pair.join('\n' + note + '\n');
  const text = `テスト商店\n2026年11月08日\n緑茶 (明細ID ${firstComplete ? '000100' : '00\n0100'})\n${code} 1 ¥1,000\n${ref('000100', 100)}\n緑茶 (明細ID 00\n0200)\n${block}\n${inline ? `(明細ID ${refId}) 値引 ¥200` : ref(refId, 200)}\n小計 ${count ? count + '点 ' : ''}¥${net}\n${tax ? '消費税 ¥' + tax + '\n' : ''}合計 ¥${net + tax}\n楽天ペイ ¥${net + tax}`;
  return { text, block };
}
const parse = (input, r = runtime()) => r.context.receiptFeature.parseReceiptText(input, '2026-11-08');
function held(p) {
  assert.equal(p.discountAttributionConfirmed, false);assert.equal(p.itemSetComplete, false);assert.equal(p.autoConfirmedItemCount, 0);assert.equal(p.productCandidateAutoConfirmed, false);assert.equal(p.splitRows.length, 0);
}
function assigned(p, qty = 2, gross = [900, 800]) {
  assert.equal(p.discountAttributionConfirmed, true);assert.equal(p.itemSetComplete, true);assert.equal(p.discountReviewRequired, false);
  assert.deepEqual(Array.from(p.itemRows, r => [r.name, r.receiptLineId, r.productCode, r.qty, r.unitPrice, r.total]), [['緑茶', '100', code, 1, 1000, 1000], ['緑茶', '200', code, qty, 1000 / qty, 1000]]);
  assert.deepEqual(Array.from(p.splitRows, r => [r.discount, r.gross]), [[100, gross[0]], [200, gross[1]]]);assert(p.wrappedIdRecoveryCount > 0);
  assert(p.itemRows.every(r => !Object.hasOwn(r, 'scopeMarker') && !Object.hasOwn(r, 'quantityEvidence')));
}
for (const order of ['unit-first', 'total-first']) for (const money of ['yen', 'bare']) {
  for (const note of forms) for (const qty of [1, 2]) test(`${order}/${money} bounded by whitespace and line: ${note}, quantity ${qty}`, () => assigned(parse(fixture({ note, order, money, qty }).text), qty));
  for (const note of ['商品明細ID000200', '明細ID000200商品']) test(`${order}/${money} fixed labels delimit the joined scope ${note}`, () => assigned(parse(fixture({ note, order, money }).text)));
  for (const note of ['商品', '単品', '商品 明細ID 000200 2', '商品 明細ID 000200 500円', '明細ID 000200 商品 税込', '単品 税抜 明細ID 000200', '商品 明細ID 0002000', '商品 明細ID 0002000000000', '商品 明細ID 200', '商品 明細ID 00200', '商品 明細ID 000201', '商品 明細ID 00 0200', '商品 明細ID 00\n0200', '商品 明細ID 0002O0', '商品 明細ID 000000', '商品 明細番号 000200', '商品 ID 000200', '(商品] 明細ID 000200', '商品 (明細ID 000200', '商品 明細ID 000200)', '商品 明細ID 000200 明細ID 000200', '商品 \f明細ID 000200', '明細ID 000200 商品\f', '商品 \uFEFF明細ID 000200']) test(`${order}/${money} ambiguous token boundary is not repaired ${JSON.stringify(note)}`, () => held(parse(fixture({ note, order, money }).text)));
  for (const refId of ['200', '000201', '00\n0200']) test(`${order}/${money} the independent reference must still match exactly ${JSON.stringify(refId)}`, () => held(parse(fixture({ order, money, refId }).text)));
  for (const unit of [0, 333, 1001, 10]) test(`${order}/${money} whitespace cannot replace quantity arithmetic ${unit}`, () => held(parse(fixture({ order, money, unit }).text)));
  for (const count of [0, 2, 4]) test(`${order}/${money} whitespace cannot replace accounting ${count}`, () => held(parse(fixture({ order, money, count }).text)));
  test(`${order}/${money} a complete first product remains independently identified`, () => assigned(parse(fixture({ order, money, firstComplete: true }).text)));
  test(`${order}/${money} an inline original discount reference remains usable`, () => assigned(parse(fixture({ order, money, inline: true }).text)));
  test(`${order}/${money} light-tax marker and external tax are retained`, () => assigned(parse(fixture({ order, money, tax: 136 }).text.replace(code + ' ¥1,000', code + ' ¥1,000 軽')), 2, [972, 864]));
  for (const note of [forms[0] + '\n', '\n' + forms[0], forms[0] + '\n' + forms[0]]) test(`${order}/${money} multiple intervening rows are not collapsed ${JSON.stringify(note)}`, () => held(parse(fixture({ order, money, note }).text)));
  test(`${order}/${money} another scope occurrence is not extra corroboration`, () => held(parse(fixture({ order, money }).text.replace('小計', '明細ID 000200 単品\n小計'))));
  test(`${order}/${money} another complete product with the same ID remains ambiguous`, () => held(parse(fixture({ order, money }).text.replace('小計', '別商品 (明細ID 000200)\n¥100\n小計'))));
  test(`${order}/${money} duplicate discount references remain ambiguous`, () => held(parse(fixture({ order, money }).text.replace('小計', '(明細ID 000200) 値引 ¥50\n小計'))));
  test(`${order}/${money} duplicate folded merchandise IDs remain ambiguous`, () => held(parse(fixture({ order, money }).text.replace('小計', '緑茶 (明細ID 00\n0200)\n' + code + ' 1 ¥100\n小計'))));
  test(`${order}/${money} explicit quantity is not overwritten`, () => held(parse(fixture({ order, money }).text.replace(code + ' ¥1,000', code + ' 1 ¥1,000'))));
  test(`${order}/${money} literal product code is not repaired`, () => held(parse(fixture({ order, money }).text.replace(code + ' ¥1,000', '22O0083271771 ¥1,000'))));
  test(`${order}/${money} the note alone cannot replace a full independent reference`, () => held(parse(fixture({ order, money }).text.replace('(明細ID 000200) 値引', '値引'))));
  test(`${order}/${money} another recognition source cannot provide the note ID`, () => {
    const { text } = fixture({ order, money });held(parse({ text, diagnostics: [{ label: '全体', text: text.replace(forms[0], '商品') }] }));
  });
  test(`${order}/${money} an isolated ID crop cannot supply the local price association`, () => {
    const { text } = fixture({ order, money });held(parse({ text, diagnostics: [{ label: '商品全域', text: text.replace(forms[0], '商品') }, { label: '分割 1', text: forms[0] }] }));
  });
  test(`${order}/${money} conflicting balanced quantities remain manual`, () => held(parse({ text: fixture({ order, money }).text, whole: fixture({ order, money, qty: 4 }).text })));
  test(`${order}/${money} conflicting balanced allocations remain manual`, () => {
    const { text } = fixture({ order, money }), first = money === 'bare' ? '値引額（円）\n100' : '値引\n¥100', second = money === 'bare' ? '値引額（円）\n200' : '値引\n¥200';held(parse({ text, whole: text.replace(first, 'TEMP').replace(second, first).replace('TEMP', second) }));
  });
  test(`${order}/${money} losing terminal evidence withdraws preceding boundaries`, () => {
    const text = fixture({ order, money, net: 900 }).text.replace(money === 'bare' ? '値引額（円）\n200' : '値引\n¥200', money === 'bare' ? '値引額（円）\n1000' : '値引\n¥1000');held(parse(text));
  });
}
for (const note of ['商品\t明細ID\t000200', '明細ＩＤ：０００２００　（単品）', '\t【商品】\t明細ID: 000200\t']) test(`horizontal/fullwidth layout ${JSON.stringify(note)}`, () => assigned(parse(fixture({ note }).text)));
for (const fold of ['0\n0\n0\n2\n0\n0', '000200\n']) test(`long or close-only product fold ${JSON.stringify(fold)}`, () => assigned(parse(fixture().text.replace('00\n0200', fold))));
test('yen suffix amounts preserve their original scope', () => assigned(parse(fixture({ money: 'suffix' }).text)));
test('ID and discount matching the unit price still need independent currency evidence', () => {
  const text = fixture({ qty: 5, money: 'bare' }).text;assigned(parse(text), 5);held(parse(text.replace('(明細ID 000200) 値引額（円）', '(明細ID 000200) 値引額')));
});
test('raw note, price order and caller objects remain unchanged', () => {
  const { text, block } = fixture(), input = { text, whole: text, diagnostics: [{ label: '全体', text }] }, before = JSON.stringify(input), p = parse(input);assigned(p);assert.equal(JSON.stringify(input), before);assert(p.rawText.includes(block));assert(!p.rawText.includes(code + ' 2 ¥1,000'));assert(p.debugText.includes('単価 ¥500\n' + forms[0] + '\n[番号マスク]'));
});
test('analysis preserves ledger, dictionary, schema and performs no storage writes', () => {
  const r = runtime();r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'テスト商店', name: '緑茶', priceHints: [500], source: 'learned', confirmedCount: 4 }]);r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);const before = r.evaluate('JSON.stringify(state)');
  assigned(parse(fixture().text, r));assigned(parse(fixture({ note: '商品明細ID000200' }).text, r));held(parse(fixture({ note: '商品明細ID0002002' }).text, r));assert.equal(r.evaluate('JSON.stringify(state)'), before);assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);assert.equal(r.writes.length, 0);assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});
for (const [note, order, valid] of [[forms[0], 'unit-first', true], [forms[3], 'total-first', true], ['商品明細ID000200', 'unit-first', true]]) test(`mock worker keeps literal boundaries ${note}/${order}`, async () => {
  const r = runtime(), { text } = fixture({ note, order, money: 'bare' });let terminated = 0;
  r.context.Tesseract = { async createWorker() { return { async setParameters() {}, async recognize() { return { data: { text, blocks: [] } }; }, async terminate() { terminated++; } }; } };
  const canvas = { width: 100, height: 300 }, ocr = await r.context.receiptInternals.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'middle', canvas }, { role: 'bottom', canvas }], shopSlices: [], itemSlices: Array.from({ length: 7 }, () => ({ canvas })), amountSlices: [], paymentSlices: [] });
  const p = parse(ocr, r);if (valid) assigned(p);else held(p);assert.equal(terminated, 1);assert.equal(r.writes.length, 0);
});
