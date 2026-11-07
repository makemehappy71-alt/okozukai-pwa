# 値引ラベルと金額が別行の明細IDの調査と修正（第26段階）

日付: 2026-11-08 / ブランチ: `codex/receipt-ocr-improvement`
基準: `b547a057accb555396961bfcd39e589640960a30`

人工OCR文字列・模擬worker・隔離ブラウザの仮データで再検証した。実画像・実店舗書式・Android実機での再現ではない。商品名・コード・金額はテスト用で、学習辞書へ追加しない。

## 再現した問題

基準版は値引ラベルと金額が同じ行にあることを前提とし、以下のようにラベルと金額が別行になると、同じ認識元の完全な商品IDで一意に照合でき、会計も整合する場合でも保留する。

```text
緑茶 (明細ID A101)
2200083271771 1 ¥1,000
…
(明細ID A101
) 値引
¥100
```

通常の1行ID、ID末尾文字と閉じ括弧が同じ行の形、閉じ括弧だけが別行の形、独立した値引ラベル行でも再現した。「商品」「単品」の注記がID・ラベルと同じ行、または独立した行の場合も対象にした。

## 修正と安全条件

`receiptDiscountLabelOnly` は、明示された値引・割引・値引額・割引額・値下額・値下げ額と、既存の個別商品を示す語だけを厳密に判定する。未知の注記、値引前・値引後価格、値下後価格と区別できない「値下」、値引合計、率だけの表記は対象外とする。

`receiptDiscountCurrencyOnly` は、独立した金額行に「¥」または「円」を必須とし、単一の整数金額、桁区切り、既存の値引額上限（1〜100000円）を検証する。「100」のような裸の数字を数量・コードと区別したと推定しない。スペース・タブ・全角の正規化と、既存の値引負号表記は扱うが、文字や小数・不正な桁を補修しない。

継続処理を `receiptDiscountContinuation` に整理し、連続する注記・ラベル・通貨表記付き金額を最大3行だけ読む。従来の「注記の次行にラベルと金額がそろう」処理も維持する。直後にも金額・裸の数値の候補が続く場合は、複数候補から一方を選ばず保留する。

IDは従来どおり16文字以内・最大16個の非空断片を維持する。最長の場合はID断片16行に、閉じ括弧・注記・ラベル・金額の4行が続く計20行になる。探索は固定した参照構造内に限定し、空行・タブだけの行・別商品・別ID・税・価格・注記などを読み飛ばさない。

採用には以下もすべて必要とする。

- 同じ認識元に、折り返しのない完全なIDを持つ商品名・数量・価格付き明細が一意に存在する。別OCRパス・結合テキスト・任意のIDラベル・学習辞書を根拠の代わりにしない。
- IDの括弧が対応し、注記にも括弧がある場合はその対応も正しい。商品名を参照の前に持つ行や、括弧のないIDへ新しい例外を広げない。
- 空白付きIDとの競合や重複がなく、復元後も対象が一意である。両側の折り返しを自己証明させない。
- 印字点数・小計・税・値引・支払額とOCRパス間の割当整合性を検証する。

「商品対象外」「単品取消」などの追加条件や、複数の対象語を削除しない。金額行の単価・数量・別ID・注記・率・複数金額も受け付けない。元の正規化済みOCR原文・ラベル・金額・タブ・改行と呼出元オブジェクトを保持し、解析用コピーだけを結合する。保存用計画・取引・学習辞書の項目は追加しない。

## 検証結果

| テスト群 | 合格数/件数 |
| --- | ---: |
| 既存家計簿 | 61/61 |
| 既存OCR | 337/337 |
| 第1〜25段階の追加回帰・性能同等性回帰（今回の期待更新2件を含む） | 1478/1478 |
| 今回の別行ラベル・金額の回帰 | 126/126 |
| モバイル操作・実canvas画像一致 | 63/63 |
| 合計 | **2065/2065** |

同じ新規126件を基準版へ適用すると74/126件合格、修正後は126/126件合格で、52件の失敗を解消した。
第22段階の82件と第25段階の105件では、ラベルの直後に明示的な金額行がある各1件の期待値だけを、保留から復元確認へ更新した。入力を変えず、それぞれの総数と他の既存期待値を維持した。
既存OCR337件は前後とも合格し、西友18/18、ヤオコー10/10、MEGA6/6、オーケー101円等の回帰を維持した。

