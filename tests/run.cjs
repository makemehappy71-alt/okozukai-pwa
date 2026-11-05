const assert = require('node:assert/strict');
const { createRuntime } = require('./helpers/runtime.cjs');

const runtime = createRuntime(process.argv[2]);
const { context, evaluate, element, writes } = runtime;
const before = evaluate('JSON.stringify(state)');
evaluate('runTests()');
const appResults = [...element('testResult').innerHTML.matchAll(/<div>(✅|❌) ([\s\S]*?)<\/div>/g)]
  .map(([, mark, name]) => [name, mark === '✅']);
assert(appResults.length > 0, 'App tests were captured');
assert.equal(evaluate('JSON.stringify(state)'), before, 'App tests restore state');
const receiptResults = context.receiptFeature.tests();
assert.equal(evaluate('JSON.stringify(state)'), before, 'Receipt parsing leaves ledger unchanged');
assert.equal(writes.length, 0, 'Built-in tests never write storage');
for (const [suite, rows] of [['app', appResults], ['receipt', receiptResults]]) {
  const failed = rows.filter(row => !row[1]);
  console.log(`${suite}: ${rows.length - failed.length}/${rows.length} passed`);
  failed.forEach(row => console.log(`FAIL: ${row[0]}`));
  if (failed.length) process.exitCode = 1;
}
