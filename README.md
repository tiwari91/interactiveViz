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
  monthly storage from October 2011 to the latest complete month (September 2026 at the last refresh) from CDEC,
  fetched by `scripts/fetch_cdec.py`, plus monthly mean river flow for the gauges that report it. See
  [Data](#data) for what the numbers mean.
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
  releases or spills. Rivers run downhill on the terrain: an inflow into each lake and an outflow below each dam. The 2016 gauge-to-reservoir relationships are data, so they are drawn as dashed arcs (hidden until you hover a reservoir or turn on Gauge links).
  Animated lakes and ocean, sky with Day / Golden hour / Night, fly-to on click with a detail card and
  sparkline, labels that give way with distance (the text keeps full contrast; only its backing plate fades), a drought
  replay with a camera path (cuts between stops under reduced motion), a compare split
  (e.g. Sep 2014 vs Apr 2017), and a Low/High quality setting (Low by default on phones).
- **% of average.** Each reservoir's storage and the statewide total are also shown as a share of the average
  for the same calendar month over the record on the page (reported values only, at least five years per month),
  the way California's water agencies report reservoir conditions. Shown in the summary, tooltips and detail card.
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

## Data

All counts and date ranges on the page are computed from these files; none is hard-coded.

- `data/reservoir_storage_monthly.csv`: CDEC sensor 15 (reservoir storage, acre-feet), duration `M`. **A monthly
  "M" value is end-of-month storage**: CDEC stamps it with the first day of the month and its observation date is
  the month's last day (e.g. `2026-09` is storage on 30 September 2026). The `flag` column is CDEC's `DATA_FLAG`
  as published: `r` = revised by the operator, `e` = estimated, blank = as reported. CDEC data are provisional until
  revised; the big operators revise once a water year closes, so the page treats every month after the latest
  revised value (currently Oct 2025 onward) as provisional and marks it on the timeline, in the summary and in
  tooltips. Estimated values are noted in the tooltip and detail card.
- **Gaps.** A few months are missing on CDEC (Diamond Valley 2012-11, 2013-06 and 2023-04; Seven Oaks 2017-09;
  Pardee 2026-08; and four reservoirs that had not filed September 2026 yet). `js/data.js` interpolates interior gaps of
  up to 3 months and carries the last value forward for up to 2 months at the end, so the total's denominator does
  not jump. Filled months are named in the summary panel and flagged in the tooltip; longer gaps stay empty.
- `data/river_flow_monthly.csv`: CDEC sensor 41 (daily mean flow, cfs) averaged per month, with the number of days
  behind each mean. Only 5 of the 14 linked gauges report daily flow (BTC, CLV, OBB, PCN, POH); BTC has gaps
  (Feb 2023 back to Oct 2022, and Nov 2024 to Nov 2025). A month without a reading is drawn at a fixed width.
- `data/reservoir_meta.csv`: corrections and roles on top of the 2016 `reservoir_filtered_data.csv` (which the
  legacy page still reads unchanged).
  - **Capacities.** Where reported storage ran well over the 2016 capacity, the capacity is replaced with the
    current value from CDEC's Reservoir Information list (https://cdec.water.ca.gov/reportapp/javareports?name=ResInfo)
    and the station notes on each station's CDEC metadata page:
    Clear Lake 315,000 → 313,000 AF (revised May 2015, Yolo County FC&WCD); Terminus / Lake Kaweah 143,000 → 185,600 AF
    (spillway raised with fuse gates in 2004); Union Valley 230,000 → 266,369 AF (revised April 2015, SMUD); Wishon
    118,000 → 128,300 AF (updated May 2015, USBR); Pardee 197,950 → 203,795 AF (EBMUD's revised table, October 2016,
    at spillway crest). The remaining months over 100% are real: surcharge above a spillway crest in flood years
    (e.g. Berryessa and Whiskeytown in Feb 2019, Pardee in Dec 2022), and Clear Lake in flood.
  - **Clear Lake** is a natural lake, not a reservoir behind a dam. Its capacity is the storage at the full-lake level
    (7.56 ft on the Rumsey gauge), so it reads up to 134% in flood (Feb 2017). The detail card calls it a natural
    lake; in 3D the outlet structure drawn is the small concrete Cache Creek Dam that regulates it.
  - **Flood-control basins.** Seven Oaks and Prado on the Santa Ana River are kept nearly empty by design to catch
    storm runoff. They are drawn with a striped steel-blue mark instead of the drought colours and are left out of
    the % full total and the "below 40% full" count. CDEC has no storage readings for Prado.
  - The totals ("34 tracked reservoirs") therefore cover the storage reservoirs with CDEC data.
- `data/drought_periods.csv`: the drought bands on the timeline, from the governor's proclamations:
  - **2012–2016 drought**: drought state of emergency proclaimed by Gov. Edmund G. Brown Jr. on 17 January 2014
    (https://www.ca.gov/archive/gov39/2014/01/17/news18368/); ended by Executive Order B-40-17 on 7 April 2017, except
    in Fresno, Kings, Tulare and Tuolumne counties (https://www.ca.gov/archive/gov39/2017/04/07/news19747/).
  - **2020–2022 drought**: Gov. Gavin Newsom proclaimed a drought emergency in Mendocino and Sonoma counties on
    21 April 2021 (https://www.gov.ca.gov/2021/04/21/governor-newsom-takes-action-to-respond-to-drought-conditions/), extended it to
    all 58 counties on 19 October 2021, and rolled most drought orders back with Executive Order N-5-23 on 24 March 2023
    (https://www.gov.ca.gov/2023/03/24/governor-newsom-eases-drought-restrictions/). The band ends there,
    although the emergency itself stayed in force: Executive Order N-3-24 ended it in 19 counties on 4 September 2024
    (https://www.gov.ca.gov/wp-content/uploads/2024/09/9.4.24-Drought-EO-N-3-24.pdf), and a proclamation of
    24 March 2026 terminated what remained of it
    (https://www.gov.ca.gov/wp-content/uploads/2026/03/SOE-Termination-Proclamation_For-Print.-FORMATTED-3-23-26.pdf).
    The band uses March 2023, when the drought orders were lifted after the wet winter, as the end of the drought.

## Run locally

From the repo root:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000/ (`?mode=2d` opens the 2D map, `?month=2015-09` picks a month, `?quality=low|high`).
The 2016 version is at http://localhost:8000/legacy/.

Refresh the data:

- `python3 scripts/fetch_cdec.py [start] [end]`: CDEC storage (with `DATA_FLAG`) and flow, dates as YYYY-MM-DD.
  The end defaults to the last day of the previous month, and trailing months that fewer than 80% of reservoirs
  have filed are dropped, so the series ends on the latest complete month.
- `python3 scripts/fetch_elevation.py`: NOAA ETOPO1 elevation grids via ERDDAP (public domain).

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