新規回帰は、1行ID・閉じ括弧だけが別行のID・末尾文字付き閉じ括弧行、ラベルが同じ行・独立行の形、商品・単品・括弧付き独立注記、各値引ラベル、¥・円・負号・全角・タブ、各ID括弧、4・16断片と最長20行、16文字の初行、値部分の括弧、記号・数字ID、商品直後の値引、LF/CRLF/CR、単一値引・税配分・原文・入力保持を検証した。
保留側は、未知のラベル・前後価格・値下表記・合計・クーポン・会員・率・取消、裸の数字・ゼロ・上限超過・桁誤り・単価・数量・コード・追加ID・注記・複数金額候補、空行・タブだけの行・別商品・別ID・税・価格、追加条件・複数の対象語、IDの括弧不足・内部タブ・行末空白・17断片、完全な商品ID不足・別パス・結合テキスト・競合・重複・会計不足・OCR間矛盾を検証した。価格表記を値引として採用しないことも確認し、従来の価格判定の警告フラグ自体は変更しない。
フッター・学習辞書による迂回も止める。模擬workerの3件では折り返しID・1行IDと独立注記行の復元、値引後価格を値引として採用しないこと、終了1回・保存書込0回を確認した。仮の既存取引・辞書・schemaVersion 12も維持した。

412pxのブラウザケースを4件追加した。

1. ID末尾文字付きの閉じ括弧行と閉じ括弧だけの行から、独立した「¥100」「200円」を照合し、値引100円/200円・支払900円/800円で分割する。
2. 通常の1行ID・独立した注記・ラベル・金額行、および同じ行の対象語とラベルでも同じ結果で分割する。
3. A101とA 101が競合する場合は保留・警告とし、商品名を手入力しても分割計画を作らない。
4. 金額候補「¥100」「¥200」が連続する場合は保留・警告とし、商品名を手入力しても分割計画を作らない。

原文のラベル・金額・改行、照合案内、保存用計画にIDを含めないこと、仮の取引・学習辞書・IndexedDB/LocalStorageの保持も確認した。従来の360px・412pxケースと実canvas画素一致も合格した。ブラウザは新規の隔離プロファイルとlocalhostを使い、OCRは模擬である。Android実機の性能測定ではない。

## 残存条件・保護範囲

- 通貨表記のない独立した数字、連続する複数の金額候補、ラベルや金額自体の欠損・不正な桁、追加条件や未知の注記、行を挟む印字は新しい対象に含めない。
- 同じ認識元の完全なID・一意な対応・会計の整合性が欠ける場合は手動確認を残す。複数の別行参照が同じIDを共有する場合も重複候補の保留条件を維持する。
- 実画像の印字位置・店舗書式・認識率、Android実機の速度・カメラ・メモリ・操作性は未検証。
- app.js、schemaVersion 12、保存処理・キー、学習辞書、Service Worker、公開バージョンは変更しない。実データは開かず、仮データだけを使う。
- 指定作業ブランチだけへ反映する。main・公開中のGitHub Pages・無関係なZIP・Git管理対象外のテスト成果物は変更対象外。

## 再現コマンド

```powershell
node tests/run.cjs
node --test --test-reporter=tap tests/regression.test.cjs tests/performance.test.cjs tests/ocr-remaining.test.cjs tests/ok-101.test.cjs tests/quantity-tax.test.cjs tests/mixed-tax.test.cjs tests/product-code.test.cjs tests/separate-discount.test.cjs tests/multiple-discount.test.cjs tests/repeated-product.test.cjs tests/printed-line-id.test.cjs tests/printed-id-layout.test.cjs tests/wrapped-alpha-id.test.cjs tests/separator-id.test.cjs tests/bounded-complex-id.test.cjs tests/split-control-id.test.cjs tests/wrapped-id-recovery.test.cjs tests/unmarked-id-wrap.test.cjs tests/long-id-wrap.test.cjs tests/separate-id-close.test.cjs tests/padded-id-close.test.cjs tests/id-close-discount.test.cjs tests/id-close-note.test.cjs tests/bare-id-scope.test.cjs tests/split-id-scope.test.cjs tests/split-discount-amount.test.cjs
node tests/compare-ocr.cjs split-discount-amount.test.cjs b547a057accb555396961bfcd39e589640960a30
node --test --test-reporter=tap tests/mobile.test.cjs
node --check receipt.js
git diff --check
```

ブラウザにはPlaywrightとChromium系ブラウザを指定する。比較結果は `.test-artifacts/split-discount-amount-comparison.json`、TAP・ブラウザ記録も同ディレクトリに出力する（Git管理対象外）。

## 変更ファイル

| ファイル | 内容 |
| --- | --- |
| receipt.js | ラベルだけ・通貨表記付き金額だけの厳密な判定、連続する参照行の照合、複数候補の保留 |
| tests/split-discount-amount.test.cjs | 新規回帰126件 |
| tests/id-close-discount.test.cjs | ラベル・金額の別行印字1件の期待更新 |
| tests/split-id-scope.test.cjs | 注記・ラベル・金額の別行印字1件の期待更新 |
| tests/mobile.test.cjs | 折り返し・1行・競合・複数金額の操作4ケース |
| docs/値引ラベルと金額が別行の明細IDの調査と修正.md | 本文書 |
| README.md | 調査結果とテストへの入口 |
