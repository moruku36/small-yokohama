# Small Yokohama · スモール横浜

[日本語](README.ja.md) · [Development stack and data](docs/technology.md) · [Study area on a map](scope/waterfront.geojson) · [System design](docs/design.md) · [Research and sources](docs/research.md)

Watch a blue articulated bus turn behind a warehouse, then pan along the piers to Yamashita Park. **Small Yokohama** is a design for a zoomable, illustrated miniature of the waterfront from Yokohama Station through Minato Mirai to Motomachi-Chukagai. This repository contains the feasibility study, the proposed architecture and a map of the study area. The viewer and live feed integration are planned.

## How it would work

The viewer uses TypeScript and OpenSeadragon. Python prepares the PLATEAU geometry, controls Blender and collects municipal bus reports. The developer guide lists the upstream repositories and the exact data products to obtain for the four-tile pilot. [Development stack and data](docs/technology.md)

A fixed camera turns Yokohama's PLATEAU city model into an illustration. A second image from the same camera records how far away each surface is. Together they let a moving bus disappear behind a building at the correct moment. The browser fetches only the parts of the drawing in view. [System design](docs/design.md)

| Layer | First release |
| --- | --- |
| Streets, buildings and piers | Create our own art from the FY2024 Yokohama model. Start in Shinko around the Red Brick Warehouse and Circle Walk. [Study area](scope/waterfront.geojson) |
| Buses | Start with Bayside Blue. Match timestamped municipal bus reports to the applicable timetable. Show the source time and label schedule estimates separately. [Transport sources](docs/research.md) |
| Harbor and light | Start with a water mask and sunlight calculated for Yokohama. Add published ship calls as scheduled events; measured vessel positions need a suitable feed. [Release sequence](docs/design.md#delivery-and-acceptance) |

**What inspired it.** Ari Dutilh's Small SF pre-renders Google's Photorealistic 3D Tiles, illustrates overlapping blocks and serves a deep-zoom image with moving overlays. Its public making-of explains the method, including the depth trick. Small Yokohama adopts that method with its own geometry, artwork and code. [Small SF](https://smallsf.com/) · [Author's making-of](https://smallsf.com/about) · [Yokohama dataset](https://www.geospatial.jp/ckan/dataset/plateau-14100-yokohama-shi-2024)

**First experiment.** Draw four adjoining tiles, replay a synthetic bus underneath the Circle Walk, then compare a fresh Bayside Blue report against its route during service. Expand the illustration once the seams, occlusion and data age are visible and measurable. [Pilot and acceptance criteria](docs/design.md#delivery-and-acceptance)

Original repository materials use the [MIT License](LICENSE). Source data and future third-party assets retain their own terms. [Source and credit register](docs/research.md)
