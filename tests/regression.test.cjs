const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntime } = require('./helpers/runtime.cjs');

const root = process.env.RECEIPT_TEST_ROOT;
const setup = () => createRuntime(root);
const internals = () => setup().context.receiptInternals;

test('app self-test preserves selected month and analysis period', () => {
  const r = setup();
  r.evaluate('selectedMonth=new Date(2026,10,1);analysisPeriodMode="custom"');
  const before = r.evaluate('JSON.stringify({state,month:getMonth(),analysisPeriodMode})');
  r.evaluate('runTests()');
  assert.equal(r.evaluate('JSON.stringify({state,month:getMonth(),analysisPeriodMode})'), before);
  assert.equal(r.writes.length, 0);
});
test('app self-test restores state if a test throws', () => {
  const r = setup();
  const before = r.evaluate('JSON.stringify({state,month:getMonth(),analysisPeriodMode})');
  r.evaluate('balanceAsOf=()=>{throw new Error("injected accounting failure")}');
  assert.throws(() => r.evaluate('runTests()'), /injected accounting failure/);
  assert.equal(r.evaluate('JSON.stringify({state,month:getMonth(),analysisPeriodMode})'), before);
  assert.equal(r.writes.length, 0);
});

for (const line of ['21 X 単99 ¥198', '21 X 単 99 ¥ 198', '21 × 単価 ¥ 99 ¥ 198 外', '2] X 単価99 ¥198']) {
  test(`quantity with damaged count and whitespace: ${line}`, () => {
    const rows = internals().itemRowsFromText(`爽やか白ぶどう\n${line}`);
    const row = rows.find(r => r.name === '爽やか白ぶどう' && r.qty === 2);
    assert(row);
    assert.equal(row.unitPrice, 99);
    assert.equal(row.total, 198);
  });
}
for (const line of ['21 X 単99 ¥197', '商品 X 単99 ¥198', '31 X 単99 ¥198', '21 X 単0 ¥198', '21 X 単99 ¥9900']) {
  test(`quantity does not invent matching units: ${line}`, () => {
    const rows = internals().itemRowsFromText(`爽やか白ぶどう\n${line}`);
    assert(!rows.some(r => r.qty > 1));
  });
}

for (const kind of ['item', 'overall']) {
  for (const [name, expected] of [['クルーネックTシャツ', 'Tシャツ'], ['オーバーサイズシャツ', 'シャツ']]) {
    test(`GU ${kind} category: ${name}`, () => {
      const api = internals();
      const result = kind === 'item' ? api.itemCategorySuggestion(name, 'GU ららぽーと立川立飛店') : api.categorySuggestion('', 'GU', [{ name }]);
      assert.equal(result.subName, expected);
    });
  }
}

test('exact independent product readings form consensus', () => {
  const result = internals().focusedProductConsensus(['whole', 'item', 'focused'].map(family => ({ family, text: 'ワッパーチーズセット ¥1090' })), 1090, { shop: 'バーガーキング' });
  assert.equal(result.accepted, true);
  assert.equal(result.name, 'ワッパーチーズセット');
  assert.equal(result.familySupport, 3);
});
test('identical readings from one family require confirmation', () => {
  const result = internals().focusedProductConsensus([1, 2, 3].map(() => ({ family: 'whole', text: 'ワッパーチーズセット ¥1090' })), 1090, { shop: 'バーガーキング' });
  assert.equal(result.accepted, false);
});
test('focused cleanup preserves suspicious leading digit', () => {
  assert.equal(internals().cleanFocusedProductName('E 【7のたかセト】 欄夫を ¥1,090', 1090), '7のたかセット');
});
test('short natural product name remains eligible for strong evidence', () => {
  assert.equal(internals().productNameRequiresConfirmation('エビピラフ', 'オーケー'), false);
});
test('single row cannot bypass independent evidence threshold', () => {
  const result = internals().applyFocusedNamesToRows('オーケー', [{ name: 'エビピラフ', total: 325, qty: 1 }], { multiProductFocus: [{ value: 325, consensus: { accepted: true, name: 'エビピラフ', familySupport: 2, support: 2, score: 88 } }] });
  assert.equal(result[0].lowConfidence, true);
});
test('single row with three strong independent readings can confirm', () => {
  const result = internals().applyFocusedNamesToRows('オーケー', [{ name: 'エビピラフ', total: 325, qty: 1 }], { multiProductFocus: [{ value: 325, consensus: { accepted: true, name: 'エビピラフ', familySupport: 3, support: 3, score: 96 } }] });
  assert.equal(result[0].lowConfidence, false);
});

