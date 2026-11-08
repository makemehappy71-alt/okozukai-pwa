# 注記前後の空行と完全IDの調査と修正（第46段階）

日付: 2026-11-09 / ブランチ: `codex/receipt-ocr-improvement`
基準: `5361fcdebab068b31782d164eb19f4347345d053`

人工OCR文字列・模擬worker・隔離ブラウザの仮データで再現した問題だけを対象とする。実画像・実店舗の印字書式・Android実機での再現は未検証。人工の商品や金額を学習辞書へ追加しない。

## 再現した問題

第45段階までの処理は、単価と商品計の間の識別済み注記について、注記内部の空行を扱っていたが、注記の前後の空行を許容していなかった。

```text
緑茶 (明細ID 00
0100)
2200083271771 1 ¥1,000
(明細ID 000100) 値引
¥100
緑茶 (明細ID 00
0200)
単価 ¥500

商品 (明細ID 000200)

2200083271771 ¥1,000
(明細ID 000200) 値引
¥200
小計 3点 ¥1700
合計 ¥1700
楽天ペイ ¥1700
```

次商品の数量は未印字だが、同じ認識元の折り返し商品ID・注記の完全ID・独立した元の完全値引参照がゼロの桁数まで一致し、単価500円と商品計1000円から数量2を確認できる。それでも基準版は直前の100円値引と次商品の200円値引の終端・帰属を確定できなかった。注記前だけ・後だけ・両側、空白／タブだけの行、単価先行・商品計先行でも再現した。

## 修正と安全条件

`receiptRecoverWrappedIds` の数量未印字商品の検証で、最初の価格項目の後から水平空白だけの行を走査し、既存の注記キャッシュを照合する。一意な注記が見つかった場合に限り、その後の書式行も越えて2つ目の価格項目を検証する。

- 注記は1件だけで、商品／単品と完全な明細IDを持つ既存の厳密な書式に一致すること。IDは括弧付き・括弧なしの既存書式を扱い、先頭ゼロを含む元の印字が折り返し商品IDと一致しなければならない。
- 同じ認識元に、元から完全に印字された独立した個別値引参照が必要。注記だけ、別の認識元、別の画像領域、復元結果からIDを補わない。
- 元の完全IDの物理的な出現は注記1件と独立参照1件の計2回だけ。注記・商品・参照の重複を照合の補強にしない。空行を越えて2件の注記をまとめない。
- 許容する前後の行は、空文字または既存NFKC後の水平空白・タブだけ。数字、数量、価格、商品、自由な注記、別ID、区切り線、縦タブ・改ページ・ゼロ幅文字等は越えない。
- 商品IDから最初の価格項目、2つ目の価格項目から独立値引参照は元の行で隣接すること。これらの境界、商品ID内部、注記のIDラベル・数字内部の空行を読み飛ばさない。注記を価格項目の外から移動しない。
- 商品コード10〜14桁、明示単価の限定書式と金額上限、商品計÷単価が1〜99の整数で厳密一致する条件、点数・税・会計照合を維持する。数量1の既定値や総額・辞書から不足を補わない。
- 裸の値引額の局所的な円単位、ID／数量／単価／コードとの値衝突チェック、末尾の証拠が失われたときの依存する前の帰属確定の取り消しも維持する。

識別済み注記が見つからない場合は、従来の「価格項目の間に書式行1行だけ」の処理を維持する。匿名の「商品」「単品」や、注記なしの複数空行へ対象を広げない。元の購入領域を走査範囲とし、小計等の終端を越えない。

原文の空行・空白・タブ・ID・先頭ゼロ・価格順序と呼出元オブジェクトは保持する。解析用コピーだけを整理し、一時的な根拠は商品行・分割計画・学習辞書へ保存しない。保存項目・OCR呼び出し・schemaVersionの変更はない。

## 検証結果

| テスト群 | 合格数/件数 |
| --- | ---: |
| 既存家計簿 | 61/61 |
| 既存OCR | 337/337 |
| 第1〜45段階の追加回帰・性能同等性回帰 | 6670/6670 |
| 今回の注記前後の空行・水平空白行の回帰 | 830/830 |
| 影響範囲の隔離ブラウザ | 99/99 |

同じ新規830件は基準版で554件合格・276件失敗、修正後は830件合格・失敗0。既存OCR337件は前後とも全件合格し、西友18/18・ヤオコー10/10・MEGA6/6を維持した。全追加回帰7500件は失敗・cancelled・skipとも0件。

隔離ブラウザ99件も失敗・cancelled・skipは0件。家計簿61件・既存OCR337件・全追加回帰7500件・ブラウザ99件を合わせ、重複実行を除く検証合計は7997件・全件合格。

