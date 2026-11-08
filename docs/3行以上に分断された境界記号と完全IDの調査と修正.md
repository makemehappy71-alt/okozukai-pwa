# 3行以上に分断された境界記号と完全IDの調査と修正（第44段階）

日付: 2026-11-09 / ブランチ: `codex/receipt-ocr-improvement`
基準: `f8994caab7b280726322d492cce1ff04d38ac382`

人工OCR文字列・模擬worker・隔離ブラウザの仮データで再現した問題だけを対象とする。実画像・実店舗の印字書式・Android実機での再現は未検証。人工の商品や金額を学習辞書へ追加しない。

## 再現した問題

第43段階の注記復元は隣接する2行までに限定されていた。次のように境界記号列が3行以上へ分断されると、同じ認識元に完全なID・価格・個別値引参照が残っていても保留していた。

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

次商品の数量は未印字だが、折り返しID・注記の完全ID・独立した元の完全値引参照はゼロの桁数まで一致する。単価500円・商品計1000円から数量2を確認できる。これでも基準版は1つ目の値引100円と次商品の値引200円の終端・帰属を確定できなかった。商品計先行、注記とIDの逆順、混在記号、水平空白・タブ付きでも再現した。

## 修正と安全条件

`receiptWrappedQuantityScopeMarker` を、元の購入領域の行列・開始位置・領域終端を受け取る処理へ変更した。

1. 開始行には商品／単品または明細IDの文字と、行末のコロン／ハイフンの印字を要求する。
2. 後続行は、水平空白を除いた行頭にコロン／ハイフンが必要。中間行はコロン・ハイフンと水平空白・タブだけを許容する。空行、数字、価格、別項目、未知記号は越えない。
3. 最初の「記号だけではない行」で必ず停止する。全体を一度だけ解析上のスペースで結び、既存の厳密な注記書式に一致するときだけ採用する。小計などの購入領域終端も越えない。終端が見つからない記号列は保留する。
4. したがって、すべての改行の両側に継続記号があり、改行位置は商品／単品と完全IDの間の記号列内だけ。注記語・括弧・`明細ID` ラベル・数字列はそれぞれ元から1行に完全印字されている必要がある。3行以上に増えてもID内部を補修しない。
5. 注記は数量未印字の折り返し商品ID直後の、明示単価とコード付き商品計の間に限る。同じ認識元の折り返しID・注記ID・独立した元の完全な個別値引参照IDを、ゼロの桁数まで照合する。注記だけを参照IDの証拠にしない。別の認識元・画像領域から不足を借用しない。
6. 注記内の完全IDは行数にかかわらず物理的な1回と数える。注記1件と独立参照1件の計2件を要求し、別商品・別注記・別参照・折り返し商品の重複を隠さない。
7. 元のコード10〜14桁、単価／商品計の金額上限、数量1〜99の整数厳密一致、点数・税・会計照合、裸の値引額の局所的な円単位、ID／数量／単価／コードとの値衝突チェックを維持する。末尾の証拠が失われたときは依存する前の帰属確定も取り消す。

有効行数に新しい固定上限は設けず、元の購入領域と厳密な連続記号の構文を境界にする。3・4・8・32・128行を回帰で確認した。記号だけの中間行を開始行として再走査せず、結合と全体構文の検証は候補の終端で1回だけ行う。

変更するのは解析用コピーのみ。原文の改行・タブ・空白・ID・先頭ゼロ・価格順序と呼出元オブジェクトを保持する。注記終端などの一時根拠は商品行・分割計画・学習辞書へ保存しない。OCR呼び出しや保存項目を追加せず、schemaVersionは12を維持する。

## 検証結果

| テスト群 | 合格数/件数 |
| --- | ---: |
| 既存家計簿 | 61/61 |
| 既存OCR | 337/337 |
| 第1〜43段階の追加回帰・性能同等性回帰 | 5646/5646 |
| 今回の複数行境界記号・完全IDの回帰 | 482/482 |
| 影響範囲の隔離ブラウザ | 83/83 |

同一の新規482件は、基準版で370件合格・112件失敗、修正後は482件合格・失敗0。既存OCR337件は前後とも全件合格し、西友18/18・ヤオコー10/10・MEGA6/6を維持した。全追加回帰6128件は失敗・cancelled・skipとも0件。

