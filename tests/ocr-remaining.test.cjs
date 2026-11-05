const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const api = () => runtime().context.receiptInternals;

for (const [text, name, price] of [['牛乳 ¥238', '牛乳', 238], ['緑茶 ¥100', '緑茶', 100], ['豆腐 98', '豆腐', 98]]) {
  test(`two-character merchandise: ${text}`, () => {
    const rows = api().itemRowsFromText(text);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, name);
    assert.equal(rows[0].total, price);
  });
}
for (const text of ['テスト商品 ¥1,280', 'テスト商品 1,280', 'テスト商品 ¥1,280C']) {
  test(`comma-separated single price: ${text}`, () => {
    const rows = api().itemRowsFromText(text);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'テスト商品');
    assert.equal(rows[0].total, 1280);
  });
}
for (const text of ['牛乳 2 ¥1,280', 'テスト商品 2 ¥1,280', 'テスト商品\n@640 2 ¥1,280', '牛乳\n¥640 x 2 ¥1,280C', '牛乳\n2コX単640 ¥1,280', '牛乳\n@1,280 2 ¥2,560', '牛乳\n2コX単1,280 ¥2,560', '牛乳\n21 X 単価 ¥ 1,280 ¥ 2,560']) {
  test(`comma prices keep quantity and unit: ${text.replaceAll('\n', ' / ')}`, () => {
    const rows = api().itemRowsFromText(text);
    const price = text.includes('2,560') ? 2560 : 1280;
    assert(rows.some(row => row.qty === 2 && row.unitPrice === price / 2 && row.total === price));
  });
}
test('coordinate quantity summary supports printed thousands separators', () => {
  const result = api().receiptQuantitySummaryLine('2コX単1,280 ¥2,560');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { qty: 2, unit: 1280, total: 2560 });
});
for (const line of ['2コX単640,00 ¥1,280', '2コX単1,28 ¥2']) {
  test(`malformed unit groups do not confirm quantities: ${line}`, () => {
    const a = api();
    assert.equal(a.receiptQuantitySummaryLine(line), null);
    assert.equal(a.itemRowsFromText('牛乳\n' + line).length, 0);
  });
}
for (const text of ['テスト商品 ¥1,28', 'テスト商品 ¥1,280,3', '牛乳\n21 X 単640 ¥1,28']) {
  test(`malformed comma money is not accepted: ${text.replaceAll('\n', ' / ')}`, () => {
    assert.equal(api().itemRowsFromText(text).length, 0);
  });
}
test('money parsing never rewrites numeric content in the product name', () => {
  const row = api().itemRowsFromText('ビタミン1,000mg ¥1,280')[0];
  assert.equal(row.name, 'ビタミン1,000mg');
  assert.equal(row.rawName, 'ビタミン1,000mg');
  assert.equal(row.total, 1280);
});
for (const [text, amount, name] of [
  ['生茶1000ml ¥100', 100, '生茶1000ml'], ['チョコ110g ¥110', 110, 'チョコ110g'],
  ['ビタミンC1000 ¥100', 100, 'ビタミンC1000'], ['【粉末青汁110g】 ¥110', 110, '粉末青汁110g'],
  ['【テスト 100】 ¥100', 100, 'テスト 100'], ['生茶1000ml', 100, '生茶1000ml'],
  ['FANTA オレンジ ¥100', 100, 'FANTA オレンジ'], ['LDC サイダー ¥198', 198, 'LDC サイダー'],
  ['ICE COFFEE ¥120', 120, 'ICE COFFEE'], ['EVIAN 500ml ¥120', 120, 'EVIAN 500ml'],
  ['F テスト商品 ¥100', 100, 'テスト商品'], ['テスト商品 1 ¥1,280C', 1280, 'テスト商品'],
  ['ビタミンC ¥120C', 120, 'ビタミンC'], ['テスト商品 ¥1,280', 1280, 'テスト商品'],
  ['テスト商品 Y 1280', 1280, 'テスト商品']
]) {
  test(`focused OCR preserves name: ${text}`, () => assert.equal(api().cleanFocusedProductName(text, amount), name));
}
test('one-character names and receipt metadata stay excluded', () => {
  assert.equal(api().itemRowsFromText('茶 ¥100\n通常P ¥100\nPOS取引番号 1280\n合計 ¥1,280').length, 0);
});
test('two-character names survive full parsing with separate categories and accounting', () => {
  const r = runtime();
  const before = r.evaluate('JSON.stringify(state)');
  const result = r.context.receiptFeature.parseReceiptText('テスト商店\n2026年10月10日\n牛乳 ¥238\n緑茶 ¥100\n小計 2点 ¥338\n消費税 ¥27\n合計 ¥365\n現金', '2026-10-10');
  assert.deepEqual(Array.from(result.itemRows, row => row.name).sort(), ['牛乳', '緑茶']);
  assert.equal(result.amount, 365);
  assert.equal(result.tax, 27);
  assert.equal(result.actualItemCount, 2);
  assert.deepEqual(Array.from(result.splitRows, row => [row.name, row.categoryLabel, row.gross]), [
    ['牛乳', '食費 ＞ スーパー・食材', 257], ['緑茶', '食費 ＞ 飲み物', 108]
  ]);
  assert.equal(r.evaluate('JSON.stringify(state)'), before);
  assert.equal(r.writes.length, 0);
});
test('Burger King comma price restores a candidate with human review still required', () => {
  const r = runtime();
  const result = r.context.receiptFeature.parseReceiptText('バーガーキング立川北口店\n2026年09月27日\nE 【りのたかセト】 1 ¥1,090\nクーポン割引 ¥-250\n合計金額 ¥840\n内消費税 ¥76\n現金 ¥1,000\nお釣り ¥160', '2026-09-27');
  const row = result.itemRows[0];
  assert.equal(row.name, 'ワッパーチーズセット');
  assert.equal(row.lowConfidence, true);
  assert.equal(row.candidateOnly, true);
  assert(!row.autoConfirmed);
  assert(row.rawName);
  assert.equal(row.originalTotal, 1090);
  assert.equal(row.discount, 250);
  assert.equal(row.total, 840);
});
test('price and discount without merchandise text never invent a known name', () => {
  const result = runtime().context.receiptFeature.parseReceiptText('バーガーキング\n¥1,090\nクーポン割引 ¥-250\n合計金額 ¥840\n現金 ¥1,000\nお釣り ¥160', '2026-09-27');
  assert.equal(result.itemRows[0].name, '商品名要確認');
  assert.equal(result.itemRows[0].lowConfidence, true);
  assert(!result.itemRows[0].autoConfirmed);
});
for (const prefix of ['7', '７']) test(`suspicious leading digit ${prefix} cannot become confirmed through repeated OCR`, () => {
  const a = api(), text = prefix + 'ワッパーチーズセット ¥1090';
  const result = a.focusedProductConsensus(['whole', 'item', 'focused'].map(family => ({ family, text })), 1090, { shop: 'バーガーキング' });
  assert.equal(result.accepted, false);
  assert.equal(a.productNameRequiresConfirmation(prefix + 'ワッパーチーズセット', 'バーガーキング'), true);
});
test('explicitly exempted 7UP prefix remains part of the product name', () => {
  assert.equal(api().cleanFocusedProductName('7UP 500ml ¥100', 100), '7UP 500ml');
});
test('comma-separated discount is read in full', () => {
  assert.equal(api().receiptDiscountAmount('クーポン割引 ¥-1,250'), 1250);
});
test('malformed discount grouping does not become a one-yen discount', () => {
  assert.equal(api().receiptDiscountAmount('クーポン割引 ¥-1,25'), 0);
});
test('comma product price and discount preserve the printed accounting', () => {
  const result = runtime().context.receiptFeature.parseReceiptText('テスト商店\n2026年10月10日\nテスト商品 ¥2,500\nクーポン割引 ¥-1,250\n合計 ¥1,250\n現金 ¥2,000\nお釣り ¥750', '2026-10-10');
  assert.equal(result.amount, 1250);
  assert.equal(result.itemRows.length, 1);
  assert.equal(result.itemRows[0].originalTotal, 2500);
  assert.equal(result.itemRows[0].discount, 1250);
  assert.equal(result.itemRows[0].total, 1250);
});
