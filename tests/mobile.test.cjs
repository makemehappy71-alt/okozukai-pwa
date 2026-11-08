const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { test } = require('node:test');

const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.test-artifacts');
fs.mkdirSync(output, { recursive: true });
const browserTestTimeout = Number(process.env.BROWSER_TEST_TIMEOUT_MS || 60000);
assert(Number.isInteger(browserTestTimeout) && browserTestTimeout >= 60000 && browserTestTimeout <= 180000);

const mobileCases = [
  { width: 360, amount: 108, body: 'テスト"緑茶 ¥100\n小計 1点 ¥100\n消費税 ¥8\n合計 ¥108\n楽天ペイ ¥108' },
  { width: 412, amount: 16875, body: 'テスト"緑茶 10 ¥15,625\n小計 10点 ¥15,625\n消費税額\n8% 10点 ¥1,250\n合計 ¥16,875\n楽天ペイ ¥16,875' },
  { width: 412, amount: 328, mixedTax: true, body: 'テスト"緑茶 ¥100\n歯ブラシ ¥200\n8%税抜対象額 ¥100\n8%税額 ¥8\n10%税抜対象額 ¥200\n10%税額 ¥20\n合計 ¥328\n楽天ペイ ¥328' },
  { width: 412, amount: 98, codePrice: true, body: 'テスト"緑茶\n2200083271771 2 ¥98\n小計 2点 ¥98\n合計 ¥98\n楽天ペイ ¥98' },
  { width: 412, amount: 1280, adjustment: 'markdown', body: 'テスト"緑茶\n値下(元 ¥2,500) ¥1,280\n小計 1点 ¥1,280\n合計 ¥1,280\n楽天ペイ ¥1,280' },
  { width: 412, amount: 1320, adjustment: 'discount', body: 'テスト"緑茶 ¥2,500\n値引 ¥1,280\n歯ブラシ ¥100\n小計 2点 ¥1,320\n合計 ¥1,320\n楽天ペイ ¥1,320' },
  { width: 412, amount: 1200, adjustment: 'multi-item', body: 'テスト"緑茶 ¥1,000\n商品値引 ¥100\n歯ブラシ ¥500\n商品値引 ¥200\n値引合計 ¥300\n小計 2点 ¥1,200\n合計 ¥1,200\n楽天ペイ ¥1,200' },
  { width: 412, amount: 1200, adjustment: 'multi-unassigned', body: 'テスト"緑茶 ¥1,000\n歯ブラシ ¥500\n会員値引 ¥100\nクーポン割引 ¥200\n小計 2点 ¥1,200\n合計 ¥1,200\n楽天ペイ ¥1,200' },
  { width: 412, amount: 1700, adjustment: 'repeat-code', body: 'テスト"緑茶\n2200083271771 1 ¥1,000\n商品値引 ¥100\nテスト"緑茶\n2200083271702 1 ¥1,000\n商品値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1900, adjustment: 'repeat-unassigned', body: 'テスト"緑茶 ¥1,000\n商品値引 ¥100\nテスト"緑茶 ¥1,000\n小計 2点 ¥1,900\n合計 ¥1,900\n楽天ペイ ¥1,900' },
  { width: 412, amount: 1700, adjustment: 'printed-id', body: '明細番号 101\nテスト"緑茶\n2200083271771 1 ¥1,000\n商品値引 ¥100\n明細番号 102\nテスト"緑茶\n2200083271771 1 ¥1,000\n商品値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'printed-id-unknown', body: '明細番号 101\nテスト"緑茶\n2200083271771 1 ¥1,000\n明細番号 102\nテスト"緑茶\n2200083271771 1 ¥1,000\n明細番号 999 値引 ¥100\n明細番号 102 値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'inline-id', body: 'テスト"緑茶 明細番号 101\n2200083271771 1 ¥1,000\n商品値引 ¥100\nテスト"緑茶 明細番号 102\n2200083271771 1 ¥1,000\n商品値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'post-id', body: 'テスト"緑茶\n2200083271771 1 ¥1,000\n明細番号 101\n商品値引 ¥100\nテスト"緑茶\n2200083271771 1 ¥1,000\n明細番号 102\n商品値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'post-id-unknown', body: 'テスト"緑茶\n2200083271771 1 ¥1,000\n明細番号 101\n補足情報\nテスト"緑茶\n2200083271771 1 ¥1,000\n明細番号 102\n明細番号 999 値引 ¥100\n明細番号 102 値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'wrapped-id', body: 'テスト"緑茶 （明細番号 101）\n2200083271771 1 ¥1,000\n商品値引 ¥100\nテスト"緑茶 【明細番号 102】\n2200083271771 1 ¥1,000\n商品値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'alpha-id', body: 'テスト"緑茶 (明細ID A1O1)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\n(明細ID A1O1) 値引 ¥100\n商品値引 ¥200 [明細ID A101]\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'alpha-id-unknown', body: 'テスト"緑茶 (明細ID A1O1)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\n(明細ID a1O1) 値引 ¥100\n商品値引 ¥200 [明細ID A101]\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'separator-id', body: 'テスト"緑茶 (明細ID A-101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID A_101)\n2200083271771 1 ¥1,000\n(明細ID A-101) 値引 ¥100\n商品値引 ¥200 [明細ID A_101]\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'separator-post-id', body: 'テスト"緑茶\n2200083271771 1 ¥1,000\n[明細ID A-101]\n商品値引 ¥100\nテスト"緑茶\n2200083271771 1 ¥1,000\n[明細ID A_101]\n商品値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'separator-id-unknown', body: 'テスト"緑茶 (明細ID A-101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID A_101)\n2200083271771 1 ¥1,000\n(明細ID A101) 値引 ¥100\n商品値引 ¥200 [明細ID A_101]\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'bounded-space-id', lineIds: ['A 101', 'A  101'], body: 'テスト"緑茶 (明細ID A 101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID A  101)\n2200083271771 1 ¥1,000\n(明細ID A 101) 値引 ¥100\n商品値引 ¥200 [明細ID A  101]\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'bounded-repeat-id', lineIds: ['A--101', 'A__101'], body: 'テスト"緑茶 (明細ID A--101)\n2200083271771 1 ¥1,000\n商品値引 ¥100\nテスト"緑茶 (明細ID A__101)\n2200083271771 1 ¥1,000\n商品値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'bounded-space-unknown', lineIds: ['A  101', 'B__102'], body: 'テスト"緑茶 (明細ID A  101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B__102)\n2200083271771 1 ¥1,000\n(明細ID A 101) 値引 ¥100\n商品値引 ¥200 [明細ID B__102]\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'control-tab-layout', lineIds: ['A101', 'B102'], body: 'テスト"緑茶 (明細ID\tA101)\n2200083271771 1 ¥1,000\n商品値引 ¥100\nテスト"緑茶 (明細ID\tB102)\n2200083271771 1 ¥1,000\n商品値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'control-cr-receipt', lineIds: ['A101', 'B102'], body: 'テスト"緑茶 (明細ID A101)\r2200083271771 1 ¥1,000\r商品値引 ¥100\rテスト"緑茶 (明細ID B102)\r2200083271771 1 ¥1,000\r商品値引 ¥200\r小計 2点 ¥1,700\r合計 ¥1,700\r楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'control-cr-reference', lineIds: ['A101', 'B102'], body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B102)\n2200083271771 1 ¥1,000\n(明細ID A\r101) 値引 ¥100\n商品値引 ¥200 [明細ID B102]\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'control-tab-reference', lineIds: ['A101', 'B102'], body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B102)\n2200083271771 1 ¥1,000\n(明細ID A\t101) 値引 ¥100\n商品値引 ¥200 [明細ID B102]\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'recovered-product-id', lineIds: ['A-101', 'B_102'], body: 'テスト"緑茶 (明細ID A-\n101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B_\n102)\n2200083271771 1 ¥1,000\n(明細ID A-101) 値引 ¥100\n(明細ID B_102) 値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'recovered-reference-id', lineIds: ['A-101', 'B_102'], body: 'テスト"緑茶 (明細ID A-101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B_102)\n2200083271771 1 ¥1,000\n(明細ID A-\n101) 値引 ¥100\n(明細ID B_\n102) 値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'recovered-id-ambiguous', lineIds: ['A-101', 'A- 101'], body: 'テスト"緑茶 (明細ID A-101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID A- 101)\n2200083271771 1 ¥1,000\n(明細ID A-\n101) 値引 ¥100\n(明細ID A- 101) 値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'unmarked-product-id', lineIds: ['A101', 'B102'], body: 'テスト"緑茶 (明細ID A\n101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B\n102)\n2200083271771 1 ¥1,000\n(明細ID A101) 値引 ¥100\n(明細ID B102) 値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'unmarked-reference-id', lineIds: ['A101', 'B102'], body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B102)\n2200083271771 1 ¥1,000\n(明細ID A\n101) 値引 ¥100\n(明細ID B\n102) 値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'unmarked-id-ambiguous', lineIds: ['A101', 'A 101'], body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID A 101)\n2200083271771 1 ¥1,000\n(明細ID A\n101) 値引 ¥100\n(明細ID A 101) 値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'longfold-product-id', lineIds: ['A101', 'B102'], originalIdFold: 'A\n1\n0\n1', body: 'テスト"緑茶 (明細ID A\n1\n0\n1)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B\n1\n0\n2)\n2200083271771 1 ¥1,000\n(明細ID A101) 値引 ¥100\n(明細ID B102) 値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'longfold-reference-id', lineIds: ['A101', 'B102'], originalIdFold: 'A\n1\n0\n1', body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B102)\n2200083271771 1 ¥1,000\n(明細ID A\n1\n0\n1) 値引 ¥100\n(明細ID B\n1\n0\n2) 値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'longfold-id-ambiguous', lineIds: ['A101', 'A 101'], body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID A 101)\n2200083271771 1 ¥1,000\n(明細ID A\n1\n0\n1) 値引 ¥100\n(明細ID A 101) 値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'separate-close-product-id', lineIds: ['A101', 'B102'], originalIdFold: 'A101\n)', body: 'テスト"緑茶 (明細ID A101\n)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B102\n)\n2200083271771 1 ¥1,000\n(明細ID A101) 値引 ¥100\n(明細ID B102) 値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'separate-close-reference-id', lineIds: ['A101', 'B102'], originalIdFold: 'A\n101\n)', body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B102)\n2200083271771 1 ¥1,000\n値引 ¥100 (明細ID A\n101\n)\n値引 ¥200 (明細ID B\n102\n)\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'separate-close-id-ambiguous', lineIds: ['A101', 'A 101'], body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID A 101)\n2200083271771 1 ¥1,000\n値引 ¥100 (明細ID A\n101\n)\n(明細ID A 101) 値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'padded-close-product-id', lineIds: ['A101', 'B102'], originalIdFold: 'A101\n\t ) \t', body: 'テスト"緑茶 (明細ID A101\n\t ) \t\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B102\n\t ) \t\n2200083271771 1 ¥1,000\n(明細ID A101) 値引 ¥100\n(明細ID B102) 値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'padded-close-reference-id', lineIds: ['A101', 'B102'], originalIdFold: 'A\n101\n\t ) \t', body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B102)\n2200083271771 1 ¥1,000\n値引 ¥100 (明細ID A\n101\n\t ) \t\n値引 ¥200 (明細ID B\n102\n\t ) \t\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'padded-close-id-ambiguous', lineIds: ['A101', 'A 101'], body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID A 101)\n2200083271771 1 ¥1,000\n値引 ¥100 (明細ID A\n101\n\t ) \t\n(明細ID A 101) 値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'discount-close-reference-id', lineIds: ['A101', 'B102'], originalIdFold: 'A101\n) 値引 ¥100', body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B102)\n2200083271771 1 ¥1,000\n(明細ID A101\n) 値引 ¥100\n(明細ID B102\n) 値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'discount-close-padded-id', lineIds: ['A101', 'B102'], originalIdFold: 'A\n101\n\t)\t値引\t¥100\t', body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B102)\n2200083271771 1 ¥1,000\n(明細ID A\n101\n\t)\t値引\t¥100\t\n(明細ID B\n102\n\t)\t値引\t¥200\t\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'discount-close-id-ambiguous', lineIds: ['A101', 'A 101'], body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID A 101)\n2200083271771 1 ¥1,000\n(明細ID A\n101\n) 値引 ¥100\n(明細ID A 101) 値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'note-close-reference-id', lineIds: ['A101', 'B102'], originalIdFold: 'A101\n) (単品) 値引 ¥100', body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B102)\n2200083271771 1 ¥1,000\n(明細ID A101\n) (単品) 値引 ¥100\n(明細ID B102\n) (商品) 値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'note-close-complete-id', lineIds: ['A101', 'B102'], unwrappedId: true, originalIdFold: '(明細ID A101) (単品) 値引 ¥100', body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B102)\n2200083271771 1 ¥1,000\n(明細ID A101) (単品) 値引 ¥100\n(明細ID B102) (商品) 値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'note-close-id-ambiguous', lineIds: ['A101', 'A 101'], body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID A 101)\n2200083271771 1 ¥1,000\n(明細ID A\n101\n) (単品) 値引 ¥100\n(明細ID A 101) 値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'note-close-unknown', lineIds: ['A101', 'B102'], body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B102)\n2200083271771 1 ¥1,000\n(明細ID A101\n) (対象外) 値引 ¥100\n(明細ID B102\n) (単品) 値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'bare-close-reference-id', lineIds: ['A101', 'B102'], originalIdFold: 'A101\n) 単品\t値引 ¥100', body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B102)\n2200083271771 1 ¥1,000\n(明細ID A101\n) 単品\t値引 ¥100\n(明細ID B102\n) 商品 値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'bare-close-complete-id', lineIds: ['A101', 'B102'], unwrappedId: true, originalIdFold: '(明細ID A101) 単品 値引 ¥100', body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B102)\n2200083271771 1 ¥1,000\n(明細ID A101) 単品 値引 ¥100\n(明細ID B102) 商品 値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'bare-close-id-ambiguous', lineIds: ['A101', 'A 101'], body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID A 101)\n2200083271771 1 ¥1,000\n(明細ID A\n101\n) 単品 値引 ¥100\n(明細ID A 101) 値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'bare-close-unknown', lineIds: ['A101', 'B102'], body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B102)\n2200083271771 1 ¥1,000\n(明細ID A101\n) 商品対象外 値引 ¥100\n(明細ID B102\n) 単品 値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'split-close-reference-id', lineIds: ['A101', 'B102'], originalIdFold: 'A\n101) 単品\n値引 ¥100', body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B102)\n2200083271771 1 ¥1,000\n(明細ID A\n101) 単品\n値引 ¥100\n(明細ID B102\n) 商品\n値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'split-close-complete-id', lineIds: ['A101', 'B102'], originalIdFold: '(明細ID A101)\n単品\n値引 ¥100', body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B102)\n2200083271771 1 ¥1,000\n(明細ID A101)\n単品\n値引 ¥100\n(明細ID B102)\n(商品)\n値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'split-close-id-ambiguous', lineIds: ['A101', 'A 101'], body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID A 101)\n2200083271771 1 ¥1,000\n(明細ID A\n101\n) 単品\n値引 ¥100\n(明細ID A 101) 値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'split-close-unknown', lineIds: ['A101', 'B102'], body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B102)\n2200083271771 1 ¥1,000\n(明細ID A101\n) 商品対象外\n値引 ¥100\n(明細ID B102\n) 単品\n値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'amount-close-reference-id', lineIds: ['A101', 'B102'], originalIdFold: 'A\n101) 値引\n¥100', body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B102)\n2200083271771 1 ¥1,000\n(明細ID A\n101) 値引\n¥100\n(明細ID B102\n) 割引\n200円\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'amount-close-complete-id', lineIds: ['A101', 'B102'], originalIdFold: '(明細ID A101)\n(単品)\n値引\n¥100', body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B102)\n2200083271771 1 ¥1,000\n(明細ID A101)\n(単品)\n値引\n¥100\n(明細ID B102) 商品 値引\n¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'amount-close-id-ambiguous', lineIds: ['A101', 'A 101'], body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID A 101)\n2200083271771 1 ¥1,000\n(明細ID A\n101) 値引\n¥100\n(明細ID A 101) 値引 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'amount-close-unknown', lineIds: ['A101', 'B102'], body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B102)\n2200083271771 1 ¥1,000\n(明細ID A101\n) 値引\n¥100\n¥200\n(明細ID B102\n) 値引\n¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'numeric-close-reference-id', lineIds: ['A101', 'B102'], originalIdFold: 'A\n101) 値引額\n100', body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B102)\n2200083271771 1 ¥1,000\n(明細ID A\n101) 値引額\n100\n(明細ID B102\n) 割引額\n200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'numeric-close-complete-id', lineIds: ['A101', 'B102'], originalIdFold: '(明細ID A101)\n(単品)\n値引額\n100', body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B102)\n2200083271771 1 ¥1,000\n(明細ID A101)\n(単品)\n値引額\n100\n(明細ID B102) 商品 値引額\n200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1996, adjustment: 'numeric-close-quantity-unknown', lineIds: ['A101', 'B102'], body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B102)\n2200083271771 1 ¥1,000\n(明細ID A101\n) 値引額\n2\n(明細ID B102\n) 値引額\n2\n小計 2点 ¥1,996\n合計 ¥1,996\n楽天ペイ ¥1,996' },
  { width: 412, amount: 1700, adjustment: 'numeric-close-unit-unknown', lineIds: ['A101', 'B102'], body: 'テスト"緑茶 (明細ID A101)\n2200083271771 10 ¥1,000\nテスト"緑茶 (明細ID B102)\n2200083271771 10 ¥1,000\n(明細ID A101\n) 値引額\n100\n(明細ID B102\n) 値引額\n200\n小計 20点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'numeric-close-code-unknown', lineIds: ['A101', 'B102'], body: 'テスト"緑茶 (明細ID A101)\n0000000000100 1 ¥1,000\nテスト"緑茶 (明細ID B102)\n0000000000200 1 ¥1,000\n(明細ID A101\n) 値引額\n100\n(明細ID B102\n) 値引額\n200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'numeric-close-id-ambiguous', lineIds: ['A101', 'A 101'], body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID A 101)\n2200083271771 1 ¥1,000\n(明細ID A\n101) 値引額\n100\n(明細ID A 101) 値引額 ¥200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' },
  { width: 412, amount: 1700, adjustment: 'numeric-close-suffix-unknown', lineIds: ['A101', 'B102'], body: 'テスト"緑茶 (明細ID A101)\n2200083271771 1 ¥1,000\nテスト"緑茶 (明細ID B102)\n2200083271771 1 ¥1,000\n(明細ID A101\n) 値引額\n100\n個\n(明細ID B102\n) 値引額\n200\n小計 2点 ¥1,700\n合計 ¥1,700\n楽天ペイ ¥1,700' }
];
for (const [role, qty, codes, values, label, resolved] of [
  ['quantity', 2, ['2200083271771', '2200083271771'], [2, 2], '値引額（円）', true],
  ['unit', 10, ['2200083271771', '2200083271771'], [100, 200], '値引額（円）', true],
  ['code', 1, ['0000000000100', '0000000000200'], [100, 200], '値引額（円）', true],
  ['wrong-unit', 10, ['2200083271771', '2200083271771'], [100, 200], '値引額(個)', false],
  ['missing-local', 10, ['2200083271771', '2200083271771'], [100, 200], '値引額', false]
]) {
  const first = `(明細ID A101\n) ${label}\n${values[0]}`, second = `(明細ID B102\n) 値引額（円）\n${values[1]}`;
  const net = 2000 - values[0] - values[1];
  mobileCases.push({ width: 412, amount: net, adjustment: `collision-close-${role}${resolved ? '' : '-unknown'}`, lineIds: ['A101', 'B102'], originalIdFold: first,
    itemQuantity: qty, productCodes: codes, deductions: values,
    body: `テスト"緑茶 (明細ID A101)\n${codes[0]} ${qty} ¥1,000\nテスト"緑茶 (明細ID B102)\n${codes[1]} ${qty} ¥1,000\n${first}\n${second}\n小計 ${qty * 2}点 ¥${net}\n合計 ¥${net}\n楽天ペイ ¥${net}` });
}
for (const [role, ids, values, label, resolved, foldedProducts = false] of [
  ['matching', ['100', '200'], [100, 200], '値引額（円）', true],
  ['crossed', ['100', '200'], [200, 100], '値引額（円）', true],
  ['quantity', ['1', '2'], [1, 2], '値引額（円）', true],
  ['missing-unit', ['100', '200'], [100, 200], '値引額', false],
  ['duplicate', ['100', '000100'], [100, 200], '値引額（円）', false],
  ['folded-products', ['100', '200'], [100, 200], '値引額（円）', false, true],
  ['unknown-reference', ['100', '200'], [100, 200], '値引額（円）', false]
]) {
  const products = ids.map(id => `テスト"緑茶 (明細ID ${foldedProducts ? id[0] + '\n' + id.slice(1) : id})\n2200083271771 1 ¥1,000`).join('\n');
  const first = `(明細ID ${role === 'unknown-reference' ? '300' : ids[0]}\n) ${label}\n${values[0]}`, second = `(明細ID ${ids[1]}\n) ${label}\n${values[1]}`;
  const net = 2000 - values[0] - values[1];
  mobileCases.push({ width: 412, amount: net, adjustment: `identity-close-${role}${resolved ? '' : '-unknown'}`, lineIds: ids, originalIdFold: first, deductions: values,
    body: `${products}\n${first}\n${second}\n小計 2点 ¥${net}\n合計 ¥${net}\n楽天ペイ ¥${net}` });
}
for (const [role, printedIds, witnesses, values, bare, resolved] of [
  ['reference', ['000100', '000200'], ['000100', '000200'], [100, 200], false, true],
  ['product', ['000100', '000200'], ['000100', '000200'], [100, 200], false, true],
  ['crossed', ['000100', '000200'], ['000100', '000200'], [200, 100], true, true],
  ['different-zeros', ['000100', '000200'], ['100', '200'], [100, 200], false, false],
  ['duplicate', ['000100', '100'], ['000100', '100'], [100, 200], false, false],
  ['both', ['000100', '000200'], ['000100', '000200'], [100, 200], false, false],
  ['missing-unit', ['000100', '000200'], ['000100', '000200'], [100, 200], true, false]
]) {
  const fold = id => id.slice(0, 2) + '\n' + id.slice(2);
  const productFolded = role === 'product' || role === 'both';
  const products = (productFolded ? printedIds.map(fold) : witnesses).map(id => `テスト"緑茶 (明細ID ${id})\n2200083271771 1 ¥1,000`).join('\n');
  const refs = (role === 'product' ? witnesses : printedIds.map(fold)).map((id, i) => `(明細ID ${id}) ${bare ? (role === 'missing-unit' ? '値引額' : '値引額（円）') + '\n' : '値引 ¥'}${values[i]}`);
  const net = 2000 - values[0] - values[1];
  mobileCases.push({ width: 412, amount: net, adjustment: `zero-close-${role}${resolved ? '' : '-unknown'}`, lineIds: ['100', '200'], originalIdFold: productFolded ? fold(printedIds[0]) : refs[0], deductions: values,
    body: `${products}\n${refs.join('\n')}\n小計 2点 ¥${net}\n合計 ¥${net}\n楽天ペイ ¥${net}` });
}
for (const [role, money, ownLabel, referenceIds, values, resolved] of [
  ['currency', 'yen', false, ['000100', '000200'], [100, 200], true],
  ['own-label', 'yen', true, ['000100', '000200'], [100, 200], true],
  ['crossed', 'bare', true, ['000100', '000200'], [200, 100], true],
  ['missing-unit', 'bare', true, ['000100', '000200'], [100, 200], false],
  ['different-zeros', 'yen', false, ['100', '200'], [100, 200], false],
  ['duplicate', 'yen', false, ['000100', '000100'], [100, 200], false],
  ['suffix', 'yen', false, ['000100', '000200'], [100, 200], false]
]) {
  const products = ['00\n0100', '00\n0200'].map(id => `テスト"緑茶 (明細ID ${id})\n2200083271771 1 ¥1,000`).join('\n');
  const label = money === 'bare' ? role === 'missing-unit' ? '値引額' : '値引額（円）' : '値引';
  const refs = referenceIds.map((id, i) => `(明細ID ${id})${ownLabel ? '\n' : ' '}${label}\n${money === 'bare' ? '' : '¥'}${values[i]}${role === 'suffix' && i === 0 ? '\n対象外' : ''}`);
  const net = 2000 - values[0] - values[1];
  mobileCases.push({ width: 412, amount: net, adjustment: `witness-close-${role}${resolved ? '' : '-unknown'}`, lineIds: ['100', '200'], originalIdFold: '00\n0100', deductions: values,
    body: `${products}\n${refs.join('\n')}\n小計 2点 ¥${net}\n合計 ¥${net}\n楽天ペイ ¥${net}` });
}
for (const [role, money, firstComplete, refs, values, resolved] of [
  ['currency', 'yen', false, ['000100', '000200'], [100, 200], true],
  ['bare-complete', 'bare', true, ['000100', '000200'], [100, 200], true],
  ['crossed', 'bare', false, ['000100', '000200'], [200, 100], true],
  ['missing-detail', 'yen', false, ['000100', '000200'], [100, 200], false],
  ['different-zeros', 'yen', false, ['000100', '200'], [100, 200], false],
  ['cycle', 'yen', false, ['000100', '000200'], [100, 200], false],
  ['withdrawn-anchor', 'bare', false, ['000100', '000200'], [100, 1000], false]
]) {
  const products = ['000100', '000200'].map((id, i) => `テスト"緑茶 (明細ID ${firstComplete && i === 0 ? id : id.slice(0, 2) + '\n' + id.slice(2)})\n2200083271771${role === 'missing-detail' && i === 1 ? '' : ' 1'} ¥1,000`);
  const references = refs.map((id, i) => `(明細ID ${id}) ${money === 'bare' ? '値引額（円）\n' : '値引\n¥'}${values[i]}`);
  const items = role === 'cycle' ? [references[0], products[1], references[1], products[0]] : [products[0], references[0], products[1], references[1]];
  const net = 2000 - values[0] - values[1];
  mobileCases.push({ width: 412, amount: net, adjustment: `boundary-close-${role}${resolved ? '' : '-unknown'}`, lineIds: ['100', '200'], originalIdFold: '00\n0200', deductions: values,
    body: `${items.join('\n')}\n小計 2点 ¥${net}\n合計 ¥${net}\n楽天ペイ ¥${net}` });
}
for (const [role, unitLine, qty, money, count, resolved] of [
  ['one', '単価 ¥1,000', 1, 'yen', 2, true],
  ['two', '単価 ¥500', 2, 'yen', 3, true],
  ['bare', '@500', 2, 'bare', 3, true],
  ['missing-unit', '', 1, 'yen', 2, false],
  ['unknown-unit', '単価 500', 2, 'yen', 3, false],
  ['fractional', '単価 ¥333', 1, 'yen', 2, false],
  ['count-mismatch', '単価 ¥500', 2, 'yen', 2, false]
]) {
  const ref = (id, value) => `(明細ID ${id}) ${money === 'bare' ? '値引額（円）\n' : '値引\n¥'}${value}`;
  const items = `テスト"緑茶 (明細ID 00\n0100)\n2200083271771 1 ¥1,000\n${ref('000100', 100)}\nテスト"緑茶 (明細ID 00\n0200)\n2200083271771 ¥1,000\n${unitLine ? unitLine + '\n' : ''}${ref('000200', 200)}`;
  mobileCases.push({ width: 412, amount: 1700, adjustment: `quantity-close-${role}${resolved ? '' : '-unknown'}`, lineIds: ['100', '200'], originalIdFold: '00\n0200', itemQuantities: [1, qty], expectedUnits: [1000, 1000 / qty],
    body: `${items}\n小計 ${count}点 ¥1700\n合計 ¥1700\n楽天ペイ ¥1700` });
}
for (const [role, unitLine, qty, money, referenceId, count, resolved] of [
  ['one', '単価 ¥1,000', 1, 'yen', '000200', 2, true],
  ['two', '単価 ¥500', 2, 'yen', '000200', 3, true],
  ['bare', '@500', 2, 'bare', '000200', 3, true],
  ['barrier', '単価 ¥500\n注記', 2, 'yen', '000200', 3, false],
  ['missing-unit', '', 1, 'yen', '000200', 2, false],
  ['fractional', '単価 ¥333', 1, 'yen', '000200', 2, false],
  ['different-zeros', '単価 ¥500', 2, 'yen', '200', 3, false]
]) {
  const ref = (id, value) => `(明細ID ${id}) ${money === 'bare' ? '値引額（円）\n' : '値引\n¥'}${value}`;
  const items = `テスト"緑茶 (明細ID 00\n0100)\n2200083271771 1 ¥1,000\n${ref('000100', 100)}\nテスト"緑茶 (明細ID 00\n0200)\n${unitLine ? unitLine + '\n' : ''}2200083271771 ¥1,000\n${ref(referenceId, 200)}`;
  mobileCases.push({ width: 412, amount: 1700, adjustment: `preceding-close-${role}${resolved ? '' : '-unknown'}`, lineIds: ['100', '200'], originalIdFold: '00\n0200', itemQuantities: [1, qty], expectedUnits: [1000, 1000 / qty],
    body: `${items}\n小計 ${count}点 ¥1700\n合計 ¥1700\n楽天ペイ ¥1700` });
}
for (const [role, order, gap, qty, money, referenceId, resolved] of [
  ['unit-first', 'unit-first', '', 2, 'yen', '000200', true],
  ['total-first', 'total-first', '\t', 2, 'yen', '000200', true],
  ['one', 'unit-first', ' ', 1, 'yen', '000200', true],
  ['bare', 'unit-first', '', 2, 'bare', '000200', true],
  ['note', 'unit-first', '注記', 2, 'yen', '000200', false],
  ['scope', 'total-first', '(単品)', 2, 'yen', '000200', false],
  ['price', 'unit-first', '@1000', 2, 'yen', '000200', false],
  ['zeros', 'unit-first', '', 2, 'yen', '200', false]
]) {
  const ref = (id, value) => `(明細ID ${id}) ${money === 'bare' ? '値引額（円）\n' : '値引\n¥'}${value}`;
  const pair = [`単価 ¥${1000 / qty}`, '2200083271771 ¥1,000'];if (order === 'total-first') pair.reverse();
  const items = `テスト"緑茶 (明細ID 00\n0100)\n2200083271771 1 ¥1,000\n${ref('000100', 100)}\nテスト"緑茶 (明細ID 00\n0200)\n${pair.join('\n' + gap + '\n')}\n${ref(referenceId, 200)}`;
  mobileCases.push({ width: 412, amount: 1700, adjustment: `gap-close-${role}${resolved ? '' : '-unknown'}`, lineIds: ['100', '200'], originalIdFold: '00\n0200', originalPriceBlock: pair.join('\n' + gap + '\n'), itemQuantities: [1, qty], expectedUnits: [1000, 1000 / qty],
    body: `${items}\n小計 ${qty + 1}点 ¥1700\n合計 ¥1700\n楽天ペイ ¥1700` });
}
for (const [role, position, note, order, qty, money, resolved] of [
  ['product', 'price', '商品', 'unit-first', 2, 'yen', false],
  ['single', 'price', '単品', 'total-first', 2, 'yen', false],
  ['product-bracket', 'price', '(商品)', 'unit-first', 1, 'yen', false],
  ['single-bracket', 'price', '(単品)', 'total-first', 2, 'bare', false],
  ['product-square', 'price', '[商品]', 'total-first', 4, 'yen', false],
  ['single-square', 'price', '【単品】', 'unit-first', 2, 'bare', false],
  ['reference-product', 'reference', '商品', 'unit-first', 2, 'yen', true],
  ['reference-single', 'reference', '(単品)', 'total-first', 2, 'bare', true]
]) {
  const ref = (id, value, scoped = false) => `(明細ID ${id})${scoped ? '\n' + note + '\n' : ' '}${money === 'bare' ? '値引額（円）\n' : '値引\n¥'}${value}`;
  const pair = [`単価 ¥${1000 / qty}`, '2200083271771 ¥1,000'];if (order === 'total-first') pair.reverse();
  const block = pair.join(position === 'price' ? '\n' + note + '\n' : '\n');
  const items = `テスト"緑茶 (明細ID 00\n0100)\n2200083271771 1 ¥1,000\n${ref('000100', 100)}\nテスト"緑茶 (明細ID 00\n0200)\n${block}\n${ref('000200', 200, position === 'reference')}`;
  mobileCases.push({ width: 412, amount: 1700, adjustment: `scope-close-${role}${resolved ? '' : '-unknown'}`, lineIds: ['100', '200'], originalIdFold: '00\n0200', originalPriceBlock: block, itemQuantities: [1, qty], expectedUnits: [1000, 1000 / qty],
    body: `${items}\n小計 ${qty + 1}点 ¥1700\n合計 ¥1700\n楽天ペイ ¥1700` });
}
for (const { width, amount, body, mixedTax = false, codePrice = false, adjustment, lineIds, originalIdFold, originalPriceBlock, unwrappedId = false, itemQuantity = 1, itemQuantities = [itemQuantity, itemQuantity], expectedUnits, productCodes = ['2200083271771', '2200083271771'], deductions = [100, 200] } of mobileCases) {
  const caseName = `${width}${adjustment ? '-' + adjustment : mixedTax ? '-mixed-tax' : codePrice ? '-product-code' : ''}`;
  const separateCloseId = /^(?:separate|padded|discount|note|bare|split|amount|numeric|collision|identity|zero|witness|boundary|quantity|preceding|gap|scope)-close-/.test(adjustment || '');
  const separateCloseResolved = separateCloseId && !/-(?:ambiguous|unknown)$/.test(adjustment);
  const unresolvedSplitReference = (separateCloseId && !separateCloseResolved) || ['control-tab-reference', 'recovered-id-ambiguous', 'unmarked-id-ambiguous', 'longfold-id-ambiguous'].includes(adjustment);
  test(`mobile Chromium ${caseName}px: image crop, OCR review, apply, data safety`, { timeout: browserTestTimeout }, async () => {
    const allowed = new Set(['index.html', 'app.js', 'receipt.js', 'styles.css', 'sw.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png']);
    const server = http.createServer((request, response) => {
      const name = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html';
      if (!allowed.has(name)) { response.writeHead(404).end(); return; }
      const mime = { '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
      response.setHeader('Content-Type', mime[path.extname(name)]);
      response.end(fs.readFileSync(path.join(root, name)));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
      browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
      const context = await browser.newContext({ viewport: { width, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      // The camera image and OCR worker are synthetic; no claim of real OCR speed.
      await page.addInitScript(({ text }) => {
        window.testOCRCalls = 0; window.testOCRTerminated = 0;
        window.Tesseract = { async createWorker() { return {
          async setParameters() {},
          async recognize() { window.testOCRCalls++; return { data: { blocks: [], text } }; },
          async terminate() { window.testOCRTerminated++; }
        }; } };
      }, { text: `ヤオコー東大和店\n2026年10月10日\n${body}` });
      const expectedAmount = String(amount);
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      // A fresh PWA install claims the page and intentionally reloads it once.
      await page.waitForFunction(() => navigator.serviceWorker.controller && performance.getEntriesByType('navigation')[0].type === 'reload');
      await page.waitForFunction(() => typeof state !== 'undefined' && !!state && !!window.receiptFeature && document.getElementById('storageMode').textContent !== '-');
      assert.equal(await page.locator('#fatal').evaluate(el => el.classList.contains('show')), false);
      const builtIn = await page.evaluate(() => {
        runTests();
        return { appFailures: (document.getElementById('testResult').innerHTML.match(/❌/g) || []).length,
          receiptFailures: window.receiptFeature.tests().filter(x => !x[1]).map(x => x[0]) };
      });
      assert.equal(builtIn.appFailures, 0);
      assert.deepEqual(builtIn.receiptFailures, []);
      await page.evaluate(async () => {
        const group = state.categories[0];
        state.transactions.push({ id: 'existing-ledger', type: 'expense', date: '2026-09-01', amount: 73, from: 'wallet', categoryId: group.id, subcategoryId: group.subs[0].id });
        await persist(false);
        localStorage.setItem('okozukaiReceiptProductDictionaryV1', JSON.stringify([{ shopKey: 'unrelated', name: '既存の学習商品', priceHints: [73], source: 'learned', confirmedCount: 4 }]));
      });
      const snapshot = await page.evaluate(async () => ({ transactions: JSON.stringify(state.transactions), dictionary: localStorage.getItem('okozukaiReceiptProductDictionaryV1'), mirror: localStorage.getItem('okozukai_v321_mirror'), indexedDB: JSON.stringify(await idbReadCurrent()) }));
      await page.locator('#homeExpense').click();
      await page.locator('#receiptGalleryInput').waitFor({ state: 'attached' });
      assert.equal(await page.locator('#receiptCameraInput').getAttribute('capture'), 'environment');
      const image = await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = 150; canvas.height = 400;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 150, 400);
        ctx.fillStyle = 'black'; ctx.font = '12px sans-serif';
        ['TEST RECEIPT', '2026/10/10', 'TEA 100', 'TAX 8', 'TOTAL 108'].forEach((line, i) => ctx.fillText(line, 12, 30 + i * 48));
        return canvas.toDataURL().split(',')[1];
      });
      await page.locator('#receiptGalleryInput').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
      await page.locator('#receiptCropReadBtn').waitFor();
      assert(await page.locator('#receiptCropPreview').isVisible());
      await page.locator('#receiptCropReadBtn').click();
      await page.locator('#receiptApplyBtn').waitFor();
      assert.equal(await page.locator('#receiptAmount').inputValue(), expectedAmount);
      assert.equal(await page.locator('#receiptShop').inputValue(), 'ヤオコー東大和店');
      assert.equal(await page.locator('#receiptDate').inputValue(), '2026-10-10');
      if (separateCloseId || ['printed-id', 'printed-id-unknown', 'inline-id', 'post-id', 'post-id-unknown', 'wrapped-id', 'alpha-id', 'alpha-id-unknown', 'separator-id', 'separator-post-id', 'separator-id-unknown', 'bounded-space-id', 'bounded-repeat-id', 'bounded-space-unknown', 'control-tab-layout', 'control-cr-receipt', 'control-cr-reference', 'control-tab-reference', 'recovered-product-id', 'recovered-reference-id', 'recovered-id-ambiguous', 'unmarked-product-id', 'unmarked-reference-id', 'unmarked-id-ambiguous', 'longfold-product-id', 'longfold-reference-id', 'longfold-id-ambiguous'].includes(adjustment)) {
        const rows = await page.locator('#receiptOCRPanel').evaluate(el => JSON.parse(el.dataset.itemRows));
        const ids = lineIds || (adjustment.startsWith('separator') ? ['A-101', 'A_101'] : adjustment.startsWith('alpha-id') ? ['A1O1', 'A101'] : ['101', '102']);
        if (unresolvedSplitReference) {
          assert.deepEqual(rows, []);
          assert.deepEqual(await page.locator('#receiptOCRPanel').evaluate(el => JSON.parse(el.dataset.splitRows)), []);
          assert.equal(await page.locator('#receiptOCRPanel').getAttribute('data-product-candidate-auto-confirmed'), '');
          assert.equal(await page.locator('.receipt-line-id').count(), 0);
        } else {
          assert.deepEqual(rows.map(row => [row.receiptLineId, row.productCode, row.qty, row.total]), ids.map((id, i) => [id, productCodes[i], itemQuantities[i], 1000]));
          if (expectedUnits) assert.deepEqual(rows.map(row => row.unitPrice), expectedUnits);
          assert.deepEqual(await page.locator('.receipt-line-id').allTextContents(), ids.map(id => '明細番号: ' + id));
          if (lineIds) assert.equal(await page.locator('.receipt-line-id').first().evaluate(el => getComputedStyle(el).whiteSpace), 'pre-wrap');
        }
        if ((separateCloseResolved && !unwrappedId) || ['recovered-product-id', 'recovered-reference-id', 'control-cr-reference', 'unmarked-product-id', 'unmarked-reference-id', 'longfold-product-id', 'longfold-reference-id'].includes(adjustment)) {
          assert.equal(await page.locator('.receipt-wrapped-id-note').isVisible(), true);
          assert((await page.locator('.receipt-wrapped-id-note').textContent()).includes('複数行の明細参照'));
          const originalFold = ['control-cr-reference', 'unmarked-product-id', 'unmarked-reference-id'].includes(adjustment) ? 'A\n101' : 'A-\n101';
          assert((await page.locator('#receiptRawText').inputValue()).includes(originalIdFold || originalFold));
        }
        if (unwrappedId) {
          assert.equal(await page.locator('.receipt-wrapped-id-note').count(), 0);
          assert((await page.locator('#receiptRawText').inputValue()).includes(originalIdFold));
        }
        if (separateCloseResolved || ['printed-id', 'inline-id', 'post-id', 'wrapped-id', 'alpha-id', 'separator-id', 'separator-post-id', 'bounded-space-id', 'bounded-repeat-id', 'control-tab-layout', 'control-cr-receipt', 'control-cr-reference', 'recovered-product-id', 'recovered-reference-id', 'unmarked-product-id', 'unmarked-reference-id', 'longfold-product-id', 'longfold-reference-id'].includes(adjustment)) {
          const split = await page.locator('#receiptOCRPanel').evaluate(el => JSON.parse(el.dataset.splitRows));
          assert.deepEqual(split.map(row => [row.discount, row.gross]), deductions.map(value => [value, 1000 - value]));
        } else {
          assert.equal(await page.locator('.receipt-discount-warning').isVisible(), true);
          assert.equal(await page.locator('#receiptSplitEnabled').count(), 0);
          assert.equal(rows.some(row => row.autoConfirmed), false);
        }
      } else if (adjustment === 'repeat-code' || adjustment === 'repeat-unassigned') {
        const rows = await page.locator('#receiptOCRPanel').evaluate(el => JSON.parse(el.dataset.itemRows));
        assert.deepEqual(rows.map(row => [row.qty, row.total]), [[1, 1000], [1, 1000]]);
        if (adjustment === 'repeat-code') {
          assert.deepEqual(rows.map(row => row.productCode), ['2200083271771', '2200083271702']);
          assert.deepEqual(await page.locator('.receipt-product-code').allTextContents(), ['商品コード: 2200083271771', '商品コード: 2200083271702']);
          const split = await page.locator('#receiptOCRPanel').evaluate(el => JSON.parse(el.dataset.splitRows));
          assert.deepEqual(split.map(row => [row.discount, row.gross]), [[100, 900], [200, 800]]);
        } else {
          assert.equal(await page.locator('.receipt-discount-warning').isVisible(), true);
          assert.equal(await page.locator('#receiptSplitEnabled').count(), 0);
          assert.equal(rows.some(row => row.autoConfirmed), false);
        }
      } else if (adjustment === 'multi-item' || adjustment === 'multi-unassigned') {
        const rows = await page.locator('#receiptOCRPanel').evaluate(el => JSON.parse(el.dataset.itemRows));
        assert.deepEqual(rows.map(row => row.total), [1000, 500]);
        if (adjustment === 'multi-item') {
          const split = await page.locator('#receiptOCRPanel').evaluate(el => JSON.parse(el.dataset.splitRows));
          assert.deepEqual(split.map(row => [row.discount, row.net, row.gross]), [[100, 900, 900], [200, 300, 300]]);
          assert.equal(await page.locator('.receipt-discount-warning').count(), 0);
        } else {
          assert.equal(await page.locator('.receipt-discount-warning').isVisible(), true);
          assert.equal(await page.locator('#receiptSplitEnabled').count(), 0);
          assert.equal(rows.some(row => row.autoConfirmed), false);
        }
      } else if (adjustment === 'markdown') {
        const rows = await page.locator('#receiptOCRPanel').evaluate(el => JSON.parse(el.dataset.itemRows));
        assert.equal(rows.length, 1);
        assert.equal(rows[0].total, 1280);
        assert.equal(rows[0].markdownOriginalTotal, 2500);
        assert.equal(rows[0].markdownDiscount, 1220);
      } else if (adjustment === 'discount') {
        const rows = await page.locator('#receiptOCRPanel').evaluate(el => JSON.parse(el.dataset.itemRows));
        assert.deepEqual(rows.map(row => row.total), [2500, 100]);
      } else if (mixedTax) {
        const rows = await page.locator('#receiptOCRPanel').evaluate(el => JSON.parse(el.dataset.splitRows));
        assert.deepEqual(rows.map(row => [row.net, row.extra, row.gross, row.taxRate]), [[100, 8, 108, 8], [200, 20, 220, 10]]);
      } else if (width === 412) {
        const rows = await page.locator('#receiptOCRPanel').evaluate(el => JSON.parse(el.dataset.itemRows));
        assert.equal(rows.length, 1);
        assert.equal(rows[0].qty, codePrice ? 2 : 10);
        assert.equal(rows[0].total, codePrice ? 98 : 15625);
        assert.equal(rows[0].unitPrice, codePrice ? 49 : 0);
        if (codePrice) assert.equal(rows[0].productCode, '2200083271771');
      }
      // The UI shows the masked diagnostic text; preserve the full price block
      // including its whitespace and notes while expecting the existing code mask.
      if (originalPriceBlock) assert((await page.locator('#receiptRawText').inputValue()).includes(originalPriceBlock.replace('2200083271771', '[番号マスク]')));
      assert.equal(await page.locator('#receiptCameraBtn').isEnabled(), true);
      assert.equal(await page.evaluate(() => window.testOCRTerminated), 1);
      assert.equal(await page.evaluate(() => JSON.stringify(state.transactions)), snapshot.transactions);
      assert.equal(await page.evaluate(() => localStorage.getItem('okozukaiReceiptProductDictionaryV1')), snapshot.dictionary);
      assert.equal(await page.evaluate(() => localStorage.getItem('okozukai_v321_mirror')), snapshot.mirror);
      assert.equal(await page.evaluate(async () => JSON.stringify(await idbReadCurrent())), snapshot.indexedDB);
      if (unresolvedSplitReference) {
        assert.equal(await page.locator('.receipt-product-review-confirm').count(), 0);
        await page.locator('#receiptItems').fill('テスト緑茶\nテスト緑茶');
      } else {
        assert(await page.locator('.receipt-product-review-confirm').count() > 0);
        const dismissed = page.waitForEvent('dialog').then(dialog => dialog.dismiss());
        await page.locator('#receiptApplyBtn').click();
        await dismissed;
        assert.equal(await page.locator('#txAmount').inputValue(), '');
        await page.locator('.receipt-product-review-name[data-index="0"]').fill('テスト緑茶');
        if (separateCloseResolved || ['repeat-code', 'repeat-unassigned', 'printed-id', 'printed-id-unknown', 'inline-id', 'post-id', 'post-id-unknown', 'wrapped-id', 'alpha-id', 'alpha-id-unknown', 'separator-id', 'separator-post-id', 'separator-id-unknown', 'bounded-space-id', 'bounded-repeat-id', 'bounded-space-unknown', 'control-tab-layout', 'control-cr-receipt', 'control-cr-reference', 'control-tab-reference', 'recovered-product-id', 'recovered-reference-id', 'unmarked-product-id', 'unmarked-reference-id', 'longfold-product-id', 'longfold-reference-id'].includes(adjustment)) await page.locator('.receipt-product-review-name[data-index="1"]').fill('テスト緑茶');
        if (mixedTax || ['discount', 'multi-item', 'multi-unassigned'].includes(adjustment)) await page.locator('.receipt-product-review-name[data-index="1"]').fill('歯ブラシ');
        for (const checkbox of await page.locator('.receipt-product-review-confirm').all()) await checkbox.check();
      }
      const geometry = await page.locator('#receiptApplyBtn').boundingBox();
      assert(geometry.width >= 44 && geometry.height >= 44);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.locator('#receiptApplyBtn').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `mobile-${caseName}.png`) });
      await page.locator('#receiptApplyBtn').click();
      assert.equal(await page.locator('#txAmount').inputValue(), expectedAmount);
      assert.equal(await page.locator('#txShop').inputValue(), 'ヤオコー東大和店');
      if (mixedTax) {
        const plan = JSON.parse(await page.locator('#receiptSplitPlan').inputValue());
        assert.equal(plan.total, 328);
        assert.deepEqual(plan.rows.map(row => [row.name, row.net, row.extra, row.gross, row.taxRate]), [['テスト緑茶', 100, 8, 108, 8], ['歯ブラシ', 200, 20, 220, 10]]);
      }
      if (adjustment === 'discount') {
        const plan = JSON.parse(await page.locator('#receiptSplitPlan').inputValue());
        assert.equal(plan.total, 1320);
        assert.equal(plan.rows.reduce((sum, row) => sum + row.originalNet, 0), 2600);
        assert.equal(plan.rows.reduce((sum, row) => sum + row.discount, 0), 1280);
        assert.equal(plan.rows.reduce((sum, row) => sum + row.gross, 0), 1320);
      }
      if (adjustment === 'multi-item') {
        const plan = JSON.parse(await page.locator('#receiptSplitPlan').inputValue());
        assert.equal(plan.total, 1200);
        assert.deepEqual(plan.rows.map(row => [row.name, row.discount, row.gross]), [['テスト緑茶', 100, 900], ['歯ブラシ', 200, 300]]);
      } else if (separateCloseResolved || ['repeat-code', 'printed-id', 'inline-id', 'post-id', 'wrapped-id', 'alpha-id', 'separator-id', 'separator-post-id', 'bounded-space-id', 'bounded-repeat-id', 'control-tab-layout', 'control-cr-receipt', 'control-cr-reference', 'recovered-product-id', 'recovered-reference-id', 'unmarked-product-id', 'unmarked-reference-id', 'longfold-product-id', 'longfold-reference-id'].includes(adjustment)) {
        const plan = JSON.parse(await page.locator('#receiptSplitPlan').inputValue());
        assert.equal(plan.total, amount);
        assert.deepEqual(plan.rows.map(row => [row.name, row.discount, row.gross]), deductions.map(value => ['テスト緑茶', value, 1000 - value]));
        assert.equal(plan.rows.some(row => row.receiptLineId), false);
        assert.equal(JSON.stringify(plan).includes('printedValue'), false);
        assert.equal(plan.rows.some(row => Object.hasOwn(row, 'reference')), false);
        assert.equal(plan.rows.some(row => Object.hasOwn(row, 'bareReference') || Object.hasOwn(row, 'foldedProduct')), false);
        assert.equal(plan.rows.some(row => Object.hasOwn(row, 'quantityEvidence')), false);
      } else if (unresolvedSplitReference || ['multi-unassigned', 'repeat-unassigned', 'printed-id-unknown', 'post-id-unknown', 'alpha-id-unknown', 'separator-id-unknown', 'bounded-space-unknown', 'control-tab-reference', 'recovered-id-ambiguous', 'unmarked-id-ambiguous', 'longfold-id-ambiguous'].includes(adjustment)) {
        assert.equal(await page.locator('#receiptSplitPlan').count(), 0);
      }
      assert.equal(await page.evaluate(() => JSON.stringify(state.transactions)), snapshot.transactions);
      assert.equal(await page.evaluate(() => localStorage.getItem('okozukai_v321_mirror')), snapshot.mirror);
      assert.equal(await page.evaluate(async () => JSON.stringify(await idbReadCurrent())), snapshot.indexedDB);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('okozukaiReceiptProductDictionaryV1')).some(row => row.name === '既存の学習商品' && row.confirmedCount === 4)), true);
      assert.deepEqual(errors, []);
      const metrics = await page.evaluate(() => ({ calls: window.testOCRCalls, terminated: window.testOCRTerminated }));
      fs.writeFileSync(path.join(output, `mobile-${caseName}.json`), JSON.stringify({ width, mixedTax, codePrice, adjustment, ...metrics, errors, realAndroidDevice: false, mockedOCR: true }, null, 2));
    } finally {
      if (browser) await browser.close();
      await new Promise(resolve => server.close(resolve));
    }
  });
}

