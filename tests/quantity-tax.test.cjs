const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const api = () => runtime().context.receiptInternals;

for (const [text, qty, total, unit] of [
  ['テスト商品 3 ¥100', 3, 100, 0], ['テスト商品 3 ¥101', 3, 101, 0],
  ['テスト商品 3 ¥99', 3, 99, 33], ['テスト商品 2 ¥1,280', 2, 1280, 640],
  ['テスト商品\n2200083271771 3 ¥100', 3, 100, 0],
  ['テスト商品\n2200083271771 3 ¥300', 3, 300, 100]
]) test(`derive unit only when total divides exactly: ${text.replaceAll('\n', ' / ')}`, () => {
  const row = api().itemRowsFromText(text).find(row => row.total === total);
  assert(row);
  assert.equal(row.qty, qty);
  assert.equal(row.unitPrice, unit);
  assert.equal(row.total, total);
});

for (const text of ['テスト商品 0 ¥100', 'テスト商品\n100 0 250', 'テスト商品\n@100 2 250', 'テスト商品\n@100 x 2 250', 'テスト商品\n¥100 2 ¥250']) {
  test(`invalid quantity or multiplication is not a merchandise row: ${text.replaceAll('\n', ' / ')}`, () => {
    assert.equal(api().itemRowsFromText(text).length, 0);
  });
  test(`subtotal fallback never resurrects the invalid row: ${text.replaceAll('\n', ' / ')}`, () => {
    const total = text.includes('250') ? 250 : 100;
    const p = runtime().context.receiptFeature.parseReceiptText(`テスト商店\n2026年10月10日\n${text}\n小計 1点 ¥${total}\n合計 ¥${total}\n楽天ペイ ¥${total}`, '2026-10-10');
    assert.equal(p.amount, total);
    assert.equal(p.itemRows.length, 0);
  });
}
test('learned gap recovery cannot override explicit quantity zero', () => {
  const r = runtime();
  r.storage.set('okozukaiReceiptProductDictionaryV1', JSON.stringify([{ shopKey: 'テスト商', name: 'テスト商品', aliases: ['テスト商品'], priceHints: [100], source: 'learned', confirmedCount: 3 }]));
  const p = r.context.receiptFeature.parseReceiptText('テスト商店\nテスト商品 0 ¥100\n小計 1点 ¥100\n合計 ¥100\n楽天ペイ ¥100', '2026-10-10');
  assert.equal(p.itemRows.length, 0);
  assert.equal(p.learnedGapRecovered, false);
  assert.equal(r.writes.length, 0);
});
test('a zero on a points row does not block legitimate learned recovery', () => {
  const r = runtime();
  r.storage.set('okozukaiReceiptProductDictionaryV1', JSON.stringify([{ shopKey: 'テスト商', name: 'テスト商品', aliases: ['テスト商品'], priceHints: [100], source: 'learned', confirmedCount: 3 }]));
  const p = r.context.receiptFeature.parseReceiptText('テスト商店\nテスト商品\n小計 1点 ¥100\n合計 ¥100\n楽天ペイ ¥100\nポイント 0 ¥100', '2026-10-10');
  assert.equal(p.learnedGapRecovered, true);
  assert.equal(p.itemRows[0].name, 'テスト商品');
  assert.equal(p.itemRows[0].total, 100);
  assert.equal(r.writes.length, 0);
});
for (const text of ['テスト商品\n@100 2 200', 'テスト商品\n¥100 2 ¥200', 'テスト商品\n100 2 200']) test(`valid printed unit and quantity stay intact: ${text.replaceAll('\n', ' / ')}`, () => {
  const rows = api().itemRowsFromText(text);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].unitPrice, 100);
  assert.equal(rows[0].qty, 2);
  assert.equal(rows[0].total, 200);
});
test('a zero inside a model name is not quantity zero', () => {
  const row = api().itemRowsFromText('テスト商品0 ¥100')[0];
  assert.equal(row.name, 'テスト商品0');
  assert.equal(row.total, 100);
});

