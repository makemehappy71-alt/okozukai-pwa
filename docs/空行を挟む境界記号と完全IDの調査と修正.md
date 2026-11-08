# 空行を挟む境界記号と完全IDの調査と修正（第45段階）

日付: 2026-11-09 / ブランチ: `codex/receipt-ocr-improvement`
基準: `ac67b33a968c1bbe9b375cc9adc29ad60fc55391`

人工OCR文字列・模擬worker・隔離ブラウザの仮データで再現した問題だけを対象とする。実画像・実店舗の印字書式・Android実機での再現は未検証。人工の商品や金額を学習辞書へ追加しない。

## 再現した問題

第44段階は、商品／単品と完全IDの間のコロン・ハイフンが3行以上に分断されても、中間行が記号だけなら解析できた。一方、空行や空白・タブだけの行が途中に入ると停止していた。

```text
緑茶 (明細ID 00
0100)
2200083271771 1 ¥1,000
(明細ID 000100) 値引
¥100
緑茶 (明細ID 00
0200)
単価 ¥500
商品:
:

:明細ID000200
2200083271771 ¥1,000
(明細ID 000200) 値引
¥200
小計 3点 ¥1700
合計 ¥1700
楽天ペイ ¥1700
```

同じ認識元で、折り返し商品ID・注記の完全ID・独立した元の完全値引参照がゼロの桁数まで一致する。単価500円と商品計1000円から数量2も確認できる。これでも基準版は直前の100円値引と次商品の200円値引の終端・帰属を確定できなかった。逆順の価格項目やID／注記、複数空行、タブだけの行でも再現した。

## 修正と安全条件

`receiptWrappedQuantityScopeMarker` の購入領域内の走査で、空文字または水平空白・タブだけの行を注記内の書式行として扱う。それ以外の照合条件は変更しない。

- 注記開始行の末尾と終端行の先頭には実際のコロン／ハイフンが必要。空行で継続記号の欠落を補わない。間の非空行も記号と水平空白だけに限定する。
- 対象は数量未印字の折り返し商品ID直後の、明示単価とコード付き商品計の間の注記だけ。注記の前後、商品ID内部、価格との境界、独立した値引参照の手前の空行を読み飛ばさない。
- 最初の非記号・非書式行で必ず走査を止め、全体が既存の厳密な注記書式に一致するときだけ採用する。小計などの購入領域終端を越えない。IDラベル・数字列・注記語・括弧は元からそれぞれ1行に完全印字されている必要がある。
- 同じ認識元の折り返しID・注記ID・独立した元の完全な個別値引参照IDを、ゼロの桁数まで照合する。注記だけの証拠、復元結果、別の認識元や画像領域からの不足補完は使わない。
- 注記全体の完全IDは物理的な1回と数え、独立値引参照との計2回を要求する。重複した注記・商品・参照・折り返し商品の判定を緩めない。
- コード10〜14桁、単価／商品計の金額上限、数量1〜99の整数厳密一致、点数・税・会計照合、裸の値引額の局所的な円単位、ID／数量／単価／コードとの値衝突チェックを維持する。末尾の証拠が失われた場合は、依存する前の帰属確定も取り消す。
- 既存のNFKCで水平空白・ASCII記号へ変換される全角空白等は扱う。縦タブ・改ページ・ゼロ幅文字等を汎用的な空白として削除しない。

元の購入領域を走査範囲とし、新しい固定行数上限は設けない。記号行3・4・8・32・128行に空行やタブ行を交互に挟む例も確認した。原文の空行・空白・タブ・ID・ゼロ・価格順序と呼出元オブジェクトは保持する。変更するのは解析用コピーだけで、一時的な注記終端や根拠は商品行・分割計画・学習辞書に保存しない。

## 検証結果

| テスト群 | 合格数/件数 |
| --- | ---: |
| 既存家計簿 | 61/61 |
| 既存OCR | 337/337 |
| 第1〜44段階の追加回帰・性能同等性回帰 | 6128/6128 |
| 今回の注記内空行・水平空白行の回帰 | 542/542 |
| 影響範囲の隔離ブラウザ | 91/91 |

同じ新規542件は基準版で397件合格・145件失敗、修正後は542件合格・失敗0。既存OCR337件は前後とも全件合格し、西友18/18・ヤオコー10/10・MEGA6/6を維持した。全追加回帰6670件は失敗・cancelled・skipとも0件。

