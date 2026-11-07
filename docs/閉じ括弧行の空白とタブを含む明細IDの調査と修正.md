# 閉じ括弧行の空白とタブを含む明細IDの調査と修正（第21段階）

日付: 2026-11-07 / ブランチ: `codex/receipt-ocr-improvement`
基準: `57e6cd2d9ddb4b0859abb3c79f49ff34231b89bd`

人工OCR文字列・模擬worker・隔離ブラウザの仮データで再検証した。実画像・実店舗書式・Android実機での再現ではない。テストの商品名・コード・金額は学習辞書へ追加しない。

## 再現した問題

基準版は、IDの閉じ括弧だけが別行にある場合に復元できる。ただし、括弧行にタブがあると継続行のタブ禁止条件に、スペースがあると閉じ括弧1文字だけの条件に合わず、同じ認識元に完全なIDと一意の対象があっても保留になる。

以下の `[TAB]` は実際のタブ、`[SP]` はスペースを表す説明用表記である。テストには実文字を渡す。

```text
緑茶 (明細ID A101
[TAB][SP])[SP][TAB]
2200083271771 1 ¥1,000
…
(明細ID A101) 値引 ¥100
```

値引参照側も、次のように商品側の完全なIDと照合できるケースで再現した。

```text
値引 ¥100 (明細ID A
101
[TAB][SP])[SP][TAB]
```

## 修正と安全条件

`receiptRecoverWrappedIds` の閉じ括弧行だけの判定を、NFKC正規化後の「スペース・タブ＋対応する閉じ括弧1個＋スペース・タブ」に広げた。タブ禁止条件より先にこの限定した判定を行い、閉じ括弧だけを解析用コピーへ連結する。

全行をtrimしたり、一般的な空白文字クラスで読み飛ばしたりしない。IDの文字がある行のタブ・空白の扱いは変更しない。括弧の後ろに値引・価格・注記がある行、複数括弧、不一致括弧、空行・タブだけの行を挟むものは、新しい判定の対象に含めない。
全角括弧・全角スペースのNFKC正規化は従来の処理を使う。ID文字・記号・大文字小文字・先頭ゼロを補完・訂正しない。

以下の条件も維持した。

- `明細ID` の明示と対応する括弧が必要。IDは16文字以内、探索は最大16個の非空ID断片と直後の閉じ括弧行まで。上限超過を切り捨てて一致させない。
- 同じ認識元に、折り返しを含まない完全なIDが独立して存在する。商品側の復元には一意の完全な個別値引参照、参照側の復元には一意の完全なIDを持つ商品名・数量・価格付き明細が必要。
- 空白付きの別IDとの競合や重複がなく、復元後も対象の明細が一意である。
- 実際の認識記録がある場合は、その記録内で根拠が成立する。結合テキスト・別OCRパス・両側の折り返し・学習辞書を根拠の代わりにしない。
- 印字点数・小計・税・値引・支払額と、OCRパス間の割当整合性を検証する。括弧が復元できるだけで自動確定しない。

元の正規化済みOCR原文・タブ・改行と呼出元オブジェクトを保持する。確認画面には照合案内と原文を残し、保存用計画・取引・学習辞書へIDや復元情報の新項目を追加しない。

## 検証結果

| テスト群 | 合格数/件数 |
| --- | ---: |
| 既存家計簿 | 61/61 |
| 既存OCR | 337/337 |
| 第1〜20段階の追加回帰・性能同等性回帰（今回の期待更新を含む） | 991/991 |
| 今回の空白・タブ付き閉じ括弧行の回帰 | 79/79 |
| モバイル操作・実canvas画像一致 | 44/44 |
| 合計 | **1512/1512** |

同じ新規79件を基準版へ適用した結果は42/79件合格、修正後は79/79件合格で、37件の失敗を解消した。
既存OCR337件は前後とも合格し、西友18/18、ヤオコー10/10、MEGA6/6、オーケー101円等の回帰を維持した。
第20段階の67件では、根拠が成立する閉じ括弧行の前タブ・前スペース・後スペースの3件と、同じ前タブ入力を使う保存保護・模擬workerの2件の期待値を復元確認へ更新した。入力をすり替えず、総数67件と他の期待値を維持した。

