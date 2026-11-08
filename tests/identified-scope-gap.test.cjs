const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const code = '2200083271771';
const forms = ['商品 (明細ID 000200)', '単品 (明細ID 000200)', '(明細ID 000200) 商品', '(明細ID 000200) 単品', '(商品) [明細ID 000200]', '【単品】 【明細ID 000200】', '(明細ID 000200) (商品)', '明細ID (000200) 単品'];
function fixture({ note = forms[0], order = 'unit-first', qty = 2, unit = 1000 / qty, money = 'yen', refId = '000200', inline = false, firstComplete = false, count = qty + 1, net = 1700, tax = 0 } = {}) {
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
  for (const note of forms) for (const qty of [1, 2]) test(`${order}/${money} exact local ${note} identifies the pair, quantity ${qty}`, () => assigned(parse(fixture({ note, order, money, qty }).text), qty));
  for (const note of ['商品', '単品', '(単品)', '商品 (明細ID 200)', '商品 (明細ID 00200)', '商品 (明細ID 000201)', '商品 (明細ID 00\n0200)', '商品 (明細ID 00 0200)', '商品 (明細ID 000200) 税込', '単品 税抜 (明細ID 000200)', '商品 単品 (明細ID 000200)', '(単品] (明細ID 000200)', '商品 (明細ID 000200]', '商品 明細ID 000200', '商品 (明細番号 000200)', '商品 (明細ID 000200) (明細ID 000200)', '(商品 明細ID 000200)', '(明細ID 000200) 商品 500円']) test(`${order}/${money} an uncertain note remains manual: ${JSON.stringify(note)}`, () => held(parse(fixture({ note, order, money }).text)));
  for (const refId of ['200', '000201', '00\n0200']) test(`${order}/${money} the note cannot repair the independent reference ${JSON.stringify(refId)}`, () => held(parse(fixture({ order, money, refId }).text)));
  for (const note of ['\f商品 (明細ID 000200)', '商品\v(明細ID 000200)', '商品 \uFEFF(明細ID 000200)', '(明細ID 000200) 商品\f']) test(`${order}/${money} control characters are not horizontal layout ${JSON.stringify(note)}`, () => held(parse(fixture({ order, money, note }).text)));
  for (const unit of [0, 333, 1001, 10]) test(`${order}/${money} matching note does not replace exact quantity math ${unit}`, () => held(parse(fixture({ order, money, unit }).text)));
  for (const count of [0, 2, 4]) test(`${order}/${money} matching note does not replace accounting ${count}`, () => held(parse(fixture({ order, money, count }).text)));
  test(`${order}/${money} a complete first product keeps its original evidence`, () => assigned(parse(fixture({ order, money, firstComplete: true }).text)));
  test(`${order}/${money} an original inline discount reference can bound the pair`, () => assigned(parse(fixture({ order, money, inline: true }).text)));
  test(`${order}/${money} literal tax marker and external tax survive`, () => assigned(parse(fixture({ order, money, tax: 136 }).text.replace(code + ' ¥1,000', code + ' ¥1,000 軽')), 2, [972, 864]));
  for (const gap of ['\n', '\n注記\n', '\n単品\n']) test(`${order}/${money} surrounding rows are not scanned past ${JSON.stringify(gap)}`, () => held(parse(fixture({ order, money, note: gap + forms[0] }).text)));
  test(`${order}/${money} a duplicate scope note is not independent evidence`, () => held(parse(fixture({ order, money }).text.replace('小計', forms[0] + '\n小計'))));
  test(`${order}/${money} another complete merchandise ID with the same value remains ambiguous`, () => held(parse(fixture({ order, money }).text.replace('小計', '別商品 (明細ID 000200)\n¥100\n小計'))));
  test(`${order}/${money} an extra discount reference remains ambiguous`, () => held(parse(fixture({ order, money }).text.replace('小計', '(明細ID 000200) 値引 ¥50\n小計'))));
  test(`${order}/${money} explicit quantity is not overwritten`, () => held(parse(fixture({ order, money }).text.replace(code + ' ¥1,000', code + ' 1 ¥1,000'))));
  test(`${order}/${money} a repaired barcode is not literal merchandise evidence`, () => held(parse(fixture({ order, money }).text.replace(code + ' ¥1,000', '22O0083271771 ¥1,000'))));
  test(`${order}/${money} a note after the pair cannot be moved between its fields`, () => {
    const { text } = fixture({ order, money });held(parse(text.replace('\n' + forms[0], '').replace('\n(明細ID 000200) 値引', '\n' + forms[0] + '\n(明細ID 000200) 値引')));
  });
  test(`${order}/${money} a merged note cannot borrow complete evidence from another pass`, () => {
    const { text } = fixture({ order, money });held(parse({ text, diagnostics: [{ label: '全体', text: text.replace(forms[0], '商品') }] }));
  });
  test(`${order}/${money} an isolated complete note is not evidence for another recognition source`, () => {
    const { text } = fixture({ order, money });held(parse({ text, diagnostics: [{ label: '商品全域', text: text.replace(forms[0], '商品') }, { label: '分割 1', text: forms[0] }] }));
  });
  test(`${order}/${money} contradictory independently balanced quantities remain manual`, () => held(parse({ text: fixture({ order, money }).text, whole: fixture({ order, money, qty: 4 }).text })));
  test(`${order}/${money} contradictory independently balanced allocations remain manual`, () => {
    const { text } = fixture({ order, money }), first = money === 'bare' ? '値引額（円）\n100' : '値引\n¥100', second = money === 'bare' ? '値引額（円）\n200' : '値引\n¥200';
    held(parse({ text, whole: text.replace(first, 'TEMP').replace(second, first).replace('TEMP', second) }));
  });
  test(`${order}/${money} duplicated folded merchandise IDs do not become a single scope`, () => {
    const { text } = fixture({ order, money });held(parse(text.replace('小計', '緑茶 (明細ID 00\n0200)\n' + code + ' 1 ¥100\n小計')));
  });
  test(`${order}/${money} a matching note before both price fields is not a price gap`, () => {
    const { text } = fixture({ order, money });held(parse(text.replace('\n' + forms[0], '').replace('00\n0200)\n', '00\n0200)\n' + forms[0] + '\n')));
  });
  test(`${order}/${money} loss of the terminal amount proof withdraws preceding boundaries`, () => {
    const text = fixture({ order, money, net: 900 }).text.replace(money === 'bare' ? '値引額（円）\n200' : '値引\n¥200', money === 'bare' ? '値引額（円）\n1000' : '値引\n¥1000');held(parse(text));
  });
}
for (const note of ['（商品） （明細ＩＤ ０００２００）', '\t単品\t[明細ID 000200]\t', '(明細ID 000200)【商品】', '商品(明細ID 000200)']) test(`exact fullwidth or horizontal formatting ${JSON.stringify(note)}`, () => assigned(parse(fixture({ note }).text)));
test('yen suffix discount amounts keep the same scope proof', () => assigned(parse(fixture({ money: 'suffix' }).text)));
test('bare values still require their own yen role at an ID/value collision', () => held(parse(fixture({ money: 'bare' }).text.replace('(明細ID 000200) 値引額（円）', '(明細ID 000200) 値引額'))));
test('a missing independent discount reference is not supplied by the note alone', () => held(parse(fixture().text.replace('(明細ID 000200) 値引', '値引'))));
test('the annotated original source and caller objects stay unchanged', () => {
  const { text, block } = fixture(), input = { text, whole: text, diagnostics: [{ label: '全体', text }] }, before = JSON.stringify(input), p = parse(input);assigned(p);assert.equal(JSON.stringify(input), before);assert(p.rawText.includes(block));assert(!p.rawText.includes(code + ' 2 ¥1,000'));assert(p.debugText.includes('単価 ¥500\n' + forms[0] + '\n[番号マスク]'));
});
test('identified scope analysis preserves existing ledger, dictionary and schema without writes', () => {
  const r = runtime();r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'テスト商店', name: '緑茶', priceHints: [500], source: 'learned', confirmedCount: 4 }]);r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);const before = r.evaluate('JSON.stringify(state)');
  assigned(parse(fixture().text, r));held(parse(fixture({ note: '単品' }).text, r));assert.equal(r.evaluate('JSON.stringify(state)'), before);assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);assert.equal(r.writes.length, 0);assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});
for (const [order, note, valid] of [['unit-first', forms[0], true], ['total-first', forms[3], true], ['unit-first', '商品 (明細ID 200)', false]]) test(`mock worker uses original local scope ${order}/${note}`, async () => {
  const r = runtime(), { text } = fixture({ order, note, money: 'bare' });let terminated = 0;
  r.context.Tesseract = { async createWorker() { return { async setParameters() {}, async recognize() { return { data: { text, blocks: [] } }; }, async terminate() { terminated++; } }; } };
  const canvas = { width: 100, height: 300 }, ocr = await r.context.receiptInternals.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'middle', canvas }, { role: 'bottom', canvas }], shopSlices: [], itemSlices: Array.from({ length: 7 }, () => ({ canvas })), amountSlices: [] , paymentSlices: [] });
  const p = parse(ocr, r);if (valid) assigned(p);else held(p);assert.equal(terminated, 1);assert.equal(r.writes.length, 0);
});
