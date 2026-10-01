# interactiveViz

Source code for California Drought Impact http://yoonchunghan.com/portfolio/california-drought-impact.html.

Live: https://tiwari91.github.io/interactiveViz/

California Drought Impact (Cal State Fullerton, 2016) is an interactive multimodal data artwork built from
laser-cut data sculptures, projection mapping and a digital visualization. Concept and visual design by
Yoon Chung Han; development by Shankar Tiwari as student research assistant. Paper: Yoon Chung Han and
Shankar Tiwari, *California Drought Impact: Multimodal Data Representation to Predict the Water Cycle*,
IEEE VISAP 2016.

## What changed (2026 rebuild)

The original 2016 page is kept, unchanged apart from data paths, in [`legacy/`](legacy/).

- **D3 v7** (pinned UMD build from cdnjs) replaces d3 v3, queue.js and jQuery. The code is split into
  small ES modules under `js/`: data loading, scales, 2D map, 3D view, timeline, legend, summary, tooltip and theme.
- **Real time series.** The 2016 data had one storage snapshot (Sep 2014) with many blanks. The page now shows
  monthly storage for Oct 2011 to Sep 2017 from CDEC, fetched by `scripts/fetch_cdec.py`, plus monthly mean
  river flow for the gauges that report it.
- **2D map:** fitted, responsive conic projection; glyphs with ring = capacity and disc = storage, coloured
  by % full; animated stream links whose width follows river flow; zoom and pan; tooltips on hover, tap and
  keyboard focus; labels that avoid each other.
- **3D view (three.js r147):** extruded California, reservoirs as glass columns (height = capacity) with water
  inside (level = storage, colour = % full) that animates over time, glowing tube streams with flowing dashes,
  raycast picking, soft shadows, labels, and touch orbit on phones.
- One shared **timeline** (play/pause and scrub over a statewide storage sparkline), legend and summary panel
  for both views. Light/dark theme, works on phones.
- Bugs fixed from 2016: swapped width/height that clipped the map, random stream shapes that changed on every
  redraw, Clear Lake listed twice, one link row with the wrong station name, and the date label showing an array.

## Run locally

From the repo root:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000/ (`?mode=3d` opens the 3D view, `?month=2015-09` picks a month).
The 2016 version is at http://localhost:8000/legacy/.

Refresh the data from CDEC: `python3 scripts/fetch_cdec.py [start] [end]` (dates as YYYY-MM-DD).

## Tests

`tests/check.mjs` runs headless Chromium with Playwright against a server it starts on a free port. It checks
for console errors, the 2D map and reservoirs, WebGL rendering, timeline updates, 2D and 3D tooltips, and
iPhone 12 layout, and saves screenshots to `tests/screenshots/`.

```sh
CHROME_BIN=/path/to/chrome-headless-shell node tests/check.mjs
# PLAYWRIGHT_FROM=/path/to/package.json selects which install of playwright to load
```
