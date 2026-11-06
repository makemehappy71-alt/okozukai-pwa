const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');
const runtime = () => createRuntime(process.env.RECEIPT_TEST_ROOT);
const items = '緑茶 ¥1,000\n商品値引 ¥100\n歯ブラシ ¥500\n商品値引 ¥200';
function receipt(body = items, { net = 1200, count = 2, tax = 0, subtotal = true, paid = true, buckets = '' } = {}) {
  return `テスト商店\n2026年10月10日\n${body}\n${subtotal ? `小計 ${count ? count + '点 ' : ''}¥${net}\n` : ''}${buckets}${tax ? `消費税 ¥${tax}\n` : ''}${paid ? `合計 ¥${net + tax}\n楽天ペイ ¥${net + tax}` : ''}`;
}
const parse = (text, r = runtime()) => r.context.receiptFeature.parseReceiptText(text, '2026-10-10');
function attributed(p, discount, expected) {
  assert.equal(p.discount, discount);
  assert.equal(p.discountStatus, 'attributed');
  assert.equal(p.discountAttributionConfirmed, true);
  assert.equal(p.discountReviewRequired, false);
  assert.equal(p.itemSetComplete, true);
  assert.deepEqual(Array.from(p.splitRows, x => [x.name, x.originalNet, x.discount, x.net, x.gross]), expected);
}
function held(p, status = 'unresolved') {
  assert.equal(p.discountStatus, status);
  assert.equal(p.discountReviewRequired, true);
  assert.equal(p.discountAttributionConfirmed, false);
  assert.equal(p.itemSetComplete, false);
  assert.equal(p.autoConfirmedItemCount, 0);
  assert.equal(p.productCandidateAutoConfirmed, false);
  assert.notEqual(p.productCandidateStatus, 'confirmed');
  assert.equal(p.itemRows.some(row => row.autoConfirmed), false);
  assert.equal(p.splitRows.length, 0);
}

for (const label of ['商品値引', '単品値引', '商品割引']) test(`two explicit item discounts retain their actual amounts: ${label}`, () => {
  const p = parse(receipt(items.replaceAll('商品値引', label)));
  attributed(p, 300, [['緑茶', 1000, 100, 900, 900], ['歯ブラシ', 500, 200, 300, 300]]);
});

test('equal amounts on different items remain two discounts', () => {
  const p = parse(receipt(items.replace('値引 ¥200', '値引 ¥100'), { net: 1300 }));
  attributed(p, 200, [['緑茶', 1000, 100, 900, 900], ['歯ブラシ', 500, 100, 400, 400]]);
});

test('consecutive item discounts stay attached to the same uniquely identified item', () => {
  const p = parse(receipt('緑茶 ¥1,000\n商品値引 ¥50\n単品値引 ¥50\n歯ブラシ ¥500\n商品値引 ¥200'));
  attributed(p, 300, [['緑茶', 1000, 100, 900, 900], ['歯ブラシ', 500, 200, 300, 300]]);
});

test('discount total belongs to the only independently counted product', () => {
  const p = parse(receipt('テスト飲料 ¥1,000\n会員値引 ¥100\nクーポン割引 ¥200', { net: 700, count: 1 }));
  attributed(p, 300, [['テスト飲料', 1000, 300, 700, 700]]);
});

for (const summary of ['値引合計 ¥300', '割引額合計 ¥300', '合計値引 ¥300', '値引合計 ¥300\n値引合計 ¥300']) test(`summary is corroboration rather than another deduction: ${summary.replaceAll('\n', ' / ')}`, () => {
  attributed(parse(receipt(items + '\n' + summary)), 300, [['緑茶', 1000, 100, 900, 900], ['歯ブラシ', 500, 200, 300, 300]]);
});

for (const copies of [2, 4]) test(`${copies} duplicate OCR sources never multiply the discount total`, () => {
  const text = receipt();
  const p = parse({ text, whole: text, ...(copies === 4 ? { itemText: text, sections: { middle: text } } : {}) });
  attributed(p, 300, [['緑茶', 1000, 100, 900, 900], ['歯ブラシ', 500, 200, 300, 300]]);
});

test('one complete source can corroborate a truncated pass', () => {
  const p = parse({ text: receipt(), itemText: items.replace('\n商品値引 ¥200', '') });
  attributed(p, 300, [['緑茶', 1000, 100, 900, 900], ['歯ブラシ', 500, 200, 300, 300]]);
});

test('discounts split across partial OCR passes are never added together', () => {
  const p = parse({ text: receipt('緑茶 ¥1,000\n商品値引 ¥100\n歯ブラシ ¥500'), whole: receipt('緑茶 ¥1,000\n歯ブラシ ¥500\n商品値引 ¥200') });
  held(p);
  assert.equal(p.discount, 0);
});

