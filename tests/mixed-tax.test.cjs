const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const api = () => runtime().context.receiptInternals;
const excluded = '8%税抜対象額 ¥100\n8%税額 ¥8\n10%税抜対象額 ¥200\n10%税額 ¥20';
const included = '8%対象額 ¥108\nうち消費税 ¥8\n10%対象額 ¥220\nうち消費税 ¥20';

for (const [label, text, net, tax, gross] of [
  ['8 then 10', excluded, 300, 28, 328],
  ['10 then 8', '10%税抜対象額 ¥200\n10%税額 ¥20\n8%税抜対象額 ¥100\n8%税額 ¥8', 300, 28, 328],
  ['parenthesized', '(8% 税抜対象額 ¥100)\n(8% 税額 ¥8)\n(10% 税抜対象額 ¥200)\n(10% 税額 ¥20)', 300, 28, 328],
  ['grouped amounts', '8%税抜対象額 ¥15,625\n8%税額 ¥1,250\n10%税抜対象額 ¥12,500\n10%税額 ¥1,250', 28125, 2500, 30625]
]) {
  test(`rate-specific bases sum to the receipt subtotal: ${label}`, () => {
    const p = api().analyzeAmount(text, '');
    assert.equal(p.subtotal, net);
    assert.equal(p.tax, tax);
    assert.equal(p.amount, gross);
    assert.equal(p.taxBuckets.length, 2);
    assert.equal(p.taxIncluded, false);
  });
  test(`printed total retains a correct subtotal: ${label}`, () => {
    const p = api().analyzeAmount(text + `\n合計 ¥${gross}`, '');
    assert.equal(p.subtotal, net);
    assert.equal(p.amount, gross);
    assert.equal(p.tax, tax);
  });
}

for (const label of ['小計', '小計 税抜', '税抜対象額', '計 2点']) test(`explicit overall subtotal takes priority: ${label}`, () => {
  const p = api().analyzeAmount(excluded + `\n${label} ¥300\n合計 ¥328`, '');
  assert.equal(p.subtotal, 300);
  assert.equal(p.amount, 328);
});

for (const text of [included, excluded]) test(`duplicated OCR tax blocks are not double-counted: ${text.slice(0, 10)}`, () => {
  const p = api().analyzeAmount(text, text);
  assert.equal(p.taxBuckets.length, 2);
  assert.equal(p.subtotal, 300);
  assert.equal(p.tax, 28);
  assert.equal(p.amount, 328);
});

for (const [rate, net, tax] of [[8, 100, 8], [10, 200, 20]]) test(`single complete excluded-tax bucket still works: ${rate}%`, () => {
  const p = api().analyzeAmount(`${rate}%税抜対象額 ¥${net}\n${rate}%税額 ¥${tax}`, '');
  assert.equal(p.taxBuckets.length, 1);
  assert.equal(p.subtotal, net);
  assert.equal(p.tax, tax);
  assert.equal(p.amount, net + tax);
});

test('explicitly printed zero taxes are complete data', () => {
  const p = api().analyzeAmount('8%税抜対象額 ¥1\n8%税額 ¥0\n10%税抜対象額 ¥2\n10%税額 ¥0', '');
  assert.equal(p.taxBuckets.length, 2);
  assert.equal(p.subtotal, 3);
  assert.equal(p.tax, 0);
  assert.equal(p.amount, 3);
});

for (const value of ['1,2', '1,00', '1,000,2', '100 2', '1000001']) {
  test(`malformed or out-of-range bucket tax is not repaired: ${value}`, () => {
    const text = excluded.replace('8%税額 ¥8', `8%税額 ¥${value}`);
    const p = api().analyzeAmount(text + '\n合計 ¥328\n楽天ペイ ¥328', '');
    assert.equal(p.taxBuckets.length, 0);
    assert.equal(p.candidates.some(x => x.labels.mixedTaxTotal), false);
    assert.equal(p.amount, 328);
  });
  test(`malformed or out-of-range tax base is not repaired: ${value}`, () => {
    assert.equal(api().receiptTaxBuckets(excluded.replace('対象額 ¥100', `対象額 ¥${value}`)).length, 0);
  });
}

