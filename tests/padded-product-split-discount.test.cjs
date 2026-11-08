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
  const lead = layout === 'own' ? '\n' : layout === 'scope' ? '\n(単品)\n' : layout === 'inline-scope' ? ' 商品\n' : ' ';
  return `(明細ID ${id})${lead}${label}\n${amount}`;
}
function body({ printedIds = ids, referenceIds = printedIds, values = [100, 200], style = 'two', qty = 1, ...options } = {}) {
  return printedIds.map(id => part(fold(id, style), qty)).concat(referenceIds.map((id, i) => ref(id, values[i], options))).join('\n');
}
function receipt(items, { count = 2, net = 1700, tax = 0, paid = true } = {}) {
  return `テスト商店\n2026年11月08日\n${items}\n小計 ${count ? count + '点 ' : ''}¥${net}\n${tax ? '消費税 ¥' + tax + '\n' : ''}${paid ? '合計 ¥' + (net + tax) + '\n楽天ペイ ¥' + (net + tax) : ''}`;
}
const parse = (input, r = runtime()) => r.context.receiptFeature.parseReceiptText(input, '2026-11-08');
function assigned(p, { canonical = ['100', '200'], values = [100, 200], gross = values.map(n => 1000 - n), qty = 1 } = {}) {
  assert.equal(p.discountAttributionConfirmed, true);assert.equal(p.discountReviewRequired, false);assert.equal(p.itemSetComplete, true);
  assert.deepEqual(Array.from(p.itemRows, row => [row.name, row.receiptLineId, row.qty, row.total]), canonical.map(id => ['緑茶', id, qty, 1000]));
  assert.deepEqual(Array.from(p.splitRows, row => [row.discount, row.gross]), values.map((n, i) => [n, gross[i]]));
  assert(p.wrappedIdRecoveryCount > 0);assert(p.itemRows.every(row => !Object.hasOwn(row, 'printedValue') && !Object.hasOwn(row, 'reference')));
}
function held(p) {
  assert.equal(p.discountAttributionConfirmed, false);assert.equal(p.itemSetComplete, false);assert.equal(p.autoConfirmedItemCount, 0);assert.equal(p.productCandidateAutoConfirmed, false);assert.equal(p.splitRows.length, 0);
}
for (const style of ['two', 'digits', 'close']) {
  for (const layout of ['same', 'own', 'scope', 'inline-scope']) {
    for (const money of ['yen', 'suffix']) for (const label of ['値引', '割引額', '値下げ額']) test(`${style} product ID uses an original complete ${layout} reference with ${label} and ${money} amount`, () => assigned(parse(receipt(body({ style, layout, money, label })))));
    for (const label of ['値引額（円）', '割引額 (円)', '値下額(円)', '値下げ額（円）']) test(`${style} product ID uses original ${layout} ${label} to type a bare amount`, () => assigned(parse(receipt(body({ style, layout, money: 'bare', label })))));
  }
}
for (const money of ['yen', 'bare']) {
  test(`${money} values matching other IDs do not change the reference target`, () => assigned(parse(receipt(body({ money, values: [200, 100] }))), { values: [200, 100] }));
  test(`${money} tax is allocated after the original reference establishes identity`, () => assigned(parse(receipt(body({ money }), { tax: 136 })), { gross: [972, 864] }));
  test(`${money} literal quantity ten is independent of the ID and amount`, () => assigned(parse(receipt(body({ money, qty: 10 }), { count: 20 })), { qty: 10 }));
  for (const newline of ['\n', '\r\n', '\r']) test(`${money} source keeps ${JSON.stringify(newline)} field boundaries`, () => assigned(parse(receipt(body({ money })).replace(/\n/g, newline))));
  for (const [open, close] of [['[', ']'], ['【', '】'], ['（', '）']]) test(`${money} source keeps ${open}${close} ID boundaries`, () => {
    const text = receipt(body({ money })).replace(/\(明細ID/g, open + '明細ID').replace(/(0100|0200|000100|000200)\)/g, '$1' + close);assigned(parse(text));
  });
  test(`${money} full-width ID digits preserve exact original zero spelling`, () => {
    const printedIds = ids.map(id => id.replace(/[0-9]/g, n => String.fromCharCode(n.charCodeAt(0) + 0xfee0)));assigned(parse(receipt(body({ money, printedIds }))));
  });
  test(`${money} IDs one/two can equal quantity and basket count when typed`, () => {
    assigned(parse(receipt(body({ money, printedIds: ['000001', '000002'], values: [1, 2] }), { net: 1997 })), { canonical: ['1', '2'], values: [1, 2] });
  });
  test(`${money} a single folded product and split reference affect only that product`, () => {
    assigned(parse(receipt(`${part(fold(ids[0]))}\n${part(ids[1])}\n${ref(ids[0], 100, { money })}`, { net: 1900 })), { values: [100, 0] });
  });
  for (const referenceIds of [['100', '200'], ['0100', '0200'], ['00100', '00200'], ['000101', '000200']]) test(`${money} reference spelling ${referenceIds.join('/')} cannot be guessed from the folded product`, () => held(parse(receipt(body({ money, referenceIds })))));
  test(`${money} folded reference IDs cannot attest folded product IDs`, () => {
    held(parse(receipt(body({ money, referenceIds: ids.map(id => fold(id)) }))));
  });
  test(`${money} duplicate canonical merchandise IDs remain ambiguous`, () => {
    held(parse(receipt(body({ money, printedIds: ['000100', '000100'], referenceIds: ids }))));
  });
  test(`${money} repeated split references are not chosen or summed`, () => {
    held(parse(receipt(`${part(fold(ids[0]))}\n${part(fold(ids[1]))}\n${ref(ids[0], 100, { money })}\n${ref(ids[0], 50, { money })}\n${ref(ids[1], 150, { money })}`)));
  });
  test(`${money} a complete inline reference and split reference are separate occurrences`, () => {
    held(parse(receipt(`${part(fold(ids[0]))}\n${part(fold(ids[1]))}\n(明細ID 000100) 値引 ¥100\n${ref(ids[0], 50, { money })}\n${ref(ids[1], 150, { money })}`)));
  });
  test(`${money} an exact full product cannot hide another folded product with the same ID`, () => {
    held(parse(receipt(`${part(fold(ids[0]))}\n${part(ids[0])}\n${ref(ids[0], 300, { money })}`)));
  });
  for (const suffix of ['対象外', '個', '%', '200', '¥200', '0']) test(`${money} a following ${suffix} is not detached from the amount`, () => {
    const amount = money === 'bare' ? '値引額（円）\n100' : '値引\n¥100';held(parse(receipt(body({ money }).replace(amount, amount + '\n' + suffix))));
  });
  for (const barrier of ['\n', '\t\n', '注記\n', '(明細ID 000300)\n', '消費税 ¥0\n']) test(`${money} a barrier ${JSON.stringify(barrier)} is not skipped`, () => {
    const label = money === 'bare' ? '値引額（円）' : '値引';held(parse(receipt(body({ money }).replace(label + '\n', label + '\n' + barrier))));
  });
  for (const accounting of [{ count: 0 }, { count: 3 }, { net: 1699 }, { paid: false }]) test(`${money} identity evidence cannot replace accounting ${JSON.stringify(accounting)}`, () => held(parse(receipt(body({ money }), accounting))));
  test(`${money} a crop edge does not establish the end of a reference amount`, () => {
    const items = body({ money }), summary = '小計 2点 ¥1700\n合計 ¥1700\n楽天ペイ ¥1700';held(parse({ text: receipt(items), diagnostics: [{ label: '商品全域', text: items }, { label: '全体', text: summary }] }));
  });
  test(`${money} merged text cannot borrow full ID spellings from another source`, () => {
    held(parse({ text: receipt(body({ money })), diagnostics: [{ label: '全体', text: receipt(body({ money, referenceIds: ['100', '200'] })) }] }));
  });
  test(`${money} separate sources cannot supply product and reference halves`, () => {
    held(parse({ text: receipt(body({ money })), diagnostics: [{ label: '分割 1', text: receipt(ids.map(id => part(fold(id))).join('\n')) }, { label: '分割 2', text: receipt(ids.map((id, i) => ref(id, [100, 200][i], { money })).join('\n')) }] }));
  });
  test(`${money} contradictory balanced allocations across passes remain manual`, () => held(parse({ text: receipt(body({ money })), whole: receipt(body({ money, values: [200, 100] })) })));
}
for (const label of ['値引', '割引額', '値引額', '値引額(個)', '値引額(%)', '値引額(円/個)', '値引額（円） 対象外', '値引額合計', '値引後価格', '数量(円)']) test(`folded merchandise cannot type a bare amount from ${label}`, () => held(parse(receipt(body({ money: 'bare', label })))));
for (const value of ['0', '00100', '-100', '1,000', '100001', '1O0', '100 注記', '100 (明細ID 000200)', '10%']) test(`a complete ID does not repair a bare monetary value ${value}`, () => held(parse(receipt(body({ money: 'bare', values: [value, 200] })))));
for (const value of ['0', '1O0', '100 対象外', '10%']) test(`a complete ID does not repair the currency field ${value}`, () => held(parse(receipt(body({ values: [value, 200] })))));
for (const [name, transform, count] of [
  ['omitted quantity', text => text.replaceAll(`${code} 1 ¥1,000`, `${code} ¥1,000`), 2],
  ['missing code', text => text.replaceAll(`${code} 1 ¥1,000`, '¥1,000'), 2],
  ['fractional unit price', text => text.replaceAll(`${code} 1 ¥1,000`, `${code} 3 ¥1,000`), 6]
]) test(`bare money still requires literal product evidence: ${name}`, () => {
  held(parse(receipt(transform(body({ money: 'bare' })), { count })));
});
test('a bare full-price deduction remains manual', () => held(parse(receipt(body({ money: 'bare', values: [1000, 200] }), { net: 800 }))));
test('a different ID scope is not a merchandise-ID witness', () => held(parse(receipt(body().replace('(明細ID 000100)', '(取引ID 000100)')))));
test('a malformed original full ID bracket is not fixed', () => held(parse(receipt(body().replace('(明細ID 000100)', '(明細ID 000100]')))));
test('a malformed folded product bracket is not fixed', () => held(parse(receipt(body().replace('00\n0100)', '00\n0100]')))));
test('spaced and numeric canonical IDs remain distinct and ambiguous', () => {
  held(parse(receipt(`${part(fold(ids[0]))}\n${part('1 00')}\n${ref(ids[0], 100)}\n${ref('1 00', 200, { layout: 'scope', money: 'bare' })}`)));
});
test('an unrelated complete ID token cannot supply a different reference spelling', () => held(parse(receipt('(明細ID 000100)\n' + body({ referenceIds: ['100', '000200'] })))));
test('a non-padded alphabetic fold does not gain the padded-numeric exception', () => held(parse(receipt(body({ printedIds: ['AA0100', 'BB0200'] })))));
test('footer split references do not establish current-sale identity', () => {
  const items = ids.map(id => part(fold(id))).join('\n') + '\n商品値引 ¥100\n商品値引 ¥200';held(parse(receipt(items) + '\n' + ids.map((id, i) => ref(id, [100, 200][i])).join('\n')));
});
test('original full reference IDs, product folds, tabs and caller objects remain intact', () => {
  const text = receipt(body({ layout: 'scope', money: 'bare' })).replace('値引額（円）\n100', '値引額（円）\n\t100\t'), input = { text, whole: text, diagnostics: [{ label: '全体', text }] }, before = JSON.stringify(input), p = parse(input);assigned(p);
  assert.equal(JSON.stringify(input), before);assert(p.rawText.includes('00\n0100)'));assert(p.rawText.includes('(明細ID 000100)\n(単品)\n値引額（円）\n\t100\t'));assert(p.debugText.includes('値引額（円）\n\t100\t'));
});
test('split reference analysis preserves existing ledger, dictionary and schema', () => {
  const r = runtime();r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'テスト商店', name: '緑茶', priceHints: [1000], source: 'learned', confirmedCount: 4 }]);r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);const before = r.evaluate('JSON.stringify(state)');
  assigned(parse(receipt(body({ money: 'bare' })), r));held(parse(receipt(body({ money: 'bare', label: '値引額' })), r));
  assert.equal(r.evaluate('JSON.stringify(state)'), before);assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);assert.equal(r.writes.length, 0);assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});
for (const [money, valid] of [['yen', true], ['bare', true], ['bare', false]]) test(`mock OCR ${money} reference ${valid ? 'with' : 'without'} independent currency evidence`, async () => {
  const r = runtime(), text = receipt(body({ money, layout: 'own', label: money === 'yen' ? '値引' : valid ? '値引額（円）' : '値引額' }));let terminated = 0;
  r.context.Tesseract = { async createWorker() { return { async setParameters() {}, async recognize() { return { data: { text, blocks: [] } }; }, async terminate() { terminated++; } }; } };
  const canvas = { width: 100, height: 300 }, ocr = await r.context.receiptInternals.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'middle', canvas }, { role: 'bottom', canvas }], shopSlices: [], itemSlices: Array.from({ length: 7 }, () => ({ canvas })), amountSlices: [], paymentSlices: [] });
  const p = parse(ocr, r);if (valid) assigned(p);else held(p);assert.equal(terminated, 1);assert.equal(r.writes.length, 0);
});
