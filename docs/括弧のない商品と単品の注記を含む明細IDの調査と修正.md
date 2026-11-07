# 括弧のない商品と単品の注記を含む明細IDの調査と修正（第24段階）

日付: 2026-11-08 / ブランチ: `codex/receipt-ocr-improvement`
基準: `3b29c364d97dc6105f5eaab5590412afdf4b69bd`

人工OCR文字列・模擬worker・隔離ブラウザの仮データで再検証した。実画像・実店舗書式・Android実機での再現ではない。商品名・コード・金額はテスト用で、学習辞書へ追加しない。

## 再現した問題

基準版は「商品値引」「単品値引」と、括弧付きの「(商品) 値引」「(単品) 値引」を解析できる。ただし、括弧のない語と値引ラベルがスペース・タブで分かれると、同じ認識元の完全な商品IDで一意に照合でき、会計も整合していても保留する。通常の1行IDと折り返しIDの両方で再現した。

```text
緑茶 (明細ID A101)
2200083271771 1 ¥1,000
…
(明細ID A101
) 単品 値引 ¥100
```

語とラベルの間にタブがある場合も同じ問題になる。ID内部のタブとは区別する。

## 修正と安全条件

既存の `receiptDiscountScopeNote` に、「商品」「単品」と明示された値引ラベルがスペース・タブで分かれる書式を追加した。語の完全一致、直後の値引・割引・値引額・割引額・値下額・値下げ額、単一の整数金額、既存の金額上限をすべて必要とし、解析用表記だけを既存の「商品値引」「単品値引」等へ変換する。

通常の1行IDでは、対応する括弧のあるIDを解析する位置で注記を共通処理へ渡す。括弧のないIDへ新しいスペース付き表記の例外を広げず、括弧付き注記と従来の直接結合した「商品値引」の動作を維持する。
折り返しIDでは、閉じ括弧の後を同じ共通処理へ渡し、既存の厳密な値引額行の照合へ接続する。新しい店舗別例外は追加しない。

以下の条件を維持した。

- 同じ認識元に、折り返しのない完全なIDを持つ商品名・数量・価格付き明細が一意に存在する。別OCRパス・結合テキスト・任意のIDラベル・学習辞書を根拠の代わりにしない。
- 空白付きIDとの競合や重複がなく、復元後も対応が一意である。両側の折り返しを自己証明させない。
- IDは16文字以内、探索は最大16個の非空ID断片と直後の閉じ括弧行まで。ID内部のタブ・空白・欠損文字・記号を補修せず、空行・別情報を読み飛ばさない。
- 印字点数・小計・税・値引・支払額とOCRパス間の割当整合性を検証する。語が認識できるだけで自動確定しない。

「商品対象外」「単品取消」「商品 次回用」、金額・率・個数・追加IDを含む注記、複数の語・追加条件は認めない。裸の金額・値引後価格・値引合計、注記や値引額自体が別行のものも新しい対象に含めない。
元の正規化済みOCR原文・注記・スペース・タブ・改行、呼出元オブジェクトは保持する。保存用計画・取引・学習辞書へIDや解析表記の新項目を追加しない。

## 検証結果

| テスト群 | 合格数/件数 |
| --- | ---: |
| 既存家計簿 | 61/61 |
| 既存OCR | 337/337 |
| 第1〜23段階の追加回帰・性能同等性回帰 | 1262/1262 |
| 今回の括弧のない注記の回帰 | 111/111 |
| モバイル操作・実canvas画像一致 | 55/55 |
| 合計 | **1826/1826** |

同じ新規111件を基準版へ適用すると70/111件合格、修正後は111/111件合格で、41件の失敗を解消した。既存テストの件数・入力・期待値は変更していない。
既存OCR337件は前後とも合格し、西友18/18、ヤオコー10/10、MEGA6/6、オーケー101円等の回帰を維持した。

