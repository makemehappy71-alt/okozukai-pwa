const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const api = () => runtime().context.receiptInternals;
const code = '2200083271771';

for (const [line, qty, total, unit] of [
  [`${code} 2 ¥98`, 2, 98, 49],
  [`${code} 1 ¥10`, 1, 10, 10],
  [`${code} ¥98`, 1, 98, 98],
  [`${code} 2 ¥99`, 2, 99, 0],
  [`${code} 2 ¥1280`, 2, 1280, 640],
  [`${code} 2 ¥1,280C`, 2, 1280, 640],
  [`${code} 2 ￥1,280外`, 2, 1280, 640],
  [`${code} 2 ¥1,280円`, 2, 1280, 640],
  [`${code} 2 1,280`, 2, 1280, 640],
  ['ZZ00083271771 1 3¥1,990', 1, 1990, 1990]
]) {
  test(`complete code price is extracted directly: ${line}`, () => {
    const rows = api().itemRowsFromText('緑茶\n' + line);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, '緑茶');
    assert.equal(rows[0].productCode, code);
    assert.equal(rows[0].qty, qty);
    assert.equal(rows[0].total, total);
    assert.equal(rows[0].unitPrice, unit);
  });
  test(`code price survives source filtering: ${line}`, () => {
    const a = api();
    const text = '緑茶\n' + line;
    assert.equal(a.productSourceText(text), text.replaceAll('￥', '¥'));
    const rows = a.itemRowsFromText(a.productSourceText(text));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].productCode, code);
    assert.equal(rows[0].qty, qty);
    assert.equal(rows[0].total, total);
    assert.equal(rows[0].unitPrice, unit);
  });
}

for (const suffix of ['¥1,280,3', '¥1,28', '¥1280余計な文字', '¥1280 ¥2560', '¥12800000', '¥1000001', '¥1,000,001', '¥0', '¥9', '¥-98']) test(`code price never accepts a partial or oversized amount: ${suffix}`, () => {
  const a = api(), text = `緑茶\n${code} 2 ${suffix}`;
  assert.equal(a.itemRowsFromText(text).length, 0);
  assert.equal(a.itemRowsFromText(a.productSourceText(text)).length, 0);
});

for (const qty of [0, 100]) test(`invalid code quantity stays rejected: ${qty}`, () => {
  const a = api(), text = `緑茶\n${code} ${qty} ¥98`;
  assert.equal(a.itemRowsFromText(text).length, 0);
  assert.equal(a.itemRowsFromText(a.productSourceText(text)).length, 0);
});

for (const line of [`${code} 2 ¥98`, `${code} 2 ¥1280`, `${code} 2 ¥1,280`]) test(`code-only row retains review requirement: ${line}`, () => {
  const a = api(), rows = a.itemRowsFromText(a.productSourceText(line));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, '商品名要確認');
  assert.equal(rows[0].lowConfidence, true);
  assert.equal(rows[0].candidateOnly, true);
  assert.equal(rows[0].productCode, code);
  assert.equal(rows[0].qty, 2);
  assert(!rows[0].autoConfirmed);
});

test('metadata and a code without a price do not become code merchandise', () => {
  const a = api();
  const rows = a.itemRowsFromText(a.productSourceText(`TEL 0120-123-456\n登録番号 T1234567890123\n${code}\n通常P ¥98\n合計 ¥98`));
  assert.equal(rows.length, 0);
});

for (const [total, printed] of [[98, '98'], [1280, '1280'], [1280, '1,280']]) test(`full code receipt preserves quantity and accounting: ${printed}`, () => {
  const r = runtime();
  const p = r.context.receiptFeature.parseReceiptText(`テスト商店\n2026年10月10日\n緑茶\n${code} 2 ¥${printed}\n小計 2点 ¥${printed}\n合計 ¥${printed}\n楽天ペイ ¥${printed}`, '2026-10-10');
  assert.equal(p.amount, total);
  assert.equal(p.itemRows.length, 1);
  assert.equal(p.itemRows[0].name, '緑茶');
  assert.equal(p.itemRows[0].productCode, code);
  assert.equal(p.itemRows[0].qty, 2);
  assert.equal(p.itemRows[0].unitPrice, total / 2);
  assert.equal(p.itemRows[0].total, total);
  assert.equal(p.itemSetComplete, true);
  assert.equal(p.actualItemCount, 2);
  assert.equal(p.gapRecovered, false);
  assert.equal(p.splitRows.reduce((sum, row) => sum + row.gross, 0), total);
  assert.equal(r.writes.length, 0);
});

test('a malformed code price cannot complete a two-item-count receipt', () => {
  const p = runtime().context.receiptFeature.parseReceiptText(`テスト商店\n緑茶\n${code} 2 ¥1,280,3\n小計 2点 ¥1,280\n合計 ¥1,280\n楽天ペイ ¥1,280`, '2026-10-10');
  assert.equal(p.amount, 1280);
  assert.equal(p.itemRows.length, 0);
  assert.equal(p.itemSetComplete, false);
});

test('new code parsing leaves existing ledger and dictionary unchanged', () => {
  const r = runtime();
  r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'unrelated', name: '学習商品', priceHints: [73], source: 'learned', confirmedCount: 4 }]);
  r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);
  const before = r.evaluate('JSON.stringify(state)');
  r.context.receiptFeature.parseReceiptText(`テスト商店\n緑茶\n${code} 2 ¥98\n小計 2点 ¥98\n合計 ¥98\n楽天ペイ ¥98`, '2026-10-10');
  assert.equal(r.evaluate('JSON.stringify(state)'), before);
  assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);
  assert.equal(r.writes.length, 0);
  assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});

test('equal short prices keep distinct codes and names', () => {
  const a = api();
  const rows = a.itemRowsFromText(a.productSourceText(`緑茶\n${code} 2 ¥98\n歯ブラシ\n2200083271702 2 ¥98`));
  assert.deepEqual(Array.from(rows, row => [row.name, row.productCode, row.qty, row.total]), [
    ['緑茶', code, 2, 98], ['歯ブラシ', '2200083271702', 2, 98]
  ]);
});
