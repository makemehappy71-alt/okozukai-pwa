const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { createRuntime } = require('./helpers/runtime.cjs');
const root = path.resolve(__dirname, '..');
const baselineCommit = 'fb6e2cd0d6e87c07871ddc6bae6fa9013db542ad';
const artifacts = path.join(root, '.test-artifacts');
const baseline = path.join(artifacts, 'remaining-ocr-baseline');
fs.mkdirSync(baseline, { recursive: true });
for (const name of ['app.js', 'receipt.js']) fs.writeFileSync(path.join(baseline, name),
  execFileSync('git', ['show', `${baselineCommit}:${name}`], { cwd: root, maxBuffer: 2 * 1024 * 1024 }));

function measure(directory) {
  const child = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join(__dirname, 'ocr-remaining.test.cjs')], {
    cwd: root, env: { ...process.env, RECEIPT_TEST_ROOT: directory }, encoding: 'utf8', timeout: 30000
  });
  if (child.error) throw child.error;
  const tap = child.stdout + child.stderr;
  fs.writeFileSync(path.join(artifacts, `${directory === root ? 'after' : 'before'}-remaining-ocr.tap`), tap);
  const count = key => Number(tap.match(new RegExp(`^# ${key} (\\d+)`, 'm'))?.[1]);
  assert(Number.isFinite(count('tests')) && count('tests') > 0);
  assert.equal(count('tests'), count('pass') + count('fail'));
  const runtime = createRuntime(directory), results = runtime.context.receiptFeature.tests();
  const protectedStores = {};
  for (const [name, pattern] of [['西友', /seiyu/i], ['ヤオコー', /yaoko/i], ['MEGA', /MEGA/]]) {
    const group = results.filter(result => pattern.test(result[0]));
    assert(group.length > 0);
    protectedStores[name] = { total: group.length, passed: group.filter(result => result[1]).length };
  }
  return { regression: { total: count('tests'), passed: count('pass'), failed: count('fail') },
    existingOCR: { total: results.length, passed: results.filter(result => result[1]).length }, protectedStores };
}
const report = { baselineCommit, before: measure(baseline), after: measure(root) };
fs.writeFileSync(path.join(artifacts, 'remaining-ocr-comparison.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.after.regression.failed || report.after.existingOCR.passed !== report.after.existingOCR.total) process.exitCode = 1;
