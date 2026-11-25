# スモール横浜 · Small Yokohama

[README (メインページ / 日本語＆English概要)](README.md) · [全体タイル割当・座標表](docs/tile-grid-plan.md) · [地図で対象範囲を見る](scope/waterfront.geojson) · [全体設計](docs/design.ja.md) · [開発技術とデータ](docs/technology.ja.md) · [調査・出典](docs/research.ja.md)

青い連節バスが倉庫の角を曲がって建物の陰に入り、地図を海沿いに動かすと山下公園が見えてくる。**スモール横浜**は、横浜駅からみなとみらいを経て元町・中華街までを、拡大して眺められる一枚の動くミニチュア・イラスト地図にするプロジェクトです。

現在、**全 23/23 タイル（15,488 × 5,888 px）をシームレス連結した全体マップビルド `full-yokohama-v1`（DZI Deep Zoom ピラミッド・`7744×2944` 深度・ランドマーク・全体ビューア統合）が完了**しました。

- [x] **全体連結ビルド (`full-yokohama-v1`)**: 全 23/23 タイル連結・`15,488×5,888` DZI ピラミッド・QA 全合格
- [x] **先行パイロット (`pilot`)**: 4/4 完了
- [x] **担当 1 (`phase-a-1` / `moruku36`)**: 4/4 完了（山下公園・氷川丸・マリンタワー・中華街・山下ふ頭・元町）
- [x] **担当 2 (`phase-a-2` / `moruku36`)**: 4/4 完了（ランドマーク・クイーンズ・パシフィコ・臨港パーク・新高島・中央卸売市場）
- [x] **担当 3 (`phase-a-3` / `moruku36`)**: 4/4 完了（横浜駅東西・そごう・ベイクォーター・ポートサイド・鶴屋町・西神奈川高台）
- [x] **担当 4 (`phase-b-1` / `moruku36`)**: 4/4 完了（山手南・石川町・中村川・関内・大通り公園・野毛・大岡川）
- [x] **担当 5 (`phase-b-2` / `moruku36`)**: 3/3 完了（紅葉坂・掃部山・戸部・石崎川・平沼橋・ガスホルダー・帷子川）

---

## 全 23 タイル 結合パノラマ ＆ パイロットプレビュー（詳細ギャラリーは [README.md](README.md) を参照）

![横浜臨海部 全23タイル 結合プレビュー](docs/images/full-yokohama-23tiles-preview.png)

| 横浜駅・ベイクォーター (`(3,0)-(4,1)`) | みなとみらい・野毛山 (`(1,-1)-(2,0)`) | 関内・野毛・大岡川 (`(0,-1)-(1,0)`) | 中華街・横浜スタジアム (`(-1,-1)-(0,0)`) |
| :---: | :---: | :---: | :---: |
| ![横浜駅周辺シーム検証](docs/images/full-seam-yokohama-station.png) | ![みなとみらいシーム検証](docs/images/full-seam-minatomirai.png) | ![関内・野毛シーム検証](docs/images/full-seam-kannai-noge.png) | ![中華街・スタジアムシーム検証](docs/images/full-seam-yamashita-chinatown.png) |

![新港パイロット 4/4 結合プレビュー](docs/images/pilot-shinko-4tiles-preview.png)

| マスター基準 (#1: `tile_1_1`) | サークルウォーク境界シーム (`10_7`) | 横浜スタジアム (`1_1`) | 汽車道・運河 (`12_5`) |
| :---: | :---: | :---: | :---: |
| ![マスター基準タイル #1](docs/images/tile_1_1_master.png) | ![サークルウォーク境界シーム](docs/images/zoom-circlewalk-seam.png) | ![横浜スタジアム拡大](docs/images/zoom-stadium.png) | ![汽車道・運河拡大](docs/images/zoom-kishamichi.png) |

---

## タイル構成・担当割り振り・作成ガイド

全体 23 タイルの配置図・担当 1〜5 の分担表・コピペ用プロンプト・上位モデル（オーケストレーター）設定のポイント・セルフ検証手順は、[README.md](README.md) および [docs/tile-grid-plan.md](docs/tile-grid-plan.md) に詳しくまとめています。

```powershell
# 全23タイル全体マップ（15488x5888 DZI・半解像データタイル・QA・プレビュー）をビルド
npm.cmd run build:full

# パイロット全体ビルド・検証・ビューア起動
npm.cmd run build:pilot
npm.cmd run typecheck
npm.cmd run test
npm.cmd run dev
```

本リポジトリのオリジナル成果物には[MITライセンス](LICENSE)を適用します。外部データと第三者素材（OpenStreetMap ODbL、国土地理院タイル、PLATEAU 等）には各配布元の条件が適用されます。[出典と表示条件](docs/research.ja.md)
