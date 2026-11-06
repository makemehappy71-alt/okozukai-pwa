const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const codeA = '2200083271771', codeB = '2200083271702';
const part = (code, amount = 100, qty = 1) => `緑茶\n${code} ${qty} ¥1,000${amount ? `\n商品値引 ¥${amount}` : ''}`;
function receipt(body, { net = 1700, count = 2, paid = true, tax = 0 } = {}) {
  return `テスト商店\n2026年10月10日\n${body}\n小計 ${count ? count + '点 ' : ''}¥${net}\n${tax ? `消費税 ¥${tax}\n` : ''}${paid ? `合計 ¥${net + tax}\n楽天ペイ ¥${net + tax}` : ''}`;
}
const parse = (text, r = runtime()) => r.context.receiptFeature.parseReceiptText(text, '2026-10-10');
function assigned(p, expected) {
  assert.equal(p.discountStatus, 'attributed');
  assert.equal(p.discountAttributionConfirmed, true);
  assert.equal(p.discountReviewRequired, false);
  assert.equal(p.itemSetComplete, true);
  assert.equal(p.itemRows.length, expected.length);
  assert.deepEqual(Array.from(p.itemRows, (row, i) => [row.productCode, row.qty, p.splitRows[i].discount, p.splitRows[i].gross]), expected);
}
function held(p, status = 'total_only') {
  assert.equal(p.discountStatus, status);
  assert.equal(p.discountAttributionConfirmed, false);
  assert.equal(p.discountReviewRequired, true);
  assert.equal(p.itemSetComplete, false);
  assert.equal(p.autoConfirmedItemCount, 0);
  assert.equal(p.productCandidateAutoConfirmed, false);
  assert.notEqual(p.productCandidateStatus, 'confirmed');
  assert.equal(p.splitRows.length, 0);
}

for (const [first, second] of [[codeA, codeB], [codeB, codeA]]) test(`distinct codes identify identical names and prices: ${first} first`, () => {
  const p = parse(receipt(part(first, 100) + '\n' + part(second, 200)));
  assigned(p, [[first, 1, 100, 900], [second, 1, 200, 800]]);
  assert.deepEqual(Array.from(p.itemRows, x => x.name), ['緑茶', '緑茶']);
});

for (const discounted of [codeA, codeB]) test(`a single item discount is not spread over both same-name products: ${discounted}`, () => {
  const p = parse(receipt(part(codeA, discounted === codeA ? 100 : 0) + '\n' + part(codeB, discounted === codeB ? 100 : 0), { net: 1900 }));
  assigned(p, [[codeA, 1, discounted === codeA ? 100 : 0, discounted === codeA ? 900 : 1000], [codeB, 1, discounted === codeB ? 100 : 0, discounted === codeB ? 900 : 1000]]);
});

test('equal discounts on different codes are still two deductions', () => {
  assigned(parse(receipt(part(codeA) + '\n' + part(codeB), { net: 1800 })), [[codeA, 1, 100, 900], [codeB, 1, 100, 900]]);
});

test('OCR pass order changes cannot swap code-specific discounts', () => {
  const text = receipt(part(codeA, 100) + '\n' + part(codeB, 200));
  const reversed = receipt(part(codeB, 200) + '\n' + part(codeA, 100));
  const p = parse({ text, whole: reversed });
  assert.equal(p.discountAttributionConfirmed, true);
  const byCode = Object.fromEntries(Array.from(p.itemRows, (row, i) => [row.productCode, p.splitRows[i].discount]));
  assert.deepEqual(byCode, { [codeA]: 100, [codeB]: 200 });
});

test('code-specific discounts that disagree across OCR passes remain unconfirmed', () => {
  held(parse({ text: receipt(part(codeA, 100) + '\n' + part(codeB, 200)), whole: receipt(part(codeA, 200) + '\n' + part(codeB, 100)) }));
});

test('actual OCR code evidence can corroborate a source with identical product names', () => {
  const text = receipt(part(codeA, 100) + '\n' + part(codeB, 200));
  const p = parse({ text, diagnostics: [{ label: '全体', text }, { label: '分割 1', text: receipt(part(codeB, 200) + '\n' + part(codeA, 100)) }] });
  assert.equal(p.discountAttributionConfirmed, true);
  assert.equal(p.discount, 300);
});

test('uncoded OCR lines cannot choose between two identical coded products', () => {
  const text = receipt(part(codeA, 100) + '\n' + part(codeB, 200));
  held(parse({ text, diagnostics: [{ label: '全体', text: receipt('緑茶 ¥1,000\n商品値引 ¥100\n緑茶 ¥1,000\n商品値引 ¥200') }] }));
});

