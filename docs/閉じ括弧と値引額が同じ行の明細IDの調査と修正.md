# 閉じ括弧と値引額が同じ行の明細IDの調査と修正（第22段階）

日付: 2026-11-07 / ブランチ: `codex/receipt-ocr-improvement`
基準: `b7796c33573faee0771afed50488c2e5e41779b4`

人工OCR文字列・模擬worker・隔離ブラウザの仮データで再検証した。実画像・実店舗書式・Android実機での再現ではない。テストの商品名・コード・金額は学習辞書へ追加しない。

## 再現した問題

基準版は閉じ括弧だけの行を復元できるが、ID文字が前行で終わり、次行が「閉じ括弧＋値引額」の場合は対象外になる。同じ認識元に完全な商品IDがあり、一意に対応し、会計も整合する場合でも保留になる。

```text
緑茶 (明細ID A101)
2200083271771 1 ¥1,000
…
(明細ID A101
) 値引 ¥100
```

値引参照のID自体が複数行で、最終行にID文字を持たないケースでも再現した。

```text
(明細ID A
101
) 値引 ¥100
```

## 修正と安全条件

`receiptRecoverWrappedIds` に「対応する閉じ括弧1個＋明示された個別値引額」の最終行を追加した。新しい判定は、値引・割引・値引額・割引額・値下額・値下げ額、および商品・単品を先頭に付ける表記と、単一の整数金額だけを対象にする。スペース・タブ、コロン、通貨記号、負号、円表記は限定した書式内で扱い、全角文字には従来のNFKC正規化を使う。

連結した結果が明細ID付きの値引参照として解析でき、IDが連結した文字列と完全一致し、正の値引額として既存の上限チェックを通ることを必要とする。商品名が括弧の前にある場合や、括弧の両側に値引額がある場合は、新しい値引参照へ読み替えない。

以下の既存条件もすべて維持した。

- 同じ認識元に、折り返しのない完全なIDを持つ商品名・数量・価格付き明細が1件だけ存在する。任意のIDラベル、別OCRパス、結合テキスト、学習辞書を代わりの根拠にしない。
- 空白付きの別IDとの競合や重複がなく、復元後も明細の対応が一意である。両側の折り返しを自己証明させない。
- IDは16文字以内。最大16個の非空ID断片と直後の閉じ括弧行までで探索を止める。17文字目・17個目の断片を切り捨てない。
- ID内部のタブ、行末空白、不正な記号を補修せず、文字・記号・大文字小文字・先頭ゼロを推定しない。空行・タブだけの行・別情報を読み飛ばさない。
- 印字点数・小計・税・値引・支払額とOCRパス間の割当整合性を検証する。復元だけで自動確定しない。

裸の金額、値引前・値引後価格、値下後価格と区別できない値下表記、値引合計、率だけ、ゼロ・上限超過・不正な桁区切り、複数金額、注記、追加IDなどを新しい対象に含めない。
元の正規化済みOCR原文・タブ・改行と呼出元オブジェクトを保持し、解析用コピーだけを復元する。保存用計画・取引・学習辞書にIDや復元情報の新項目を追加しない。

## 検証結果

| テスト群 | 合格数/件数 |
| --- | ---: |
| 既存家計簿 | 61/61 |
| 既存OCR | 337/337 |
| 第1〜21段階の追加回帰・性能同等性回帰（今回の期待更新1件を含む） | 1070/1070 |
| 今回の閉じ括弧・値引額同一行の回帰 | 82/82 |
| モバイル操作・実canvas画像一致 | 47/47 |
| 合計 | **1597/1597** |

同じ新規82件を基準版へ適用すると50/82件合格、修正後は82/82件合格で、32件の失敗を解消した。
既存OCR337件は前後とも合格し、西友18/18、ヤオコー10/10、MEGA6/6、オーケー101円等の回帰を維持した。
第20段階の67件では、完全な商品IDと会計の根拠を持つ「閉じ括弧＋値引額」の1件だけを保留から復元確認へ更新した。入力を変えず、総数67件と他の既存期待値を維持した。

