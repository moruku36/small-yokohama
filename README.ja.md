# スモール横浜 · Small Yokohama

[README (メインページ / 日本語＆English概要)](README.md) · [全体タイル割当・座標表](docs/tile-grid-plan.md) · [地図で対象範囲を見る](scope/waterfront.geojson) · [全体設計](docs/design.ja.md) · [開発技術とデータ](docs/technology.ja.md) · [調査・出典](docs/research.ja.md)

青い連節バスが倉庫の角を曲がって建物の陰に入り、地図を海沿いに動かすと山下公園が見えてくる。**スモール横浜**は、横浜駅からみなとみらいを経て元町・中華街までを、拡大して眺められる一枚の動くミニチュア・イラスト地図にするプロジェクトです。

現在、**新港パイロット 4 タイル（#1〜#4）＋ 担当 1（`moruku36` / `phase-a-1`）4 タイルの計 8/23 タイルが完成**し、残り **15 タイル（全体 23 タイル／3×8=24格子）** をチーム分担で進めるための汎用ベースレンダラー（`npm run render:tile`）および品質チェック環境まで実装済みです。

---

## 新港パイロット 4/4 完成プレビュー

![新港パイロット 4/4 結合プレビュー](docs/images/pilot-shinko-4tiles-preview.png)

| マスター基準 (#1: `tile_1_1`) | サークルウォーク境界シーム (`10_7`) | 横浜スタジアム (`1_1`) | 汽車道・運河 (`12_5`) |
| :---: | :---: | :---: | :---: |
| ![マスター基準タイル #1](docs/images/tile_1_1_master.png) | ![サークルウォーク境界シーム](docs/images/zoom-circlewalk-seam.png) | ![横浜スタジアム拡大](docs/images/zoom-stadium.png) | ![汽車道・運河拡大](docs/images/zoom-kishamichi.png) |

---

## タイル構成・担当割り振り・作成ガイド

全体 23 タイルの配置図・担当 1〜5 の分担表・コピペ用プロンプト・上位モデル（オーケストレーター）設定のポイント・セルフ検証手順は、[README.md](README.md) および [docs/tile-grid-plan.md](docs/tile-grid-plan.md) に詳しくまとめています。

```powershell
# 任意のタイルまたは担当ブロックの下絵（_base.png）を自動生成する
npm.cmd run render:tile -- --tile 2,0
npm.cmd run render:tile -- --block phase-a-2

# パイロット全体ビルド・検証・ビューア起動
npm.cmd run build:pilot
npm.cmd run typecheck
npm.cmd run test
npm.cmd run dev
```

本リポジトリのオリジナル成果物には[MITライセンス](LICENSE)を適用します。外部データと第三者素材（OpenStreetMap ODbL、国土地理院タイル、PLATEAU 等）には各配布元の条件が適用されます。[出典と表示条件](docs/research.ja.md)