新規回帰は商品側・参照側で、前後スペース・タブ・その混在・全角括弧とスペース、角括弧・隅付き括弧、16断片と17行目の括弧行、16文字の初行、値部分の括弧、商品後のID、記号・数字ID、LF/CRLF/CR、単一値引・税配分・原文保持を検証した。
保留側は、同じ認識元の完全なID不足、両側の折り返し、別パス・結合テキストでの根拠の混入、空白付きIDの競合、表記違い、括弧違い・重複、注記・価格・税・別ID、空行・タブだけの行、垂直タブ・フォームフィード・ゼロ幅文字・行区切り文字、ID文字行のタブ・行末空白・不正な記号、17文字・17断片、重複商品ID、会計不足・パス間矛盾を検証した。
フッター・値引合計・学習辞書による迂回も止める。模擬workerの3件では商品側・参照側の復元とID内部タブの保留、終了1回・保存書込0回を検証した。仮の既存取引・辞書・schemaVersion 12も維持した。

412pxのブラウザケースを3件追加した。

1. 商品側の閉じ括弧行の前後にスペース・タブが混在していても、完全な値引参照で照合できれば値引100円/200円・支払900円/800円で分割する。
2. 値引参照側の複数行IDとスペース・タブ付き閉じ括弧行を、完全な商品IDで照合して同じ結果へ分割する。
3. A101とA 101が両方読める場合は保留・警告とし、商品名を手入力しても分割計画を作らない。

照合案内、原文のタブ・スペース・改行、保存用計画にIDを含めないこと、仮の既存取引・学習辞書・IndexedDB/LocalStorageの保持も確認した。従来の360px・412pxケースと実canvas画素一致も合格した。ブラウザは新規の隔離プロファイルとlocalhostを使い、OCRは模擬である。Android実機の性能測定ではない。

## 残存条件・保護範囲

- 閉じ括弧行に別の情報があるもの、空行・タブだけの行・別情報を挟むもの、16文字を超えるIDは新しい復元対象に含めない。
- ID内部の空白・タブ、IDラベルの折り返し、閉じ括弧後の別行の値引を修復・結合する処理は追加しない。
- 完全なID・一意な対応・会計の整合性が欠ける場合は手動確認を残す。
- 実画像の印字位置・店舗書式・認識率、Android実機の速度・カメラ・メモリ・操作性は未検証。
- app.js、schemaVersion 12、保存処理・キー、学習辞書、Service Worker、公開バージョンは変更しない。実データは開かず、仮データだけで検証する。
- 指定作業ブランチだけへ反映する。main・公開中のGitHub Pages・無関係なZIP・Git管理対象外のテスト成果物は変更対象外。

## 再現コマンド

```powershell
node tests/run.cjs
node --test --test-reporter=tap tests/regression.test.cjs tests/performance.test.cjs tests/ocr-remaining.test.cjs tests/ok-101.test.cjs tests/quantity-tax.test.cjs tests/mixed-tax.test.cjs tests/product-code.test.cjs tests/separate-discount.test.cjs tests/multiple-discount.test.cjs tests/repeated-product.test.cjs tests/printed-line-id.test.cjs tests/printed-id-layout.test.cjs tests/wrapped-alpha-id.test.cjs tests/separator-id.test.cjs tests/bounded-complex-id.test.cjs tests/split-control-id.test.cjs tests/wrapped-id-recovery.test.cjs tests/unmarked-id-wrap.test.cjs tests/long-id-wrap.test.cjs tests/separate-id-close.test.cjs tests/padded-id-close.test.cjs
node tests/compare-ocr.cjs padded-id-close.test.cjs 57e6cd2d9ddb4b0859abb3c79f49ff34231b89bd
node --test --test-reporter=tap tests/mobile.test.cjs
node --check receipt.js
git diff --check
```

ブラウザにはPlaywrightとChromium系ブラウザを指定する。比較結果は `.test-artifacts/padded-id-close-comparison.json`、TAP・ブラウザ記録も同ディレクトリに出力する（Git管理対象外）。

## 変更ファイル

| ファイル | 内容 |
| --- | --- |
| receipt.js | 閉じ括弧だけの行の前後に限るスペース・タブ判定 |
| tests/padded-id-close.test.cjs | 新規回帰79件 |
| tests/separate-id-close.test.cjs | 条件を満たす旧ケース5件の期待更新 |
| tests/mobile.test.cjs | 商品側・参照側・競合時の操作3ケース |
| docs/閉じ括弧行の空白とタブを含む明細IDの調査と修正.md | 本文書 |
| README.md | 調査結果とテストへの入口 |
