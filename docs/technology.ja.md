# 開発に使う言語・リポジトリ・データ

[English](technology.md) · [ホーム](../README.ja.md) · [全体設計](design.ja.md) · [データの利用条件と出典](research.ja.md)

**画面はTypeScript、地図の前処理・描画の自動化・バスデータの取得はPythonで実装します。** 最初に作るのは、新港の隣接する背景4枚と、サークルウォークの下を通る合成バス1台です。この段階はGoogle Mapsのキー、ODPTトークン、有料の画像生成なしで試せます。以下は試作での採用方針です。動作確認したツールの版と実測バスの取得状況は、試作の結果として記録します。

## 工程ごとの技術と公式リポジトリ

| 作るもの | 使う言語・道具 | 入力から何ができるか |
| --- | --- | --- |
| 都市モデルの前処理 | PythonからPLATEAU GIS Converter（`nusamai`）を呼び、座標はpyproj、海岸線の切り出しはGDALの `ogr2ogr` で扱う。WindowsではWSL2にLinux版CLIを置く案。 | 先行街区に重なるCityGMLのメッシュファイルを選び、地物の面をglTFに変換。陸域ポリゴンも切り出す。元の地物ID、各メッシュの原点から共通座標への変換を記録する。[PLATEAU GIS Converter](https://github.com/Project-PLATEAU/PLATEAU-GIS-Converter) · [CLI配布元](https://github.com/MIERUNE/plateau-gis-converter/releases) · [pyproj](https://github.com/pyproj4/pyproj) · [GDAL](https://github.com/OSGeo/gdal) |
| 背景と奥行きの制作 | Blender内のPython（`bpy`）で正投影カメラを固定して描画し、設定を出力。背景のタイル化はlibvipsのCLI。 | 街のメッシュから背景、同じ位置の奥行き、地物IDを作る。背景は `vips dzsave` で拡大率別のDZIタイルにする。奥行きとIDは値が変わらない可逆形式で保存する。[Blender公式ミラー](https://github.com/blender/blender) · [libvips](https://github.com/libvips/libvips) · [dzsaveの仕様](https://www.libvips.org/API/current/method.Image.dzsave.html) |
| ブラウザの画面 | TypeScript、HTML/CSS、開発・ビルド用のVite。画像の拡大・移動はOpenSeadragon。車両はWebGL2で描き、建物の陰に入る画素を短いGLSL ESシェーダーで判定する。 | DZI・カメラ設定・車両データから、拡大しても背景とバスがずれない地図を作る。公開時の画面は静的ファイルとして配信できる。[TypeScript](https://github.com/microsoft/TypeScript) · [Vite](https://github.com/vitejs/vite) · [OpenSeadragon](https://github.com/openseadragon/openseadragon) · [WebGL仕様](https://github.com/KhronosGroup/WebGL) |
| バスの取得処理 | サーバーでPythonを動かす。静的なGTFS-JPの読込は標準の `zipfile` と `csv`。GTFS-RTのバイナリは `gtfs-realtime-bindings` で読む。 | 事業者・運行日・便を照合し、出典、観測時刻、取得時刻、座標、状態を小さなJSONにする。ODPTトークンはサーバーで保持。合成バスにも同じJSON形式を使う。[MobilityData公式バインディング](https://github.com/MobilityData/gtfs-realtime-bindings) · [Pythonでの使い方](https://gtfs.org/documentation/realtime/language-bindings/python/) |
| 配信 | ビューアは静的ホスト、タイルは版付きのHTTPディレクトリへ置く。実測を追加したら一つの取得処理が短時間有効なJSONを各端末に配る。 | 背景・奥行き・カメラを同じ版で公開し、小さな設定ファイルで切り替える。ホスティング事業者と月額費用は試作後に決める。[配信設計](design.ja.md) |

独自のコードを書く場所は [small-yokohama](https://github.com/moruku36/small-yokohama) です。表の各リポジトリはツールの取得・参照先です。Small SF本体のソースは、作者が制作記で非公開と説明しています。[作者の制作記](https://smallsf.com/about)

## どの地図・交通データを取るか

| データ | 選ぶ配布物・項目 | 試作での確認と取得先 |
| --- | --- | --- |
| **PLATEAU 横浜市・2024年度** | カタログの **CityGML（v4）** と索引図。建物 `udx/bldg`、道路 `udx/tran`、地形 `udx/dem`、橋梁 `udx/brid` のうち収録されている地物を使う。[対象範囲](../scope/waterfront.geojson)に余白を加えてメッシュを選ぶ。 | 赤レンガ倉庫とサークルウォークのデッキの収録状況を確認。元データの軸順・単位・標高基準とglTFの原点を地上の基準点と照合し、水平位置をEPSG:6677に統一する。版、ハッシュ、出典、補作した形状を記録。[公式配布ページ](https://www.geospatial.jp/ckan/dataset/plateau-14100-yokohama-shi-2024) · [PLATEAUの利用条件](https://www.mlit.go.jp/plateau/site-policy/) |
| **OpenStreetMapの海岸線から作られた陸域ポリゴン** | 詳細版の **WGS84・分割済み陸域ポリゴン**（Shapefile）を選ぶ。街区で切り出し、重複部分を統合。対象範囲から陸域を引いた面を港の水面に使う。 | PLATEAUの岸壁と位置を照合する。桟橋や歩道橋の床面は別に描き、水面で消さない。取得日とOpenStreetMap contributorsのODbLクレジットを記録する。[配布物とライセンス](https://osmdata.openstreetmap.de/data/land-polygons.html) |
| **横浜市営バスのGTFS-JP** | 観測日に有効な版を選ぶ。`routes.txt`、`trips.txt`、`stops.txt`、`stop_times.txt`、運行日・例外日、収録されていれば経路形状 `shapes.txt` を使う。 | ベイサイドブルーの往復の便IDと経路を確認する。経路形状が欠ける区間は、道筋を確認できるまで停留所と時刻を表示する。[ODPT静的データ](https://ckan.odpt.org/dataset/yokohama_municipal_bus) · [横浜市の路線案内](https://www.city.yokohama.lg.jp/kotsu/bus/norikata/baysideblue.html) |
| **横浜市営バスのGTFS-RT VehiclePosition** | トークン付きの車両位置配信から、収録されている座標・観測時刻・便の参照情報を読む。表示・キャッシュ・保持は提供条件に合わせる。 | 営業時間中に往復それぞれの新鮮な観測を静的な便と照合。実測、古い実測、時刻表推定、合成を画面で区別する。配布元は確認済みで、この路線の認証付き受信は未検証。[ODPT車両位置](https://ckan.odpt.org/dataset/b_bus_gtfs_rt-yokohamamunicipal/resource/cafd8fda-f99b-4167-9c14-c9e35cc7c42f) · [利用条件](https://developer.odpt.org/terms) |

## この順番で組み立てる

1. **まず一つの街角。** 入力の版とカメラを固定し、隣り合う4枚を変換・描画。岸壁の線とデッキの高さを確かめる。
2. **次に合成のバス1台。** TypeScriptのビューアでDZIと奥行きを読み、試験用と表示したJSONを再生。バスが歩道橋の下に入り、反対側から出る様子を確かめる。この時点で動いた変換器・Blender・ライブラリの版を固定する。
3. **最後に実測1路線。** ODPTの取得処理を接続し、ベイサイドブルーの観測の古さと便の照合率を測る。[先行街区の合格条件](design.ja.md#実装順と合格条件)を満たしたら海沿いへ広げる。

港を拡張する際は、横浜市の客船入港予定とシーバス時刻表を「予定」の出典に使えます。実位置で船を動かすには、横浜港を受信でき、表示が許されるAIS配信を別に選びます。画像モデルによる加筆、気象観測、一般車のシミュレーションも、最初の地図が動いてから追加できます。[横浜港の入港予定](https://www.city.yokohama.lg.jp/kanko-bunka/minato/kyakusen/nyuko/2026.html) · [シーバス時刻表](https://yokohama-cruising.jp/seabass/timetable/) · [出典一覧](research.ja.md)