既存の同じ入力68件は今回の安全条件に一致するため、保留から採用へ期待値を更新した。第37段階の先頭空行4件と、第38〜45段階の注記前後の空行各8件で、件数は維持する。それ以外の既存期待値は変更しない。新規ブラウザは採用4件・保留4件、既存ブラウザの期待値変更はない。

保留時はIDの帰属がない未確定・低信頼候補、または候補なしであることを検証する。候補のチェックは未選択で、未確認の適用を拒否する。明示的な名前編集・確認後にフォームへ金額を反映しても自動分割計画は作らない。既存取引・IndexedDB・LocalStorageミラーと既存の学習辞書を保護する。

## 残存問題と保護

- 匿名の注記、注記なしの複数空行、別項目・制御文字・区切り線の混入、ID内部や価格項目外の空行、ID不一致・重複・矛盾は引き続き手動確認が必要。
- 保留時に注記や価格ラベルが未確定商品候補として表示される既存の候補品質問題は残る。未確認の自動確定・自動分割は行わない。
- Android実機の速度・操作性、実画像の認識精度と店舗書式は未検証。ブラウザは模擬OCR・人工画像・新規コンテキスト・localhostと仮データだけで検証し、実データや実ブラウザプロファイルは開かない。
- schemaVersionは12を維持し、データの初期化・migrationは行わない。`app.js`、`sw.js`、`index.html`、`styles.css`、manifestに変更はない。
- mainは `e641912b6648757e39893659766b1de83dff8765`、Pages公開元は main `/` のlegacy構成。作業ブランチ以外の参照と公開設定は変更しない。

## 再実行と成果物

```powershell
node tests/run.cjs
node tests/compare-ocr.cjs surrounded-scope-gap.test.cjs 5361fcdebab068b31782d164eb19f4347345d053
$regressionFiles = @(rg --files tests -g '*.test.cjs' | Where-Object { $_ -notmatch '(^|[\\/])mobile\.test\.cjs$' })
node --test --test-reporter=tap @regressionFiles
$nodeRoot=Split-Path (Split-Path (Get-Command node).Source)
$env:PLAYWRIGHT_MODULE_PATH=Join-Path $nodeRoot 'node_modules\playwright'
$env:BROWSER_PATH='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$env:BROWSER_TEST_TIMEOUT_MS='180000'
node --test --test-reporter=tap --test-name-pattern='^(?:mobile Chromium (?:(?:360|412)px|412-(?:gap|scope|identified|unbracketed|joined|punctuation|repeated|spaced|wrapped|multiline|blankgap|surrounded)-close-[^:]+px):|deferred OCR crops)' tests/mobile.test.cjs
Remove-Item Env:BROWSER_TEST_TIMEOUT_MS
node --check receipt.js
node --check tests/surrounded-scope-gap.test.cjs
node --check tests/mobile.test.cjs
git diff --check
```

ブラウザ全213件のうち影響範囲99件を選択する。180秒はテスト待機上限だけでアプリ制限・テスト既定値は変更しない。先行実行8件や比較・単独実行などの再実行分は総件数に重複加算しない。

成果物は `.test-artifacts` の `surrounded-scope-gap-comparison.json`、`before-surrounded-scope-gap.tap`、`after-surrounded-scope-gap.tap`、`phase46-regression.tap`、`phase46-mobile-new.tap`、`phase46-mobile.tap`、`phase46-review.json`、`phase46-remote-before.json`、`phase46-remote-after.json`（Git管理対象外）。

## 変更ファイル

| ファイル | 内容 |
| --- | --- |
| receipt.js | 識別済み注記の前後の書式行に限定した走査 |
| tests/surrounded-scope-gap.test.cjs | 新規回帰830件 |
| tests/identified-scope-gap.test.cjs | 同じ入力4件の期待値更新 |
| tests/unbracketed-scope-id.test.cjs | 同じ入力8件の期待値更新 |
| tests/joined-scope-id.test.cjs | 同じ入力8件の期待値更新 |
| tests/scope-id-punctuation.test.cjs | 同じ入力8件の期待値更新 |
| tests/repeated-scope-id-punctuation.test.cjs | 同じ入力8件の期待値更新 |
| tests/spaced-scope-id-punctuation.test.cjs | 同じ入力8件の期待値更新 |
| tests/wrapped-scope-punctuation.test.cjs | 同じ入力8件の期待値更新 |
| tests/multiline-scope-punctuation.test.cjs | 同じ入力8件の期待値更新 |
| tests/blank-scope-punctuation.test.cjs | 同じ入力8件の期待値更新 |
| tests/mobile.test.cjs | 新規8件、手動保留と保存保護の検証 |
| docs/注記前後の空行と完全IDの調査と修正.md | 本文書 |
| README.md | 調査結果と回帰への入口 |
