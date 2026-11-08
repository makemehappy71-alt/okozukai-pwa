# 完全参照IDと値引ラベルの間の空行の調査と修正（第49段階）

日付: 2026-11-09 / ブランチ: `codex/receipt-ocr-improvement`
基準: `ea704a8d54c382658419ac865cd112b32f058799`

人工OCR文字列・模擬worker・隔離ブラウザの仮データで再現した問題だけを対象とする。実画像・実店舗書式・Android実機での再現は未検証。テストの商品や金額を学習辞書へ追加しない。

## 再現と修正

第48段階までの処理は、完全な値引参照IDだけの行の直後にラベルを要求していた。次の入力では、同じ認識元の折り返し商品ID・単価・商品計・元の完全な参照で照合できても、ラベルの前の空行を理由に保留していた。

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
(明細ID 000200)

値引
¥200
小計 3点 ¥1700
合計 ¥1700
楽天ペイ ¥1700
```

空行がない同じ入力は基準版で確定できた。空行・水平空白／タブ行が入ると、直前の100円値引と次商品の200円値引の終端・帰属を確定できなかった。価格順序の逆転、注記あり／なし、複数書式行でも再現した。

`receiptCompleteDiscountContinuation` に、元の完全な参照を商品ID折り返しの根拠として読む場合だけ有効になる `allowLabelGap` を追加した。元のID行の後の書式行を走査し、最初の非空行が厳密なラベル単独行であれば既存のラベル・金額読取りへ渡す。元の参照開始位置と金額終端は維持する。

通常の参照正規化ではこのオプションを有効にしない。新しい読取りで見つけた参照は、数量未印字商品の折り返しと価格組の照合が成立する場合にだけ、その商品の付随参照として解析用コピーを整理する。

## 安全条件

- 対象は元から完全に印字され、閉じ括弧を持つ参照ID単独行。連続数字2〜6桁の先頭ゼロ付きIDだけを新しい走査の対象とする。ID内部の空白・数字・括弧を補修せず、英数字IDや先頭ゼロなしIDへこの走査を広げない。
- 越えるのは空文字または既存NFKC後の水平空白・タブだけ。最初の非空行に数量・価格・別ID・自由な注記・区切り線・制御文字があれば停止し、後方の正しいラベルを探さない。購入領域の終端を越えない。
- 最初の非空行は既存の厳密な値引／割引／値下額ラベル単独行に合うこと。既存書式の同一行の「商品値引」等の接頭語と局所的な「額（円）」は扱う。独立した「商品」「単品」行を越えてラベルを探さない。
- 金額はラベルの直後の元の行に必要。ラベルと金額の間、ID内部、値引額の後から次商品ID・小計までの空行には今回の走査を適用しない。新しい空行対応ではラベルと金額が同一行の書式を補完しない。
- 同じ認識元にある折り返し商品IDと元の完全な参照を、ゼロの桁数まで一致させる。別の認識元・画像領域・復元結果からIDを借用しない。注記だけを参照の根拠にしない。
- 新しい参照を使う商品は、元のコード10〜14桁、限定された明示単価・商品計の組から数量1〜99の整数が厳密一致することが必須。既定数量1・印字数量・点数・総額・辞書から数量根拠を補わない。印字数量のある商品の正規化へ広げない。
- 重複商品・注記・参照、税・会計・認識元間の矛盾、裸の値引額の局所的な円単位と数量／単価／ID／コードとの値衝突チェックを維持する。末尾の証拠が失われたときは依存する前の帰属確定も取り消す。

1・2・8・32・128行の書式行を確認し、元の購入領域を走査上限とする。一時的な `labelGap` は数量根拠の追加検証にだけ使用し、商品行・分割計画・学習辞書へ保存しない。原文の空行・タブ・先頭ゼロ・価格順序と呼出元オブジェクトは保持する。保存項目・OCR呼び出し・schemaVersionの変更はない。

## 検証結果

| テスト群 | 合格数/件数 |
| --- | ---: |
| 既存家計簿 | 61/61 |
| 既存OCR | 337/337 |
| 第1〜48段階の追加回帰・性能同等性回帰 | 9568/9568 |
| 今回の完全IDとラベルの間の書式行の回帰 | 1238/1238 |
| 影響範囲の隔離ブラウザ | 137/137 |

固定コミットとの比較は、新規1238件が改善前798件合格・440件失敗、修正後1238件合格・失敗0。既存OCR337件は前後とも合格し、西友18/18・ヤオコー10/10・MEGA6/6を維持した。全追加回帰10806件は10806件合格、失敗・cancelled・skipとも0件。

画面137件も失敗・cancelled・skipは0件。家計簿61件・既存OCR337件・全追加回帰10806件・画面137件を合わせ、重複実行を除く最終検証合計は11341件・全件合格。

既存回帰の入力・期待値は変更していない。新規画面の採用4件・保留4件は先行実行ですべて合格。既存の画面期待値は維持し、一時情報が分割計画に残らない検査を追加した。

## 残存問題と保護

- ID内部やラベル・金額間の空行、別項目・未知の制御文字、ラベルと金額が同一行の未対応書式、ID不一致・重複・矛盾は手動確認が必要。
- 保留時の未確定候補表示の品質問題は残る。未確認の適用を拒否し、名前を明示的に編集・確認した後も値引の自動分割計画を作らない条件を検証する。
- Android実機の速度・操作性、実画像の認識精度と店舗書式は未検証。ブラウザは模擬OCR・人工画像・新規コンテキスト・localhostと仮データだけを使用し、実データや実ブラウザプロファイルは開かない。
- 既存取引・IndexedDB・LocalStorageミラー・既存の学習辞書を保護する。schemaVersionは12を維持し、初期化・migrationは行わない。`app.js`、`sw.js`、`index.html`、`styles.css`、manifestに変更はない。
- mainは `e641912b6648757e39893659766b1de83dff8765`、Pages公開元は main `/` のlegacy構成。作業ブランチ以外の参照と公開設定は変更しない。

## 再実行と成果物

```powershell
node tests/run.cjs
New-Item -ItemType Directory -Path .test-artifacts -Force | Out-Null
$comparisonSource=Get-Content -LiteralPath tests/compare-ocr.cjs -Raw
$comparisonSource=$comparisonSource.Replace("require('./helpers/runtime.cjs')", "require('../tests/helpers/runtime.cjs')").Replace('path.join(__dirname, suite)', "path.join(root, 'tests', suite)").Replace('timeout: 30000', 'timeout: 180000')
$comparisonSource | Set-Content -LiteralPath .test-artifacts/phase49-compare.cjs -Encoding utf8
node .test-artifacts/phase49-compare.cjs reference-id-label-gap.test.cjs ea704a8d54c382658419ac865cd112b32f058799
$regressionFiles = @(rg --files tests -g '*.test.cjs' | Where-Object { $_ -notmatch '(^|[\\/])mobile\.test\.cjs$' })
node --test --test-reporter=tap @regressionFiles
$nodeRoot=Split-Path (Split-Path (Get-Command node).Source)
$env:PLAYWRIGHT_MODULE_PATH=Join-Path $nodeRoot 'node_modules\playwright'
$env:BROWSER_PATH='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$env:BROWSER_TEST_TIMEOUT_MS='180000'
node --test --test-reporter=tap --test-name-pattern='^(?:mobile Chromium (?:(?:360|412)px|412-(?:quantity|preceding|gap|scope|identified|unbracketed|joined|punctuation|repeated|spaced|wrapped|multiline|blankgap|surrounded|idprice|refgap|idlabel)-close-[^:]+px):|deferred OCR crops)' tests/mobile.test.cjs
Remove-Item Env:BROWSER_TEST_TIMEOUT_MS
node --check receipt.js
node --check tests/reference-id-label-gap.test.cjs
node --check tests/mobile.test.cjs
git diff --check
```

ブラウザ全237件のうち影響範囲137件を選択する。比較の子プロセスと画面テストの180秒は検証用の待機上限だけで、アプリの制限・テスト既定値は変更しない。先行実行8件や比較・単独実行等の再実行分は総件数に重複加算しない。

成果物は `.test-artifacts` の `reference-id-label-gap-comparison.json`、`before-reference-id-label-gap.tap`、`after-reference-id-label-gap.tap`、`phase49-regression.tap`、`phase49-mobile-new.tap`、`phase49-mobile.tap`、`phase49-review.json`、`phase49-remote-before.json`、`phase49-remote-after.json`（Git管理対象外）。

## 変更ファイル

| ファイル | 内容 |
| --- | --- |
| receipt.js | 元の完全参照IDの後の書式行と厳密なラベル・数量根拠の検証 |
| tests/reference-id-label-gap.test.cjs | 新規回帰1238件 |
| tests/mobile.test.cjs | 新規8件、原文保持・手動保留・一時情報混入防止・保存保護の検証 |
| docs/完全参照IDと値引ラベルの間の空行の調査と修正.md | 本文書 |
| README.md | 調査結果と回帰への入口 |
