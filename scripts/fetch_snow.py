#!/usr/bin/env python3
"""Build data/snowpack_monthly.json: snowpack as % of April 1 average, statewide and
for CDEC's North / Central / South Sierra sections, one value per month from
October 2011 to the last month in data/reservoir_storage_monthly.csv.

Method (mirrors CDEC's "Daily Statewide Summary of Snow Water Content", report DLYSWEQ):
  * Stations: the snow pillows CDEC lists under "Stations included" in DLYSWEQ
    (https://cdec.water.ca.gov/reportapp/javareports?name=DLYSWEQ), by section.
    LVT is listed under both Central and South there; it counts in both sections
    and once statewide.
  * April 1 average per station: the "Apr 1 Avg (IN)" column of CDEC's Daily Snow
    Sensor Report (https://cdec.water.ca.gov/reportapp/javareports?name=PAGE6).
  * Snow water equivalent: CDEC sensor 3 (SNOW WC, inches), duration D, from
    https://cdec.water.ca.gov/dynamicapp/req/CSVDataServlet?Stations=..&SensorNums=3&dur_code=D
    The month's value is the reading on the 1st of the month (the snow-survey
    convention: "April" = April 1), falling back to the 2nd or 3rd if the 1st is
    missing. Readings below 0 are counted as 0; readings above
    max(150 in, 4 x the station's April 1 average) are treated as sensor errors.
  * Section % = sum of SWE over the reporting stations / sum of those stations'
    April 1 averages. Statewide % = the same over every listed station.
    A section with fewer than half of its stations reporting has no value that
    month (null = "no data"); it is never interpolated.

Usage: python3 scripts/fetch_snow.py
"""
import csv
import datetime as dt
import io
import json
import re
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPORT = "https://cdec.water.ca.gov/reportapp/javareports?name={}"
URL = ("https://cdec.water.ca.gov/dynamicapp/req/CSVDataServlet"
       "?Stations={ids}&SensorNums=3&dur_code=D&Start={start}&End={end}")
SECTIONS = ("north", "central", "south")


def get(url):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=180) as resp:
                return resp.read().decode("utf-8", "replace")
        except OSError:
            if attempt == 2:
                raise
            time.sleep(3)


def text_of(html):
    t = re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", t)


def station_lists():
    t = text_of(get(REPORT.format("DLYSWEQ")))
    out = {}
    for key, label, nxt in (("north", "North:", "Central:"), ("central", "Central:", "South:"),
                            ("south", "South:", "var baseName")):
        seg = t[t.index(label, t.index("Stations included")) + len(label): t.index(nxt, t.index("Stations included"))]
        seg = re.sub(r"\([^)]*\)", " ", seg)
        out[key] = re.findall(r"\b[A-Z0-9]{3}\b", seg)
    return out


def april_averages():
    t = text_of(get(REPORT.format("PAGE6")))
    # "<Name> <ID> <Agency...> <elev> <apr1avg> ..." e.g. "Peterson Flat PET DWR 7,150 24.6 0.0 r 0% ..."
    avgs = {}
    for m in re.finditer(r"([A-Z][A-Za-z0-9 .'()/-]*?) ([A-Z0-9]{3}) [A-Za-z/&.\- ]+? ([\d,]{3,6}) ([\d.]+|---) ", t):
        sid, elev, avg = m.group(2), m.group(3), m.group(4)
        if avg != "---" and sid not in avgs:
            avgs[sid] = {"name": m.group(1).strip(), "elev_ft": int(elev.replace(",", "")), "apr1_in": float(avg)}
    return avgs


def months_between(first, last):
    y, m = map(int, first.split("-"))
    out = []
    while f"{y:04d}-{m:02d}" <= last:
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def main():
    with open(ROOT / "data/reservoir_storage_monthly.csv", newline="") as fh:
        last = max(row["date"] for row in csv.DictReader(fh))
    months = months_between("2011-10", last)
    lists = station_lists()
    avgs = april_averages()
    all_ids = sorted({s for ids in lists.values() for s in ids})
    missing_avg = [s for s in all_ids if s not in avgs]
    ids = [s for s in all_ids if s in avgs]

    end = (dt.date(int(last[:4]), int(last[5:]), 1) + dt.timedelta(days=3)).isoformat()
    day1 = {}   # (station, month) -> SWE inches
    for i in range(0, len(ids), 8):
        chunk = ids[i:i + 8]
        rows = csv.DictReader(io.StringIO(get(URL.format(ids=",".join(chunk), start="2011-10-01", end=end))))
        for rec in rows:
            stamp = rec["DATE TIME"][:8]
            if int(stamp[6:8]) > 3:
                continue
            try:
                v = float(rec["VALUE"].strip())
            except ValueError:
                continue
            sid = rec["STATION_ID"]
            if v > max(150.0, 4 * avgs[sid]["apr1_in"]) or v < -5:
                continue
            key = (sid, f"{stamp[:4]}-{stamp[4:6]}")
            day = int(stamp[6:8])
            if key not in day1 or day < day1[key][0]:
                day1[key] = (day, max(v, 0.0))
        time.sleep(0.5)

    def pct(stations, month):
        rep = [s for s in stations if (s, month) in day1]
        if len(rep) < 0.5 * len(stations):
            return None, len(rep)
        swe = sum(day1[(s, month)][1] for s in rep)
        base = sum(avgs[s]["apr1_in"] for s in rep)
        return round(100 * swe / base, 1), len(rep)

    out = {
        "source": "CDEC (California Data Exchange Center), California Cooperative Snow Surveys snow pillows, sensor 3 daily",
        "method": "Reading on the 1st of each month (2nd/3rd if missing); % = sum of station SWE / sum of their CDEC April 1 averages (PAGE6); a section needs half its stations reporting, else null.",
        "generated": dt.date.today().isoformat(),
        "months": months,
        "stations": {k: [s for s in v if s in avgs] for k, v in lists.items()},
        "apr1_in": {s: avgs[s]["apr1_in"] for s in ids},
    }
    for key in SECTIONS:
        vals = [pct(out["stations"][key], m) for m in months]
        out[key] = [v for v, _ in vals]
        out[key + "_reporting"] = [n for _, n in vals]
    vals = [pct(ids, m) for m in months]
    out["statewide"] = [v for v, _ in vals]
    out["statewide_reporting"] = [n for _, n in vals]

    path = ROOT / "data/snowpack_monthly.json"
    path.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"wrote {path}: {len(months)} months, {len(ids)} stations"
          + (f"; no April 1 average for {', '.join(missing_avg)}" if missing_avg else ""))
    for m in ("2015-04", "2017-04", "2021-04", "2023-04", "2024-04", "2025-04", "2026-04"):
        if m in months:
            i = months.index(m)
            print(m, out["statewide"][i], [out[k][i] for k in SECTIONS])


if __name__ == "__main__":
    main()
