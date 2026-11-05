const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createRuntime } = require('./runtime.cjs');

const baselineCommit = 'fd3d18a4138be0d3a1f13800047e0091914c064e';
function baselineRuntime() {
  const directory = path.resolve(__dirname, '../../.test-artifacts/performance-baseline');
  fs.mkdirSync(directory, { recursive: true });
  for (const name of ['app.js', 'receipt.js']) fs.writeFileSync(path.join(directory, name),
    execFileSync('git', ['show', `${baselineCommit}:${name}`], { cwd: path.resolve(__dirname, '../..'), maxBuffer: 2 * 1024 * 1024 }));
  return createRuntime(directory);
}

function selectionRows(count, seed = 1) {
  let value = seed >>> 0;
  const random = () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value; };
  return Array.from({ length: count }, (_, i) => ({
    name: `検証商品${String.fromCharCode(0x30a2 + i)}飲料`, total: 10 + random() % 500,
    qty: 1 + random() % 4, sourceIndex: i, sourcePriority: 3
  }));
}

// Count constructed canvas surfaces and record draw operations without allocating
// native bitmap storage. pixelBytes is an RGBA estimate, never peak device RAM.
function canvasRuntime(runtime, width = 1200, height = 3600) {
  const canvases = [];
  function canvas() {
    const draws = [], result = { width: 300, height: 150, draws };
    const context = {
      drawImage(...args) { draws.push(args); }, fillRect() {}, translate() {}, rotate() {}, putImageData() {},
      getImageData(_x, _y, w, h) { const data = new Uint8ClampedArray(w * h * 4); data.fill(255); return { data, width: w, height: h }; }
    };
    result.getContext = () => context;
    canvases.push(result);
    return result;
  }
  runtime.context.document.createElement = tag => { if (tag !== 'canvas') throw new Error(`Unexpected element: ${tag}`); return canvas(); };
  runtime.context.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
  runtime.context.receiptInternals.setPendingSource({ width, height, draws: [] });
  const stats = () => ({ count: canvases.length, pixels: canvases.reduce((sum, c) => sum + c.width * c.height, 0), pixelBytes: canvases.reduce((sum, c) => sum + c.width * c.height * 4, 0) });
  const signature = c => ({ width: c.width, height: c.height, draws: c.draws.map(([src, ...args]) => [signature(src), ...args]) });
  return { ...runtime, canvases, stats, signature };
}

module.exports = { baselineCommit, baselineRuntime, selectionRows, canvasRuntime };
