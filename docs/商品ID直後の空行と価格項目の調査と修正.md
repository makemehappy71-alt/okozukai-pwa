# 商品ID直後の空行と価格項目の調査と修正（第47段階）

日付: 2026-11-09 / ブランチ: `codex/receipt-ocr-improvement`
基準: `134eec2d44d5edf6e60921f47b2105729110a556`

人工OCR文字列・模擬worker・隔離ブラウザの仮データで再現した問題だけを対象とする。実画像・実店舗書式・Android実機での再現は未検証。テストの商品や金額を学習辞書へ追加しない。

## 再現した問題と修正

第46段階は最初の価格項目を折り返しIDの閉じ括弧の直後の行に固定していた。次のような入力では、完全ID・単価・商品計・個別値引参照が同じ認識元に揃っても、空行を理由に保留していた。

```text
緑茶 (明細ID 00
0100)
2200083271771 1 ¥1,000
(明細ID 000100) 値引
¥100
緑茶 (明細ID 00
0200)

単価 ¥500
2200083271771 ¥1,000
(明細ID 000200) 値引
¥200
小計 3点 ¥1700
合計 ¥1700
楽天ペイ ¥1700
```

次商品の数量は未印字だが、元の折り返し商品IDと独立した元の完全な値引参照がゼロの桁数まで一致し、単価500円と商品計1000円から数量2を確認できる。それでも直前の100円値引と次商品の200円値引の終端・帰属を確定できなかった。単価先行・商品計先行、単独／複数の空行・水平空白行、識別済み注記を挟む場合でも再現した。

`receiptRecoverWrappedIds` で、元の商品IDが閉じた後の書式行を走査し、最初の非空行の位置を `firstPrice` として保持するようにした。2つ目の価格項目の検証をこの位置から始め、従来の厳密な単価・商品計の組で照合する。解析用コピー上では、空行と価格組を既存の数量付き明細へ整理する。

## 安全条件

- 対象は、数量印字のない、折り返された先頭ゼロ付き数字IDの商品。IDが閉じた後だけを走査し、ID内部の空行・数字・括弧の不足を補修しない。完全IDの商品へこの折り返し修復を拡張しない。
- 許容するのは空文字または既存NFKC後の水平空白・タブだけ。最初の非空行が数量・商品・注記・別コード・別ID・区切り線・制御文字等なら越えない。購入領域の終端も越えない。
- 同じ認識元に、元から完全に印字された独立した個別値引参照が必要。ゼロの桁数まで照合し、復元結果・別の認識元・別画像領域からIDや単価を借用しない。
- 元の数字コード10〜14桁、明示単価の限定書式・金額上限、商品計÷単価が1〜99の整数で厳密一致する条件を維持する。印字数量・既定数量1・総額・辞書から不足を補わない。
- 2つの価格項目は、直接隣接するか従来の書式行1行、または完全IDで識別できる注記1件とその前後の書式行だけを挟む。匿名注記や注記なしの複数空行を価格組の間で読み飛ばさない。
- 2つ目の価格項目と元の独立値引参照は隣接が必要。直前の値引額から次の商品IDまでの境界も変更しない。価格組の外から注記や単価を移動しない。
- 注記がある場合の完全IDの物理的な出現数、重複商品・注記・参照、点数・税・会計・認識元間の矛盾、裸の値引額の局所的な円単位と数量／単価／ID／コードとの値衝突チェックを維持する。
- 次商品の数量根拠は既存の一時情報に格納する。末尾の証拠が失われた場合は、依存する前の帰属確定も取り消す。

原文の空行・空白・タブ・ID・先頭ゼロ・価格順序と呼出元オブジェクトを保持する。1・2・8・32・128行の書式行を確認し、新しい固定行数上限は設けず、元の購入領域を上限とする。解析位置・数量根拠は商品行・分割計画・学習辞書へ保存しない。OCR呼び出し・保存項目・schemaVersionの変更はない。

## 検証結果

| テスト群 | 合格数/件数 |
| --- | ---: |
| 既存家計簿 | 61/61 |
| 既存OCR | 337/337 |
| 第1〜46段階の追加回帰・性能同等性回帰 | 7500/7500 |
| 今回の商品ID直後の書式行の回帰 | 966/966 |
| 影響範囲の隔離ブラウザ | 121/121 |

同じ新規966件は基準版で626件合格・340件失敗、修正後は966件合格・失敗0。既存OCR337件は前後とも全件合格し、西友18/18・ヤオコー10/10・MEGA6/6を維持した。

隔離ブラウザ121件も失敗・cancelled・skipは0件。家計簿61件・既存OCR337件・全追加回帰8466件・ブラウザ121件を合わせ、重複実行を除く最終検証合計は8985件・全件合格。