新規回帰は、各値引ラベル、各括弧、余白なし・スペース・タブ・全角、コロン・円・負号、4・16個のID断片、16文字の初行、値部分の括弧、記号・数字ID、LF/CRLF/CR、単一値引、税配分、原文・入力保持を検証した。
保留側は、完全な商品ID不足、商品名・価格のないIDラベル、両側の折り返し、別パス・結合テキストでの根拠の混入、空白付きIDの競合、表記違い、括弧違い・重複、裸の金額・前後価格・合計・クーポン・率・ゼロ・上限超過・桁誤り・注記・複数金額・追加ID、別行の値引額・空行・別情報、ID内部タブ・行末空白・17文字・17断片、重複商品ID、会計不足・パス間矛盾を検証した。
フッター・学習辞書による迂回も止める。模擬workerの3件では通常・タブ付きの値引額行の復元とID内部タブの保留、終了1回・保存書込0回を確認した。仮の既存取引・辞書・schemaVersion 12も維持した。

412pxのブラウザケースを3件追加した。

1. 完全な商品IDを使い、「閉じ括弧＋値引額」の参照を照合し、値引100円/200円・支払900円/800円で分割する。
2. 複数行のIDとタブ付きの閉じ括弧・値引額行を照合し、同じ結果へ分割する。
3. A101とA 101が両方読める場合は保留・警告とし、商品名を手入力しても分割計画を作らない。

照合案内、原文の値引額行・タブ・改行、保存用計画にIDを含めないこと、仮の既存取引・学習辞書・IndexedDB/LocalStorageの保持も確認した。従来の360px・412pxケースと実canvas画素一致も合格した。ブラウザは新規の隔離プロファイルとlocalhostを使い、OCRは模擬である。Android実機の性能測定ではない。

## 残存条件・保護範囲

- 裸の金額・価格と区別できない表記・注記付きの行、別行の値引額、IDラベル自体の折り返しは新しい復元対象に含めない。
- 完全なID・一意な対応・会計の整合性が欠ける場合は手動確認を残す。複数の折り返された参照が同じIDを共有する場合も、既存の重複候補の保留条件を維持する。
- 実画像の印字位置・店舗書式・認識率、Android実機の速度・カメラ・メモリ・操作性は未検証。
- app.js、schemaVersion 12、保存処理・キー、学習辞書、Service Worker、公開バージョンは変更しない。実データは開かず、仮データだけで検証する。
- 指定作業ブランチだけへ反映する。main・公開中のGitHub Pages・無関係なZIP・Git管理対象外のテスト成果物は変更対象外。

## 再現コマンド

```powershell
node tests/run.cjs
node --test --test-reporter=tap tests/regression.test.cjs tests/performance.test.cjs tests/ocr-remaining.test.cjs tests/ok-101.test.cjs tests/quantity-tax.test.cjs tests/mixed-tax.test.cjs tests/product-code.test.cjs tests/separate-discount.test.cjs tests/multiple-discount.test.cjs tests/repeated-product.test.cjs tests/printed-line-id.test.cjs tests/printed-id-layout.test.cjs tests/wrapped-alpha-id.test.cjs tests/separator-id.test.cjs tests/bounded-complex-id.test.cjs tests/split-control-id.test.cjs tests/wrapped-id-recovery.test.cjs tests/unmarked-id-wrap.test.cjs tests/long-id-wrap.test.cjs tests/separate-id-close.test.cjs tests/padded-id-close.test.cjs tests/id-close-discount.test.cjs
node tests/compare-ocr.cjs id-close-discount.test.cjs b7796c33573faee0771afed50488c2e5e41779b4
node --test --test-reporter=tap tests/mobile.test.cjs
node --check receipt.js
git diff --check
```

ブラウザにはPlaywrightとChromium系ブラウザを指定する。比較結果は `.test-artifacts/id-close-discount-comparison.json`、TAP・ブラウザ記録も同ディレクトリに出力する（Git管理対象外）。

## 変更ファイル

| ファイル | 内容 |
| --- | --- |
| receipt.js | 閉じ括弧と明示された単一値引額の行の条件付き復元 |
| tests/id-close-discount.test.cjs | 新規回帰82件 |
| tests/separate-id-close.test.cjs | 条件を満たす旧ケース1件の期待更新 |
| tests/mobile.test.cjs | 通常・タブ付き・競合時の操作3ケース |
| docs/閉じ括弧と値引額が同じ行の明細IDの調査と修正.md | 本文書 |
| README.md | 調査結果とテストへの入口 |
