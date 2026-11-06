const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const api = () => runtime().context.receiptInternals;
const parse = (r, body, amount = 1280, count = 1, footer = '') => r.context.receiptFeature.parseReceiptText(
  `テスト商店\n2026年10月10日\n${body}\n小計 ${count}点 ¥${amount}\n合計 ¥${amount}\n楽天ペイ ¥${amount}\n${footer}`, '2026-10-10');

for (const line of ['値引 ¥1,280', '値引 ¥-1,280', '割引額 ¥1,280', '値下げ額 ¥1,280', 'クーポン割引 ¥-1,280']) {
  test(`a separate discount amount never replaces the original price: ${line}`, () => {
    const a = api(), rows = a.itemRowsFromText(`テスト商品 ¥2,500\n${line}`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'テスト商品');
    assert.equal(rows[0].total, 2500);
    assert.equal(a.receiptDiscountAmount(line), 1280);
  });
  test(`a discount without a product price is not merchandise: ${line}`, () => {
    const a = api();
    assert.equal(a.itemRowsFromText(`テスト商品\n${line}`).length, 0);
    const p = parse(runtime(), `テスト商品\n${line}`);
    assert.equal(p.itemRows.length, 0);
    assert.equal(p.itemSetComplete, false);
  });
  test(`single-item accounting retains original, deduction and paid price: ${line}`, () => {
    const p = parse(runtime(), `テスト商品 ¥2,500\n${line}`, 1220);
    assert.equal(p.amount, 1220);
    assert.equal(p.discount, 1280);
    assert.equal(p.itemRows.length, 1);
    const row = p.itemRows[0];
    assert.equal(row.rawName, 'テスト商品');
    assert.equal(row.originalTotal, 2500);
    assert.equal(row.discount, 1280);
    assert.equal(row.total, 1220);
    assert.equal(row.lowConfidence, true);
    assert(!row.autoConfirmed);
  });
}

for (const [body, total, original, qty] of [
  ['テスト商品\n値下(元 ¥2,500) ¥1,280', 1280, 2500, 1],
  ['テスト商品\n値下（元 ￥139） ￥88C', 88, 139, 1],
  ['テスト商品\n値下 ¥1,280', 1280, 0, 1],
  ['テスト商品\n特価 ¥1,280', 1280, 0, 1],
  ['テスト商品\nSALE ¥1,280', 1280, 0, 1],
  ['テスト商品\n値引後価格 ¥1,280', 1280, 0, 1],
  ['テスト商品 ¥2,500\n割引後価格 ¥1,280', 1280, 2500, 1],
  ['テスト商品 2 ¥2,500\n値引後価格 ¥1,280', 1280, 2500, 2],
  ['テスト商品 3 ¥2,500\n値引後価格 ¥1,280', 1280, 2500, 3]
]) {
  test(`markdown final price stays attached to its product: ${body.replaceAll('\n', ' / ')}`, () => {
    const a = api();
    for (const text of [body, a.productSourceText(body)]) {
      const rows = a.itemRowsFromText(text);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].name, 'テスト商品');
      assert.equal(rows[0].total, total);
      assert.equal(rows[0].qty, qty);
      if (qty > 1) assert.equal(rows[0].unitPrice, total % qty === 0 ? total / qty : 0);
      if (original) {
        assert.equal(rows[0].markdownOriginalTotal, original);
        assert.equal(rows[0].markdownDiscount, original - total);
      }
    }
    assert.equal(a.receiptDiscountAmount(body), 0);
  });
  test(`markdown price is not deducted for a second time: ${body.replaceAll('\n', ' / ')}`, () => {
    const p = parse(runtime(), body, total, qty);
    assert.equal(p.amount, total);
    assert.equal(p.discount, 0);
    assert.equal(p.itemRows.length, 1);
    assert.equal(p.itemRows[0].name, 'テスト商品');
    assert.equal(p.itemRows[0].total, total);
    assert.equal(p.itemRows[0].qty, qty);
    if (original) {
      assert.equal(p.itemRows[0].markdownOriginalTotal, original);
      assert.equal(p.itemRows[0].markdownDiscount, original - total);
    }
    assert.equal(p.itemSetComplete, true);
    assert.equal(p.splitRows.reduce((sum, x) => sum + x.gross, 0), total);
  });
}

for (const line of ['値下(元 ¥1,000) ¥1,280', '値下(元 ¥0) ¥1,280', '値下(元 ¥2,50) ¥1,280', '値下(元 ¥2,500) ¥1,28', '値下 ¥1,280 ¥2,500', '値下 ¥1,280余計な文字', '値下 ¥1,280,3', '値下 20%', '値下', '値引後価格 ¥1,28']) test(`invalid or insufficient markdown evidence is not resurrected: ${line}`, () => {
  const a = api(), body = `テスト商品\n${line}`;
  assert.equal(a.itemRowsFromText(body).length, 0);
  const p = parse(runtime(), body);
  assert.equal(p.amount, 1280);
  assert.equal(p.itemRows.length, 0);
  assert.equal(p.itemSetComplete, false);
  assert.equal(p.learnedGapRecovered, false);
});