test('deferred OCR crops preserve baseline bitmap pixels in Chromium', { timeout: browserTestTimeout }, async () => {
  const before = execFileSync('git', ['show', 'fd3d18a4138be0d3a1f13800047e0091914c064e:receipt.js'], { cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  const after = fs.readFileSync(path.join(root, 'receipt.js'), 'utf8');
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
  try {
    const page = await browser.newPage();
    async function bitmaps(source) {
      await page.addScriptTag({ content: source.replace('window.receiptFeature={', 'window.receiptImageTest={buildOCRBundle,setSource:function(source){pendingReceipt={source:source}}};window.receiptFeature={') });
      const result = await page.evaluate(() => {
        const source = document.createElement('canvas'); source.width = 60; source.height = 180;
        const context = source.getContext('2d'), pixels = context.createImageData(60, 180);
        for (let i = 0; i < pixels.data.length; i += 4) {
          pixels.data[i] = i % 251; pixels.data[i + 1] = (i * 7) % 253; pixels.data[i + 2] = (i * 13) % 255; pixels.data[i + 3] = 255;
        }
        context.putImageData(pixels, 0, 0);
        window.receiptImageTest.setSource(source);
        const bundle = window.receiptImageTest.buildOCRBundle();
        return ['slices', 'shopSlices', 'itemSlices', 'amountSlices', 'paymentSlices'].flatMap(role => bundle[role].map(part => ({ role, label: part.label || part.role, width: part.canvas.width, height: part.canvas.height, png: part.canvas.toDataURL() })));
      });
      return result.map(({ png, ...metadata }) => ({ ...metadata, sha256: createHash('sha256').update(png).digest('hex') }));
    }
    assert.deepEqual(await bitmaps(after), await bitmaps(before));
  } finally { await browser.close(); }
});