隔離ブラウザ83件も失敗・cancelled・skipは0件。家計簿61件・既存OCR337件・全追加回帰6128件・ブラウザ83件を合わせ、重複実行を除く検証合計は6609件・全件合格。

前段階の同じ入力4件と既存ブラウザ1件は、今回の記号だけの中間行の条件に一致するため保留から採用へ期待値を変更した。それ以外の既存期待値は維持する。新規ブラウザは採用4件・保留4件。

保留時はID帰属を持たない未確定・低信頼候補、または候補なしであることを検証する。候補のチェックは未選択で、未確認の適用を拒否する。明示的な名前編集・確認後にフォームへ金額を反映しても自動分割計画は作らない。取引・IndexedDB・LocalStorageミラーと既存の学習辞書を保護する。

## 残存問題と保護

- 片側の継続記号欠落、中間の空行・数字・別項目、ID内部の分断、異なるID、重複や矛盾では手動確認が必要。
- 保留時に注記や価格ラベルが未確定商品候補として表示される既存の候補品質問題は残る。未確認の自動確定・自動分割は行わない。
- Android実機の処理速度・操作性、実画像における記号認識精度と店舗書式は未検証。ブラウザは模擬OCR・人工画像・新規コンテキスト・localhostと仮データだけで検証する。実データや実ブラウザプロファイルは開かない。
- `app.js`、`sw.js`、`index.html`、`styles.css`、manifestに変更はない。既存家計簿データや保存処理の初期化・migrationは行わない。
- mainは `e641912b6648757e39893659766b1de83dff8765`、Pages公開元は main `/` のlegacy構成。作業ブランチ以外の参照と公開設定は変更しない。

## 再実行と成果物

```powershell
node tests/run.cjs
node tests/compare-ocr.cjs multiline-scope-punctuation.test.cjs f8994caab7b280726322d492cce1ff04d38ac382
$regressionFiles = @(rg --files tests -g '*.test.cjs' | Where-Object { $_ -notmatch '(^|[\\/])mobile\.test\.cjs$' })
node --test --test-reporter=tap @regressionFiles
$nodeRoot=Split-Path (Split-Path (Get-Command node).Source)
$env:PLAYWRIGHT_MODULE_PATH=Join-Path $nodeRoot 'node_modules\playwright'
$env:BROWSER_PATH='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$env:BROWSER_TEST_TIMEOUT_MS='180000'
node --test --test-reporter=tap --test-name-pattern='^(?:mobile Chromium (?:(?:360|412)px|412-(?:gap|scope|identified|unbracketed|joined|punctuation|repeated|spaced|wrapped|multiline)-close-[^:]+px):|deferred OCR crops)' tests/mobile.test.cjs
Remove-Item Env:BROWSER_TEST_TIMEOUT_MS
node --check receipt.js
node --check tests/multiline-scope-punctuation.test.cjs
node --check tests/wrapped-scope-punctuation.test.cjs
node --check tests/mobile.test.cjs
git diff --check
```

ブラウザ全197件のうち、影響範囲83件を選択する。180秒はテスト待機上限だけでアプリ制限・テスト既定値は変更しない。新規8件の先行実行と比較・単独実行などの再実行分は総件数に重複加算しない。

成果物は `.test-artifacts` の `multiline-scope-punctuation-comparison.json`、`before-multiline-scope-punctuation.tap`、`after-multiline-scope-punctuation.tap`、`phase44-regression.tap`、`phase44-mobile-new.tap`、`phase44-mobile.tap`、`phase44-review.json`、`phase44-remote-before.json`、`phase44-remote-after.json`（Git管理対象外）。

## 変更ファイル

| ファイル | 内容 |
| --- | --- |
| receipt.js | 記号だけの中間行を厳密に検証し、元の購入領域内で注記終端を特定 |
| tests/multiline-scope-punctuation.test.cjs | 新規回帰482件 |
| tests/wrapped-scope-punctuation.test.cjs | 同じ入力4件の期待値更新 |
| tests/mobile.test.cjs | 新規8件と既存1件の期待値更新、手動保留と保存保護の検証 |
| docs/3行以上に分断された境界記号と完全IDの調査と修正.md | 本文書 |
| README.md | 調査結果と回帰への入口 |