for (const input of ['24h 保湿クリーム', '24H 保湿クリーム', '２４ｈ 保湿クリーム']) test(`preserve explicitly allowed 24h product prefix: ${input}`, () => {
  const a = api();
  const expected = input.includes('24H') ? '24H 保湿クリーム' : '24h 保湿クリーム';
  assert.equal(a.normalizeProductName(input), expected);
  assert.equal(a.cleanFocusedProductName(input + ' ¥500', 500), expected);
});
test('24h prefix survives full receipt parsing', () => {
  const p = runtime().context.receiptFeature.parseReceiptText('テスト商店\n24h 保湿クリーム ¥500\n小計 ¥500\n外税 ¥50\n合計 ¥550\n楽天ペイ ¥550', '2026-10-10');
  assert.equal(p.itemRows[0].name, '24h 保湿クリーム');
  assert.equal(p.itemRows[0].total, 500);
  assert.equal(p.amount, 550);
});

for (const line of ['外税 ¥1,250', '内税 ¥1,250', '税 1,250', '消費税額 ¥1,250']) test(`read entire grouped tax amount: ${line}`, () => assert.equal(api().taxAmountFromLine(line), 1250));
for (const row of ['8% 10点 ¥1,250', '8Y, 10点 ¥1,250', '¥1,250', '(8% ¥1,250)']) test(`split tax heading keeps grouped amount: ${row}`, () => {
  const p = api().analyzeAmount(`小計 ¥15,625\n消費税額\n${row}\n合計 ¥16,875\n楽天ペイ ¥16,875`, '');
  assert.equal(p.tax, 1250);
  assert.equal(p.subtotal, 15625);
  assert.equal(p.amount, 16875);
});
for (const rate of [8, 10]) test(`compact ${rate}% tax reads grouped subtotal and printed tax`, () => {
  const net = rate === 8 ? 15625 : 12500;
  const p = api().analyzeAmount(`小計 10点 ¥${net.toLocaleString('en-US')}\n${rate}Y 10点 ¥1,250\n楽天ベイ`, '');
  assert.equal(p.tax, 1250);
  assert.equal(p.subtotal, net);
  assert.equal(p.amount, net + 1250);
});
for (const row of ['8Y 9点 ¥1,250', '8Y 10点 ¥1,251', '8Y 10点 1,250', '8Y 10点 ¥1,25']) test(`compact tax rejects inconsistent or weak data: ${row}`, () => {
  assert.equal(api().analyzeAmount(`小計 10点 ¥15,625\n${row}\n楽天ベイ`, '').tax, 0);
});
for (const row of ['外税 ¥1,25', '消費税額 ¥1,25', '内税 ¥1,250,3', '税率 10%', '外税 10%']) test(`malformed tax or rate alone is never an amount: ${row}`, () => assert.equal(api().taxAmountFromLine(row), 0));
test('tax heading never takes a following product price as tax', () => {
  const p = api().analyzeAmount('小計 ¥15,625\n消費税額\nテスト商品 ¥1250\n合計 ¥16,875', '');
  assert.equal(p.tax, 0);
});
test('a following points row cannot become grouped tax', () => {
  assert.equal(api().analyzeAmount('小計 ¥15,625\n消費税額\nポイント ¥1,250\n合計 ¥16,875', '').tax, 0);
});
test('grouped tax reconciles full parsing without altering existing ledger or dictionary', () => {
  const r = runtime();
  r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:500,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'unrelated', name: '既存商品', priceHints: [500], source: 'learned' }]);
  r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);
  const before = r.evaluate('JSON.stringify(state)');
  const p = r.context.receiptFeature.parseReceiptText('テスト商店\nテスト飲料 ¥15,625\n小計 ¥15,625\n消費税額\n8% ¥1,250\n合計 ¥16,875\n楽天ペイ ¥16,875', '2026-10-10');
  assert.equal(p.tax, 1250);
  assert.equal(p.amount, 16875);
  assert.equal(p.subtotalTaxMatch, true);
  assert.equal(p.splitRows.reduce((sum, row) => sum + row.gross, 0), 16875);
  assert.equal(r.evaluate('JSON.stringify(state)'), before);
  assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);
  assert.equal(r.writes.length, 0);
  assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});