for (const subtotal of ['小計 2点 ¥237', '小計 ¥237']) {
  test(`compact printed tax: ${subtotal}`, () => {
    const result = internals().analyzeAmount(`${subtotal}\n8Y 2点 ¥18`, '');
    assert.equal(result.tax, 18);
    assert.equal(result.amount, 255);
  });
}
for (const row of ['8Y 2点 ¥19', '8Y 3点 ¥18', '8Y 2点 18', '8Y 0点 ¥18', '8Y 2点 ¥18 商品', '8Y 2点 ¥237']) {
  test(`compact tax rejects ambiguous/inconsistent row: ${row}`, () => {
    assert.equal(internals().analyzeAmount(`小計 2点 ¥237\n${row}`, '').tax, 0);
  });
}
test('compact tax never adds tax to explicitly included subtotal', () => {
  assert.equal(internals().analyzeAmount('小計 税込 ¥237\n8Y 2点 ¥18', '').tax, 0);
});
test('mixed-tax allocation still reconciles each bucket and payment', () => {
  const result = internals().allocateReceiptRows([{ name: '緑茶', total: 200 }, { name: '歯ブラシ', total: 100 }], 300, 26, 326, 'クリエイト', false,
    [{ rate: 8, net: 200, tax: 16, gross: 216 }, { rate: 10, net: 100, tax: 10, gross: 110 }]);
  assert.deepEqual(Array.from(result, r => [r.net, r.extra, r.gross, r.taxRate]), [[200, 16, 216, 8], [100, 10, 110, 10]]);
});

test('parsing preserves existing ledger and learned dictionary byte for byte', () => {
  const r = setup();
  const key = 'okozukaiReceiptProductDictionaryV1';
  const dictionary = JSON.stringify([{ shopKey: 'yaoko', name: '学習した緑茶', aliases: ['テスト茶'], priceHints: [100], source: 'learned', confirmedCount: 7 }]);
  r.storage.set(key, dictionary);
  r.evaluate('state.transactions.push({id:"existing",type:"expense",amount:500,from:"wallet",date:"2026-10-01"})');
  const ledger = r.evaluate('JSON.stringify(state)');
  r.context.receiptFeature.parseReceiptText('ヤオコー東大和店\n緑茶 ¥100\n小計 ¥100\n合計 ¥108\n消費税 ¥8\n現金', '2026-10-01');
  assert.equal(r.evaluate('JSON.stringify(state)'), ledger);
  assert.equal(r.storage.get(key), dictionary);
  assert.equal(r.writes.length, 0);
  assert.equal(r.evaluate('SCHEMA_VERSION'), 12);
});

function mockScriptDocument(r) {
  let current = null;
  const scripts = [];
  r.context.document.querySelector = () => current;
  r.context.document.createElement = () => {
    const script = { dataset: {}, remove() { if (current === script) current = null; } };
    return script;
  };
  r.context.document.head = { appendChild(script) { current = script; scripts.push(script); } };
  return scripts;
}
test('failed OCR library request can be retried', async () => {
  const r = setup(), scripts = mockScriptDocument(r), api = r.context.receiptInternals;
  const first = api.loadOCR();
  scripts[0].onerror();
  await assert.rejects(first, /読込/);
  const retry = api.loadOCR();
  assert.equal(scripts.length, 2, 'retry creates a fresh request');
  r.context.Tesseract = { createWorker() {} };
  scripts[1].onload();
  assert.equal(await retry, r.context.Tesseract);
});
test('concurrent OCR library requests share one script', async () => {
  const r = setup(), scripts = mockScriptDocument(r), api = r.context.receiptInternals;
  const first = api.loadOCR(), second = api.loadOCR();
  assert.equal(first, second);
  assert.equal(scripts.length, 1);
  r.context.Tesseract = { createWorker() {} };
  scripts[0].onload();
  await first;
});

async function mockOCR(shop, { fail = false } = {}) {
  const r = setup();
  const text = `${shop}\nテスト緑茶 ¥100\n小計 1点 ¥100\n消費税 ¥8\n合計 ¥108\n楽天ペイ ¥108`;
  let calls = 0, terminated = 0;
  r.context.Tesseract = { async createWorker() { return {
    async setParameters() {},
    async recognize() { calls++; if (fail) throw new Error('recognition failed'); return { data: { text, blocks: [] } }; },
    async terminate() { terminated++; }
  }; } };
  const canvas = { width: 100, height: 200 };
  const bundle = { gray: canvas, slices: [{ role: 'top', canvas }, { role: 'bottom', canvas }], shopSlices: Array.from({ length: 5 }, () => ({ canvas, mode: '7' })) };
  try { return { result: await r.context.receiptInternals.runOCR(bundle), calls, terminated }; }
  catch (error) { return { error, calls, terminated }; }
}
for (const shop of ['西友', 'ヤオコー東大和店', 'MEGAドン・キホーテ立川店', 'GU ららぽーと立川立飛店', 'Seria', 'ファーストキッチン 田無店']) {
  test(`known merchant skips redundant logo OCR: ${shop}`, async () => {
    const { result, calls, terminated } = await mockOCR(shop);
    assert.equal(calls, 3);
    assert.equal(result.meta.passes, calls);
    assert.equal(terminated, 1);
    assert.equal(result.meta.fastPath, true);
  });
}
test('unknown merchant keeps all logo fallback passes', async () => {
  const { calls, terminated } = await mockOCR('名もない商店');
  assert.equal(calls, 8);
  assert.equal(terminated, 1);
});
test('OCR worker terminates even when recognition fails', async () => {
  const { error, terminated } = await mockOCR('西友', { fail: true });
  assert.match(error.message, /recognition failed/);
  assert.equal(terminated, 1);
});