新規回帰は、1行ID・折り返しID、商品・単品、スペース・タブ・全角スペース、各値引ラベル、各ID括弧、4・16断片、16文字の初行、値部分の括弧、記号ID、LF/CRLF/CR、単一値引・税配分・複数値引、完全な参照と折り返し商品の照合、原文・入力保持を検証した。従来の括弧付き注記・直接結合した個別値引も対象に含めた。
保留側は、類似語・対象外・取消・次回用・注記・個数・金額・率・追加ID・複数の語、裸の金額・値引後価格・値引合計・ゼロ・上限超過・桁誤り・複数金額・別行の注記や値引額、垂直タブ・ゼロ幅文字、IDの括弧不足・内部タブ・行末空白・17断片、完全な商品ID不足・別パス・結合テキスト・競合・重複・会計不足・OCR間矛盾を検証した。
フッター・学習辞書による迂回も止める。模擬workerの3件では折り返し・1行の注記解析と「商品対象外」の保留、終了1回・保存書込0回を確認した。仮の既存取引・辞書・schemaVersion 12も維持した。

412pxのブラウザケースを4件追加した。

1. 折り返し参照の「単品＋タブ＋値引」「商品 値引」を完全な商品IDと照合し、値引100円/200円・支払900円/800円で分割する。
2. 通常の1行IDでも同じ結果で分割し、折り返し復元の案内は表示しない。
3. A101とA 101が競合する場合は保留・警告とし、商品名を手入力しても分割計画を作らない。
4. 「商品対象外」がある場合は保留・警告とし、商品名を手入力しても分割計画を作らない。

原文の注記・タブ・改行、照合案内、保存用計画にIDを含めないこと、仮の取引・学習辞書・IndexedDB/LocalStorageの保持も確認した。従来の360px・412pxケースと実canvas画素一致も合格した。ブラウザは新規の隔離プロファイルとlocalhostを使い、OCRは模擬である。Android実機の性能測定ではない。

## 残存条件・保護範囲

- 「商品」「単品」以外の注記・追加条件を削除したり、意味を推定したりしない。注記や値引額自体の折り返し、複数条件、ID内部の欠損は新しい対象に含めない。
- 同じ認識元の完全なID・一意な対応・会計の整合性が欠ける場合は手動確認を残す。同じIDの折り返し参照が複数ある場合も、既存の重複候補の保留条件を維持する。
- 実画像の印字位置・店舗書式・認識率、Android実機の速度・カメラ・メモリ・操作性は未検証。
- app.js、schemaVersion 12、保存処理・キー、学習辞書、Service Worker、公開バージョンは変更しない。実データは開かず、仮データだけを使う。
- 指定作業ブランチだけへ反映する。main・公開中のGitHub Pages・無関係なZIP・Git管理対象外のテスト成果物は変更対象外。

## 再現コマンド

```powershell
node tests/run.cjs
node --test --test-reporter=tap tests/regression.test.cjs tests/performance.test.cjs tests/ocr-remaining.test.cjs tests/ok-101.test.cjs tests/quantity-tax.test.cjs tests/mixed-tax.test.cjs tests/product-code.test.cjs tests/separate-discount.test.cjs tests/multiple-discount.test.cjs tests/repeated-product.test.cjs tests/printed-line-id.test.cjs tests/printed-id-layout.test.cjs tests/wrapped-alpha-id.test.cjs tests/separator-id.test.cjs tests/bounded-complex-id.test.cjs tests/split-control-id.test.cjs tests/wrapped-id-recovery.test.cjs tests/unmarked-id-wrap.test.cjs tests/long-id-wrap.test.cjs tests/separate-id-close.test.cjs tests/padded-id-close.test.cjs tests/id-close-discount.test.cjs tests/id-close-note.test.cjs tests/bare-id-scope.test.cjs
node tests/compare-ocr.cjs bare-id-scope.test.cjs 3b29c364d97dc6105f5eaab5590412afdf4b69bd
node --test --test-reporter=tap tests/mobile.test.cjs
node --check receipt.js
git diff --check
```

ブラウザにはPlaywrightとChromium系ブラウザを指定する。比較結果は `.test-artifacts/bare-id-scope-comparison.json`、TAP・ブラウザ記録も同ディレクトリに出力する（Git管理対象外）。

## 変更ファイル

| ファイル | 内容 |
| --- | --- |
| receipt.js | 括弧のない商品・単品の注記を共通解析し、閉じ括弧付きの値引参照へ接続 |
| tests/bare-id-scope.test.cjs | 新規回帰111件 |
| tests/mobile.test.cjs | 折り返し・1行・競合・対象外の操作4ケース |
| docs/括弧のない商品と単品の注記を含む明細IDの調査と修正.md | 本文書 |
| README.md | 調査結果とテストへの入口 |
