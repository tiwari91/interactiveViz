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
  releases or spills. Rivers run downhill on the terrain: an inflow into each lake and an outflow below each dam. From the state view the main Central Valley rivers, the Delta's main channels, and the California Aqueduct (with its West and East branches to Pyramid, Castaic and Perris) and Delta-Mendota Canal are drawn as a faint glowing layer from approximate waypoints; it fades out close up. The aqueduct line passes San Luis Reservoir, which is not one of the tracked reservoirs. The 2016 gauge-to-reservoir relationships are data, so they are drawn as dashed arcs (hidden until you hover a reservoir or turn on Gauge links).
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
- `data/snowpack_monthly.json` (built by `scripts/fetch_snow.py`): snowpack as **% of the April 1 average**,
  statewide and for CDEC's North / Central / South Sierra sections, one value per month from October 2011 to the last
  storage month. How it is made, mirroring CDEC's *Daily Statewide Summary of Snow Water Content*:
  - **Stations**: the automatic snow pillows CDEC lists under "Stations included" in its DLYSWEQ report
    (https://cdec.water.ca.gov/reportapp/javareports?name=DLYSWEQ): North = Trinity through Feather and Truckee,
    Central = Yuba and Tahoe through Merced and Walker, South = San Joaquin and Mono through Kern. The station IDs used
    are stored in the JSON (`stations`). LVT (Leavitt Lake) is listed under both Central and South and counts in both;
    FLV and LLX have no April 1 average on CDEC and are left out (111 stations in all).
  - **April 1 average** per station: the "Apr 1 Avg (IN)" column of CDEC's Daily Snow Sensor Report
    (https://cdec.water.ca.gov/reportapp/javareports?name=PAGE6), stored in the JSON (`apr1_in`).
  - **Snow water equivalent**: CDEC sensor 3 (SNOW WC, inches), daily (`dur_code=D`), from
    `https://cdec.water.ca.gov/dynamicapp/req/CSVDataServlet?Stations=…&SensorNums=3&dur_code=D`. A month's value is
    the reading on its **1st** (the snow-survey convention: "April" means April 1), or the 2nd or 3rd if the 1st is
    missing. Negative readings count as 0; readings above max(150 in, 4 × the station's April 1 average) are treated
    as sensor errors and dropped.
  - **% of April 1 average** = sum of SWE over the stations reporting that day ÷ sum of those stations' April 1
    averages; statewide uses every station. A section with fewer than half its stations reporting gets no value (null,
    shown as "No data"); nothing is interpolated. The figures can differ by a few points from CDEC's own published
    summary, which uses its station list of the day.
  - On the page: the statewide figure in "Statewide this month", the fourth chart, and timeline flags at the lowest
    April under 15% (April 2015) and the highest month over 150% (April 2023). In 3D the Snowpack layer drapes snow on
    the Sierra Nevada, Cascades and Trinity Alps; the snowline for each section is set from its % (about 1,500 / 1,800 /
    2,150 m at 100% in the north / centre / south, lower in a big year, only the high peaks in a dry one), split by
    latitude at 39.35° and 37.55° N (an approximation of the basin groups). In the melt months (April to July) pale
    pulses run down the mountain reservoirs' inflow rivers, scaled by how much the section's snowpack fell between the
    1st of that month and the 1st of the next. The 2D map washes the mountain counties of each section white by its %
    (a region indication, not the actual snow extent).

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
- `python3 scripts/fetch_snow.py`: CDEC snow pillows → `data/snowpack_monthly.json` (run after `fetch_cdec.py`; it
  ends at the last storage month). Takes about six minutes.

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
