const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { createRuntime } = require('./helpers/runtime.cjs');

const root = path.resolve(__dirname, '..');
const baselineCommit = 'e641912';
const artifacts = path.join(root, '.test-artifacts');
const baseline = path.join(artifacts, 'baseline');
fs.mkdirSync(baseline, { recursive: true });
for (const name of ['app.js', 'receipt.js']) {
  fs.writeFileSync(path.join(baseline, name), execFileSync('git', ['show', `${baselineCommit}:${name}`], { cwd: root, maxBuffer: 2 * 1024 * 1024 }));
}

function measure(directory) {
  const r = createRuntime(directory);
  const rows = r.context.receiptFeature.tests();
  const groups = {};
  for (const [name, pattern] of [['西友', /SEIYU|seiyu/i], ['ヤオコー', /yaoko/i], ['MEGAドン・キホーテ', /MEGA/]]) {
    const group = rows.filter(row => pattern.test(row[0]));
    assert(group.length > 0);
    groups[name] = { total: group.length, passed: group.filter(row => row[1]).length, failed: group.filter(row => !row[1]).map(row => row[0]) };
  }
  const child = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join(__dirname, 'regression.test.cjs')], {
    cwd: root, env: { ...process.env, RECEIPT_TEST_ROOT: directory }, encoding: 'utf8', timeout: 30000
  });
  if (child.error) throw child.error;
  const tap = child.stdout + child.stderr;
  const count = key => Number(tap.match(new RegExp(`^# ${key} (\\d+)`, 'm'))?.[1]);
  assert(Number.isFinite(count('tests')) && count('tests') > 0, tap);
  assert.equal(count('pass') + count('fail'), count('tests'), 'Regression run completed');
  fs.writeFileSync(path.join(artifacts, `${directory === root ? 'after' : 'before'}-regression.tap`), tap);
  const app = spawnSync(process.execPath, [path.join(__dirname, 'run.cjs'), directory], { cwd: root, encoding: 'utf8', timeout: 30000 });
  const appMatch = app.stdout.match(/app: (\d+)\/(\d+) passed/);
  assert(appMatch, app.stderr);
  return {
    app: { total: Number(appMatch[2]), passed: Number(appMatch[1]) },
    receipt: { total: rows.length, passed: rows.filter(row => row[1]).length, failed: rows.filter(row => !row[1]).map(row => row[0]) },
    regression: { total: count('tests'), passed: count('pass'), failed: count('fail') }, groups
  };
}
const report = { baselineCommit, before: measure(baseline), after: measure(root) };
fs.writeFileSync(path.join(artifacts, 'comparison.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.after.receipt.failed.length || report.after.regression.failed || report.after.app.passed !== report.after.app.total) process.exitCode = 1;
