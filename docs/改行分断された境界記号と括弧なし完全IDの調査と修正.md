# 改行分断された境界記号と括弧なし完全IDの調査と修正（第43段階）

日付: 2026-11-09 / ブランチ: `codex/receipt-ocr-improvement`
基準: `e92a95edaef6e537ba06052a4f9989a28b38b260`

人工OCR文字列・模擬worker・隔離ブラウザの仮データで検証した。実画像・実店舗書式・Android実機での再現は未検証。テストの商品や金額を学習辞書へ追加しない。

## 再現した問題

第42段階は同じ行内で空白・タブが入った境界記号列を扱っていた。記号列の途中で改行すると、同じ認識元に完全ID・単価・商品計・値引参照が残る場合も保留していた。

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
:明細ID000200
2200083271771 ¥1,000
(明細ID 000200) 値引
¥200
小計 3点 ¥1700
合計 ¥1700
楽天ペイ ¥1700
```

次商品の数量は未印字だが、元の商品ID・注記の完全ID・元から完全な独立値引参照は `000200` で一致する。単価500円と商品計1000円から数量2を確認できる。この例で1つ目の値引100円と2つ目の値引200円の終端・帰属を確認できなかった。逆順の価格項目、逆順のIDと注記、ハイフン・混在記号でも再現した。

## 修正と安全条件

`receiptWrappedQuantityScopeMarker` を追加し、次の条件に合う注記だけ、解析用コピー上で2行の境界記号を扱う。

1. 隣接する2行だけを対象に、前行末と次行頭の両方にコロンまたはハイフンの実印字を要求する。記号と行端の間は水平空白・タブだけを許容する。
2. 2行を解析上のスペース1文字で結んだ全体が既存の厳密な注記書式に一致すること。改行できるのは商品／単品と完全IDとの境界記号列内だけ。`明細ID` ラベルと数字列は元から1行に完全に印字されていなければならない。
3. 注記ブロックは、数量印字のない折り返し商品IDの直後にある、明示単価とコード付き商品計の間に限る。単価先行・商品計先行のどちらでも、値引参照との間に別行・空行を読み飛ばさない。
4. 同じ認識元の折り返し商品ID・注記ID・独立した元の完全な個別値引参照IDを先頭ゼロの桁数まで照合する。注記だけを完全IDの証拠にしない。別の認識元や別の画像領域から不足を借用しない。
5. 完全IDの物理的な出現は注記1件と独立値引参照1件の計2件を要求する。2行にまたがる注記内の完全IDは1件として数え、別の注記・商品・参照の重複は隠さない。
6. 既存の商品コード10〜14桁・単価／商品計の上限・数量1〜99の整数厳密一致・数量／税／会計照合・値引額の局所的な円単位・金額と数量／単価／ID／コードの衝突チェックを維持する。末尾の証拠が失われた場合は依存する前の商品・値引の確定も取り消す。

元の文字列や呼出元オブジェクトを変更しない。追加した注記終端は解析内の一時情報だけで、商品行・分割計画・学習辞書へ保存しない。OCR呼び出し・データ保存項目・schemaVersionの変更はない。

片側にしか継続記号がない例、3行以上の注記、途中の空行・価格・商品行、IDラベル／数字内部の分断、未知の区切り、重複／別ID、認識元間の矛盾は保留する。汎用的な改行削除やID修復は行わない。

## 検証結果

| テスト群 | 合格数/件数 |
| --- | ---: |
| 既存家計簿 | 61/61 |
| 既存OCR | 337/337 |
| 第1〜42段階の追加回帰・性能同等性回帰 | 5304/5304 |
| 今回の改行分断・境界記号・完全IDの回帰 | 342/342 |
| 影響範囲の隔離ブラウザ | 75/75 |

同一の新規342件は基準版で250件合格・92件失敗、修正後は342件合格・失敗0。既存OCR337件は前後とも全件合格し、西友18/18・ヤオコー10/10・MEGA6/6を維持した。全追加回帰5646件の失敗・cancelled・skipは0件。

ブラウザ75件も失敗・cancelled・skipは0件。家計簿61件・既存OCR337件・全追加回帰5646件・ブラウザ75件を合わせ、重複実行を除く合計は6119件・全件合格。

第42段階の同じ入力8件と既存ブラウザ1件は、今回の両側継続記号の条件に一致するため期待値を保留から採用へ変更した。それ以外の既存テストの期待値は維持する。新規画面ケースは採用4件・保留4件。

保留時の候補表示は、空配列か、IDの帰属がない未確定・低信頼の候補であることを検証する。候補が表示される場合もチェックは未選択とし、未確認の適用を拒否する。明示的に名前を修正・確認してから金額をフォームへ反映しても、自動分割計画は作らない。前段階で確認した低信頼候補の表示品質の問題は今回の修正対象に含めない。

## 残存問題と保護

- 片側だけの継続記号や3行以上の注記など、根拠が不足する書式は引き続き手動確認が必要。
- 保留時に注記や価格ラベルが未確定商品候補として表示される既存の候補品質問題は残る。未確認の自動確定・自動分割は行わない。
- Android実機の処理速度・操作性、実画像での記号認識精度や店舗書式の適用範囲は未検証。ブラウザ検証は模擬OCRと人工画像を使う。
- 実データ・実ブラウザプロファイルは開かず、仮データ・新規ブラウザコンテキスト・localhostのみで検証する。既存取引、IndexedDB、LocalStorageのミラー、学習辞書の保護を検査する。
- `app.js`、`sw.js`、`index.html`、`styles.css`、manifestは変更せず、schemaVersionは12を維持する。
- mainは `e641912b6648757e39893659766b1de83dff8765`、Pages公開元は main `/` のlegacy構成。作業ブランチ以外の参照や公開設定を変更しない。

## 再実行と成果物

```powershell
node tests/run.cjs
node tests/compare-ocr.cjs wrapped-scope-punctuation.test.cjs e92a95edaef6e537ba06052a4f9989a28b38b260
$regressionFiles = @(rg --files tests -g '*.test.cjs' | Where-Object { $_ -notmatch '(^|[\\/])mobile\.test\.cjs$' })
node --test --test-reporter=tap @regressionFiles
$nodeRoot=Split-Path (Split-Path (Get-Command node).Source)
$env:PLAYWRIGHT_MODULE_PATH=Join-Path $nodeRoot 'node_modules\playwright'
$env:BROWSER_PATH='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$env:BROWSER_TEST_TIMEOUT_MS='180000'
node --test --test-reporter=tap --test-name-pattern='^(?:mobile Chromium (?:(?:360|412)px|412-(?:gap|scope|identified|unbracketed|joined|punctuation|repeated|spaced|wrapped)-close-[^:]+px):|deferred OCR crops)' tests/mobile.test.cjs
Remove-Item Env:BROWSER_TEST_TIMEOUT_MS
node --check receipt.js
node --check tests/wrapped-scope-punctuation.test.cjs
node --check tests/spaced-scope-id-punctuation.test.cjs
node --check tests/mobile.test.cjs
git diff --check
```

ブラウザ全189件のうち、影響範囲75件を選択する。180秒はテスト待機上限だけで、アプリの制限やテスト既定値を変更しない。新規8件の先行実行と、比較・単独実行の再実行分は総件数に重複加算しない。

成果物は `.test-artifacts` の `wrapped-scope-punctuation-comparison.json`、`before-wrapped-scope-punctuation.tap`、`after-wrapped-scope-punctuation.tap`、`phase43-regression.tap`、`phase43-mobile-new.tap`、`phase43-mobile.tap`、`phase43-remote-before.json`、`phase43-remote-after.json`（Git管理対象外）。

## 変更ファイル

| ファイル | 内容 |
| --- | --- |
| receipt.js | 両側継続記号のある2行注記の検証、物理ID数と注記終端の管理 |
| tests/wrapped-scope-punctuation.test.cjs | 新規回帰342件 |
| tests/spaced-scope-id-punctuation.test.cjs | 同じ入力8件の期待値更新 |
| tests/mobile.test.cjs | 新規8件と既存1件の期待値更新、保留候補の手動確認と保存保護 |
| docs/改行分断された境界記号と括弧なし完全IDの調査と修正.md | 本文書 |
| README.md | 調査結果と回帰への入口 |