for (const label of ['商品値引', '値引', '会員値引']) test(`one ambiguous ${label} never enters legacy proportional splitting`, () => {
  const p = parse(receipt(`緑茶 ¥1,000\n${label} ¥100\n緑茶 ¥1,000`, { net: 1900 }));
  held(p);
  assert.equal(p.discount, 100);
  assert.equal(p.itemRows.length, 2);
});

for (const amounts of [[100, 200], [100, 100]]) test(`identical codes and quantities are not distinguished by line order: ${amounts}`, () => {
  held(parse(receipt(part(codeA, amounts[0]) + '\n' + part(codeA, amounts[1]), { net: 2000 - amounts[0] - amounts[1] })));
});

test('explicit quantity distinguishes identical name and price without codes', () => {
  const p = parse(receipt('緑茶 2 ¥1,000\n商品値引 ¥100\n緑茶 1 ¥1,000', { net: 1900, count: 3 }));
  assigned(p, [['', 2, 100, 900], ['', 1, 0, 1000]]);
});

test('same code with different printed quantities remains uniquely identifiable', () => {
  const p = parse(receipt(part(codeA, 100, 2) + '\n' + part(codeA, 200, 1), { count: 3 }));
  assigned(p, [[codeA, 2, 100, 900], [codeA, 1, 200, 800]]);
});

for (const separator of ['\n', '\n商品値引 ¥100\n']) test(`repeated code-only price lines retain both physical occurrences: ${JSON.stringify(separator)}`, () => {
  const r = runtime(), a = r.context.receiptInternals;
  const body = `${codeA} 1 ¥1,000${separator}${codeA} 1 ¥1,000`;
  for (const text of [body, a.productSourceText(body)]) {
    const rows = a.itemRowsFromText(text);
    assert.equal(rows.length, 2);
    assert.equal(rows.reduce((sum, row) => sum + row.qty, 0), 2);
    assert.equal(rows.every(row => row.name === '商品名要確認' && row.candidateOnly && row.lowConfidence), true);
    assert.equal(new Set(rows.map(row => row.sourceIndex)).size, 2);
  }
});

test('name followed by its code is one occurrence, not two', () => {
  const r = runtime();
  const rows = r.context.receiptInternals.itemRowsFromText(part(codeA, 0));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].productCode, codeA);
  assert.equal(rows[0].name, '緑茶');
});

test('repeated unnamed codes keep both candidates and do not inherit the shop name', () => {
  const p = parse(receipt(`${codeA} 1 ¥1,000\n商品値引 ¥100\n${codeA} 1 ¥1,000\n商品値引 ¥200`));
  held(p);
  assert.equal(p.itemRows.length, 2);
  assert.equal(p.actualItemCount, 2);
  assert.equal(p.itemRows.every(row => row.name === '商品名要確認'), true);
  assert.equal(p.itemRows.some(row => row.rawName === p.shop), false);
});

test('named duplicate code lines remain separate physical purchases', () => {
  const a = runtime().context.receiptInternals;
  const rows = a.itemRowsFromText(part(codeA, 0) + '\n' + part(codeA, 0));
  assert.equal(rows.length, 2);
  assert.equal(rows.every(row => row.productCode === codeA && row.total === 1000), true);
});

for (const options of [{ count: 0 }, { count: 3 }, { paid: false }, { net: 1699 }]) test(`codes do not bypass missing accounting evidence: ${JSON.stringify(options)}`, () => {
  held(parse(receipt(part(codeA, 100) + '\n' + part(codeB, 200), options)), 'unresolved');
});

test('generic coupons do not inherit a product merely because it has a code', () => {
  held(parse(receipt(part(codeA, 0) + '\n' + part(codeB, 0) + '\n会員値引 ¥100\nクーポン割引 ¥200')));
});

test('a code without a readable adjacent name cannot auto-assign a discount', () => {
  const p = parse(receipt(`${codeA} 1 ¥1,000\n商品値引 ¥100\n${codeB} 1 ¥1,000\n商品値引 ¥200`));
  held(p);
  assert.equal(p.itemRows.length, 2);
});

test('an unreadable intervening name breaks the code/discount association', () => {
  held(parse(receipt(part(codeA, 0) + '\n不明な補足\n商品値引 ¥100\n' + part(codeB, 200))));
});

test('tax allocation uses the correct code-specific net amounts', () => {
  const p = parse(receipt(part(codeA, 100) + '\n' + part(codeB, 200), { tax: 136 }));
  assigned(p, [[codeA, 1, 100, 972], [codeB, 1, 200, 864]]);
});

