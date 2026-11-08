const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const code = '2200083271771';
const ids = ['000100', '000200'];
const fold = (id, style = 'two') => style === 'digits' ? Array.from(id).join('\n') : style === 'close' ? id + '\n' : id.slice(0, 2) + '\n' + id.slice(2);
const part = (id, qty = 1) => `緑茶 (明細ID ${id})\n${code} ${qty} ¥1,000`;
function ref(id, value, { layout = 'same', money = 'yen', label = money === 'bare' ? '値引額（円）' : '値引' } = {}) {
  const amount = money === 'bare' ? String(value) : money === 'suffix' ? value + '円' : '¥' + value;
  const lead = layout === 'own' ? '\n' : layout === 'scope' ? '\n(単品)\n' : ' ';
  return `(明細ID ${id})${lead}${label}\n${amount}`;
}
function body({ printedIds = ids, referenceIds = printedIds, values = [100, 200], style = 'two', firstComplete = false, qty = 1, terminalInline = false, ...options } = {}) {
  return printedIds.map((id, i) => `${part(firstComplete && i === 0 ? id : fold(id, style), qty)}\n${terminalInline && i === printedIds.length - 1 ? `(明細ID ${referenceIds[i]}) 値引 ¥${values[i]}` : ref(referenceIds[i], values[i], options)}`).join('\n');
}
function receipt(items, { count = 2, net = 1700, tax = 0, paid = true } = {}) {
  return `テスト商店\n2026年11月08日\n${items}\n小計 ${count ? count + '点 ' : ''}¥${net}\n${tax ? '消費税 ¥' + tax + '\n' : ''}${paid ? '合計 ¥' + (net + tax) + '\n楽天ペイ ¥' + (net + tax) : ''}`;
}
const parse = (input, r = runtime()) => r.context.receiptFeature.parseReceiptText(input, '2026-11-08');
function assigned(p, { canonical = ['100', '200'], values = [100, 200], gross = values.map(n => 1000 - n), qty = 1 } = {}) {
  assert.equal(p.discountAttributionConfirmed, true);assert.equal(p.discountReviewRequired, false);assert.equal(p.itemSetComplete, true);
  assert.deepEqual(Array.from(p.itemRows, row => [row.name, row.receiptLineId, row.qty, row.total]), canonical.map(id => ['緑茶', id, qty, 1000]));
  assert.deepEqual(Array.from(p.splitRows, row => [row.discount, row.gross]), values.map((n, i) => [n, gross[i]]));
  assert(p.wrappedIdRecoveryCount > 0);assert(p.itemRows.every(row => !Object.hasOwn(row, 'reference') && !Object.hasOwn(row, 'bareReference') && !Object.hasOwn(row, 'foldedProduct')));
}
function held(p) {
  assert.equal(p.discountAttributionConfirmed, false);assert.equal(p.itemSetComplete, false);assert.equal(p.autoConfirmedItemCount, 0);assert.equal(p.productCandidateAutoConfirmed, false);assert.equal(p.splitRows.length, 0);
}
for (const firstComplete of [false, true]) for (const style of ['two', 'digits', 'close']) for (const layout of ['same', 'own', 'scope']) for (const money of ['yen', 'suffix', 'bare']) test(`${firstComplete ? 'complete' : 'folded'} first product, ${style} next ID, ${layout} ${money} reference has grounded end evidence`, () => assigned(parse(receipt(body({ firstComplete, style, layout, money })))));
for (const money of ['yen', 'bare']) {
  test(`${money} a next product with a full inline reference is an independent anchor`, () => assigned(parse(receipt(body({ money, terminalInline: true })))));
  test(`${money} discount values equal to other IDs do not change ownership`, () => assigned(parse(receipt(body({ money, values: [200, 100] }))), { values: [200, 100] }));
  test(`${money} a three-product chain terminates at the original checkout boundary`, () => {
    const printedIds = ['000100', '000200', '000050'], values = [100, 200, 50];assigned(parse(receipt(body({ money, printedIds, values }), { count: 3, net: 2650 })), { canonical: ['100', '200', '50'], values });
  });
  test(`${money} the terminal anchor can be printed before its dependent reference`, () => {
    const items = `${part(fold(ids[1]))}\n${part(fold(ids[0]))}\n${ref(ids[0], 100, { money })}\n${part(fold('000050'))}\n${ref('000050', 50, { money })}\n${ref(ids[1], 200, { money })}`;
    assigned(parse(receipt(items, { count: 3, net: 2650 })), { canonical: ['200', '100', '50'], values: [200, 100, 50] });
  });
  test(`${money} tax allocation follows exact IDs after the end boundary is grounded`, () => assigned(parse(receipt(body({ money }), { tax: 136 })), { gross: [972, 864] }));
  test(`${money} explicit quantity ten remains a literal boundary field`, () => assigned(parse(receipt(body({ money, qty: 10 }), { count: 20 })), { qty: 10 }));
  test(`${money} one/two ID and amount values can also equal quantities and count`, () => {
    assigned(parse(receipt(body({ money, printedIds: ['000001', '000002'], values: [1, 2] }), { net: 1997 })), { canonical: ['1', '2'], values: [1, 2] });
  });
  for (const newline of ['\n', '\r\n', '\r']) test(`${money} ${JSON.stringify(newline)} preserves original end positions`, () => assigned(parse(receipt(body({ money })).replace(/\n/g, newline))));
  for (const [open, close] of [['[', ']'], ['【', '】'], ['（', '）']]) test(`${money} ${open}${close} bounds the next product ID`, () => {
    const text = receipt(body({ money })).replace(/\(明細ID/g, open + '明細ID').replace(/(0100|0200|000100|000200)\)/g, '$1' + close);assigned(parse(text));
  });
  test(`${money} full-width ID digits keep their exact original zero spelling`, () => {
    const printedIds = ids.map(id => id.replace(/[0-9]/g, n => String.fromCharCode(n.charCodeAt(0) + 0xfee0)));assigned(parse(receipt(body({ money, printedIds }))));
  });
  test(`${money} surrounding horizontal space in the literal detail row is harmless`, () => {
    const text = receipt(body({ money })).replaceAll(`${code} 1 ¥1,000`, `\t ${code} 1 ¥1,000\t`);assigned(parse(text));
  });
  for (const referenceIds of [['000100', '200'], ['000100', '00100'], ['000100', '000201']]) test(`${money} next-product reference ${referenceIds.join('/')} cannot be repaired from the amount`, () => held(parse(receipt(body({ money, referenceIds })))));
  test(`${money} folded IDs on both product/reference sides have no original complete anchor`, () => held(parse(receipt(body({ money, referenceIds: ids.map(id => fold(id)) })))));
  test(`${money} duplicate next-product IDs cannot certify an end`, () => held(parse(receipt(body({ money, printedIds: ['000100', '000100'] })))));
  test(`${money} duplicate terminal references are not selected or summed`, () => {
    const items = body({ money, values: [100, 150] }) + '\n' + ref(ids[1], 50, { money });held(parse(receipt(items)));
  });
  for (const suffix of ['対象外', '個', '%', '200', '¥200', '0', '', '\t']) test(`${money} ${JSON.stringify(suffix)} before the next folded product is not skipped`, () => {
    const value = money === 'bare' ? '値引額（円）\n100' : '値引\n¥100';held(parse(receipt(body({ money }).replace(value + '\n', value + '\n' + suffix + '\n'))));
  });
  for (const fragment of ['00 \n0200', '00\t\n0200', '00\n\t0200', '00\n\n0200', '00\n注記\n0200']) test(`${money} a malformed next ID ${JSON.stringify(fragment)} is not an end boundary`, () => held(parse(receipt(body({ money }).replace('00\n0200', fragment)))));
  test(`${money} a wrong next-product bracket cannot certify an end`, () => held(parse(receipt(body({ money }).replace('00\n0200)', '00\n0200]')))));
  test(`${money} unreadable next merchandise cannot certify an end`, () => held(parse(receipt(body({ money }).replace('緑茶 (明細ID 00\n0200)', '?? (明細ID 00\n0200)')))));
  for (const [name, detail, count] of [
    ['omitted code', '¥1,000', 2], ['default quantity', `${code} ¥1,000`, 2], ['fractional unit', `${code} 3 ¥1,000`, 4], ['repaired code', '22O0083271771 1 ¥1,000', 2]
  ]) test(`${money} next-product ${name} is not literal boundary proof`, () => {
    const text = body({ money }).replace('00\n0200)\n' + code + ' 1 ¥1,000', '00\n0200)\n' + detail);held(parse(receipt(text, { count })));
  });
  for (const accounting of [{ count: 0 }, { count: 3 }, { net: 1699 }, { paid: false }]) test(`${money} grounded ends do not replace accounting ${JSON.stringify(accounting)}`, () => held(parse(receipt(body({ money }), accounting))));
  test(`${money} a source edge is not an anchor for a dependent chain`, () => {
    const items = body({ money }), summary = '小計 2点 ¥1700\n合計 ¥1700\n楽天ペイ ¥1700';held(parse({ text: receipt(items), diagnostics: [{ label: '商品全域', text: items }, { label: '全体', text: summary }] }));
  });
  test(`${money} a closed cycle of full references has no independently known end`, () => {
    const cycle = `${ref(ids[0], 100, { money })}\n${part(fold(ids[1]))}\n${ref(ids[1], 200, { money })}\n${part(fold(ids[0]))}`;held(parse(receipt(cycle)));
  });
  test(`${money} merged text cannot borrow terminal spelling proof from another recognition source`, () => {
    held(parse({ text: receipt(body({ money })), diagnostics: [{ label: '全体', text: receipt(body({ money, referenceIds: ['000100', '200'] })) }] }));
  });
  test(`${money} a boundary cannot be established using a next product from another source`, () => {
    const first = `${part(fold(ids[0]))}\n${ref(ids[0], 100, { money })}`, second = `${part(fold(ids[1]))}\n${ref(ids[1], 200, { money })}\n小計 2点 ¥1700\n合計 ¥1700\n楽天ペイ ¥1700`;
    held(parse({ text: receipt(body({ money })), diagnostics: [{ label: '商品上段', text: first }, { label: '商品下段', text: second }] }));
  });
  test(`${money} contradictory grounded allocations across passes remain manual`, () => held(parse({ text: receipt(body({ money })), whole: receipt(body({ money, values: [200, 100] })) })));
}
test('a terminal bare value without its local yen unit cannot ground the previous amount', () => {
  held(parse(receipt(body({ money: 'bare' }).replace('(明細ID 000200) 値引額（円）', '(明細ID 000200) 値引額'))));
});
test('a previous bare amount without its unit cannot use the next product to supply currency evidence', () => {
  held(parse(receipt(body({ money: 'bare' }).replace('(明細ID 000100) 値引額（円）', '(明細ID 000100) 値引額'))));
});
test('removing an invalid terminal proof also removes its previously grounded dependents', () => {
  const p = parse(receipt(body({ money: 'bare', values: [100, 1000] }), { net: 900 }));held(p);assert.equal(p.wrappedIdRecoveryCount || 0, 0);
});
test('a terminal fractional price with balanced printed quantity cannot ground predecessors', () => {
  const text = body({ money: 'bare' }).replace('00\n0200)\n' + code + ' 1 ¥1,000', '00\n0200)\n' + code + ' 3 ¥1,000');held(parse(receipt(text, { count: 4 })));
});
test('an alphabetic next-product fold does not gain the padded numeric end exception', () => held(parse(receipt(body({ printedIds: ['000100', '00A200'], terminalInline: true })))));
test('a spaced canonical alias cannot certify the next product', () => {
  const text = body().replace('緑茶 (明細ID 00\n0200)', '緑茶 (明細ID 2 00)');held(parse(receipt(text)));
});
test('original product fragments, full references, money and caller objects remain intact', () => {
  const text = receipt(body({ money: 'bare', layout: 'scope' })), input = { text, whole: text, diagnostics: [{ label: '全体', text }] }, before = JSON.stringify(input), p = parse(input);assigned(p);
  assert.equal(JSON.stringify(input), before);assert(p.rawText.includes('100\n緑茶 (明細ID 00\n0200)'));assert(p.debugText.includes('(明細ID 000200)\n(単品)\n値引額（円）\n200'));
});
test('grounded end analysis preserves ledger, dictionary and schema', () => {
  const r = runtime();r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'テスト商店', name: '緑茶', priceHints: [1000], source: 'learned', confirmedCount: 4 }]);r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);const before = r.evaluate('JSON.stringify(state)');
  assigned(parse(receipt(body({ money: 'bare' })), r));held(parse(receipt(body({ money: 'bare', referenceIds: ['000100', '200'] })), r));
  assert.equal(r.evaluate('JSON.stringify(state)'), before);assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);assert.equal(r.writes.length, 0);assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});
for (const [money, valid] of [['yen', true], ['bare', true], ['bare', false]]) test(`mock OCR ${money} ${valid ? 'grounded' : 'unproved'} next product`, async () => {
  const r = runtime(), text = receipt(body({ money, referenceIds: valid ? ids : ['000100', '200'] }));let terminated = 0;
  r.context.Tesseract = { async createWorker() { return { async setParameters() {}, async recognize() { return { data: { text, blocks: [] } }; }, async terminate() { terminated++; } }; } };
  const canvas = { width: 100, height: 300 }, ocr = await r.context.receiptInternals.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'middle', canvas }, { role: 'bottom', canvas }], shopSlices: [], itemSlices: Array.from({ length: 7 }, () => ({ canvas })), amountSlices: [], paymentSlices: [] });
  const lines = ocr.text.split('\n');
  assert.equal(lines.filter(line => line === '緑茶 (明細ID 00').length, 2);
  assert.equal(lines.filter(line => line === `${code} 1 ¥1,000`).length, 2);
  assert.equal(lines.filter(line => line === '小計 2点 ¥1700').length, 1);
  const p = parse(ocr, r);if (valid) assigned(p);else held(p);assert.equal(terminated, 1);assert.equal(r.writes.length, 0);
});