for (const prefix of ['18', '110', '108']) test(`${prefix}% must never become an 8% or 10% bucket tax`, () => {
  const text = excluded.replace('8%税額 ¥8', `${prefix}%税額 ¥8`);
  const p = api().analyzeAmount(text + '\n合計 ¥328\n楽天ペイ ¥328', '');
  assert.equal(p.taxBuckets.length, 0);
  assert.equal(p.candidates.some(x => x.labels.mixedTaxTotal), false);
  assert.equal(p.amount, 328);
});

for (const text of [
  excluded.replace('8%税額 ¥8\n', ''),
  excluded.replace('10%税額 ¥20', ''),
  '8%税抜対象額 ¥100\n10%税抜対象額 ¥200',
  included.replace('うち消費税 ¥8', 'うち消費税 ¥1,2'),
  '8%税額 ¥8\n10%税額 ¥20'
]) test(`incomplete tax blocks cannot contribute a partial mixed total: ${text.replaceAll('\n', ' / ')}`, () => {
  const p = api().analyzeAmount(text, '');
  assert.equal(p.taxBuckets.length, 0);
  assert.equal(p.candidates.some(x => x.labels.mixedTaxTotal), false);
});

test('full receipt keeps both products, per-rate allocation, and existing data', () => {
  const r = runtime();
  r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'unrelated', name: '学習商品', priceHints: [73], source: 'learned', confirmedCount: 4 }]);
  r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);
  const before = r.evaluate('JSON.stringify(state)');
  const p = r.context.receiptFeature.parseReceiptText(`テスト商店\n2026年10月10日\n緑茶 ¥100\n歯ブラシ ¥200\n${excluded}\n合計 ¥328\n楽天ペイ ¥328`, '2026-10-10');
  assert.equal(p.amount, 328);
  assert.equal(p.subtotal, 300);
  assert.equal(p.tax, 28);
  assert.equal(p.itemRows.length, 2);
  assert.equal(p.itemSetComplete, true);
  assert.equal(p.subtotalTaxMatch, true);
  assert.deepEqual(Array.from(p.splitRows, x => [x.name, x.net, x.extra, x.gross, x.taxRate]), [
    ['緑茶', 100, 8, 108, 8], ['歯ブラシ', 200, 20, 220, 10]
  ]);
  assert.equal(r.evaluate('JSON.stringify(state)'), before);
  assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);
  assert.equal(r.writes.length, 0);
  assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});

for (const block of [
  excluded.replace('8%税額 ¥8\n', ''),
  excluded.replace('8%税額 ¥8', '8%税額 ¥1,2'),
  excluded.replace('8%税額 ¥8', '18%税額 ¥8'),
  included.replace('うち消費税 ¥8', 'うち消費税 ¥1,2')
]) test(`partial rate tax cannot override printed total: ${block.replaceAll('\n', ' / ')}`, () => {
  const p = api().analyzeAmount(`小計 ¥300\n${block}\n合計 ¥328`, '');
  assert.equal(p.amount, 328);
  assert.equal(p.subtotal, 300);
  assert.equal(p.tax, 0);
  assert.equal(p.candidates.some(x => x.labels.derivedTotal), false);
});

for (const label of ['消費税額合計', '消費税額']) test(`a separate overall tax survives an incomplete breakdown: ${label}`, () => {
  const p = api().analyzeAmount(`小計 ¥300\n${excluded.replace('8%税額 ¥8\n', '')}\n${label} ¥28\n合計 ¥328`, '');
  assert.equal(p.subtotal, 300);
  assert.equal(p.tax, 28);
  assert.equal(p.amount, 328);
  assert.equal(p.taxBuckets.length, 0);
});
