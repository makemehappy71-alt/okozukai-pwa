const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const code = '2200083271771';
const ids = ['000100', '000200'];
const part = (id, qty = 1) => `緑茶 (明細ID ${id})\n${code} ${qty} ¥1,000`;
const fold = (id, layout = 'two') => layout === 'close' ? id + '\n' : layout === 'digits' ? Array.from(id).join('\n') : layout === 'three' ? id.slice(0, 2) + '\n' + id.slice(2, 4) + '\n' + id.slice(4) : id.slice(0, 2) + '\n' + id.slice(2);
function ref(id, value, { bare = false, label = bare ? '値引額（円）' : '値引' } = {}) {
  return `(明細ID ${id}) ${label}${bare ? '\n' : ' ¥'}${value}`;
}
function body({ role = 'reference', layout = 'two', printedIds = ids, witnessIds = printedIds, values = [100, 200], qty = 1, ...options } = {}) {
  const products = (role === 'product' || role === 'both' ? printedIds.map(id => fold(id, layout)) : witnessIds).map(id => part(id, qty));
  const references = (role === 'product' ? witnessIds : printedIds.map(id => fold(id, layout))).map((id, i) => ref(id, values[i], options));
  return products.concat(references).join('\n');
}
function receipt(items, { count = 2, net = 1700, tax = 0, paid = true } = {}) {
  return `テスト商店\n2026年11月08日\n${items}\n小計 ${count ? count + '点 ' : ''}¥${net}\n${tax ? '消費税 ¥' + tax + '\n' : ''}${paid ? '合計 ¥' + (net + tax) + '\n楽天ペイ ¥' + (net + tax) : ''}`;
}
const parse = (input, r = runtime()) => r.context.receiptFeature.parseReceiptText(input, '2026-11-08');
function assigned(p, { canonical = ['100', '200'], values = [100, 200], gross = values.map(n => 1000 - n), qty = 1 } = {}) {
  assert.equal(p.discountAttributionConfirmed, true);assert.equal(p.discountReviewRequired, false);assert.equal(p.itemSetComplete, true);
  assert.deepEqual(Array.from(p.itemRows, row => [row.name, row.receiptLineId, row.qty, row.total]), canonical.map(id => ['緑茶', id, qty, 1000]));
  assert.deepEqual(Array.from(p.splitRows, row => [row.discount, row.gross]), values.map((n, i) => [n, gross[i]]));
  assert(p.wrappedIdRecoveryCount > 0);assert(p.itemRows.every(row => !Object.hasOwn(row, 'printedValue')));
}
function held(p) {
  assert.equal(p.discountAttributionConfirmed, false);assert.equal(p.itemSetComplete, false);assert.equal(p.autoConfirmedItemCount, 0);assert.equal(p.productCandidateAutoConfirmed, false);assert.equal(p.splitRows.length, 0);
}
for (const role of ['reference', 'product']) {
  for (const layout of ['two', 'three', 'digits', 'close']) {
    for (const label of ['値引', '割引額', '商品値引', '単品 値下げ額']) test(`${role} ${layout} padded numeric fold has an exact original ${label} witness`, () => assigned(parse(receipt(body({ role, layout, label })))));
    test(`${role} ${layout} values cannot choose the target numeric ID`, () => assigned(parse(receipt(body({ role, layout, values: [200, 100] }))), { values: [200, 100] }));
  }
}
for (const layout of ['two', 'three', 'digits', 'close']) {
  for (const label of ['値引額（円）', '割引額 (円)', '値下額(円)', '値下げ額（円）', '(単品) 値引額（円）', '\n商品\n値引額（円）']) test(`${layout} exact full product ID plus ${label} distinguishes a bare amount`, () => assigned(parse(receipt(body({ layout, bare: true, label })))));
  test(`${layout} a bare amount equal to the numeric ID still needs its local yen unit`, () => held(parse(receipt(body({ layout, bare: true, label: '値引額' })))));
}
for (const role of ['reference', 'product']) {
  for (const newline of ['\n', '\r\n', '\r']) test(`${role} folds support ${JSON.stringify(newline)} without removing ID zeros`, () => assigned(parse(receipt(body({ role })).replace(/\n/g, newline))));
  for (const [open, close] of [['[', ']'], ['【', '】'], ['（', '）']]) test(`${role} padded numeric fold keeps matching ${open}${close}`, () => {
    const text = receipt(body({ role })).replace(/\(明細ID/g, open + '明細ID').replace(/\)/g, close);assigned(parse(text));
  });
  test(`${role} full-width ID digits normalize while the printed zeros remain`, () => {
    const printedIds = ids.map(id => id.replace(/[0-9]/g, n => String.fromCharCode(n.charCodeAt(0) + 0xfee0)));assigned(parse(receipt(body({ role, printedIds }))));
  });
  test(`${role} the smallest six-digit padded IDs preserve numeric canonicalization`, () => {
    assigned(parse(receipt(body({ role, printedIds: ['000001', '000002'], values: [1, 2] }), { net: 1997 })), { canonical: ['1', '2'], values: [1, 2] });
  });
  test(`${role} tax allocation follows the exact restored ID`, () => assigned(parse(receipt(body({ role }), { tax: 136 })), { gross: [972, 864] }));
  test(`${role} explicit quantities survive ID restoration`, () => assigned(parse(receipt(body({ role, qty: 2 }), { count: 4 })), { qty: 2 }));
  for (const witnessIds of [['100', '200'], ['0100', '0200'], ['00100', '00200']]) test(`${role} a different zero spelling ${witnessIds.join('/')} is not a complete witness`, () => held(parse(receipt(body({ role, witnessIds })))));
  test(`${role} both folded sides cannot corroborate each other`, () => held(parse(receipt(body({ role: 'both' })))));
  test(`${role} a different full ID cannot be repaired from the price`, () => held(parse(receipt(body({ role, witnessIds: ['000101', '000200'] })))));
}
test('value-only ID brackets retain the exact original padded spelling', () => assigned(parse(receipt(body()).replace(/\(明細ID ([0-9\n]+)\)/g, '明細ID [$1]'))));
test('a single padded folded reference changes only its exact product', () => {
  assigned(parse(receipt(`${part(ids[0])}\n${part(ids[1])}\n${ref(fold(ids[0]), 100)}`, { net: 1900 })), { values: [100, 0] });
});
test('a single folded product needs its complete individually priced reference', () => {
  assigned(parse(receipt(`${part(fold(ids[0]))}\n${part(ids[1])}\n${ref(ids[0], 100)}\n${ref(ids[1], 200)}`)));
});
test('a non-colliding bare amount keeps the existing explicit amount-label evidence', () => {
  assigned(parse(receipt(body({ printedIds: ['000101', '000102'], bare: true, label: '値引額' }))), { canonical: ['101', '102'] });
});
test('padded closing-bracket rows retain spaces and tabs', () => {
  assigned(parse(receipt(body({ layout: 'close', bare: true })).replace(/\n\) /g, '\n\t )\t ')));
});
test('zero-prefixed alphanumeric IDs keep their opaque spelling', () => {
  const printedIds = ['00A100', '00B200'];assigned(parse(receipt(body({ printedIds }))), { canonical: printedIds });
});
for (const role of ['reference', 'product']) {
  for (const printedIds of [['000000', '000200'], ['0000100', '0000200']]) test(`${role} invalid numeric IDs ${printedIds.join('/')} do not gain a fold exception`, () => held(parse(receipt(body({ role, printedIds })))));
  for (const spaced of ['000 100', '1 00']) test(`${role} spaced spelling ${spaced} conflicts with numeric canonicalization`, () => {
    const items = role === 'reference' ? `${part(ids[0])}\n${part(spaced)}\n${ref(fold(ids[0]), 100)}\n${ref(spaced, 200)}` : `${part(fold(ids[0]))}\n${part(spaced)}\n${ref(ids[0], 100)}\n${ref(spaced, 200)}`;held(parse(receipt(items)));
  });
  test(`${role} duplicate canonical product IDs remain ambiguous`, () => {
    const items = `${part(role === 'product' ? fold(ids[0]) : ids[0])}\n${part('100')}\n${ref(role === 'reference' ? fold(ids[0]) : ids[0], 300)}`;held(parse(receipt(items)));
  });
  for (const accounting of [{ count: 0 }, { count: 3 }, { net: 1699 }, { paid: false }]) test(`${role} exact padded spelling does not replace accounting ${JSON.stringify(accounting)}`, () => held(parse(receipt(body({ role }), accounting))));
  for (const fragment of ['00 \n0100', '00\t\n0100', '00\n\t0100', '00\n\n0100', '00\n注記\n0100', '00\n(明細ID 000200)\n0100']) test(`${role} an ambiguous fold is not repaired: ${JSON.stringify(fragment)}`, () => {
    const text = receipt(body({ role })).replace(fold(ids[0]), fragment);held(parse(text));
  });
  test(`${role} mismatching closing brackets are not repaired`, () => held(parse(receipt(body({ role })).replace(fold(ids[0]) + ')', fold(ids[0]) + ']'))));
  test(`${role} summary IDs cannot replace an individual original witness`, () => {
    const items = role === 'product' ? `${part(fold(ids[0]))}\n${part(ids[1])}\n(明細ID 000100) 値引合計 ¥100\n${ref(ids[1], 200)}` : `${part('100')}\n${part(ids[1])}\n(明細ID 000100) 値引合計 ¥100\n${ref(fold(ids[0]), 100)}\n${ref(ids[1], 200)}`;held(parse(receipt(items)));
  });
  test(`${role} a source without its own full original witness cannot borrow another pass`, () => {
    held(parse({ text: receipt(body({ role })), diagnostics: [{ label: '全体', text: receipt(body({ role, witnessIds: ['100', '200'] })) }] }));
  });
  test(`${role} a merged text cannot join full witnesses from another recognition source`, () => {
    const full = body({ role }).split('\n'), referenceIndex = full.findIndex(line => line.startsWith('(明細ID'));
    held(parse({ text: receipt(body({ role })), diagnostics: [{ label: '分割 1', text: receipt(full.slice(0, referenceIndex).join('\n')) }, { label: '分割 2', text: receipt(full.slice(referenceIndex).join('\n')) }] }));
  });
  test(`${role} contradictory balanced allocations remain manual`, () => held(parse({ text: receipt(body({ role })), whole: receipt(body({ role, values: [200, 100] })) })));
}
test('an unrelated complete ID token cannot replace the exact original product spelling', () => {
  const items = '(明細ID 000100)\n' + body({ witnessIds: ['100', '000200'] });held(parse(receipt(items)));
});
test('an unrelated complete ID token cannot replace the exact original reference spelling', () => {
  held(parse(receipt('(明細ID 000100)\n' + body({ role: 'product', witnessIds: ['100', '000200'] }))));
});
test('two complete references with canonically equal IDs are not one original witness', () => {
  held(parse(receipt(`${part(fold(ids[0]))}\n${part(ids[1])}\n${ref(ids[0], 100)}\n${ref('100', 50)}\n${ref(ids[1], 150)}`)));
});
test('duplicate folded aliases do not share or sum a guessed reference', () => {
  held(parse(receipt(`${part(ids[0])}\n${part(ids[1])}\n${ref(fold(ids[0]), 100)}\n${ref(fold('100'), 50)}\n${ref(fold(ids[1]), 150)}`)));
});
test('a folded product uses the original complete reference ID and local yen label for a split amount', () => assigned(parse(receipt(body({ role: 'product', bare: true })))));
for (const label of ['値引額(個)', '値引額(%)', '値引額(円/個)', '値引額（円） 対象外', '値引(円)', '数量(円)']) test(`an ambiguous label ${label} does not type a bare numeric collision`, () => held(parse(receipt(body({ bare: true, label })))));
for (const value of ['00100', '-100', '1O0', '100 注記', '10%']) test(`restoring ID zeros does not repair the amount ${value}`, () => {
  held(parse(receipt(body({ bare: true }).replace('値引額（円）\n100', '値引額（円）\n' + value))));
});
for (const suffix of ['個', '%', '対象外', '200', '¥200']) test(`a bare value cannot discard the following ${suffix}`, () => held(parse(receipt(body({ bare: true }).replace('値引額（円）\n100', '値引額（円）\n100\n' + suffix)))));
test('a bare amount still needs literal product code, quantity and price', () => {
  held(parse(receipt(body({ bare: true }).replaceAll(`${code} 1 ¥1,000`, '¥1,000'))));
});
test('a bare amount at a recognition-source edge has no confirmed field boundary', () => {
  const items = body({ bare: true }), summary = '小計 2点 ¥1700\n合計 ¥1700\n楽天ペイ ¥1700';held(parse({ text: receipt(items), diagnostics: [{ label: '商品全域', text: items }, { label: '全体', text: summary }] }));
});
test('original zeros, fragments, monetary labels and caller objects remain intact', () => {
  const text = receipt(body({ bare: true })), input = { text, whole: text, diagnostics: [{ label: '全体', text }] }, before = JSON.stringify(input), p = parse(input);assigned(p);
  assert.equal(JSON.stringify(input), before);assert(p.rawText.includes('00\n0100) 値引額（円）\n100'));assert(p.debugText.includes('00\n0100) 値引額（円）\n100'));
});
test('padded numeric ID restoration preserves ledger, dictionary and schema', () => {
  const r = runtime();r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'テスト商店', name: '緑茶', priceHints: [1000], source: 'learned', confirmedCount: 4 }]);r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);const before = r.evaluate('JSON.stringify(state)');
  assigned(parse(receipt(body({ bare: true })), r));held(parse(receipt(body({ witnessIds: ['100', '200'] })), r));
  assert.equal(r.evaluate('JSON.stringify(state)'), before);assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);assert.equal(r.writes.length, 0);assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});
for (const [role, valid] of [['reference', true], ['product', true], ['reference', false]]) test(`mock OCR ${role} with ${valid ? 'exact' : 'different'} original zero spelling`, async () => {
  const r = runtime(), text = receipt(body({ role, witnessIds: valid ? ids : ['100', '200'] }));let terminated = 0;
  r.context.Tesseract = { async createWorker() { return { async setParameters() {}, async recognize() { return { data: { text, blocks: [] } }; }, async terminate() { terminated++; } }; } };
  const canvas = { width: 100, height: 300 }, ocr = await r.context.receiptInternals.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'middle', canvas }, { role: 'bottom', canvas }], shopSlices: [], itemSlices: Array.from({ length: 7 }, () => ({ canvas })), amountSlices: [], paymentSlices: [] });
  const p = parse(ocr, r);if (valid) assigned(p);else held(p);assert.equal(terminated, 1);assert.equal(r.writes.length, 0);
});