test('duplicate OCR sources never double the number of purchased coded products', () => {
  const text = receipt(part(codeA, 100) + '\n' + part(codeB, 200));
  const p = parse({ text, whole: text, itemText: text, sections: { middle: text } });
  assigned(p, [[codeA, 1, 100, 900], [codeB, 1, 200, 800]]);
  assert.equal(p.actualItemCount, 2);
});

test('learned names cannot make indistinguishable occurrences confirmed', () => {
  const r = runtime();
  r.storage.set('okozukaiReceiptProductDictionaryV1', JSON.stringify([{ shopKey: 'テスト商', name: '緑茶', aliases: ['緑茶'], priceHints: [1000], source: 'learned', confirmedCount: 6 }]));
  held(parse(receipt('緑茶 ¥1,000\n商品値引 ¥100\n緑茶 ¥1,000', { net: 1900 }), r));
  assert.equal(r.writes.length, 0);
});

test('coded and unresolved parsing leave existing user data unchanged', () => {
  const r = runtime();
  r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'unrelated', name: '学習商品', priceHints: [73], source: 'learned', confirmedCount: 4 }]);
  r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);
  const before = r.evaluate('JSON.stringify(state)');
  parse(receipt(part(codeA, 100) + '\n' + part(codeB, 200)), r);
  parse(receipt('緑茶 ¥1,000\n商品値引 ¥100\n緑茶 ¥1,000', { net: 1900 }), r);
  assert.equal(r.evaluate('JSON.stringify(state)'), before);
  assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);
  assert.equal(r.writes.length, 0);
  assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});

test('a missing repeated name in merged OCR cannot add a phantom coded purchase', () => {
  const actual = receipt(part(codeA, 100) + '\n' + part(codeB, 200));
  const merged = actual.replace(`緑茶\n${codeB}`, codeB);
  const p = parse({ text: merged, whole: actual, itemText: merged, diagnostics: [{ label: '全体', text: actual }] });
  assert.equal(p.itemRows.length, 2);
  assert.equal(p.actualItemCount, 2);
  assert.equal(p.discountAttributionConfirmed, true);
  const byCode = Object.fromEntries(Array.from(p.itemRows, (row, i) => [row.productCode, p.splitRows[i].discount]));
  assert.deepEqual(byCode, { [codeA]: 100, [codeB]: 200 });
});

test('reordered same-code quantity variants do not merge across OCR passes', () => {
  const text = receipt(part(codeA, 100, 2) + '\n' + part(codeA, 200, 1), { count: 3 });
  const whole = receipt(part(codeA, 200, 1) + '\n' + part(codeA, 100, 2), { count: 3 });
  const p = parse({ text, whole });
  assert.equal(p.discountAttributionConfirmed, true);
  assert.equal(p.actualItemCount, 3);
  assert.deepEqual(Object.fromEntries(Array.from(p.itemRows, (row, i) => [row.qty, p.splitRows[i].discount])), { 1: 200, 2: 100 });
});

test('mock OCR pipeline preserves coded repetitions despite merged-name deduplication', async () => {
  const r = runtime(), a = r.context.receiptInternals;
  const text = receipt(part(codeA, 100) + '\n' + part(codeB, 200));
  let terminated = 0;
  r.context.Tesseract = { async createWorker() { return {
    async setParameters() {}, async recognize() { return { data: { text, blocks: [] } }; }, async terminate() { terminated++; }
  }; } };
  const canvas = { width: 100, height: 300 };
  const ocr = await a.runOCR({ gray: canvas, slices: [{ role: 'top', canvas }, { role: 'middle', canvas }, { role: 'bottom', canvas }], shopSlices: [], itemSlices: Array.from({ length: 7 }, () => ({ canvas })), amountSlices: [], paymentSlices: [] });
  const p = parse(ocr, r);
  assert.equal(p.itemRows.length, 2);
  assert.equal(p.actualItemCount, 2);
  assert.equal(p.discountAttributionConfirmed, true);
  assert.equal(p.splitRows.reduce((sum, row) => sum + row.gross, 0), 1700);
  assert.equal(terminated, 1);
  assert.equal(r.writes.length, 0);
});

test('a more readable name cannot absorb a same-code row with a different quantity', () => {
  const a = runtime().context.receiptInternals;
  const named = a.itemRowsFromText(`キリン 生茶 500ml\n${codeA} 1 ¥1,000`, 1);
  const shortened = a.itemRowsFromText(`緑茶\n${codeA} 2 ¥1,000`, 2);
  const choice = a.chooseItemsForSubtotal(named.concat(shortened), 1700, 1700, 300, '');
  assert.equal(choice.matched, true);
  assert.equal(choice.rows.length, 2);
  assert.equal(choice.rows.reduce((sum, row) => sum + row.qty, 0), 3);
  assert.equal(choice.rows.reduce((sum, row) => sum + row.total, 0), 2000);
});