既存の同じ入力16件（第34・35・45・46段階の各4件）を、今回の安全条件に合うため保留から採用へ更新した。件数と入力は維持し、その他の期待値は変更しない。全追加回帰初回は8462/8466件合格で、第35段階の旧期待値4件が失敗した。入力を確認すると、商品IDが閉じた後の空行・2つの価格項目・元の完全な値引参照が揃う今回の対象だった。この4件だけを更新した後の全再実行は8466/8466件合格、失敗・cancelled・skipとも0件。アプリ側の追加変更はない。

新規画面は採用4件・保留4件で先行実行を通過。保留時は未確定・低信頼でIDの帰属がない候補、または候補なしを検証する。チェックは未選択で、未確認の適用を拒否する。明示的な名前編集・確認後にフォームへ金額を反映しても、自動分割計画は作らない。既存取引・IndexedDB・LocalStorageミラー・既存の学習辞書を保護する。

## 残存問題と保護

- ID内部の空行、最初の価格までの別項目・未知の制御文字、参照手前の空行、価格組の間の匿名注記・複数空行、ID不一致・重複・矛盾は手動確認が必要。
- 保留時に注記や価格ラベルが未確定商品候補として表示される既存の候補品質問題は残る。未確認の自動確定・自動分割は行わない。
- Android実機の速度・操作性、実画像の認識精度と店舗書式は未検証。ブラウザは模擬OCR・人工画像・新規コンテキスト・localhostと仮データだけを使用し、実データや実ブラウザプロファイルは開かない。
- schemaVersionは12を維持し、初期化・migrationは行わない。`app.js`、`sw.js`、`index.html`、`styles.css`、manifestは変更しない。
- mainは `e641912b6648757e39893659766b1de83dff8765`、Pages公開元は main `/` のlegacy構成。作業ブランチ以外の参照と公開設定は変更しない。

## 再実行と成果物

```powershell
node tests/run.cjs
node tests/compare-ocr.cjs product-id-price-gap.test.cjs 134eec2d44d5edf6e60921f47b2105729110a556
$regressionFiles = @(rg --files tests -g '*.test.cjs' | Where-Object { $_ -notmatch '(^|[\\/])mobile\.test\.cjs$' })
node --test --test-reporter=tap @regressionFiles
$nodeRoot=Split-Path (Split-Path (Get-Command node).Source)
$env:PLAYWRIGHT_MODULE_PATH=Join-Path $nodeRoot 'node_modules\playwright'
$env:BROWSER_PATH='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$env:BROWSER_TEST_TIMEOUT_MS='180000'
node --test --test-reporter=tap --test-name-pattern='^(?:mobile Chromium (?:(?:360|412)px|412-(?:quantity|preceding|gap|scope|identified|unbracketed|joined|punctuation|repeated|spaced|wrapped|multiline|blankgap|surrounded|idprice)-close-[^:]+px):|deferred OCR crops)' tests/mobile.test.cjs
Remove-Item Env:BROWSER_TEST_TIMEOUT_MS
node --check receipt.js
node --check tests/product-id-price-gap.test.cjs
node --check tests/mobile.test.cjs
git diff --check
```

ブラウザ全221件のうち、数量省略・単価先行の旧画面14件を追加した影響範囲121件を選択する。180秒はテスト待機上限だけでアプリ制限・テスト既定値は変更しない。先行実行8件や比較・再実行分は検証総数に重複加算しない。

成果物は `.test-artifacts` の `product-id-price-gap-comparison.json`、`before-product-id-price-gap.tap`、`after-product-id-price-gap.tap`、`phase47-regression-initial.tap`、`phase47-regression.tap`、`phase47-mobile-new.tap`、`phase47-mobile.tap`、`phase47-review.json`、`phase47-remote-before.json`、`phase47-remote-after.json`（Git管理対象外）。

## 変更ファイル

| ファイル | 内容 |
| --- | --- |
| receipt.js | 閉じた商品IDの後の書式行と最初の価格項目の検証 |
| tests/product-id-price-gap.test.cjs | 新規回帰966件 |
| tests/unit-before-total.test.cjs | 同じ入力4件の期待値更新 |
| tests/separated-unit-total.test.cjs | 同じ入力4件の期待値更新 |
| tests/blank-scope-punctuation.test.cjs | 同じ入力4件の期待値更新 |
| tests/surrounded-scope-gap.test.cjs | 同じ入力4件の期待値更新 |
| tests/mobile.test.cjs | 新規8件、原文保持・手動保留・保存保護の検証 |
| docs/商品ID直後の空行と価格項目の調査と修正.md | 本文書 |
| README.md | 調査結果と回帰への入口 |
