# 閉じ括弧だけが別行の明細IDの調査と修正（第20段階）

日付: 2026-11-07 / ブランチ: `codex/receipt-ocr-improvement`
基準: `b1e7689a08fcdf14e23e336f3b59c8983b2b7aae`

人工OCR文字列・模擬worker・隔離ブラウザの仮データで再検証した。実画像・実店舗書式・Android実機での再現ではない。テストの商品名・コード・金額は学習辞書へ追加しない。

## 再現した問題

基準版の継続行は「ID文字＋閉じ括弧」を必須としており、閉じ括弧だけが次行にあると、同じ認識元に完全なIDが一意に印字されていても復元しない。

```text
緑茶 (明細ID A101
)
2200083271771 1 ¥1,000
…
(明細ID A101) 値引 ¥100
```

値引参照側も、次のように値引額とIDラベルが同じ行で始まり、商品側に完全なIDがあるケースで再現した。

```text
値引 ¥100 (明細ID A
101
)
```

## 修正と安全条件

`receiptRecoverWrappedIds` 内で、次の行が対応する閉じ括弧1文字だけの場合に、解析用コピーを閉じられるようにした。括弧の前後に空白・タブ・別の情報がある行は、新しい対象に含めない。NFKCによる全角の正規化は従来どおり行う。

探索は既存のID長上限16文字に基づき、最大16個の非空ID断片と、その直後の閉じ括弧行までで止める。16文字に達しても閉じ括弧だけの行は確認できるが、追加の文字断片は受け付けない。17文字目・17個目の断片を捨てて一致させることはない。

復元後も以下の既存条件をすべて維持した。

- `明細ID` と明記され、対応する1組の括弧がある。文字・記号・大文字小文字・先頭ゼロを補正せず、そのまま連結して完全なIDと照合する。
- 同じ認識元に、折り返しを含まない完全なIDが独立して存在する。商品側の復元には一意の完全な個別値引参照、参照側の復元には一意の完全なIDを持つ商品名・数量・価格付き明細が必要。
- 空白付きの別IDとの競合や重複がなく、復元後も対象の明細が一意である。
- 実際の認識記録がある場合は、その記録内で根拠が成立する。結合テキスト・別OCRパス・学習辞書を根拠の代わりにしない。両側とも折り返されている場合も自己証明させない。
- 印字点数・小計・税・値引・支払額と、OCRパス間の割当整合性を検証する。IDが復元できるだけで自動確定しない。

タブ・空行・価格・税・注記などを読み飛ばして括弧を探さない。元の正規化済みOCR原文と呼出元オブジェクトを保持し、確認画面には原文の改行と照合案内を残す。

## 検証結果

| テスト群 | 合格数/件数 |
| --- | ---: |
| 既存家計簿 | 61/61 |
| 既存OCR | 337/337 |
| 第1〜19段階の追加回帰・性能同等性回帰（今回の期待更新1件を含む） | 924/924 |
| 今回の閉じ括弧別行の回帰 | 67/67 |
| モバイル操作・実canvas画像一致 | 41/41 |
| 合計 | **1430/1430** |

同じ新規67件を基準版へ適用した結果は39/67件合格、修正後は67/67件合格で、28件の失敗を解消した。
既存OCR337件は前後とも合格し、西友18/18、ヤオコー10/10、MEGA6/6、オーケー101円等の回帰を維持した。
第19段階の53件では、完全な参照を持つ4断片＋閉じ括弧行の1件だけを保留から復元確認へ更新した。件数53を維持し、他の既存期待値は変更していない。

新規回帰では、商品側・参照側、1・4・16個のID断片、16文字に達した後の閉じ括弧行、各種括弧、値部分の括弧、商品後のID、記号・数字・全角ID、LF/CRLF/CR、単一値引、税配分、原文・入力保持を検証した。
保留側は、完全なID不足、両側の折り返し、別パス・結合テキストによる根拠の混入、空白付きIDの競合、表記違い、括弧違い・重複、前後の空白・タブ、空行・税・価格・注記の混入、17文字・17断片、重複商品ID、フッター・値引合計・学習辞書による迂回、会計不足・パス間矛盾を検証した。
模擬workerの3件では商品側・参照側の条件付き復元とタブ付き閉じ括弧行の保留、終了1回・保存書込0回を確認した。仮の既存取引・学習辞書・schemaVersion 12も維持した。

