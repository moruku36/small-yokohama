# Small Yokohama

**English** · [日本語](README.ja.md)

An interactive miniature map of Yokohama’s waterfront, from Yokohama Station through Minato Mirai and Shinko to Yamashita Park, Motomachi, and Chinatown. Inspired by [Small SF](https://smallsf.com/), it combines a cityscape drawn in a miniature illustration style with moving transit, simulated street life, and live weather.

**[Explore the live map](https://small-yokohama.vercel.app/)**

## Yokohama waterfront panorama

![Panorama of all 23 illustrated tiles of the Yokohama waterfront](docs/images/full-yokohama-23tiles-preview.png)

*23 illustrated tiles stitched into one 15,488 × 5,888 px panorama. See the [tile gallery and seam checks](docs/project-guide.md#tile-gallery-and-seam-checks) for close-ups.*

## What to try

- **Explore at street level.** Drag to pan, scroll or pinch to zoom, and switch between Japanese and English labels.
- **Follow a vehicle.** Click a bus, train, or moving ship to follow it. Trains use a live feed where available, with a timetable fallback; street traffic and pedestrians are simulated.
- **See the city change.** Lighting follows Yokohama’s local time, and live weather drives the default rain setting. Turn on harbor sound or share a link to the view you found.

## Run locally

From the repository root in Windows PowerShell:

```powershell
npm.cmd install
npm.cmd run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). For map generation, validation, and other commands, see the [project guide](docs/project-guide.md).

## Project documentation

| Topic | Where to look |
| --- | --- |
| Tile gallery, production, and contributor workflow | [Project guide](docs/project-guide.md) |
| Tile coordinates and coverage | [Tile grid](docs/tile-grid-plan.md) · [Study area (GeoJSON)](scope/waterfront.geojson) |
| Architecture and development stack | [System design](docs/design.md) · [Technology](docs/technology.md) |
| Data sources, attribution, and license | [Research and sources](docs/research.md) · [MIT license](LICENSE) |
