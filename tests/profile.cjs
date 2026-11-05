const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const { createRuntime } = require('./helpers/runtime.cjs');
const { baselineCommit, baselineRuntime, canvasRuntime } = require('./helpers/performance.cjs');

async function measure(runtime) {
  const selection = [];
  for (const count of [8, 12, 16, 18]) {
    const rows = Array.from({ length: count }, (_, i) => ({ name: `検証商品${String.fromCharCode(0x30a2 + i)}飲料`, total: 101 + i * 13, qty: i % 4 === 0 ? 2 : 1, sourceIndex: i, sourcePriority: 3 }));
    const times = [];
    for (let sample = 0; sample < 6; sample++) {
      const start = performance.now();
      runtime.context.receiptInternals.chooseItemsForSubtotal(rows, 1000, 5000, 0, '');
      if (sample) times.push(performance.now() - start); // discard warmup
    }
    times.sort((a, b) => a - b);
    selection.push({ candidates: count, medianMs: +times[2].toFixed(3), minMs: +times[0].toFixed(3), maxMs: +times[4].toFixed(3) });
  }
  const r = canvasRuntime(runtime);
  const bundle = r.context.receiptInternals.buildOCRBundle();
  const prepared = r.stats();
  r.context.Tesseract = { async createWorker() { return { async setParameters() {}, async terminate() {},
    async recognize() { return { data: { blocks: [], text: 'ヤオコー東大和店\nテスト飲料 ¥100\n小計 1点 ¥100\n消費税 ¥8\n合計 ¥108\n楽天ペイ ¥108' } }; } }; } };
  const result = await r.context.receiptInternals.runOCR(bundle);
  return { selection, canvas: { source: [1200, 3600], prepared, afterKnownMerchantFastPath: r.stats(), calls: result.meta.passes } };
}
(async () => {
  const report = { baselineCommit, environment: { platform: process.platform, architecture: process.arch, node: process.version, cpu: os.cpus()[0].model, androidDevice: false },
    before: await measure(baselineRuntime()), after: await measure(createRuntime()) };
  const target = path.resolve(__dirname, '../.test-artifacts/performance.json');
  fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
