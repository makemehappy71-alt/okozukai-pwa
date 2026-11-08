const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const code = '2200083271771';
const ids = ['000100', '000200'];
const fold = (id, style = 'two') => style === 'digits' ? Array.from(id).join('\n') : style === 'close' ? id + '\n' : id.slice(0, 2) + '\n' + id.slice(2);
const part = (id, detail) => `緑茶 (明細ID ${id})\n${detail}`;
function ref(id, amount, { money = 'yen', layout = 'same' } = {}) {
  const label = money === 'bare' ? '値引額（円）' : '値引', value = money === 'bare' ? amount : money === 'suffix' ? amount + '円' : '¥' + amount;
  return `(明細ID ${id})${layout === 'own' ? '\n' : layout === 'scope' ? '\n(単品)\n' : ' '}${label}\n${value}`;
}
function body({ qty = 2, total = 1000, unit = total / qty, unitLine = '単価 ¥' + unit.toLocaleString('en-US'), style = 'two', firstComplete = false, referenceIds = ids, values = [100, 200], terminalInline = false, ...options } = {}) {
  return `${part(firstComplete ? ids[0] : fold(ids[0], style), `${code} 1 ¥1,000`)}\n${ref(referenceIds[0], values[0], options)}\n${part(fold(ids[1], style), `${code} ¥${total.toLocaleString('en-US')}`)}\n${unitLine}\n${terminalInline ? `(明細ID ${referenceIds[1]}) 値引 ¥${values[1]}` : ref(referenceIds[1], values[1], options)}`;
}
function receipt(items, { count = 3, net = 1700, tax = 0, paid = true } = {}) {
  return `テスト商店\n2026年11月08日\n${items}\n小計 ${count ? count + '点 ' : ''}¥${net}\n${tax ? '消費税 ¥' + tax + '\n' : ''}${paid ? '合計 ¥' + (net + tax) + '\n楽天ペイ ¥' + (net + tax) : ''}`;
}
const parse = (input, r = runtime()) => r.context.receiptFeature.parseReceiptText(input, '2026-11-08');
function assigned(p, { qty = 2, total = 1000, unit = total / qty, values = [100, 200], gross = [1000 - values[0], total - values[1]] } = {}) {
  assert.equal(p.discountAttributionConfirmed, true);assert.equal(p.discountReviewRequired, false);assert.equal(p.itemSetComplete, true);
  assert.deepEqual(Array.from(p.itemRows, r => [r.name, r.receiptLineId, r.qty, r.unitPrice, r.total]), [['緑茶', '100', 1, 1000, 1000], ['緑茶', '200', qty, unit, total]]);
  assert.deepEqual(Array.from(p.splitRows, r => [r.discount, r.gross]), [[values[0], gross[0]], [values[1], gross[1]]]);
  assert(p.wrappedIdRecoveryCount > 0);assert(p.itemRows.every(row => !Object.hasOwn(row, 'quantityEvidence')));
}
function held(p) {
  assert.equal(p.discountAttributionConfirmed, false);assert.equal(p.itemSetComplete, false);assert.equal(p.autoConfirmedItemCount, 0);assert.equal(p.productCandidateAutoConfirmed, false);assert.equal(p.splitRows.length, 0);
}
for (const qty of [1, 2, 4]) for (const firstComplete of [false, true]) for (const style of ['two', 'digits', 'close']) for (const money of ['yen', 'suffix', 'bare']) test(`${qty} items from explicit unit price, ${firstComplete ? 'complete' : 'folded'} first ID, ${style} next ID, ${money}`, () => assigned(parse(receipt(body({ qty, firstComplete, style, money }), { count: 1 + qty })), { qty }));
for (const money of ['yen', 'bare']) {
  for (const unitLine of ['単価 ¥500', '単価: ¥500円', '単価 500円', '@500', '@ ¥500', '＠５００円']) test(`${money} exact local unit notation ${unitLine}`, () => assigned(parse(receipt(body({ money, unitLine })))));
  for (const layout of ['own', 'scope']) test(`${money} complete ID, label and amount on separate rows retain unit scope`, () => assigned(parse(receipt(body({ money, layout })))));
  test(`${money} the adjacent complete inline reference is also a valid unit-field boundary`, () => assigned(parse(receipt(body({ money, terminalInline: true })))));
  test(`${money} discounts follow reference IDs instead of equal values`, () => assigned(parse(receipt(body({ money, values: [200, 100] }))), { values: [200, 100] }));
  test(`${money} external tax and the original light-tax marker survive deriving the exact quantity`, () => assigned(parse(receipt(body({ money }).replace(code + ' ¥1,000', code + ' ¥1,000 軽'), { tax: 136 })), { gross: [972, 864] }));
  for (const newline of ['\n', '\r\n', '\r']) test(`${money} ${JSON.stringify(newline)} preserves original unit adjacency`, () => assigned(parse(receipt(body({ money })).replace(/\n/g, newline))));
  for (const [open, close] of [['[', ']'], ['【', '】'], ['（', '）']]) test(`${money} ${open}${close} retains exact original IDs`, () => {
    assigned(parse(receipt(body({ money })).replace(/\(明細ID/g, open + '明細ID').replace(/(0100|0200|000100|000200)\)/g, '$1' + close)));
  });
  test(`${money} horizontal space around unit and code rows is harmless`, () => {
    assigned(parse(receipt(body({ money })).replace(code + ' ¥1,000', '\t ' + code + ' ¥1,000\t').replace('単価 ¥500', '\t 単価\t¥500\t')));
  });
  test(`${money} quantity 99 stays within existing item limits`, () => {
    assigned(parse(receipt(body({ money, qty: 99, total: 9900 }), { count: 100, net: 10600 })), { qty: 99, total: 9900 });
  });
  for (const referenceIds of [['000100', '200'], ['000100', '00100'], ['000100', '000201']]) test(`${money} unit arithmetic cannot replace exact full ID ${referenceIds.join('/')}`, () => held(parse(receipt(body({ money, referenceIds })))));
  test(`${money} folded reference IDs cannot supply the original complete unit-field identity`, () => held(parse(receipt(body({ money, referenceIds: ['000100', fold('000200')] })))));
  test(`${money} repeated canonical reference IDs remain ambiguous`, () => {
    held(parse(receipt(body({ money, values: [100, 150] }) + '\n' + ref('200', 50, { money }))));
  });
  for (const barrier of ['', '\t', '注記', '対象外', '数量 3', '@1000', '単価 ¥1000', '(明細ID 000300)']) test(`${money} ${JSON.stringify(barrier)} between unit and full reference is not skipped`, () => {
    held(parse(receipt(body({ money }).replace('単価 ¥500\n', '単価 ¥500\n' + barrier + '\n'))));
  });
  for (const barrier of ['', '\t', '注記', '数量 2']) test(`${money} ${JSON.stringify(barrier)} between total and unit is not skipped`, () => {
    held(parse(receipt(body({ money }).replace('単価 ¥500', barrier + '\n単価 ¥500'))));
  });
  for (const suffix of ['個', '%', '対象外', '200']) test(`${money} ${suffix} between discount and next product is not skipped`, () => {
    const label = money === 'bare' ? '値引額（円）\n100' : '値引\n¥100';held(parse(receipt(body({ money }).replace(label + '\n', label + '\n' + suffix + '\n'))));
  });
  for (const accounting of [{ count: 0 }, { count: 2 }, { count: 4 }, { net: 1699 }, { paid: false }]) test(`${money} local unit proof cannot replace accounting ${JSON.stringify(accounting)}`, () => held(parse(receipt(body({ money }), accounting))));
  test(`${money} missing code cannot be supplied by the reference ID or unit`, () => held(parse(receipt(body({ money }).replace(code + ' ¥1,000', '¥1,000')))));
  test(`${money} a repaired code is not literal evidence`, () => held(parse(receipt(body({ money }).replace(code + ' ¥1,000', '22O0083271771 ¥1,000')))));
  test(`${money} an unknown next-product name cannot be a boundary`, () => held(parse(receipt(body({ money }).replace('緑茶 (明細ID 00\n0200)', '?? (明細ID 00\n0200)')))));
  test(`${money} a wrong next-product bracket is not fixed`, () => held(parse(receipt(body({ money }).replace('00\n0200)', '00\n0200]')))));
  test(`${money} an analysis joined from different sources cannot borrow a unit`, () => {
    held(parse({ text: receipt(body({ money })), diagnostics: [{ label: '全体', text: receipt(body({ money }).replace('単価 ¥500\n', '')) }] }));
  });
  test(`${money} separate item and unit passes cannot establish the local relation`, () => {
    held(parse({ text: receipt(body({ money })), diagnostics: [{ label: '分割 1', text: receipt(body({ money }).replace('単価 ¥500\n', '')) }, { label: '分割 2', text: '単価 ¥500\n(明細ID 000200)' }] }));
  });
  test(`${money} contradictory balanced allocations across sources remain manual`, () => held(parse({ text: receipt(body({ money })), whole: receipt(body({ money, values: [200, 100] })) })));
  test(`${money} a recognition edge is not an anchor for a quantity-dependent chain`, () => {
    const items = body({ money }), summary = '小計 3点 ¥1700\n合計 ¥1700\n楽天ペイ ¥1700';held(parse({ text: receipt(items), diagnostics: [{ label: '商品全域', text: items }, { label: '全体', text: summary }] }));
  });
}
for (const unitLine of ['', '単価 500', '¥500', '500', '数量 2', '商品コード 500', '単価 ¥0', '単価 ¥333', '単価 ¥1,001', '単価 ¥10', '単価 ¥00500', '単価 ¥5O0', '単価 ¥500.0', '単価 -500円', '単価 500個', '単価 ¥500 (税込)', '税込単価 ¥500', '単価 ¥500 対象外', '@500%', '@500 注記']) test(`default quantity one does not replace an unambiguous unit field: ${unitLine}`, () => held(parse(receipt(body({ unitLine })))));
test('no unit information stays manual even when default quantity one balances', () => held(parse(receipt(body({ qty: 1, unitLine: '' }), { count: 2 }))));
test('a global unit heading cannot supply a local unit value', () => {
  held(parse(receipt('単価 ¥500\n' + body({ unitLine: '' }))));
});
test('an invalid terminal deduction removes preceding quantities and boundaries too', () => {
  const p = parse(receipt(body({ money: 'bare', values: [100, 1000] }), { net: 900 }));held(p);assert.equal(p.wrappedIdRecoveryCount || 0, 0);
});
test('the first bare deduction still needs its own local currency label', () => {
  held(parse(receipt(body({ money: 'bare' }).replace('(明細ID 000100) 値引額（円）', '(明細ID 000100) 値引額'))));
});
test('the terminal bare deduction still needs its own local currency label', () => {
  held(parse(receipt(body({ money: 'bare' }).replace('(明細ID 000200) 値引額（円）', '(明細ID 000200) 値引額'))));
});
test('individually balanced but contradictory unit quantities across sources remain manual', () => {
  held(parse({ text: receipt(body({ money: 'bare' })), whole: receipt(body({ money: 'bare', qty: 4 }), { count: 5 }) }));
});
test('arithmetic does not allow an alphabetic folded ID to certify the next boundary', () => {
  const text = body().replaceAll('00\n0200', '00A\n200').replaceAll('000200', '00A200');held(parse(receipt(text)));
});
test('original omitted quantity, local unit, full IDs and caller objects remain intact', () => {
  const text = receipt(body({ money: 'bare' })), input = { text, whole: text, diagnostics: [{ label: '全体', text }] }, before = JSON.stringify(input), p = parse(input);assigned(p);
  assert.equal(JSON.stringify(input), before);assert(p.rawText.includes(code + ' ¥1,000\n単価 ¥500'));assert(!p.rawText.includes(code + ' 2 ¥1,000'));assert(p.debugText.includes('単価 ¥500'));
});
test('quantity evidence preserves ledger, dictionary and schema', () => {
  const r = runtime();r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'テスト商店', name: '緑茶', priceHints: [500], source: 'learned', confirmedCount: 4 }]);r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);const before = r.evaluate('JSON.stringify(state)');
  assigned(parse(receipt(body({ money: 'bare' })), r));held(parse(receipt(body({ qty: 1, unitLine: '' }), { count: 2 }), r));
  assert.equal(r.evaluate('JSON.stringify(state)'), before);assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);assert.equal(r.writes.length, 0);assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});
for (const [qty, money, valid] of [[1, 'yen', true], [2, 'bare', true], [2, 'yen', false]]) test(`mock OCR unit-derived quantity ${qty}, ${money}, ${valid ? 'proved' : 'ambiguous'}`, async () => {
  const r = runtime(), text = receipt(body({ qty, money, ...(valid ? {} : { unitLine: '単価 500' }) }), { count: 1 + qty });let terminated = 0;
  r.context.Tesseract = { async createWorker() { return { async setParameters() {}, async recognize() { return { data: { text, blocks: [] } }; }, async terminate() { terminated++; } }; } };
  const canvas = { width: 100, height: 300 }, ocr = await r.context.receiptInternals.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'middle', canvas }, { role: 'bottom', canvas }], shopSlices: [], itemSlices: Array.from({ length: 7 }, () => ({ canvas })), amountSlices: [], paymentSlices: [] });
  const p = parse(ocr, r);if (valid) assigned(p, { qty });else held(p);assert.equal(terminated, 1);assert.equal(r.writes.length, 0);
});