test('a summary-only source confirms the total without inventing item attribution', () => {
  const p = parse(receipt('緑茶 ¥1,000\n歯ブラシ ¥500\n値引合計 ¥300'));
  held(p, 'total_only');
  assert.equal(p.discount, 300);
});

for (const body of ['緑茶 ¥1,000\n歯ブラシ ¥500\n会員値引 ¥100\nクーポン割引 ¥200', items.replaceAll('商品値引', '値引')]) test(`position or matching prices alone cannot establish attribution: ${body.replaceAll('\n', ' / ')}`, () => {
  const p = parse(receipt(body));
  held(p, 'total_only');
  assert.equal(p.discount, 300);
});

test('OCR sources that disagree on attribution cannot auto-confirm products', () => {
  const swapped = items.replace('値引 ¥100', '値引 ¥200').replace('歯ブラシ ¥500\n商品値引 ¥200', '歯ブラシ ¥500\n商品値引 ¥100');
  const p = parse({ text: receipt(), whole: receipt(swapped) });
  held(p, 'total_only');
  assert.equal(p.discount, 300);
});

test('same-name same-price product occurrences are not assigned by price alone', () => {
  const p = parse(receipt('緑茶 ¥1,000\n商品値引 ¥100\n緑茶 ¥1,000\n商品値引 ¥200', { net: 1700 }));
  held(p, 'total_only');
  assert.equal(p.discount, 300);
});

for (const options of [{ count: 0 }, { count: 3 }, { subtotal: false }, { paid: false }, { net: 1199 }]) test(`missing or inconsistent independent evidence is held: ${JSON.stringify(options)}`, () => {
  held(parse(receipt(items, options)));
});

for (const change of ['商品値引 ¥1,00', '商品値引 20%', '商品値引 ¥100 ¥200']) test(`a malformed discount cannot disappear into the remaining sum: ${change}`, () => {
  const p = parse(receipt(items.replace('商品値引 ¥100', change)));
  held(p);
  assert.equal(p.discount, 0);
});

for (const suffix of ['値引合計 ¥400', '値引合計 ¥300\n値引合計 ¥400']) test(`conflicting detail/summary values remain unresolved: ${suffix.replaceAll('\n', ' / ')}`, () => {
  const p = parse(receipt(items + '\n' + suffix));
  held(p);
  assert.equal(p.discount, 0);
});

test('an unexplained repeated discount is not silently deduplicated', () => {
  const p = parse(receipt('テスト飲料 ¥1,000\n会員値引 ¥100\n会員値引 ¥100', { net: 900, count: 1 }));
  held(p);
});

for (const amount of [1000, 1200]) test(`an item discount that consumes or exceeds its price is not allocated: ${amount}`, () => {
  const p = parse(receipt(`緑茶 ¥1,000\n商品値引 ¥${amount}\n歯ブラシ ¥500\n商品値引 ¥100`, { net: 1500 - amount - 100 }));
  held(p, 'total_only');
});

test('quantity-bearing price lines keep their quantity during attribution', () => {
  const p = parse(receipt(items.replace('緑茶 ¥1,000', '緑茶 2 ¥1,000'), { count: 3 }));
  assert.equal(p.itemRows[0].qty, 2);
  assert.equal(p.itemRows[0].unitPrice, 500);
  assert.equal(p.discountAttributionConfirmed, true);
  assert.deepEqual(Array.from(p.splitRows, x => x.discount), [100, 200]);
});

test('grouped discount amounts are read completely', () => {
  const p = parse(receipt('緑茶 ¥5,000\n商品値引 ¥1,000\n歯ブラシ ¥3,000\n商品値引 ¥2,000', { net: 5000 }));
  attributed(p, 3000, [['緑茶', 5000, 1000, 4000, 4000], ['歯ブラシ', 3000, 2000, 1000, 1000]]);
});

test('printed yen discount after a rate remains usable', () => {
  const p = parse(receipt(items.replace('商品値引 ¥100', '商品値引 10% ¥100')));
  assert.equal(p.discount, 300);
  assert.equal(p.discountAttributionConfirmed, true);
});

test('future coupons are excluded from the current-sale sum', () => {
  const p = parse(receipt(items + '\n次回クーポン特典 ¥500'));
  assert.equal(p.discount, 300);
  assert.equal(p.discountAttributionConfirmed, true);
});

test('ordinary printed tax is applied after the attributed discounts', () => {
  const p = parse(receipt(items, { tax: 96 }));
  attributed(p, 300, [['緑茶', 1000, 100, 900, 972], ['歯ブラシ', 500, 200, 300, 324]]);
});

