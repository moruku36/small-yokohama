# Small SFの制作法と、横浜で使えるデータ

[English](research.md) · [ホーム](../README.ja.md) · [全体設計](design.ja.md)

2026年11月24日時点の一次資料を調べました。制作方法とデータの配布までは確認できました。先行街区の実際の詳細度、路線ごとの測位状況・遅延、画像制作費は実験で測る項目です。

## 作者が明かしている制作工程

作者はAri Dutilh氏です。自身の制作記に工程・クレジット・変更履歴を載せ、Dylan Martin氏のIsometric Seattleを着想元として紹介しています。本人のGitHubプロフィールも公開されています。Small SF本体については、制作記で現在はオープンソース化していないと説明しています。[作者の制作記](https://smallsf.com/about) · [実際の地図](https://smallsf.com/) · [作者サイト](https://dutilh.net/) · [GitHub](https://github.com/aridutilh) · [Isometric Seattle](https://isometricseattle.fun/)

| 工程 | Small SFで確認できたこと | 横浜版の選択 |
| --- | --- | --- |
| 元データとカメラ | GoogleのPhotorealistic 3D Tilesをヘッドレスブラウザで、斜め45度の固定カメラから正投影している。 | 固定視点で一度描画する工程を採用。自前で絵を制作・配信できるよう、素材にはPLATEAUの横浜市モデルを選ぶ。 |
| 絵作り | 重なりを持つ2,048 pxの画像を2,880 pxのイラストに変換。スタイル見本を渡し、当初はHiggsfield、後にGPT Image 2を使用。重複部分の違いが小さい線で切ってつなぐ。 | 独自の見本で4枚を先に制作。岸壁とランドマークの位置を固定し、海だけのタイルは規則的に塗る。 |
| 地図の表示 | 拡大・移動にはOpenSeadragonを使用。同じ視点で奥行きを描き、車体のうち手前の建物に隠れる部分を判定。道路の高さも別に扱う。 | 絵、クリック判定、車両で同じ座標変換を共有。歩道橋をくぐるバスで先に検証する。 |
| 街の動き | 公共交通には511の到着予測や遅延GPS、船はAIS、飛行機はADS-B、一般車はOSMの道路上でシミュレーション。光と霧には気象・衛星情報も使う。 | 海側を走る実測バスを優先。船の予定、地下の列車、演出の車、天気にはそれぞれの出典・時刻・意味を表示する。 |

Googleが使われているのは、原画を作るための3D素材です。閲覧側の画像を動かす役目はOpenSeadragonです。Googleの規約には、地図コンテンツの保存や派生コンテンツ作成に関する制限があります。横浜版の基本構成はGoogle MapsのAPIキーなしで組めます。[作者のクレジット](https://smallsf.com/about#credits) · [Googleの3D Tiles](https://developers.google.com/maps/documentation/tile/3d-tiles) · [タイル利用ポリシー](https://developers.google.com/maps/documentation/tile/policies) · [プラットフォーム規約](https://cloud.google.com/maps-platform/terms) · [OpenSeadragon](https://openseadragon.github.io/)

## 横浜で使える一次資料

| レイヤー | 確認したこと | 実装時に確かめること・出典 |
| --- | --- | --- |
| 建物・道路・地形・橋 | 横浜市2024年度版にCityGML、複数詳細度の建物・道路、地形、橋梁、索引図がある。 | 取得した版・ハッシュを固定。新港の各メッシュと歩道橋の収録状況を確認し、詳細形状がなければLOD1で描く。配布元のサイトポリシー、個別の注記、出典・加工表記を適用。[データセット](https://www.geospatial.jp/ckan/dataset/plateau-14100-yokohama-shi-2024) · [索引図（PDF）](https://assets.cms.plateau.reearth.io/assets/77/ac1e93-e863-47f5-908f-313abc462ddd/14100_indexmap_op.pdf) · [利用条件](https://www.mlit.go.jp/plateau/site-policy/) |
| バスの経路とダイヤ | ODPTには2026年11月1日有効開始の横浜市営バスGTFS-JPを掲載。横浜市のベイサイドブルー案内は横浜駅、みなとみらい、山下方面を結ぶ。 | 運行日に有効な版で往復の経路・便ID・運休例外を確認する。開発者登録と基本・特定利用条件を確認。[静的カタログ](https://ckan.odpt.org/dataset/yokohama_municipal_bus) · [横浜市の路線案内](https://www.city.yokohama.lg.jp/kotsu/bus/norikata/baysideblue.html) |
| バスの実測位置 | ODPTの横浜市交通局配布ページにVehiclePosition・Protocol Buffers・アクセストークン付きの取得先が明記されている。 | サーバー側で取得を集約。今回は認証付きデータの受信や、ベイサイドブルーの便との照合は未実施。鮮度・利用枠・表示・キャッシュ・保存期間を運用条件と突き合わせる。[車両位置の配布ページ](https://ckan.odpt.org/dataset/b_bus_gtfs_rt-yokohamamunicipal/resource/cafd8fda-f99b-4167-9c14-c9e35cc7c42f) · [動的カタログ](https://ckan.odpt.org/dataset/b_bus_gtfs_rt-yokohamamunicipal) · [ODPT利用条件](https://developer.odpt.org/terms) |
| 港と船 | 横浜市に客船入港予定、シーバス運航会社に水上バスの時刻表がある。どちらも予定を知るための資料。 | 初期は着岸場所に予定を表示するか、運航元へリンク。転載条件と運休・変更情報を確認。船を実位置で滑らかに動かすには、横浜港を受信できて目的の表示が許されるAISが別途必要。[横浜港入港予定](https://www.city.yokohama.lg.jp/kanko-bunka/minato/kyakusen/nyuko/2026.html) · [シーバス公式時刻表](https://yokohama-cruising.jp/seabass/timetable/) |
| 街路・気象 | OSMに道路網、気象庁にアメダス観測がある。 | 一般車シミュレーションにOSMを使う段階でODbLの表示とデータベース派生物の条件を確認。初期は計算した昼夜のみ。観測を重ねる段階で観測点・観測時刻・取得方法・利用条件を確定。[OSM](https://www.openstreetmap.org/copyright) · [気象庁アメダス](https://www.jma.go.jp/bosai/amedas/) · [気象庁の利用条件](https://www.jma.go.jp/jma/kishou/info/coment.html) |

公開単位ごとに、提供者、配布物と版、取得日、再配布・保持条件、出典表示、加工内容、生成物を記録します。画面と配布物の両方でクレジットを表示します。MITは本プロジェクトの独自成果物が対象です。初期公開に含める地理データは手作業で定めた計画範囲と目印です。

## 実装時に引く仕様

- 大きな画像を段階的に読み込むDZIの形式と、オフラインでの生成方法。[OpenSeadragonのDZI例](https://openseadragon.github.io/examples/tilesource-dzi/) · [libvips dzsave](https://www.libvips.org/API/current/method.Image.dzsave.html)
- 運行日、車両位置、タイムスタンプの定義。設計書の鮮度しきい値は推奨事項を踏まえた初期運用案。[GTFS静的仕様](https://gtfs.org/documentation/schedule/reference/) · [GTFS動的仕様](https://gtfs.org/documentation/realtime/reference/) · [推奨事項](https://gtfs.org/documentation/realtime/realtime-best-practices/)