412pxのブラウザケースを3件追加した。

1. 商品側の閉じ括弧別行IDを完全な値引参照で照合し、値引100円/200円・支払900円/800円で分割する。
2. 値引参照側の複数行ID＋閉じ括弧行を完全な商品IDで照合し、同じ結果で分割する。
3. A101とA 101が両方読める場合は保留・警告とし、商品名を手入力しても分割計画を作らない。

照合案内・原文の閉じ括弧行表示、保存用計画にIDを含めないこと、仮の取引・学習辞書・IndexedDB/LocalStorageの保持も確認した。360px・412pxの従来ケースと実canvas画素一致も合格した。ブラウザは新規の隔離プロファイルとlocalhostを使い、OCRは模擬である。
サンドボックス内ではEdgeの起動に失敗したため、その実行を停止し、同じ隔離テストを許可されたサンドボックス外の環境で実行した。

## 残存条件・保護範囲

- 閉じ括弧行の前後に空白・タブ・注記があるもの、別情報・空行を挟むもの、16文字を超えるものは新しい復元対象に含めない。
- IDラベル自体の折り返しや、閉じ括弧後の別行の値引を新たに結合する処理は追加しない。
- 同じ認識元に完全なID・一意な対応・会計の整合性がなければ手動確認を残す。
- 実画像の印字位置・店舗書式・認識率、Android実機の速度・カメラ・メモリ・操作性は未検証。
- app.js、schemaVersion 12、保存処理・キー、学習辞書、Service Worker、公開バージョンは変更しない。実データは開かず、仮データだけで検証する。
- 作業ブランチだけへ反映する。main・公開中のGitHub Pages・無関係なZIP・Git管理対象外のテスト成果物は変更対象外。

## 再現コマンド

```powershell
node tests/run.cjs
node --test --test-reporter=tap tests/regression.test.cjs tests/performance.test.cjs tests/ocr-remaining.test.cjs tests/ok-101.test.cjs tests/quantity-tax.test.cjs tests/mixed-tax.test.cjs tests/product-code.test.cjs tests/separate-discount.test.cjs tests/multiple-discount.test.cjs tests/repeated-product.test.cjs tests/printed-line-id.test.cjs tests/printed-id-layout.test.cjs tests/wrapped-alpha-id.test.cjs tests/separator-id.test.cjs tests/bounded-complex-id.test.cjs tests/split-control-id.test.cjs tests/wrapped-id-recovery.test.cjs tests/unmarked-id-wrap.test.cjs tests/long-id-wrap.test.cjs tests/separate-id-close.test.cjs
node tests/compare-ocr.cjs separate-id-close.test.cjs b1e7689a08fcdf14e23e336f3b59c8983b2b7aae
node --test --test-reporter=tap tests/mobile.test.cjs
node --check receipt.js
git diff --check
```

ブラウザにはPlaywrightとChromium系ブラウザを指定する。比較結果は `.test-artifacts/separate-id-close-comparison.json`、TAP・ブラウザ記録も同ディレクトリに出力する（Git管理対象外）。

## 変更ファイル

| ファイル | 内容 |
| --- | --- |
| receipt.js | 閉じ括弧だけの直後行の照合、最大17行の探索上限 |
| tests/separate-id-close.test.cjs | 新規回帰67件 |
| tests/long-id-wrap.test.cjs | 条件を満たす閉じ括弧別行1件の期待更新 |
| tests/mobile.test.cjs | 商品側・参照側・競合時の操作3ケース |
| docs/閉じ括弧だけが別行の明細IDの調査と修正.md | 本文書 |
| README.md | 調査結果とテストへの入口 |