隔離ブラウザ91件も失敗・cancelled・skipは0件。家計簿61件・既存OCR337件・全追加回帰6670件・ブラウザ91件を合わせ、重複実行を除く検証合計は7159件・全件合格。

既存の同じ入力20件（第43段階4件・第44段階16件）とブラウザ1件は、今回の注記内書式行の条件に一致するため、保留から採用へ期待値を変更した。テスト件数は維持し、それ以外の既存期待値は変更しない。新規ブラウザは採用4件・保留4件。

保留時はIDの帰属がない未確定・低信頼候補、または候補なしであることを検証する。候補のチェックは未選択で、未確認の適用を拒否する。明示的な名前編集・確認後にフォームへ金額を反映しても自動分割計画は作らない。取引・IndexedDB・LocalStorageミラーと既存の学習辞書を保護する。

## 残存問題と保護

- 継続記号の欠落、中間の数字・別項目・未知の制御文字、ID内部や注記外の空行、異なるID・重複・矛盾では引き続き手動確認が必要。
- 保留時に注記や価格ラベルが未確定商品候補として表示される既存の候補品質問題は残る。未確認の自動確定・自動分割は行わない。
- Android実機の速度・操作性、実画像での認識精度と店舗書式は未検証。ブラウザは模擬OCR・人工画像・新規コンテキスト・localhostと仮データだけで検証し、実データや実ブラウザプロファイルは開かない。
- 保存項目・OCR呼び出しを追加しない。schemaVersionは12を維持し、データの初期化・migrationは行わない。`app.js`、`sw.js`、`index.html`、`styles.css`、manifestに変更はない。
- mainは `e641912b6648757e39893659766b1de83dff8765`、Pages公開元は main `/` のlegacy構成。作業ブランチ以外の参照と公開設定は変更しない。

## 再実行と成果物

```powershell
node tests/run.cjs
node tests/compare-ocr.cjs blank-scope-punctuation.test.cjs ac67b33a968c1bbe9b375cc9adc29ad60fc55391
$regressionFiles = @(rg --files tests -g '*.test.cjs' | Where-Object { $_ -notmatch '(^|[\\/])mobile\.test\.cjs$' })
node --test --test-reporter=tap @regressionFiles
$nodeRoot=Split-Path (Split-Path (Get-Command node).Source)
$env:PLAYWRIGHT_MODULE_PATH=Join-Path $nodeRoot 'node_modules\playwright'
$env:BROWSER_PATH='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$env:BROWSER_TEST_TIMEOUT_MS='180000'
node --test --test-reporter=tap --test-name-pattern='^(?:mobile Chromium (?:(?:360|412)px|412-(?:gap|scope|identified|unbracketed|joined|punctuation|repeated|spaced|wrapped|multiline|blankgap)-close-[^:]+px):|deferred OCR crops)' tests/mobile.test.cjs
Remove-Item Env:BROWSER_TEST_TIMEOUT_MS
node --check receipt.js
node --check tests/blank-scope-punctuation.test.cjs
node --check tests/multiline-scope-punctuation.test.cjs
node --check tests/wrapped-scope-punctuation.test.cjs
node --check tests/mobile.test.cjs
git diff --check
```

ブラウザ全205件のうち、影響範囲91件を選択する。180秒はテスト待機上限だけで、アプリ制限・テスト既定値は変更しない。新規8件の先行実行と、比較・単独実行などの再実行分は総件数に重複加算しない。

成果物は `.test-artifacts` の `blank-scope-punctuation-comparison.json`、`before-blank-scope-punctuation.tap`、`after-blank-scope-punctuation.tap`、`phase45-regression.tap`、`phase45-mobile-new.tap`、`phase45-mobile.tap`、`phase45-review.json`、`phase45-remote-before.json`、`phase45-remote-after.json`（Git管理対象外）。

## 変更ファイル

| ファイル | 内容 |
| --- | --- |
| receipt.js | 注記内の書式行だけを許容 |
| tests/blank-scope-punctuation.test.cjs | 新規回帰542件 |
| tests/multiline-scope-punctuation.test.cjs | 同じ入力16件の期待値更新 |
| tests/wrapped-scope-punctuation.test.cjs | 同じ入力4件の期待値更新 |
| tests/mobile.test.cjs | 新規8件と既存1件の期待値更新、手動保留と保存保護の検証 |
| docs/空行を挟む境界記号と完全IDの調査と修正.md | 本文書 |
| README.md | 調査結果と回帰への入口 |
