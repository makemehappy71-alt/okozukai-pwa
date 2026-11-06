const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

// Never start the application or connect to browser storage in this harness.
function createRuntime(root = path.resolve(__dirname, '../..'), { captureFixtures = false, merchantDictionary } = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      dataset: {}, value: '', innerHTML: '', textContent: '',
      addEventListener() {}, insertAdjacentHTML(_position, html) { this.innerHTML += html; },
      classList: { contains: () => false, add() {}, remove() {}, toggle() {} }
    });
    return elements.get(id);
  };
  const storage = new Map();
  const writes = [];
  const context = vm.createContext({
    console, Date, Intl, URL, structuredClone, crypto: webcrypto,
    setTimeout, clearTimeout,
    document: {
      getElementById: element,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {}
    },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem(key, value) { writes.push(key); storage.set(key, String(value)); },
      removeItem(key) { writes.push(key); storage.delete(key); }
    },
    indexedDB: { open() { throw new Error('IndexedDB access prohibited in tests'); } },
    MutationObserver: class { observe() {} },
    addEventListener() {}, navigator: {}, location: { protocol: 'test:' }
  });
  context.window = context;
  let app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const startup = app.indexOf('(async()=>{await loadState();');
  if (startup < 0) throw new Error('App startup boundary changed; review test isolation');
  vm.runInContext(app.slice(0, startup), context, { filename: 'app.js' });
  vm.runInContext('state=defaults()', context);
  let receipt = fs.readFileSync(path.join(root, 'receipt.js'), 'utf8');
  const exportBoundary = 'window.receiptFeature={';
  if (!receipt.includes(exportBoundary)) throw new Error('Receipt export boundary changed');
  receipt = receipt.replace(exportBoundary,
    'window.receiptInternals={setPendingSource:function(source){pendingReceipt={source:source}},itemRowsFromText,itemCategorySuggestion,categorySuggestion,loadOCR,runOCR,receiptStructuralFastPath,buildOCRBundle,shopFromText,cleanFocusedProductName,focusedProductConsensus,productNameRequiresConfirmation,applyFocusedNamesToRows,analyzeAmount,allocateReceiptRows,chooseItemsForSubtotal,receiptQuantitySummaryLine,receiptDiscountAmount,productSourceText,normalizeProductName,isGarbageProductName,classifyReceiptLine,anchoredProductLineFromBlocks,isReceiptHeaderLine,stripReceiptHeaderNoise,receiptNonMerchandiseLabel,productMeaningfulScore,taxAmountFromLine,receiptTaxBuckets};' + exportBoundary);
  if (captureFixtures) receipt = receipt.replace('var diagnosticP5=receiptDiagnosticSummary(p5);',
    'window.receiptFixtures={p5,pbk,pbkRow,okText,okObj,okFastPath,pOk,goodFocusConsensus,noisyNameChecks,naturalNameCheck,multiWeakConsensusRows,multiStrongConsensusRows,p510,psw};var diagnosticP5=receiptDiagnosticSummary(p5);');
  if (merchantDictionary) {
    context.testMerchantDictionary = merchantDictionary;
    receipt = receipt.replace(exportBoundary, 'merchantProductDictionary=function(){return globalThis.testMerchantDictionary};' + exportBoundary);
  }
  vm.runInContext(receipt, context, { filename: 'receipt.js' });
  return { context, storage, writes, element, evaluate: source => vm.runInContext(source, context) };
}

module.exports = { createRuntime };
