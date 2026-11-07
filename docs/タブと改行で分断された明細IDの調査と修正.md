# タブと改行で分断された明細IDの調査と修正（第16段階）

日付: 2026-11-07 / ブランチ: `codex/receipt-ocr-improvement`
基準: `a868cc27a7c6b44b473c30261d9e4b4f1f46152d`

人工OCR文字列・模擬worker・隔離ブラウザの仮データで、タブや改行による明細IDの分断と値引帰属を調査した。新しい実画像・実店舗の印字形式は検証していない。テストの商品名・コード・価格は仮の組合せで、辞書へ追加していない。

## 確認結果と再現した問題

ID内部のタブ、LF改行、CRLF改行を含むケースは、基準版でも帰属を自動確定しなかった。これらを推測で連結する処理は追加しない。

単独のCR（`\r`）は、前処理が削除していた。そのため、次のようなIDが別の文字列へ変わる。

```text
実際の入力: A\r101
基準版での値: A101
```

商品側の `(明細ID A\r101)` と、値引参照側の `(明細ID A\r101) 値引 ¥100` の両方で、分断された文字を結合し、値引先を自動確定する問題を再現した。正常に読めた別パスを併用した場合にも、CRを含む認識記録の不足を迂回してしまう。
また、レシート全体がCRだけで行を区切っている場合、行を連結してしまい正常な明細を抽出できない。

## 修正

本体の修正は正規化の1か所に限定した。

```text
従来: CRを削除
修正: CRLFと単独CRを、いずれもLF改行へ統一
```

Windows形式のCRLFは従来と同じ1改行に保ち、単独CRも行の境界として残す。これにより、ID内部のCRが文字の連結に変わらず、不完全なIDとして確認保留になる。
CRが通常の明細行の区切りである場合は、それぞれの行にある完全なID・商品・値引を既存の処理で照合できる。

タブは位置を区別して検証した。

- `明細ID\tA101` のようなラベルと値の間、商品名と番号欄の間、値の外側の構文上の余白は、既存のレイアウト区切りとして維持する。
- `(明細ID A\t101)` のようなID内部のタブは、有効なIDへ結合・置換せず確認保留にする。
- LF・CR・CRLF等で内部が分断されたIDも、括弧が別行で閉じていることだけを理由に再結合しない。

商品側・値引参照側のいずれかが不完全な場合、一般的な値引按分や学習辞書へ戻して自動確定しない。印字点数・小計・税額・支払額が一致しても、IDの帰属根拠の不足は解消したと扱わない。

## テスト結果

| テスト群 | 合格数/件数 |
| --- | ---: |
| 既存家計簿 | 61/61 |
| 既存OCR | 337/337 |
| 第1〜15段階の追加回帰・性能同等性回帰 | 712/712 |
| 今回のタブ・改行分断ID回帰 | 45/45 |
| モバイル操作・実canvas画像一致 | 29/29 |
| 合計 | **1184/1184** |

同じ新規45件を基準版へ適用すると30/45件合格、修正後は45/45件合格。15件の失敗を解消した。既存テストの期待値は変更していない。
既存OCR337件は前後とも合格し、西友18/18、ヤオコー10/10、MEGA6/6とオーケー等の回帰を維持した。

新規回帰では、タブ・LF・CR・CRLF・空行について、商品ID、値部分の括弧、値引行の前後の参照、単一参照を検証した。
正常なLF/CR/CRLF区切りのレシート、レイアウト用のタブ、CRLFとLFのOCR間照合、数字・記号・空白を含むIDのCR分断、ラベルの分断、元価格への誤流用、前処理からの切り詰め防止、別パス・学習辞書での迂回防止も検証した。
模擬workerの4ケースで、レイアウト用タブは正しく照合し、ID内部のタブ・CR・LFは保留になること、終了1回・保存書込0回を確認した。仮の既存取引・辞書とschemaVersion 12も維持した。

ブラウザには412pxの4ケースを追加した。

1. ラベルと値の間のタブを区切りとして読み、A101/B102を値引100円/200円・支払900円/800円で分割する。
2. CR区切りの明細を同じ結果で抽出・確認・分割する。
3. 値引参照のID内部がCRで分断された場合、商品候補全体を保留して警告し、商品名を手入力しても分割計画を作らない。
4. 同じくID内部がタブで分断された場合も、商品候補を保留し、手入力後も分割計画を作らない。

従来の360px・412px、各ID形式・値引・値下・税配分と実canvas画素一致も検証した。隔離ブラウザの仮の取引・辞書・IndexedDB/LocalStorageを保持し、保存用計画へIDを追加しないことも確認した。OCRは模擬であり、実機性能測定ではない。

## 保護範囲と残存問題

- schemaVersion 12、app.js、保存処理・キー、学習辞書、Service Worker、公開バージョンを変更しない。実データを開かず仮データだけで検証した。
- 指定作業ブランチだけへ反映し、mainと公開中のGitHub Pagesは変更しない。無関係なZIPとテスト成果物は対象外。
- タブや改行で分断されたIDの自動復元は未対応。改行が印字の折返しなのか、別情報との境界なのか、テキストだけでは十分な根拠がないため再結合しない。
- CRを改行へ統一する修正であり、タブをIDの一部として受け入れたり、改行を空白や無文字へ変えて照合したりする拡張はしていない。
- 実画像での認識率、実店舗の折返し形式、Android実機の速度・カメラ・メモリ・操作性は未検証。

## 再現コマンド

```powershell
node tests/run.cjs
node --test tests/regression.test.cjs tests/performance.test.cjs tests/ocr-remaining.test.cjs tests/ok-101.test.cjs tests/quantity-tax.test.cjs tests/mixed-tax.test.cjs tests/product-code.test.cjs tests/separate-discount.test.cjs tests/multiple-discount.test.cjs tests/repeated-product.test.cjs tests/printed-line-id.test.cjs tests/printed-id-layout.test.cjs tests/wrapped-alpha-id.test.cjs tests/separator-id.test.cjs tests/bounded-complex-id.test.cjs tests/split-control-id.test.cjs
node tests/compare-ocr.cjs split-control-id.test.cjs a868cc27a7c6b44b473c30261d9e4b4f1f46152d
node --test tests/mobile.test.cjs
node --check receipt.js
git diff --check
```

ブラウザにはPlaywrightとChromium系ブラウザを指定する。比較JSONは `.test-artifacts/split-control-id-comparison.json`、TAP・ブラウザ記録も同ディレクトリへ出力する（Git管理対象外）。

## 変更ファイル

| ファイル | 内容 |
| --- | --- |
| receipt.js | 単独CRを削除せず改行として保持 |
| tests/split-control-id.test.cjs | 新規回帰45件 |
| tests/mobile.test.cjs | タブ区切り・CR明細行・CR/TABで分断された参照の操作4ケース |
| docs/タブと改行で分断された明細IDの調査と修正.md | 本文書 |
| README.md | 調査結果とテストへの入口 |