test('mixed tax buckets use discounted item bases', () => {
  const buckets = '8%税抜対象額 ¥900\n8%税額 ¥72\n10%税抜対象額 ¥300\n10%税額 ¥30\n';
  const p = parse(receipt(items, { tax: 102, buckets }));
  attributed(p, 300, [['緑茶', 1000, 100, 900, 972], ['歯ブラシ', 500, 200, 300, 330]]);
  assert.deepEqual(Array.from(p.splitRows, x => x.taxRate), [8, 10]);
});

test('included tax on a single counted item is preserved after discount aggregation', () => {
  const text = 'テスト商店\nテスト飲料 ¥1,000\n会員値引 ¥100\nクーポン割引 ¥200\n小計 税込 1点 ¥700\n内税 ¥63\n合計 ¥700\n楽天ペイ ¥700';
  const p = parse(text);
  attributed(p, 300, [['テスト飲料', 1000, 300, 637, 700]]);
});

test('a learned product name cannot bypass unresolved attribution', () => {
  const r = runtime();
  r.storage.set('okozukaiReceiptProductDictionaryV1', JSON.stringify([{ shopKey: 'テスト商', name: '緑茶', aliases: ['緑茶'], priceHints: [1000], source: 'learned', confirmedCount: 6 }]));
  const p = parse(receipt('緑茶 ¥1,000\n歯ブラシ ¥500\n会員値引 ¥100\nクーポン割引 ¥200'), r);
  held(p, 'total_only');
  assert.equal(r.writes.length, 0);
});

test('confirmed totals and unresolved attribution do not change stored user data', () => {
  const r = runtime();
  r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:73,date:"2026-10-01",from:"wallet"})');
  const dictionary = JSON.stringify([{ shopKey: 'unrelated', name: '学習商品', priceHints: [73], source: 'learned', confirmedCount: 4 }]);
  r.storage.set('okozukaiReceiptProductDictionaryV1', dictionary);
  const before = r.evaluate('JSON.stringify(state)');
  parse(receipt(), r);
  parse(receipt('緑茶 ¥1,000\n歯ブラシ ¥500\n会員値引 ¥100\nクーポン割引 ¥200'), r);
  assert.equal(r.evaluate('JSON.stringify(state)'), before);
  assert.equal(r.storage.get('okozukaiReceiptProductDictionaryV1'), dictionary);
  assert.equal(r.writes.length, 0);
  assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});

test('existing single discount and markdown interpretation are retained', () => {
  const r = runtime();
  assert.equal(r.context.receiptInternals.receiptDiscountAmount('クーポン割引 ¥-1,250'), 1250);
  const p = parse(receipt('テスト飲料\n値下(元 ¥1,390) ¥880', { net: 880, count: 1 }));
  assert.equal(p.discount, 0);
  assert.equal(p.itemRows[0].total, 880);
  assert.equal(p.itemRows[0].markdownOriginalTotal, 1390);
});

test('a concatenated payment text does not turn one discount into multiple deductions', () => {
  const text = receipt('緑茶 ¥2,500\n値引 ¥1,280\n歯ブラシ ¥100', { net: 1320 });
  const p = parse({ text, whole: text, paymentText: text + '\n' + text });
  assert.equal(p.discount, 1280);
  assert.equal(p.itemSetComplete, true);
  assert.equal(p.splitRows.reduce((sum, row) => sum + row.gross, 0), 1320);
});

test('actual OCR passes override a merged text that could fabricate a combined discount', () => {
  const p = parse({ text: receipt(), diagnostics: [
    { label: '全体', text: receipt('緑茶 ¥1,000\n商品値引 ¥100\n歯ブラシ ¥500') },
    { label: '分割 1', text: receipt('緑茶 ¥1,000\n歯ブラシ ¥500\n商品値引 ¥200') }
  ] });
  held(p);
});

test('actual OCR pass occurrences survive line deduplication in merged text', () => {
  const actual = receipt(items.replace('値引 ¥200', '値引 ¥100'), { net: 1300 });
  const p = parse({ text: actual.replace('歯ブラシ ¥500\n商品値引 ¥100', '歯ブラシ ¥500'), diagnostics: [{ label: '全体', text: actual }] });
  attributed(p, 200, [['緑茶', 1000, 100, 900, 900], ['歯ブラシ', 500, 100, 400, 400]]);
});

for (const summary of ['値引合計', '割引額合計', '合計値引']) test(`${summary} is never independent proof of a paid total`, () => {
  const text = receipt(`緑茶 ¥350\n商品値引 ¥100\n歯ブラシ ¥250\n商品値引 ¥200\n${summary} ¥300`, { net: 300, paid: false });
  held(parse(text));
});