for (const line of ['値引 20%', '割引 20.0%', '値引前価格 ¥2,500', '値引後価格 ¥1,280', '割引後金額 ¥1,280', '割引前合計 ¥2,500']) test(`a rate or before/after price is never a discount amount: ${line}`, () => {
  assert.equal(api().receiptDiscountAmount(line), 0);
});

test('printed discount amount after a rate is retained without calculating it', () => {
  assert.equal(api().receiptDiscountAmount('値引 20% ¥500'), 500);
});

test('rate-only discount cannot reconstruct a final product price', () => {
  const p = parse(runtime(), 'テスト商品 ¥2,500\n値引 20%', 2000);
  assert.equal(p.amount, 2000);
  assert.equal(p.discount, 0);
  assert.equal(p.itemRows.length, 0);
  assert.equal(p.itemSetComplete, false);
});

test('conflicting printed originals do not force the markdown price', () => {
  const p = parse(runtime(), 'テスト商品 ¥2,000\n値下(元 ¥2,500) ¥1,280');
  assert.equal(p.itemRows.length, 0);
  assert.equal(p.itemSetComplete, false);
});

test('metadata alone never supplies a product name', () => {
  const p = parse(runtime(), '値下(元 ¥2,500) ¥1,280\n特価 ¥1,280');
  assert.equal(p.itemRows.length, 0);
  assert.equal(p.itemSetComplete, false);
});

for (const tax of [0, 105]) test(`original basket may exceed payment only with exact accounting: tax ${tax}`, () => {
  const total = 1320 + tax;
  const text = `テスト商店\n北海道産牛乳 ¥2,500\n値引 ¥1,280\n歯ブラシ ¥100\n小計 2点 ¥1,320\n消費税 ¥${tax}\n合計 ¥${total}\n楽天ペイ ¥${total}`;
  const p = runtime().context.receiptFeature.parseReceiptText(text, '2026-10-10');
  assert.equal(p.amount, total);
  assert.equal(p.discount, 1280);
  assert.equal(p.preDiscountTotal, 2600);
  assert.deepEqual(Array.from(p.itemRows, x => [x.name, x.total]), [['北海道産牛乳', 2500], ['歯ブラシ', 100]]);
  assert.equal(p.itemSetComplete, true);
  assert.equal(p.splitRows.reduce((sum, x) => sum + x.discount, 0), 1280);
  assert.equal(p.splitRows.reduce((sum, x) => sum + x.extra, 0), tax);
  assert.equal(p.splitRows.reduce((sum, x) => sum + x.gross, 0), total);
});

for (const subtotal of ['', '小計 2点 ¥1,300\n']) test(`an oversized original basket is rejected without matching subtotal: ${subtotal || 'missing'}`, () => {
  const p = runtime().context.receiptFeature.parseReceiptText(`テスト商店\n北海道産牛乳 ¥2,500\n値引 ¥1,280\n歯ブラシ ¥100\n${subtotal}合計 ¥1,320\n楽天ペイ ¥1,320`, '2026-10-10');
  assert.equal(p.itemSetComplete, false);
  assert.equal(p.itemRows.length, 0);
});

test('invalid markdown cannot be bypassed through a learned dictionary', () => {
  const r = runtime();
  r.storage.set('okozukaiReceiptProductDictionaryV1', JSON.stringify([{ shopKey: 'テスト商', name: 'テスト商品', aliases: ['テスト商品'], priceHints: [1280], source: 'learned', confirmedCount: 4 }]));
  const p = parse(r, 'テスト商品\n値下(元 ¥1,000) ¥1,280');
  assert.equal(p.learnedGapRecovered, false);
  assert.equal(p.itemRows.length, 0);
  assert.equal(r.writes.length, 0);
});

test('OCR duplicates preserve the markdown original once', () => {
  const text = 'テスト商店\n2026年10月10日\nテスト商品\n値下(元 ¥2,500) ¥1,280\n小計 1点 ¥1,280\n合計 ¥1,280\n楽天ペイ ¥1,280';
  const p = runtime().context.receiptFeature.parseReceiptText({ text, whole: text, itemText: text }, '2026-10-10');
  assert.equal(p.itemRows.length, 1);
  assert.equal(p.itemRows[0].markdownOriginalTotal, 2500);
  assert.equal(p.itemRows[0].markdownDiscount, 1220);
  assert.equal(p.discount, 0);
});

test('parsing preserves existing transactions, learning dictionary and schema', () => {
  const r = runtime();
  r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'unrelated', name: '学習商品', priceHints: [73], source: 'learned', confirmedCount: 4 }]);
  r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);
  const before = r.evaluate('JSON.stringify(state)');
  parse(r, 'テスト商品\n値下(元 ¥2,500) ¥1,280');
  parse(r, 'テスト商品 ¥2,500\n値引 ¥1,280', 1220);
  assert.equal(r.evaluate('JSON.stringify(state)'), before);
  assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);
  assert.equal(r.writes.length, 0);
  assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});
