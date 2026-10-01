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
- **3D view (three.js r147):** real relief from NOAA ETOPO1 elevation (7x vertical exaggeration), coloured from
  valley fields to Sierra rock and snow, browning as statewide storage falls. Each reservoir is a lake carved into
  the terrain: its water level comes from a volume table of the basin, so a low reservoir shrinks and exposes pale
  "bathtub ring" banks. Every dam visibly releases water: an animated tailrace runs from the outlet down the canyon into the
  river, with mist at the base, its width, speed and foam set by the same release value as the dam's sound.
  A dam sits at each outlet (concrete arch, gravity or gravity-arch walls with gated
  spillways, or earth/rockfill embankments with abutment chutes, plus a powerhouse), with white water when it
  releases or spills. Rivers are routed along valleys and follow the terrain, widening with measured flow.
  Animated lakes and ocean, sky with Day / Golden hour / Night, fly-to on click with a detail card and
  sparkline, labels that fade with distance, a drought replay with a camera path, a compare split
  (e.g. Sep 2014 vs Apr 2017), and a Low/High quality setting (Low by default on phones).
- **Sound (Web Audio, all procedural, off until you turn it on):** water in wet months, dry wind and cicadas in
  drought months, and a voice per dam whose loudness and character follow its storage, size and estimated
  release (deep rumble for a big full dam, thin hiss for a small low one, a crashing layer when the spillway
  runs above ~90%). In 3D the nearest dams are mixed by distance and direction; the detail card shows each
  dam's sound level and can solo it. A limiter keeps loud months from clipping.
- Opens in 3D (2D if WebGL is off); `?mode=2d` or a previous choice of 2D is remembered.
- One shared **timeline** (play/pause and scrub over a statewide storage sparkline), legend and summary panel
  for both views. Light/dark theme, works on phones.
- Bugs fixed from 2016: swapped width/height that clipped the map, random stream shapes that changed on every
  redraw, Clear Lake listed twice, one link row with the wrong station name, and the date label showing an array.

## Run locally

From the repo root:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000/ (`?mode=2d` opens the 2D map, `?month=2015-09` picks a month, `?quality=low|high`).
The 2016 version is at http://localhost:8000/legacy/.

Refresh the data:

- `python3 scripts/fetch_cdec.py [start] [end]`: CDEC storage and flow (dates as YYYY-MM-DD).
- `python3 scripts/fetch_elevation.py`: NOAA ETOPO1 elevation grids via ERDDAP (public domain).
- `python3 scripts/river_paths.py`: least-cost valley routes from gauges to reservoirs.

Dam types for the largest reservoirs follow the real structures; the rest are a reasonable guess by size and
setting. Lake outlines are generated, not surveyed.

## Tests

`tests/check.mjs` runs headless Chromium with Playwright against a server it starts on a free port. It checks
for console errors, the 2D map, detail card, sound (off by default, builds on click, mute), WebGL terrain,
lake levels over time, 3D hover and click fly-to, time of day, compare, replay and the iPhone 12 layout, and
saves screenshots to `tests/screenshots/`.

```sh
CHROME_BIN=/path/to/chrome-headless-shell node tests/check.mjs
# PLAYWRIGHT_FROM=/path/to/package.json selects which install of playwright to load
```
